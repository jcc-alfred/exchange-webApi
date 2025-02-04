let DB = require('../Base/Data/DB');
let Cache = require('../Base/Data/Cache');
let config = require('../Base/config');
let Utils = require('../Base/Utils/Utils');

class CoinModel {


  constructor() {

  }

  async getCoinList() {
    let cacheCnt = await Cache.init(config.cacheDB.system);
    try {
      let cRes = await cacheCnt.hgetall(config.cacheKey.Sys_Coin);

      if (cRes) {

        let data = [];
        for (let i in cRes) {
          let item = cRes[i];
          data.push(JSON.parse(item));
        }
        return data;
      }

      let cnt = await DB.cluster('slave');
      let res = await cnt.execQuery("select * from m_coin where record_status=1 order by order_by_num asc");
      await cnt.close();

      let chRes = await Promise.all(res.map((info) => {
        return cacheCnt.hset(
          config.cacheKey.Sys_Coin,
          info.coin_id,
          info
        )
      }));
      return res;

    } catch (error) {
      throw error;
    } finally {
      await cacheCnt.close();
    }
  }

  async getCoinExchangeAreaList() {
    let cacheCnt = await Cache.init(config.cacheDB.system);
    try {
      let cRes = await cacheCnt.hgetall(config.cacheKey.Sys_Coin_Exchange_Area);

      if (cRes) {

        let data = [];
        for (let i in cRes) {
          let item = cRes[i];
          data.push(JSON.parse(item));
        }
        return data;
      }

      let cnt = await DB.cluster('slave');
      let res = await cnt.execQuery("select * from m_coin_exchange_area where record_status=1 order by order_by_num asc");
      await cnt.close();

      let chRes = await Promise.all(res.map((info) => {
        return cacheCnt.hset(
          config.cacheKey.Sys_Coin_Exchange_Area,
          info.coin_exchange_area_id,
          info
        )
      }));

      return res;

    } catch (error) {
      throw error;
    } finally {
      await cacheCnt.close();
    }
  }

  async getCoinExchangeList(refresh = false) {
    let cacheCnt = await Cache.init(config.cacheDB.system);
    try {
      if (!refresh) {
        let cRes = await cacheCnt.hgetall(config.cacheKey.Sys_Coin_Exchange);

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
      let sql = `SELECT
                            a.coin_exchange_id,
                            a.coin_exchange_area_id,
                            b.coin_exchange_area_name,
                            b.order_by_num as area_order_by_num ,
                            a.coin_id,
                            c.coin_name,
                            c.coin_unit,
                            c.coin_symbol,
                            c.decimal_digits,
                            a.exchange_coin_id,
                            a.day_transaction_limit,
                            d.coin_name as exchange_coin_name,
                            d.coin_unit as exchange_coin_unit,
                            d.coin_symbol as exchange_coin_symbol,
                            d.decimal_digits as exchange_decimal_digits,
                            a.sell_fees_rate,
                            a.buy_fees_rate,
                            a.entrust_min_amount,
                            a.entrust_min_price,
                            a.coin_exchange_status,
                            a.is_enable_trade,
                            a.open_trade_day,
                            a.trade_time_am_start,
                            a.trade_time_am_end,
                            a.trade_time_pm_start,
                            a.trade_time_pm_end,
                            a.change_range_high_rate,
                            a.change_range_low_rate,
                            a.order_by_num,
                            a.update_time,
                            a.create_time,
                            a.record_status,
                            a.base_amount
                            FROM m_coin_exchange as a 
                            LEFT JOIN m_coin_exchange_area as b ON a.coin_exchange_area_id = b.coin_exchange_area_id
                            LEFT JOIN m_coin as c ON a.coin_id = c.coin_id
                            LEFT JOIN m_coin as d ON a.exchange_coin_id = d.coin_id
                            WHERE a.record_status = 1 AND a.is_enable_trade = 1
                            ORDER BY a.order_by_num ASC`;
      let res = await cnt.execQuery(sql);
      await cnt.close();

      let chRes = await Promise.all(res.map((info) => {
        return cacheCnt.hset(
          config.cacheKey.Sys_Coin_Exchange,
          info.coin_exchange_id,
          info
        )
      }));
      return res;

    } catch (error) {
      throw error;
    } finally {
      await cacheCnt.close();
    }
  }


  async getCoinIDbyName(exchangeName) {
    try {
      let data = await this.getCoinExchangeList();
      let [coin_name, exchange_coin_name] = exchangeName.toUpperCase().split('/');
      // console.log(coin_name,exchange_coin_name);
      let exchange = data.filter((item) => item.coin_name == coin_name).filter((item) => item.exchange_coin_name == exchange_coin_name);
      if (exchange && exchange[0]) {
        return exchange[0].coin_exchange_id
      }
      return null;

    } catch (error) {
      throw error;
    }
  }

  async getOTCExchangeArea(type = 'all', refresh = false) {
    let cacheCnt = await Cache.init(config.cacheDB.system);
    try {
      if (await cacheCnt.exists(config.cacheKey.Sys_OTC_Coin && !refresh)) {
        let cRes = await cacheCnt.get(config.cacheKey.Sys_OTC_Coin);
        if (type === 1) {
          return cRes.buy;
        } else if (type === 0) {
          return cRes.sell;
        }
        return cRes;
      } else {
        let cnt = await DB.cluster('slave');
        let sql = `select coin_id, coin_name, order_by_num, trade_fee_rate from m_otc_exchange_area where status=1 and type = {0}`;
        let buyCoin = await cnt.execQuery(Utils.formatString(sql, [1]));
        let sellCoin = await cnt.execQuery(Utils.formatString(sql, [0]));
        await cnt.close();
        let res = {buy: buyCoin, sell: sellCoin};
        await cacheCnt.set(config.cacheKey.Sys_OTC_Coin, res, 3600);
        if (type === 1) {
          return res.buy;
        } else if (type == 0) {
          return res.sell;
        }
        return res
      }

    } catch (error) {
      throw error;
    } finally {
      await cacheCnt.close();
    }
  }

}

module.exports = new CoinModel();
