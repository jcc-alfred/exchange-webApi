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
      // if (res) {
      //   await cache.hset(ckey, res.entrust_id, res,);
      //   //let cRes = await cache.hgetall(ckey);
      // }
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
          cache.close();
          return data;
        }
      }
      let cnt = await DB.cluster('slave');
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
        //1. LastPrice
        let orderList = await this.getOrderListByCoinExchangeId(item.coin_exchange_id);
        let lastOrder = orderList.sort((item1, item2) => {
          return item2.order_id - item1.order_id
        })[0];
        if (lastOrder && lastOrder.trade_price) {
          marketModel.last_price = lastOrder.trade_price;
          //2. highPrice lowPrice total_volume total_amount
          let marketSQL = `SELECT max(trade_price) as high_price,min(trade_price) as low_price,sum(trade_volume) as total_volume,sum(trade_amount) as total_amount
                    FROM m_order Where coin_exchange_id = ? and create_time >= (now() - interval 24 hour) `;
          let marketRes = await cnt.execReader(marketSQL, item.coin_exchange_id);
          //3. pre24HourPrice
          let pre24PriceSQL = `SELECT trade_price FROM m_order Where coin_exchange_id = ? and create_time >= (now() - interval 24 hour) ORDER BY order_id ASC LIMIT 1 `;
          let pre24PriceRes = await cnt.execReader(pre24PriceSQL, item.coin_exchange_id);
          if (marketRes && marketRes.high_price && pre24PriceRes && pre24PriceRes.trade_price) {
            marketModel.high_price = marketRes.high_price;
            marketModel.low_price = marketRes.low_price;
            marketModel.total_volume = marketRes.total_volume;
            marketModel.total_amount = marketRes.total_amount + item.base_amount;
            marketModel.change_rate = (marketModel.last_price - pre24PriceRes.trade_price) / pre24PriceRes.trade_price;
          }
        }
        marketList.push({coin_exchange_id: item.coin_exchange_id, market: marketModel, coinEx: item});

      }));
      cnt.close();
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
      cache.close()
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
          60000
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
      let sql = `SELECT * FROM m_entrust WHERE user_id = ? and (entrust_status = 0 or entrust_status = 1) limit 300 `;
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

  async getEntrustList(coin_exchange_id, refresh = false) {
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
            }).orderByDescending("parseFloat($.entrust_price)").take(10).toArray();
        await cache.set(ckey, {"buyList": newBuyList, "sellList": newSellList}, 10);
        return {buyList: newBuyList, sellList: newSellList};
        // let cnt = await DB.cluster('slave');
        // let sql = 'select entrust_price, sum(e.entrust_volume) as entrust_volume, sum(e.no_completed_volume) as no_completed_volume from ' +
        //   '(SELECT * FROM m_entrust WHERE coin_exchange_id = ? and entrust_type_id = ? and entrust_status in (0,1) ) as e ' +
        //   'group by e.entrust_price ' +
        //   'order by entrust_price desc limit 10';
        // let BuyList = await cnt.execQuery(sql, [coin_exchange_id, 1]);
        // let SellList = await cnt.execQuery(sql, [coin_exchange_id, 0]);
        // await cache.set(ckey, {"buyList": BuyList, "sellList": SellList}, 10);
        // return {buyList: BuyList, sellList: SellList};
      }
    } catch (e) {
      console.error(e);
      return {buyList: [], sellList: []};
    } finally {
      cache.close();
    }
  }

  async getBuyEntrustListByCEId(coinExchangeId) {
    let cnt = await DB.cluster('slave');
    try {
      let sql = `SELECT * FROM m_entrust WHERE coin_exchange_id = ? and entrust_type_id = 1 and (entrust_status = 0 or entrust_status = 1) ORDER BY entrust_price DESC, entrust_id ASC LIMIT 20`;
      let res = await cnt.execQuery(sql, coinExchangeId);
      return res;
    } catch (error) {
      throw error;
    } finally {
      cnt.close();
    }
  }

  async getSellEntrustListByCEId(coinExchangeId, refresh = false) {
    let cnt = await DB.cluster('slave');
    try {
      let sql = `SELECT * FROM m_entrust WHERE coin_exchange_id = ? and entrust_type_id = 0 and (entrust_status = 0 or entrust_status = 1) ORDER BY entrust_price ASC, entrust_id ASC LIMIT 20`;
      let res = await cnt.execQuery(sql, coinExchangeId);
      return res;

    } catch (error) {
      throw error;
    }
    finally {
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
          cache.close();
          return data;
        }
      }
      let cnt = await DB.cluster('slave');
      let sql = '';
      let minArr = [300000, 900000, 1800000];//5 15 30
      let hourArr = [14400000, 21600000, 43200000];//4 6 12
      if (minArr.includes(range)) {
        sql = ` SELECT DATE_ADD(DATE_FORMAT(create_time,'%Y-%m-%d %H:00:00'), INTERVAL FLOOR(EXTRACT(MINUTE FROM create_time)/{0})*{0} MINUTE) as datestamp,
                FLOOR(UNIX_TIMESTAMP(DATE_ADD(DATE_FORMAT(create_time,'%Y-%m-%d %H:00:00'), INTERVAL FLOOR(EXTRACT(MINUTE FROM create_time)/{0})*{0} MINUTE))) as timestamp,
                (
                select trade_price from m_order where coin_exchange_id = {1} and
                DATE_ADD(DATE_FORMAT(create_time,'%Y-%m-%d %H:00:00'), INTERVAL FLOOR(EXTRACT(MINUTE FROM create_time)/{0})*{0} MINUTE) = datestamp
                ORDER BY create_time LIMIT 1
                ) as open_price,
                (
                select trade_price from m_order where coin_exchange_id = {1} and
                DATE_ADD(DATE_FORMAT(create_time,'%Y-%m-%d %H:00:00'), INTERVAL FLOOR(EXTRACT(MINUTE FROM create_time)/{0})*{0} MINUTE) = datestamp
                ORDER BY create_time DESC LIMIT 1
                ) as close_price,
                MAX(trade_price) as high_price,
                MIN(trade_price) as low_price,
                SUM(trade_volume) as volume
                FROM m_order as tr WHERE coin_exchange_id = {1}
                GROUP BY datestamp,timestamp
                ORDER BY timestamp `;
        sql = Utils.formatString(sql, [range / 60000, coinExchangeId]);
      } else if (range == 60000) {//1m
        sql = `SELECT DATE_FORMAT(create_time,'%Y-%m-%d %H:%i:00') as datestamp,
                FLOOR(UNIX_TIMESTAMP(DATE_FORMAT(create_time,'%Y-%m-%d %H:%i:00'))) as timestamp,
                (
                 select trade_price from m_order where coin_exchange_id = {0} and
                 DATE_FORMAT(create_time,'%Y-%m-%d %H:%i:00') = datestamp
                 ORDER BY create_time LIMIT 1
                ) as open_price,
                (
                 select trade_price from m_order where coin_exchange_id = {0} and
                 DATE_FORMAT(create_time,'%Y-%m-%d %H:%i:00') = datestamp
                 ORDER BY create_time DESC LIMIT 1
                ) as close_price,
                MAX(trade_price) as high_price,
                MIN(trade_price) as low_price,
                SUM(trade_volume) as volume
                FROM m_order as tr WHERE coin_exchange_id = {0}
                GROUP BY datestamp,timestamp
                ORDER BY timestamp`;
        sql = Utils.formatString(sql, [coinExchangeId]);
      } else if (range == 3600000) {//1h
        sql = `SELECT DATE_FORMAT(create_time,'%Y-%m-%d %H:00:00') as datestamp,
                FLOOR(UNIX_TIMESTAMP(DATE_FORMAT(create_time,'%Y-%m-%d %H:00:00'))) as timestamp,
                (
                 select trade_price from m_order where coin_exchange_id = {0} and
                 DATE_FORMAT(create_time,'%Y-%m-%d %H:00:00') = datestamp
                 ORDER BY create_time LIMIT 1
                ) as open_price,
                (
                 select trade_price from m_order where coin_exchange_id = {0} and
                 DATE_FORMAT(create_time,'%Y-%m-%d %H:00:00') = datestamp
                 ORDER BY create_time DESC LIMIT 1
                ) as close_price,
                MAX(trade_price) as high_price,
                MIN(trade_price) as low_price,
                SUM(trade_volume) as volume
                FROM m_order as tr WHERE coin_exchange_id = {0}
                GROUP BY datestamp,timestamp
                ORDER BY timestamp`;
        sql = Utils.formatString(sql, [coinExchangeId]);
      } else if (range == 86400000) {//1d
        sql = `SELECT DATE_FORMAT(create_time,'%Y-%m-%d 00:00:00') as datestamp,
                FLOOR(UNIX_TIMESTAMP(DATE_FORMAT(create_time,'%Y-%m-%d 00:00:00'))) as timestamp,
                (
                 select trade_price from m_order where coin_exchange_id = {0} and
                 DATE_FORMAT(create_time,'%Y-%m-%d 00:00:00') = datestamp
                 ORDER BY create_time LIMIT 1
                ) as open_price,
                (
                 select trade_price from m_order where coin_exchange_id = {0} and
                 DATE_FORMAT(create_time,'%Y-%m-%d 00:00:00') = datestamp
                 ORDER BY create_time DESC LIMIT 1
                ) as close_price,
                MAX(trade_price) as high_price,
                MIN(trade_price) as low_price,
                SUM(trade_volume) as volume
                FROM m_order as tr WHERE coin_exchange_id = {0}
                GROUP BY datestamp,timestamp
                ORDER BY timestamp`;
        sql = Utils.formatString(sql, [coinExchangeId]);
      }
      else if (hourArr.includes(range)) {
        sql = ` SELECT DATE_ADD(DATE_FORMAT(create_time,'%Y-%m-%d 00:00:00'), INTERVAL FLOOR(EXTRACT(HOUR FROM create_time)/{0})*{0} HOUR) as datestamp,
                FLOOR(UNIX_TIMESTAMP(DATE_ADD(DATE_FORMAT(create_time,'%Y-%m-%d 00:00:00'), INTERVAL FLOOR(EXTRACT(HOUR FROM create_time)/{0})*{0} HOUR))) as timestamp,
                (
                 select trade_price from m_order where coin_exchange_id = {1} and
                 DATE_ADD(DATE_FORMAT(create_time,'%Y-%m-%d 00:00:00'), INTERVAL FLOOR(EXTRACT(HOUR FROM create_time)/{0})*{0} HOUR) = datestamp
                 ORDER BY create_time LIMIT 1
                ) as open_price,
                (
                 select trade_price from m_order where coin_exchange_id = {1} and
                 DATE_ADD(DATE_FORMAT(create_time,'%Y-%m-%d 00:00:00'), INTERVAL FLOOR(EXTRACT(HOUR FROM create_time)/{0})*{0} HOUR) = datestamp
                 ORDER BY create_time DESC LIMIT 1
                ) as close_price,
                MAX(trade_price) as high_price,
                MIN(trade_price) as low_price,
                SUM(trade_volume) as volume
                FROM m_order as tr WHERE coin_exchange_id = {1}
                GROUP BY datestamp,timestamp
                ORDER BY timestamp `;
        sql = Utils.formatString(sql, [range / 3600000, coinExchangeId]);
      }

      let res = await cnt.execQuery(sql);
      cnt.close();

      let chRes = await Promise.all(res.map((info) => {
        return cache.hset(
          ckey,
          info.timestamp,
          info
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
