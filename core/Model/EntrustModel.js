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
      cnt.close();
      if (res) {
        await cache.hset(ckey, res.entrust_id, res, 300);
      }
      return res;

    } catch (error) {
      throw error;
    }
    finally {
      cache.close();
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
        console.log('userId:', userId, 'buy coinId:', exchangeCoinId, 'totalAmount:', totalAmount);
        updAssets = await cnt.execQuery(`update m_user_assets set available = available - ? , frozen = frozen + ?
                where user_id = ? and coin_id = ?`, [totalAmount, totalAmount, userId, exchangeCoinId]);
      } else {
        console.log('userId:', userId, 'sell coinId:', coinId, 'totalAmount:', entrustVolume);
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
      console.error(error);
      cnt.rollback();
      throw error;
    }
    finally {
      cnt.close();
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
        let coinEx = coinExchangeList.find(item => item.coin_exchange_id == coinExchangeId);
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
          if (updAssets.affectedRows == 0) {
            console.log(entrust);
          }
        } else {
          updAssets = await cnt.execQuery(`update m_user_assets set available = available + ? , frozen = frozen - ? 
                    where user_id = ? and coin_id = ? and frozen >= ?`, [entrust.no_completed_volume, entrust.no_completed_volume, userId, coinEx.coin_id, entrust.no_completed_volume]);
          if (updAssets.affectedRows == 0) {
            console.log(entrust);
          }
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
          cache.close();
          socket.emit('entrustList', {coin_exchange_id: coinExchangeId});
          socket.emit('userEntrustList', {user_id: entrust.user_id, coin_exchange_id: coinExchangeId});
          res = 1;
          console.log("cancel the entrust success " + entrust.entrust_id);
        } else {
          cnt.rollback();
          console.log("cancel the entrust fail " + entrust.entrust_id);
        }
      } else {
        res = -1;
      }
    } catch (error) {
      console.error(error);
      cnt.rollback();
      throw error;
    } finally {
      cnt.close();
    }
    return res;
  }

  async getMarketList(refresh = true) {
    let cache = await Cache.init(config.cacheDB.order);
    let klinecache = await Cache.init(config.cacheDB.kline);
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
      let marketList = [];
      await Promise.all(coinExList.map(async (item) => {
        let marketModel = {
          last_price: 0,
          change_rate: 0,
          high_price: 0,
          low_price: 0,
          total_volume: 0,
          total_amount: 0
        };
        let timestamp=new Date(new Date().toLocaleDateString()).getTime()/1000;
        let Day_Klinedata = await this.getKlineData(item.coin_exchange_id, 86400000);
        let marketRes = Day_Klinedata.find(a => a.timestamp == timestamp);
        if (marketRes) {
          marketModel.high_price = marketRes.high_price;
          marketModel.low_price = marketRes.low_price;
          marketModel.total_volume = marketRes.volume;
          marketModel.total_amount = marketRes.volume * marketRes.close_price + item.base_amount;
          marketModel.change_rate = (marketRes.close_price - marketRes.open_price) / marketRes.open_price;
          marketModel.last_price = marketRes.close_price;
        }
        marketList.push({coin_exchange_id: item.coin_exchange_id, market: marketModel, coinEx: item});
      }));
      try {
        let coin_prices = await axios.get(config.GTdollarAPI, {timeout: 2000});
        marketList.map(x => Object.assign(x, coin_prices.data.find(y => y.symbol.toUpperCase() == x.coinEx.coin_name.toUpperCase())));
      } catch (e) {
        console.error("error get prices from " + config.GTdollarAPI);
        console.error(e);
      }
      let chRes = await Promise.all(marketList.map((market) => {
        return cache.hset(
          ckey,
          market.coin_exchange_id,
          market,
          60
        )
      }));
      return marketList;

    } catch (error) {
      throw error;
    } finally {
      cache.close();
      klinecache.close();
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
      cnt.close();
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
      cnt.close();
      let chRes = await Promise.all(res.map((info) => {
        return cache.hset(
          ckey,
          info.order_id,
          info,
          600
        )
      }));
      return res;

    } catch (error) {
      throw error;
    }
    finally {
      cache.close();
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
      }
      let cnt = await DB.cluster('slave');
      let sql = `SELECT * FROM m_entrust WHERE user_id = ? and (entrust_status = 0 or entrust_status = 1) `;
      let res = await cnt.execQuery(sql, userId);
      cnt.close();

      let chRes = await Promise.all(res.map((info) => {
        return cache.hset(
          ckey,
          info.entrust_id,
          info,
          6000
        )
      }));
      return res;
    } catch (error) {
      throw error;
    }
    finally {
      cache.close();
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
      let cnt = await DB.cluster('slave');
        let sql = 'select e.entrust_price as entrust_price, sum(e.entrust_volume) as entrust_volume, sum(e.no_completed_volume) as no_completed_volume from ' +
          '(SELECT * FROM m_entrust WHERE coin_exchange_id = {0} and entrust_type_id = {1} and entrust_status in (0,1) ) as e ' +
          'group by entrust_price ' +
          'order by entrust_price {2} limit 10';
        let buysql = Utils.formatString(sql, [coin_exchange_id, 1, "desc"]);
        let sellsql = Utils.formatString(sql, [coin_exchange_id, 0, "asc"]);
        let BuyList = await cnt.execQuery(buysql);
        let SellList = await cnt.execQuery(sellsql);
        let NewSellList = Enumerable.from(SellList).orderByDescending("parseFloat($.entrust_price)").toArray();
      await cache.set(ckey, {"buyList": BuyList, "sellList": NewSellList}, 10);
      return {buyList: BuyList, sellList: NewSellList};
      }
    } catch (e) {
      console.error(e);
      return {buyList: [], sellList: []};
    } finally {
      cache.close();
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
      let sql = `SELECT * FROM m_entrust WHERE coin_exchange_id = ? and entrust_type_id = 1 and entrust_status in (0,1) ORDER BY entrust_price DESC, entrust_id ASC`;
      let res = await cnt.execQuery(sql, coinExchangeId);
      let chRes = await Promise.all(res.map((info) => {
        return cache.hset(
          ckey,
          info.entrust_id,
          info,
          300
        )
      }));
      return res;

    } catch (error) {
      throw error;
    } finally {
      cache.close();
      cnt.close();
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

      let sql = `SELECT * FROM m_entrust WHERE coin_exchange_id = ? and entrust_type_id = 0 and entrust_status in (0,1) ORDER BY entrust_price ASC, entrust_id ASC`;
      let res = await cnt.execQuery(sql, coinExchangeId);
      let chRes = await Promise.all(res.map((info) => {
        return cache.hset(
          ckey,
          info.entrust_id,
          info,
          300
        )
      }));
      return res;

    } catch (error) {
      throw error;
    } finally {
      cache.close();
      cnt.close();
    }
  }

  async getKlineData(coinExchangeId, range, refresh = false) {
    let cache = await Cache.init(config.cacheDB.kline);
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
      let cnt = await DB.cluster('slave');
      let sql = `SELECT datestamp, timestamp, open_price, close_price, high_price, low_price, volume
                       FROM m_kline
                       WHERE coin_exchange_id_range = ?
                       ORDER BY timestamp DESC
                       LIMIT 500`;

      let res = await cnt.execQuery(sql, ckey);
      cnt.close();

      let chRes = await Promise.all(res.map((info) => {
        return cache.hset(
          ckey,
          info.timestamp,
          info,
          3600
        )
      }));
      return res;

    } catch (error) {
      throw error;
    } finally {
      cache.close();
    }
  }

  async ResetEntrust(coin_exchange_id, user_id) {
    let cache = await Cache.init(config.cacheDB.order);
    try {
      //delete mysql entrusts for coin_exchange_id
      let cnt = await DB.cluster('master');
      let delete_entrust_sql = `delete from m_entrust where coin_exchange_id = ?`;
      let delete_entrust = await cnt.execQuery(delete_entrust_sql, coin_exchange_id);
      //delet mysql orders for coin_exchange_id
      let delete_order_sql = `delete from m_order where coin_exchange_id = ?`;
      let reset_balance_sql = `update m_user_assets set available=100000000, balance=100000000,frozen=0 where user_id=?`;
      let reset_balance = await cnt.execQuery(reset_balance_sql, [user_id]);
      let delete_order = await cnt.execQuery(delete_order_sql, [coin_exchange_id]);

      let chRes = await Promise.all([delete_entrust, delete_order, reset_balance]);
      cnt.close();

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
      cache.close();
      return true;

    } catch (error) {
      throw error;
      return false
    }
    finally {
      cache.close();
    }
  }

}

module.exports = new EntrustModel();
