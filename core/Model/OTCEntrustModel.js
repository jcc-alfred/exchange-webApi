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


class OTCEntrustModel {

  constructor() {

  }

  async getOpenEntrustByEntrustId(entrustId) {
    try {

      let cnt = await DB.cluster('salve');
      let sql = `select * from m_otc_entrust where id = ? and (status = 0 or status = 1)  `;
      let res = await cnt.execReader(sql, entrustId);
      await cnt.close();
      return res;
    } catch (error) {
      throw error;
    }
  }

  async addEntrust({userId, coinExchangeId, entrustTypeId, coinId, exchangeCoinId, buyFeesRate, sellFeesRate, entrustPrice, entrustVolume}) {
    let cnt = await DB.cluster('master');
    let res = 0;
    try {
      let serialNum = moment().format('YYYYMMDDHHmmssSSS');
      let feesRate = entrustTypeId == 1 ? buyFeesRate : sellFeesRate;
      let totalAmount = Utils.checkDecimal(Utils.mul(entrustPrice, entrustVolume), 8);

      cnt.transaction();
      //冻结用户资产
      let updAssets = null;
      if (entrustTypeId == 1) {
        // console.log('userId:', userId, 'buy coinId:', exchangeCoinId, 'totalAmount:', totalAmount);
        updAssets = await cnt.execQuery(`update m_user_assets set available = available - ? , frozen = frozen + ?
                where user_id = ? and coin_id = ?`, [totalAmount, totalAmount, userId, exchangeCoinId]);
      } else {
        // console.log('userId:', userId, 'sell coinId:', coinId, 'totalAmount:', entrustVolume);
        updAssets = await cnt.execQuery(`update m_user_assets set available = available - ? , frozen = frozen + ?
                where user_id = ? and coin_id = ?`, [entrustVolume, entrustVolume, userId, coinId]);
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
      let entrustMQ = false;
      if (entrustRes) {
        entrustMQ = await MQ.push(config.MQKey.Entrust_Queue + coinExchangeId, {
          ...{...params, entrust_id: entrustRes.insertId, create_time: Date.now()}
          , comments: '发送委托了'
        });
      }
      if (entrustRes.affectedRows && updAssets.affectedRows && entrustMQ) {
        cnt.commit();
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
    try {
      let entrust = await this.getOpenEntrustByEntrustId(entrustId, coinExchangeId, entrustTypeId, true);
      if (entrust && entrust.user_id == userId && (entrust.entrust_status == 0 || entrust.entrust_status == 1)) {
        //0 待成交 1 部分成交 2 已完成 3 已取消
        let coinExchangeList = await CoinModel.getCoinExchangeList();
        let coinEx = coinExchangeList.find((item) => item.coin_exchange_id == coinExchangeId);
        let totalNoCompleteAmount = Utils.checkDecimal(Utils.mul(entrust.no_completed_volume, entrust.entrust_price), coinEx.exchange_decimal_digits);
        cnt.transaction();
        let updEntrust = await cnt.edit('m_entrust', {
          entrust_status: 3,
          entrust_status_name: '已取消'
        }, {entrust_id: entrustId});
        let updAssets = null;
        if (entrust.entrust_type_id == 1) {
          updAssets = await cnt.execQuery(`update m_user_assets set available = available + ? , frozen = frozen - ? 
                    where user_id = ? and coin_id = ? and frozen >= ?`, [totalNoCompleteAmount, totalNoCompleteAmount, userId, coinEx.exchange_coin_id, totalNoCompleteAmount]);
        } else {
          updAssets = await cnt.execQuery(`update m_user_assets set available = available + ? , frozen = frozen - ? 
                    where user_id = ? and coin_id = ? and frozen >= ?`, [entrust.no_completed_volume, entrust.no_completed_volume, userId, coinEx.coin_id, entrust.no_completed_volume]);
        }
        if (updEntrust.affectedRows && updAssets.affectedRows) {
          cnt.commit();
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
          // console.log("cancel the entrust success " + entrust.entrust_id);
        } else {
          cnt.rollback();
          console.log("cancel the entrust fail " + entrust.entrust_id);
        }
      } else {
        res = -1;
      }
    } catch (error) {
      // console.error(error);
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
            start: 1,
            limit: 5,
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
          Promise.all(res.map(item => {
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
        // let startk = new Date();
        let Day_Klinedata = await this.getKlineData(item.coin_exchange_id, 86400000);
        // console.log(new Date() - startk, 'end get kline for coin ' + item.coin_exchange_id);
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
        if (exchange_coin_prices) {
          price_usd = marketModel.last_price * exchange_coin_prices.price_usd;
        }
        marketList.push({
          coin_exchange_id: item.coin_exchange_id,
          market: marketModel,
          coinEx: item,
          price_usd: price_usd
        });
      }));
      let chRes = await Promise.all(marketList.map((market) => {
        return cache.hset(
          ckey,
          market.coin_exchange_id,
          market
        )
      }));
      await cache.expire(ckey, 60);
      return marketList;

    } catch (error) {
      throw error;
    } finally {
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
      await cnt.close();
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
      await cnt.close();
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
      await cnt.close();
    }
  }


  async getOrderListByCoinExchangeId(coinExchangeId, refresh = false) {
    let cache = await Cache.init(config.cacheDB.order);
    try {
      let ckey = config.cacheKey.Order_Coin_Exchange_Id + coinExchangeId;
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
      let cnt = await DB.cluster('slave');
      let sql = `SELECT * FROM m_order WHERE coin_exchange_id = ? ORDER BY create_time DESC LIMIT 30 `;
      let res = await cnt.execQuery(sql, coinExchangeId);
      await cnt.close();
      let chRes = await Promise.all(res.map((info) => {
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
        x
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

  async getEntrustList(coin_exchange_id, refresh = true) {
    let cache = await Cache.init(config.cacheDB.order);
    try {
      let ckey = config.cacheKey.Entrust_List + coin_exchange_id;
      if (await cache.exists(ckey) && !refresh) {
        let cRes = await cache.get(ckey);
        return cRes
      } else {
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
        await cache.set(ckey, {"buyList": newBuyList, "sellList": newSellList}, 5);
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
      await cache.close();
    }
  }

  async getBuyEntrustListByCEId(coinExchangeId, refresh = true) {
    let cache = await Cache.init(config.cacheDB.order);
    let cnt = await DB.cluster('slave');
    try {
      let ckey = config.cacheKey.Buy_Entrust + coinExchangeId;
      if (await cache.exists(ckey) && !refresh) {
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
      let sql = `SELECT * FROM m_entrust WHERE coin_exchange_id = ? and entrust_type_id = 1 and entrust_status in (0,1) ORDER BY entrust_price DESC, entrust_id ASC limit 30`;
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

  async getSellEntrustListByCEId(coinExchangeId, refresh = true) {
    let cache = await Cache.init(config.cacheDB.order);
    let cnt = await DB.cluster('slave');
    try {
      let ckey = config.cacheKey.Sell_Entrust + coinExchangeId;
      if (await cache.exists(ckey) && !refresh) {
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

      let sql = `SELECT * FROM m_entrust WHERE coin_exchange_id = ? and entrust_type_id = 0 and entrust_status in (0,1) ORDER BY entrust_price ASC, entrust_id ASC limit 30`;
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
      let sql = `SELECT datestamp, timestamp, open_price, close_price, high_price, low_price, volume
                       FROM m_kline
                       WHERE coin_exchange_id_range = ?
                       ORDER BY timestamp DESC
                       LIMIT 500`;

      let res = await cnt.execQuery(sql, ckey);
      // console.log('from db' + coinExchangeId);

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

  async ResetEntrust(coin_exchange_id, user_id) {
    let cache = await Cache.init(config.cacheDB.order);
    let cnt = await DB.cluster('master');
    try {
      //delete mysql entrusts for coin_exchange_id
      let delete_entrust_sql = `delete from m_entrust where coin_exchange_id = ?`;
      let delete_entrust = await cnt.execQuery(delete_entrust_sql, coin_exchange_id);
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
      cache.select(config.cacheDB.kline);
      let range_list = [300000, 900000, 1800000, 14400000, 21600000, 43200000, 60000];
      await Promise.all(range_list.map((range) => {
        return cache.del(config.cacheKey.KlineData_CEID_Range + coin_exchange_id + '_' + range)
      }));
      cache.select(config.cacheDB.users);
      await cache.flushdb();
      return true;

    } catch (error) {
      throw error;
      return false
    }
    finally {
      await cnt.close();
      await cache.close();
    }
  }

  async getOpenEntrustList(coin_id, type, refresh = false) {
    let cacheCnt = await Cache.init(config.cacheDB.otc);
    let ckey = (type === 1 ? config.cacheKey.Buy_Entrust_OTC : config.cacheKey.Sell_Entrust_OTC) + coin_id;
    try {
      if (!refresh) {
        let cRes = await cacheCnt.hgetall(ckey);
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
      let sql = `select id,ad_user_id,
                    coin_id,
                    coin_name,
                    remaining_amount,
                    price,currency,
                    min_trade_amount,
                    min_trade_amount*price as min_money,
                    remaining_amount*price as max_money,
                    support_payments_id,valid_duration,
                    remark,
                    create_time 
                    from m_otc_entrust
                    where status={0} and coin_id ={1} and remaining_amount>0 order by price desc`;
      let res = await cnt.execQuery(Utils.formatString(sql, [type, coin_id]));
      await cnt.close();
      res = res.map(function (each) {
        each.support_payments_id = each.support_payments_id.split(',');
        return each;
      });

      let chRes = await Promise.all(res.map((entrust) => {
        return cacheCnt.hset(
          ckey,
          entrust.id,
          entrust
        )
      }));
      await cacheCnt.expire(ckey, 60);
      return res;

    } catch (error) {
      throw error;
    } finally {
      await cacheCnt.close();
    }
  }

  async getEntrustByID(entrust_id) {
    try {
      let cnt = await DB.cluster('slave');
      let entrust = await cnt.execQuery('select * from m_otc_entrust where id = ?', [entrust_id]);
      cnt.close();
      return entrust[0]
    } catch (e) {
      throw e
    }
  }

  async getOTCOrderByID(order_id) {
    let cnt = await DB.cluster('slave');
    let order = null;
    try {
      let data = await cnt.execQuery('select * from (select * from m_otc_order where id =?) a ' +
        'left join (select coin_name, coin_id ,type, trade_fee_rate from m_otc_exchange_area)b' +
        ' on a.coin_id = b.coin_id and a.trigger_type = b.type', order_id);
      if (data.length) {
        order = data[0];
        order.entrust = await this.getEntrustByID(order.entrust_id);
      }
      return order
    } catch (e) {
      throw e;
    } finally {
      cnt.close();
    }
  }

  async updateUserDefaultSecretRemark(user_id, secret_remark) {
    let cache = await Cache.init(config.cacheDB.users);
    let cnt = await DB.cluster('master');
    let ckey = config.cacheKey.User_OTC_Secret_Remark;
    try {
      let data = await cnt.insertOnDuplicate('m_otc_user_secret_remark', {
        user_id: user_id,
        secret_remark: secret_remark
      });
      await cache.hset(ckey, user_id, {user_id: user_id, secret_remark: secret_remark});
      return true
    } catch (e) {
      throw e;
    } finally {
      cache.close();
      cnt.close();
    }
  }

  async getUserDefaultSecretRemark(user_id) {
    let cache = await Cache.init(config.cacheDB.users);
    try {
      let ckey = config.cacheKey.User_OTC_Secret_Remark;
      let cRes = await cache.hget(ckey, user_id);
      if (cRes) {
        return cRes;
      }
      let cnt = await DB.cluster('slave');
      let data = await cnt.execQuery('select user_id,secret_remark from m_otc_user_secret_remark where user_id = ?', user_id);
      await cnt.close();
      if (data) {
        await cache.hset(ckey, user_id, data[0])
      }
      return data[0]
    } catch (e) {
      throw e;
    } finally {
      cache.close();
    }
  }


  async createOTCOrder(user_id, entrust, coin_amount) {
    let cnt = await DB.cluster('master');
    try {
      let buy_user_id = null;
      let sell_user_id = null;
      let coinExs = await CoinModel.getOTCExchangeArea(entrust.trade_type, true);
      let coinEx = coinExs.find(item => item.coin_id === entrust.coin_id);
      let trade_fee = Utils.checkDecimal(Utils.mul(coinEx.trade_fee_rate, coin_amount), coinEx.decimal_digits);
      let trade_amount = Utils.checkDecimal(Utils.mul(coin_amount, entrust.price), 2);
      let end_time = moment().add(entrust.valid_duration, 'seconds').format("YYYY-MM-DD HH:mm:ss");
      let lock = false;
      cnt.transaction();
      if (entrust.trade_type == 1) {
        ///如果是买的广告，需要冻结createorder的用户的币
        buy_user_id = entrust.ad_user_id;
        sell_user_id = user_id;

        //冻结用户的币,冻结失败返回创建失败
        let lockasset = await cnt.execQuery(`update m_user_assets set available = available - ? , frozen = frozen + ? , balance = balance - ?
                                                            where user_id = ? and coin_id = ? and available > ? `,
          [coin_amount, coin_amount, coin_amount, user_id, entrust.coin_id, coin_amount]);
        lock = lockasset.affectedRows;
      } else {
        sell_user_id = entrust.ad_user_id;
        buy_user_id = user_id;
        lock = true;
        ///如果是卖的广告，创建entrust的时候已经冻结了币
      }
      let order_params = {
        entrust_id: entrust.id,
        buy_user_id: buy_user_id,
        sell_user_id: sell_user_id,
        coin_amount: coin_amount,
        coin_id: entrust.coin_id,
        trade_fee: trade_fee,
        trigger_type: entrust.trade_type,
        trade_amount: trade_amount,
        trade_currency: entrust.currency,
        status: 0,
        end_time: end_time
      };
      let order = await cnt.edit('m_otc_order', order_params);
      let sql = 'update m_otc_entrust set remaining_amount = remaining_amount-? where id =? and remaining_amount > ?';
      let updateEntrust = await cnt.execQuery(sql, [coin_amount, entrust.id, coin_amount]);
      if (lock && order.affectedRows && updateEntrust.affectedRows) {
        cnt.commit();
        entrust.remaining_amount = entrust.remaining_amount - coin_amount;
        if (entrust.remaining_amount > 0) {
          let ckey = (entrust.trade_type === 1 ? config.cacheKey.Buy_Entrust_OTC : config.cacheKey.Sell_Entrust_OTC) + entrust.coin_id;
          let cache = await Cache.init(config.cacheDB.otc);
          if (await cache.exists(ckey)) {
            await cache.hset(ckey, entrust.id, entrust);
          }
        }
        return {order_id: order.insertId}
      }
      else {
        cnt.rollback();
        return false
      }
    } catch (e) {
      throw e;
      cnt.rollback();
    } finally {
      cnt.close();
    }
  }

  async PayOTCOrder(order) {
    let cnt = await DB.cluster('master');
    // let cache = await Cache.init(config.cacheDB.otc);
    try {
      let pay = await cnt.execQuery('update m_otc_order set status=1 where id =?', order.id);
      return true
    } catch (e) {
      throw e
    } finally {
      cnt.close();
    }
  }

  async lockUserAsset(user_id, coin_id, amount) {
    let cnt = DB.cluster('master');
    try {
      let lockasset = await cnt.execQuery(`update m_user_assets set available = available - ? , frozen = frozen + ? , balance = balance - ?
                                                            where user_id = ? and coin_id = ? and available > ? `,
        [amount, amount, amount, user_id, coin_id, amount]);
      return lockasset.affectedRows;
    } catch (e) {
      throw e;
    }
  }

  async CreateEntrust(entrust_id, user_id, type, coin_id, amount, price, currency, min_amount, remark, secret_remark, payment_methods, valid_duration) {
    let cacheCnt = await Cache.init(config.cacheDB.otc);
    let ckey = (type === 1 ? config.cacheKey.Buy_Entrust_OTC : config.cacheKey.Sell_Entrust_OTC) + coin_id;
    let otccoins = await CoinModel.getOTCExchangeArea(type);
    let coin = otccoins.find(item => item.coin_id === coin_id);
    let cnt = await DB.cluster('master');
    let lock = false;
    try {
      cnt.transaction();
      if (type === 0) {
        ///发布卖币的广告，需要冻结发广告用户资产
        let lock_amount = Utils.checkDecimal(Utils.mul(amount, Utils.add(1, coin.trade_fee_rate)), coin.decimal_digits);
        let lockasset = await cnt.execQuery(`update m_user_assets set available = available - ? , frozen = frozen + ? , balance = balance - ?
                                                            where user_id = ? and coin_id = ? and available > ? `,
          [lock_amount, lock_amount, lock_amount, user_id, coin_id, lock_amount]);
        lock = lockasset.affectedRows;
      } else {
        lock = true;
      }
      let entrust_params = {
        ad_user_id: user_id,
        trade_type: type,
        coin_id: coin_id,
        coin_name: coin.coin_name,
        total_amount: amount,
        remaining_amount: amount,
        price: price,
        currency: currency || "CNY",
        min_trade_amount: min_amount,
        support_payments_id: payment_methods.join(','),
        valid_duration: valid_duration || 900,
        remark: remark,
        secret_remark: secret_remark,
        status: 0,
        create_time: moment().format("YYYY-MM-DD HH:mm:ss"),
        update_time: moment().format("YYYY-MM-DD HH:mm:ss")
      };
      let entrust = await cnt.edit('m_otc_entrust', entrust_params);
      if (lock && entrust.affectedRows) {
        cnt.commit();
        ///update cache
        entrust_params.id = entrust.insertId;
        entrust_params.support_payments_id = payment_methods;
        if (await cacheCnt.exists(ckey)) {
          await cacheCnt.hset(ckey, entrust_params.id, entrust_params);
        }
        return entrust_params
      } else {
        cnt.rollback();
        return false
      }
    } catch (error) {
      throw error;
    } finally {
      await cacheCnt.close();
      cnt.close();
    }
  }

  async ConfirmOTCOrder(order) {
    let cnt = await DB.cluster('master');
    let buy_user_asset_update = false;
    let sell_user_asset_update = false;
    try {
      cnt.transaction();
      let updateorder = await cnt.execQuery('update m_otc_order set status=2 where id =?', order.id);
      /// 解冻广告用户的币
      let unlocksql = 'update m_user_assets set  frozen = frozen - ? where user_id = ? and coin_id = ? ';
      let addassetsql = 'update m_user_assets set available = available + ? , balance = balance + ? where user_id=? and coin_id = ?';
      if (order.trigger_type == 1) {
        let amount = Utils.sub(order.coin_amount, order.trade_fee);
        buy_user_asset_update = await cnt.execQuery(addassetsql, [amount, amount, order.buy_user_id, order.coin_id]);
        sell_user_asset_update = await cnt.execQuery(unlocksql, [order.coin_amount, order.sell_user_id, order.coin_id]);
      } else {
        buy_user_asset_update = await cnt.execQuery(addassetsql, [order.coin_amount, order.coin_amount, order.buy_user_id, order.coin_id]);
        sell_user_asset_update = await cnt.execQuery(unlocksql, [Utils.add(order.coin_amount, order.trade_fee), order.sell_user_id, order.coin_id]);
      }
      if (updateorder.affectedRows && buy_user_asset_update.affectedRows && sell_user_asset_update.affectedRows) {
        cnt.commit();
        return true
      } else {
        cnt.rollback();
        return false
      }
    } catch (e) {
      throw e
    } finally {
      cnt.close();
    }
  }


}

module.exports = new OTCEntrustModel();
