let DB = require('../Base/Data/DB');
let Cache = require('../Base/Data/Cache');
let config = require('../Base/config');
let Utils = require('../Base/Utils/Utils');
let moment = require('moment');
let io = require('socket.io-client');
let socket = io(config.socketDomain);
let axios = require('axios');
let AssetsModel = require('../Model/AssetsModel');
let CoinModel = require('../Model/CoinModel');
let MQ = require('../Base/Data/MQ');
let Enumerable = require('linq');
const rp = require('request-promise');

class EntrustModel {

  constructor() {

  }

  async getOpenEntrustByEntrustId(entrustId, coinExchangeId, entrustTypeId, refresh = false) {
    let cache = await Cache.init(config.cacheDB.order);
    try {
      let ckey = (entrustTypeId == 1 ? config.cacheKey.Buy_Entrust : config.cacheKey.Sell_Entrust) + coinExchangeId;
      if (await cache.exists(ckey) && !refresh) {
        let cRes = await cache.hgetall(ckey);
        if (Object.keys(cRes) && await Object.keys(cRes).includes(entrustId.toString())) {
          return JSON.parse(cRes[entrustId])
        }
      }
      let cnt = await DB.cluster('salve');
      let sql = `select * from m_entrust where entrust_id = ? and (entrust_status = 0 or entrust_status = 1)  `;
      let res = await cnt.execReader(sql, entrustId);
      await cnt.close();
      if (res && await cache.exists(ckey)) {
        await cache.hset(ckey, res.entrust_id, res, 300);
      }
      return res;

    } catch (error) {
      throw error;
    }
    finally {
      await cache.close();
    }

  }

  async addEntrust({userId, coinExchangeId, entrustTypeId, coinId, exchangeCoinId, buyFeesRate, sellFeesRate, entrustPrice, entrustVolume}) {
    let cnt = await DB.cluster('master');
    let res = 0;
    try {
      let serialNum = moment().format('YYYYMMDDHHmmssSSS');
      let feesRate = entrustTypeId == 1 ? buyFeesRate : sellFeesRate;
      let totalAmount = Utils.checkDecimal(Utils.mul(entrustPrice, entrustVolume), 8);

      await cnt.transaction();
      //冻结用户资产
      let updAssets = null;
      if (entrustTypeId == 1) {
        // console.log('userId:', userId, 'buy coinId:', exchangeCoinId, 'totalAmount:', totalAmount);
        updAssets = await cnt.execQuery(`update m_user_assets set available = available - ? , frozen = frozen + ?
                where user_id = ? and coin_id = ? and available>= ?`, [totalAmount, totalAmount, userId, exchangeCoinId, totalAmount]);
      } else {
        // console.log('userId:', userId, 'sell coinId:', coinId, 'totalAmount:', entrustVolume);
        updAssets = await cnt.execQuery(`update m_user_assets set available = available - ? , frozen = frozen + ?
                where user_id = ? and coin_id = ? and available >= ?`, [entrustVolume, entrustVolume, userId, coinId, entrustVolume]);
      }
      let params = {
        serial_num: serialNum,
        user_id: userId,
        coin_exchange_id: coinExchangeId,
        entrust_type_id: entrustTypeId,
        entrust_price: entrustPrice,
        entrust_volume: entrustVolume,
        completed_volume: 0,
        no_completed_volume: entrustVolume,
        total_amount: totalAmount,
        completed_total_amount: 0,
        average_price: 0,
        trade_fees_rate: feesRate,
        trade_fees: 0,
        entrust_status: 0,
        entrust_status_name: '待成交'
      };
      let entrustRes = await cnt.edit('m_entrust', params);

      if (entrustRes.affectedRows && updAssets.affectedRows) {
        await cnt.commit();
        let entrustMQ = await MQ.push(config.MQKey.Entrust_Queue + coinExchangeId, {
          ...{...params, entrust_id: entrustRes.insertId, create_time: Date.now()}
          , comments: '发送委托了'
        });
        await AssetsModel.getUserAssetsByUserId(userId, true);
        res = {...params, entrust_id: entrustRes.insertId, create_time: Date.now()};
      } else {
        cnt.rollback();
      }
    } catch (error) {
      cnt.rollback();
      console.error(Utils.checkDecimal(Utils.mul(entrustPrice, entrustVolume), 8));
      throw error;

    }
    finally {
      await cnt.close();
    }
    return res;
  }

  async cancelEntrust({userId, entrustId, coinExchangeId, entrustTypeId}) {
    let cnt = await DB.cluster('master');
    let res = 0;
    let unlock_coin_id = null;
    let unlcok_volume = null;
    try {
      let entrust = await this.getOpenEntrustByEntrustId(entrustId, coinExchangeId, entrustTypeId, true);
      if (entrust && entrust.user_id == userId && (entrust.entrust_status == 0 || entrust.entrust_status == 1)) {
        //0 待成交 1 部分成交 2 已完成 3 已取消
        let coinExchangeList = await CoinModel.getCoinExchangeList();
        let coinEx = coinExchangeList.find((item) => item.coin_exchange_id == coinExchangeId);
        await cnt.transaction();
        let updEntrust = await cnt.edit('m_entrust', {
          entrust_status: 3,
          entrust_status_name: '已取消'
        }, {entrust_id: entrustId});
        if (entrustTypeId === 1) {
          unlock_coin_id = coinEx.exchange_coin_id;
          unlcok_volume = Utils.checkDecimal(Utils.mul(entrust.no_completed_volume, entrust.entrust_price), coinEx.exchange_decimal_digits);
        } else {
          unlock_coin_id = coinEx.coin_id;
          unlcok_volume = entrust.no_completed_volume;
        }
        let updAssets = await cnt.execQuery(`update m_user_assets set available = available + ? , frozen = frozen - ? 
                    where user_id = ? and coin_id = ? and frozen >= ?`, [unlcok_volume, unlcok_volume, userId, unlock_coin_id, unlcok_volume]);
        if (updEntrust.affectedRows && updAssets.affectedRows) {
          await cnt.commit();
          let refreshAssets = await AssetsModel.getUserAssetsByUserId(userId, true);
          let cache = await Cache.init(config.cacheDB.order);
          //buy or sell entrust list
          let ckey = (entrust.entrust_type_id == 1 ? config.cacheKey.Buy_Entrust : config.cacheKey.Sell_Entrust) + coinExchangeId;
          if (await cache.exists(ckey) && await cache.hexists(ckey, entrust.entrust_id)) {
            await cache.hdel(ckey, entrust.entrust_id);
          }
          //entrust_ceid_userid
          let uckey = config.cacheKey.Entrust_UserId + entrust.user_id;
          if (await cache.exists(uckey) && await cache.hexists(uckey, entrust.entrust_id)) {
            await cache.hdel(uckey, entrust.entrust_id);
          }
          await cache.close();
          socket.emit('entrustList', {coin_exchange_id: coinExchangeId});
          socket.emit('userEntrustList', {user_id: entrust.user_id, coin_exchange_id: coinExchangeId});
          res = 1;
        } else {
          cnt.rollback();
          console.log("cancel the entrust fail " + entrust.entrust_id);
        }
      } else {
        res = -1;
      }
    } catch (error) {
      cnt.rollback();
      throw error;
    } finally {
      await cnt.close();
    }
    return res;
  }


  async getCoinexchangeBasePrice(refresh = false) {
    let cache = await Cache.init(config.cacheDB.system);
    try {
      let ckey = config.cacheKey.Sys_Base_Coin_Prices;
      if (await cache.exists(ckey) && !refresh) {
        let cRes = await cache.hgetall(ckey);
        if (cRes) {
          let data = [];
          for (let i in cRes) {
            let item = cRes[i];
            data.push(JSON.parse(item));
          }
          return data;
        }
      } else {
        let res = [];
        let currency = JSON.parse(await rp({
          method: 'GET',
          uri: config.currency_api,
          qs: {
            access_key: config.currency_secret,
          }
        }));
        let gtt_value = {
          name: 'GTT',
          symbol: 'GTT',
          price_usd: 1 / currency.quotes.USDCNY,
          last_updated: new Date(currency.timestamp * 1000).toISOString()
        };
        res.push(gtt_value);
        const requestOptions = {
          method: 'GET',
          uri: config.coinmarket_api,
          qs: {
            symbol: 'BTC,ETH,XRP,EOS,LTC,USDT',
            convert: 'USD'
          },
          headers: {
            'X-CMC_PRO_API_KEY': config.coinmarket_secret
          },
          json: true,
          gzip: true
        };

        let response = await rp(requestOptions);
        // console.log('API call response:', response);

        if (response) {
          let ckey = config.cacheKey.Sys_Base_Coin_Prices;
          for (let i in response.data) {
            let item = response.data[i];
            let value = {
              name: item.name,
              symbol: item.symbol,
              price_usd: item.quote.USD.price,
              last_updated: item.last_updated
            };
            res.push(value);
            if (item.symbol.toLowerCase() == 'btc') {
              let GTB_BTC_CoinID = await CoinModel.getCoinIDbyName('GTB/BTC');
              let last_order = await this.getLastOrder(GTB_BTC_CoinID);
              if (last_order) {
                let GTB_BTC_Price = last_order.trade_price;
                let gtb_value = {
                  name: 'GTB',
                  symbol: "GTB",
                  price_usd: GTB_BTC_Price * value.price_usd,
                  last_updated: item.last_updated
                };
                res.push(gtb_value);
              }
            }
          }
          await Promise.all(res.map(item => {
            return cache.hset(ckey, item.symbol.toLowerCase(), item);
          }));
        }
        return res
      }
    } catch (e) {
      throw e
    } finally {
      cache.close();
    }
  }


  async getMarketList(refresh = false) {
    let cache = await Cache.init(config.cacheDB.order);
    try {
      let ckey = config.cacheKey.Market_List;
      if (await cache.exists(ckey) && !refresh) {
        let cRes = await cache.hgetall(ckey);
        if (cRes) {
          let data = [];
          for (let i in cRes) {
            let item = cRes[i];
            data.push(JSON.parse(item));
          }
          return data;
        }
      }
      let coinExList = await CoinModel.getCoinExchangeList();
      let Base_Prices = await this.getCoinexchangeBasePrice();

      let marketList = [];
      let date = new Date();
      let timestamp = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 1000;
      let CoinPrice = {};

      let res = await Promise.all(coinExList.map(async (item) => {
        let marketModel = {
          last_price: 0,
          change_rate: 0,
          high_price: 0,
          low_price: 0,
          total_volume: 0,
          total_amount: 0
        };
        let price_usd = 0;
        let price_cny = 0;
        let Day_Klinedata = await this.getKlineData(item.coin_exchange_id, 86400000);
        let marketRes = Day_Klinedata.find((a) => a.timestamp == timestamp);
        if (marketRes) {
          marketModel.high_price = marketRes.high_price;
          marketModel.low_price = marketRes.low_price;
          marketModel.total_volume = marketRes.volume;
          marketModel.total_amount = marketRes.volume * marketRes.close_price + item.base_amount;
          marketModel.change_rate = (marketRes.close_price - marketRes.open_price) / marketRes.open_price;
          marketModel.last_price = marketRes.close_price;
        }
        let exchange_coin_prices = Base_Prices.find(i => i.symbol.toLowerCase() == item.exchange_coin_name.toLowerCase());
        let gtt_prices = Base_Prices.find(i => i.symbol.toLowerCase() === 'gtt');
        if (exchange_coin_prices) {
          price_usd = marketModel.last_price * exchange_coin_prices.price_usd;
          price_cny = price_usd / gtt_prices.price_usd;
        }
        if (price_usd) {
          CoinPrice[item.coin_id] = price_usd;
        }
        marketList.push({
          coin_exchange_id: item.coin_exchange_id,
          market: marketModel,
          coinEx: item,
          price_usd: price_usd,
          price_cny: price_cny
        });
      }));
      marketList = marketList.map(
        function (item) {
          CoinPrice[item.coinEx.coin_id] = item['price_usd'];
          item['price_usd'] = CoinPrice[item.coinEx.coin_id];
          return item
        }
      );
      let coinpricelist = Object.entries(CoinPrice);
      for (let i in coinpricelist) {
        await cache.hset(config.cacheKey.Sys_Base_Coin_Prices, coinpricelist[i][0], coinpricelist[i][1]);
      }
      let chRes = await Promise.all(marketList.map((market) => {
        return cache.hset(
          ckey,
          market.coin_exchange_id,
          market
        )
      }));
      await cache.expire(ckey, 60);
      return marketList;

    }

    catch (error) {
      throw error;
    }

    finally {
      await cache.close();
    }
  }

  async getMarkets() {
    let cnt = await DB.cluster('slaves');
    try {
      let sql = 'SELECT max(last24.trade_price) as high_price,' +
        'min(last24.trade_price) as low_price,' +
        'sum(last24.trade_volume) as total_volume,' +
        'sum(last24.trade_amount) as total_amount,' +
        'last24.coin_exchange_id ' +
        'from (select * FROM m_order Where  create_time >= (now() - interval 24 hour) ) as last24 ' +
        ' group by coin_exchange_id;';
      // console.log(sql);
      let res = await cnt.execQuery(sql);
      if (res) {
        return res
      } else {
        return null
      }
    } catch (e) {
      console.error(e);
    } finally {
      await
        cnt.close();
    }
  }

  async getLastOrder(coinExchangeID = null) {
    let cnt = await DB.cluster('slaves');
    try {
      if (coinExchangeID) {
        let sql = 'select * from m_order where coin_exchange_id=? order by order_id desc limit 1';
        let res = await cnt.execQuery(sql, coinExchangeID);
        if (res) {
          return res[0]
        } else {
          return null
        }
      } else {
        let sql = 'select * from m_order where order_id in (select max(order_id) from m_order where  create_time >= (now() - interval 24 hour) group by coin_exchange_id)';
        let res = await cnt.execQuery(sql);
        if (res) {
          return res
        } else {
          return null
        }
      }

    } catch (e) {
      console.error(e);
    } finally {
      await
        cnt.close();
    }
  }

  async getPre24FirstOrder(coinExchangeID = null) {
    let cnt = await DB.cluster('slaves');
    try {
      if (coinExchangeID) {
        let sql = 'select * from m_order where coin_exchange_id=? and create_time >= (now() - interval 24 hour) order by order_id asc limit 1';
        let res = await cnt.execQuery(sql, coinExchangeID);
        if (res) {
          return res[0]
        } else {
          return null
        }
      } else {
        let sql = 'select coin_exchange_id,trade_price from m_order where order_id in (select min(order_id) from m_order where  create_time >= (now() - interval 24 hour) group by coin_exchange_id)';
        let res = await cnt.execQuery(sql);
        if (res) {
          return res
        } else {
          return null
        }
      }

    } catch (e) {
      console.error(e);
    } finally {
      await
        cnt.close();
    }
  }


  async getOrderListByCoinExchangeId(coinExchangeId, refresh = false) {
    let cache = await Cache.init(config.cacheDB.order);
    try {
      let ckey = config.cacheKey.Order_Coin_Exchange_Id + coinExchangeId;
      if (await cache.exists(ckey) && !refresh
      ) {
        let cRes = await cache.hgetall(ckey);
        if (cRes) {
          let data = [];
          for (let i in cRes) {
            let item = cRes[i];
            data.push(JSON.parse(item));
          }
          return data;
        }
      }
      let cnt = await DB.cluster('slave');
      let sql = `SELECT * FROM m_order WHERE coin_exchange_id = ? ORDER BY create_time DESC LIMIT 30 `;
      let res = await cnt.execQuery(sql, coinExchangeId);
      await cnt.close();
      let chRes = await
        Promise.all(res.map((info) => {
          return cache.hset(
            ckey,
            info.order_id,
            info
          )
        }));
      await cache.expire(ckey, 600);
      return res;

    } catch (error) {
      throw error;
    }
    finally {
      await cache.close();
    }
  }

  async getEntrustListByUserId(userId, coinExchangeId, refresh = false) {
    let cache = await Cache.init(config.cacheDB.order);
    try {
      let ckey = config.cacheKey.Entrust_UserId + userId;
      if (await cache.exists(ckey) && !refresh
      ) {
        let cRes = await
          cache.hgetall(ckey);
        if (cRes) {
          let data = [];
          for (let i in cRes) {
            let item = cRes[i];
            data.push(JSON.parse(item));
          }
          return data;
        }
      }
      let cnt = await DB.cluster('slave');
      let sql = `SELECT * FROM m_entrust WHERE user_id = ? and (entrust_status = 0 or entrust_status = 1) `;
      let res = await cnt.execQuery(sql, userId);
      await cnt.close();

      let chRes = await Promise.all(res.map((info) => {
          return cache.hset(
            ckey,
            info.entrust_id,
            info
          )
        }));
      await cache.expire(ckey, 300);
      return res;
    } catch (error) {
      throw error;
    }
    finally {
      await cache.close();
    }
  }

  async getEntrustList(coin_exchange_id, refresh = false) {
    let cache = await Cache.init(config.cacheDB.order);
    try {
      let ckey = config.cacheKey.Entrust_List + coin_exchange_id;
      if (await cache.exists(ckey) && !refresh
      ) {
        let cRes = await cache.get(ckey);
        return cRes
      }
      else {
        let buyList = await this.getBuyEntrustListByCEId(coin_exchange_id);
        let newBuyList = Enumerable.from(buyList)
          .groupBy("parseFloat($.entrust_price)", null,
            function (key, g) {
              return {
                entrust_price: key,
                entrust_volume: g.sum("parseFloat($.entrust_volume)"),
                no_completed_volume: g.sum("parseFloat($.no_completed_volume)")
              }
            }).orderByDescending("parseFloat($.entrust_price)").take(10).toArray();
        let sellList = await this.getSellEntrustListByCEId(coin_exchange_id);
        let newSellList = Enumerable.from(sellList)
          .groupBy("parseFloat($.entrust_price)", null,
            function (key, g) {
              return {
                entrust_price: key,
                entrust_volume: g.sum("parseFloat($.entrust_volume)"),
                no_completed_volume: g.sum("parseFloat($.no_completed_volume)")
              }
            }).orderBy("parseFloat($.entrust_price)").take(10).toArray();
        newSellList.sort((item1, item2) => {
          return item2.entrust_price - item1.entrust_price
        });
        await cache.set(ckey, {"buyList": newBuyList, "sellList": newSellList});
        await cache.expire(ckey, 5);
        return {buyList: newBuyList, sellList: newSellList};
        // let cnt = await DB.cluster('slave');
        // let sql = 'select e.entrust_price as entrust_price, sum(e.entrust_volume) as entrust_volume, sum(e.no_completed_volume) as no_completed_volume from ' +
        //   '(SELECT * FROM m_entrust WHERE coin_exchange_id = {0} and entrust_type_id = {1} and entrust_status in (0,1) ) as e ' +
        //   'group by entrust_price ' +
        //   'order by entrust_price {2} limit 10';
        // let buysql = Utils.formatString(sql, [coin_exchange_id, 1, "desc"]);
        // let sellsql = Utils.formatString(sql, [coin_exchange_id, 0, "asc"]);
        // let BuyList = await cnt.execQuery(buysql);
        // let SellList = await cnt.execQuery(sellsql);
        // let NewSellList = Enumerable.from(SellList).orderByDescending("parseFloat($.entrust_price)").toArray();
        // await cache.set(ckey, {"buyList": BuyList, "sellList": NewSellList}, 10);
        // return {buyList: BuyList, sellList: NewSellList};
      }
    } catch (e) {
      console.error(e);
      return {buyList: [], sellList: []};
    } finally {
      await
        cache.close();
    }
  }

  async getTransactionAmount(user_id, coin_id, type, date = moment(new Date()).format('YYYY-MM-DD')) {
    let cnt = await DB.cluster('slave');
    try {
      let sql = 'select sum(trade_amount) as amount ,user_id from m_user_assets_log where user_id=? and user_assets_log_type_id=?  and date(create_time)=? and coin_id =?';
      let user_gtt_transaction = await cnt.execQuery(sql, [user_id, type, date, coin_id]);
      return user_gtt_transaction[0].amount > 0 ? user_gtt_transaction[0].amount : 0
    } catch (e) {
      throw e
    } finally {
      await cnt.close();
    }
  }

  async getBuyEntrustListByCEId(coinExchangeId, refresh = false) {
    let cache = await Cache.init(config.cacheDB.order);
    let cnt = await DB.cluster('slave');
    try {
      let ckey = config.cacheKey.Buy_Entrust + coinExchangeId;
      if (await cache.exists(ckey) && !refresh
      ) {
        let buyRes = await cache.hgetall(ckey);
        if (buyRes) {
          let data = [];
          for (let i in buyRes) {
            let item = buyRes[i];
            data.push(JSON.parse(item));
          }
          return data;
        }
      }
      let sql = `SELECT * FROM m_entrust WHERE coin_exchange_id = ? and entrust_type_id = 1 and entrust_status in (0,1) ORDER BY entrust_price DESC, entrust_id ASC limit 100`;
      let res = await cnt.execQuery(sql, coinExchangeId);
      let chRes = await
        Promise.all(res.map((info) => {
          return cache.hset(
            ckey,
            info.entrust_id,
            info
          )
        }));
      await cache.expire(ckey, 10);
      return res;

    } catch (error) {
      throw error;
    } finally {
      await cache.close();
      await cnt.close();
    }
  }

  async getSellEntrustListByCEId(coinExchangeId, refresh = false) {
    let cache = await Cache.init(config.cacheDB.order);
    let cnt = await DB.cluster('slave');
    try {
      let ckey = config.cacheKey.Sell_Entrust + coinExchangeId;
      if (await cache.exists(ckey) && !refresh
      ) {
        let sellRes = await cache.hgetall(ckey);
        if (sellRes) {
          let data = [];
          for (let i in sellRes) {
            let item = sellRes[i];
            data.push(JSON.parse(item));
          }
          return data;
        }
      }

      let sql = `SELECT * FROM m_entrust WHERE coin_exchange_id = ? and entrust_type_id = 0 and entrust_status in (0,1) ORDER BY entrust_price ASC, entrust_id ASC limit 100`;
      let res = await cnt.execQuery(sql, coinExchangeId);
      let chRes = await Promise.all(res.map((info) => {
        return cache.hset(
          ckey,
          info.entrust_id,
          info
        )
      }));
      await cache.expire(ckey, 10);
      return res;

    } catch (error) {
      throw error;
    } finally {
      await cache.close();
      await cnt.close();
    }
  }

  async getKlineData(coinExchangeId, range, refresh = false) {
    let cache = await Cache.init(config.cacheDB.kline);
    let cnt = await DB.cluster('slave');
    try {
      let ckey = config.cacheKey.KlineData_CEID_Range + coinExchangeId + '_' + range;
      if (await cache.exists(ckey) && !refresh
      ) {
        let cRes = await cache.hgetall(ckey);
        if (cRes) {
          let data = [];
          for (let i in cRes) {
            let item = cRes[i];
            data.push(JSON.parse(item));
          }
          return data;
        }
      }
      let sql = `SELECT datestamp, timestamp, open_price, close_price, high_price, low_price, volume
                       FROM m_kline
                       WHERE coin_exchange_id_range = ?
                       ORDER BY timestamp DESC
                       LIMIT 500`;

      let res = await cnt.execQuery(sql, ckey);
      let chRes = await Promise.all(res.map((info) => {
          return cache.hset(
            ckey,
            info.timestamp,
            info
          )
        }));
      await cache.expire(ckey, 86400);
      return res;

    } catch (error) {
      throw error;
    } finally {
      await cache.close();
      await cnt.close();
    }
  }

  async getHistoryEntrustListByUserId(userId, coinExchangeId, limit = 50) {
    let cnt = await DB.cluster('slave');
    try {
      let sql = `SELECT * FROM m_entrust WHERE user_id = ? and coin_exchange_id = ? and entrust_status in (2,3) order by entrust_id desc limit ? `;
      let res = await cnt.execQuery(sql, [userId, coinExchangeId, limit]);
      return res;

    } catch (error) {
      throw error;
    } finally {
      await cnt.close();
    }
  }

  async ResetEntrust(coin_exchange_id, user_id) {
    let cache = await Cache.init(config.cacheDB.order);
    let cnt = await DB.cluster('master');
    try {
      //delete mysql entrusts for coin_exchange_id
      let delete_entrust_sql = `delete from m_entrust where coin_exchange_id = ?`;
      let delete_entrust = await
        cnt.execQuery(delete_entrust_sql, coin_exchange_id);
      //delet mysql orders for coin_exchange_id
      let delete_order_sql = `delete from m_order where coin_exchange_id = ?`;
      let reset_balance_sql = `update m_user_assets set available=100000000, balance=100000000,frozen=0 where user_id=?`;
      let reset_balance = await cnt.execQuery(reset_balance_sql, [user_id]);
      let delete_order = await cnt.execQuery(delete_order_sql, [coin_exchange_id]);

      let chRes = await Promise.all([delete_entrust, delete_order, reset_balance]);

      // delete redis hash key for entrust, user,kline
      await cache.del(config.cacheKey.Buy_Entrust + coin_exchange_id);
      await cache.del(config.cacheKey.Sell_Entrust + coin_exchange_id);
      await cache.del(config.cacheKey.Order_Coin_Exchange_Id + coin_exchange_id);
      await cache.del(config.cacheKey.Entrust_UserId + user_id);
      await cache.select(config.cacheDB.kline);
      let range_list = [300000, 900000, 1800000, 14400000, 21600000, 43200000, 60000];
      await Promise.all(range_list.map((range) => {
          return cache.del(config.cacheKey.KlineData_CEID_Range + coin_exchange_id + '_' + range)
        }));
      await cache.select(config.cacheDB.users);
      await cache.flushdb();
      return true;

    } catch (error) {
      console.error(error);
      return false;
    }
    finally {
      await cnt.close();
      await cache.close();
    }
  }


}

module.exports = new EntrustModel();
