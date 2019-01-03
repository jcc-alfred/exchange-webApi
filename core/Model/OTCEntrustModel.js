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
let AssetsLogModel = require('../Model/AssetsLogModel');


class OTCEntrustModel {

  constructor() {

  }

  async getEntrustByID(entrust_id, type, refresh = false) {
    let cnt = await DB.cluster('slave');
    let entrust = null;
    try {
      let sql = ` select * from 
                    (select id,ad_user_id,
                    coin_id,
                    coin_name,
                    remaining_amount,
                    price,currency,
                    min_trade_amount,
                    trade_fee_rate,
                    trade_type,
                    min_trade_amount*price as min_money,
                    remaining_amount*price as max_money,
                    support_payments_id,valid_duration,
                    remark,
                    secret_remark,
                    create_time 
                    from m_otc_entrust
                    where id={0}) entrust
                    left join 
                    (select user_id,(case when full_name is null or full_name ="" then email else full_name end) name from m_user) a
                    on a.user_id =entrust.ad_user_id`;
      let res = await cnt.execQuery(Utils.formatString(sql, [entrust_id]));
      if (res.length > 0) {
        entrust = res[0];
        entrust.support_payments_id = entrust.support_payments_id.split(',');
        let ckey = (entrust.trade_type === 1 ? config.cacheKey.Buy_Entrust_OTC : config.cacheKey.Sell_Entrust_OTC) + entrust.coin_id;
        let ckey_all = (entrust.trade_type === 1 ? config.cacheKey.Buy_Entrust_OTC : config.cacheKey.Sell_Entrust_OTC) + "all";
        let cache = await Cache.init(config.cacheDB.otc);
        if (await cache.exists(ckey)) {
          if (entrust.remaining_amount > 0) {
            await cache.hset(ckey, entrust.id, entrust);
          } else {
            await cache.hdel(ckey, entrust.id);
          }
        }
        if (await cache.exists(ckey_all)) {
          if (entrust.remaining_amount > 0) {
            await cache.hset(ckey_all, entrust.id, entrust);
          } else {
            await cache.hdel(ckey_all, entrust.id);
          }
        }
      }
      return entrust;
    } catch (error) {
      throw error;
    } finally {
      await cnt.close();
    }
  }

  async cancelEntrust(entrust) {
    let cnt = await DB.cluster('master');
    let unlock = true;
    try {
      cnt.transaction();
      let updateEntrust = await cnt.execQuery("update m_otc_entrust set status= 3 , remaining_amount = remaining_amount - ? where id= ? and remaining_amount >= ?", [entrust.remaining_amount, entrust.id, entrust.remaining_amount]);
      if (entrust.trade_type === 0) {
        ///unlock the asset for user
        let lock_amount = Utils.checkDecimal(Utils.mul(entrust.remaining_amount, Utils.add(1, entrust.trade_fee_rate)), 8);
        let unlockasset = await cnt.execQuery("update m_user_assets set available = available + ? , frozen = frozen - ? , balance = balance + ?" +
          "                                                            where user_id = ? and coin_id = ? and frozen >= ?",
          [lock_amount, lock_amount, lock_amount, entrust.ad_user_id, entrust.coin_id, lock_amount]);
        unlock = unlockasset.affectedRows;
      }
      if (unlock && updateEntrust.affectedRows) {
        cnt.commit();
        await AssetsModel.getUserAssetsByUserId(entrust.ad_user_id, true);
        let cache = await Cache.init(config.cacheDB.otc);
        let ckey = (entrust.trade_type === 1 ? config.cacheKey.Buy_Entrust_OTC : config.cacheKey.Sell_Entrust_OTC) + entrust.coin_id;
        await cache.hdel(ckey, entrust.id);
        await cache.close();
        return true
      } else {
        cnt.rollback();
        return false
      }
    } catch (e) {
      cnt.rollback();
      throw e
    } finally {
      cnt.close();
    }

  }

  async getEntrustByUserID(user_id, status = null, refresh = false) {
    let cnt = await DB.cluster('slave');
    try {
      let sql = ` select * from 
                    (select id,ad_user_id,
                    coin_id,
                    coin_name,
                    remaining_amount,
                    price,currency,
                    min_trade_amount,
                    trade_fee_rate,
                    trade_type,
                    min_trade_amount*price as min_money,
                    remaining_amount*price as max_money,
                    support_payments_id,valid_duration,
                    remark,
                    status,
                    secret_remark,
                    create_time 
                    from m_otc_entrust
                    where ad_user_id={0}  {1})  entrust 
                    left join 
                    (select user_id,(case when full_name is null or full_name ="" then email else full_name end) name from m_user) a
                    on a.user_id =entrust.ad_user_id`;
      let condition = "";
      if (status) condition = 'and status in ( ' + status.join(',') + ')';
      let res = await cnt.execQuery(Utils.formatString(sql, [user_id, condition]));
      res = res.map(function (each) {
        each.support_payments_id = each.support_payments_id.split(',');
        return each;
      });
      return res;
    } catch (error) {
      throw error;
    } finally {
      await cnt.close();
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
      let sql = ` select * from 
                    (select id,ad_user_id,
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
                    where trade_type={0} {1} and remaining_amount>0 and status in (0,1)
                    order by price desc) entrust
                    left join 
                    (select user_id,(case when full_name is null or full_name ="" then email else full_name end) name from m_user) a
                    on a.user_id =entrust.ad_user_id;`;
      let coin_condition = "";
      if (coin_id !== 'all') {
        coin_condition = 'and coin_id =' + coin_id
      }
      let res = await cnt.execQuery(Utils.formatString(sql, [type, coin_condition]));
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
      await cacheCnt.expire(ckey, 300);
      return res;

    } catch (error) {
      throw error;
    } finally {
      await cacheCnt.close();
    }
  }

  async getOTCOrderByID(order_id) {
    let cnt = await DB.cluster('slave');
    let order = null;
    try {
      let data = await cnt.execQuery('select * from (select * from m_otc_order where id =?) a left join (select coin_name, coin_id ,type, trade_fee_rate from m_otc_exchange_area)b  on a.coin_id = b.coin_id and a.trigger_type = b.type', order_id);
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
      await cache.hset(ckey, user_id, secret_remark);
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
      if (data.length > 0) {
        await cache.hset(ckey, user_id, data[0].secret_remark);
        return data[0].secret_remark
      } else {
        return ""
      }
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
      let serial_num = moment().format('YYYYMMDDHHmmssSSS');
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
                                                            where user_id = ? and coin_id = ? and available >= ? `,
          [coin_amount, coin_amount, coin_amount, user_id, entrust.coin_id, coin_amount]);
        lock = lockasset.affectedRows;
      } else {
        sell_user_id = entrust.ad_user_id;
        buy_user_id = user_id;
        lock = true;
        ///如果是卖的广告，创建entrust的时候已经冻结了币
      }
      let order_params = {
        serial_num: serial_num,
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
      let sql = 'update m_otc_entrust set remaining_amount = remaining_amount-? where id =? and remaining_amount >= ?';
      let updateEntrust = await cnt.execQuery(sql, [coin_amount, entrust.id, coin_amount]);
      if (lock && order.affectedRows && updateEntrust.affectedRows) {
        cnt.commit();
        entrust.remaining_amount = entrust.remaining_amount - coin_amount;
        let ckey = (entrust.trade_type === 1 ? config.cacheKey.Buy_Entrust_OTC : config.cacheKey.Sell_Entrust_OTC) + entrust.coin_id;
        let cache = await Cache.init(config.cacheDB.otc);
        if (await cache.exists(ckey)) {
          if (entrust.remaining_amount > 0) {
            await cache.hset(ckey, entrust.id, entrust);
          } else {
            await cache.hdel(ckey, entrust.id);
          }
        }
        return {order_id: order.insertId}
      }
      else {
        cnt.rollback();
        return false
      }
    } catch (e) {
      cnt.rollback();
      throw e;
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
        trade_fee_rate: coin.trade_fee_rate,
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

        let data = await this.getEntrustByID(entrust.insertId);
        return data
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
    try {
      cnt.transaction();
      let updateorder = await cnt.execQuery('update m_otc_order set status=2 where id =?', order.id);
      /// 解冻广告用户的币
      let unlocksql = 'update m_user_assets set  frozen = frozen - ? where user_id = ? and coin_id = ? ';
      let addassetsql = 'update m_user_assets set available = available + ? , balance = balance + ? where user_id=? and coin_id = ?';
      let buy_amount = 0;
      let sell_amount = 0;
      if (order.trigger_type == 1) {
        buy_amount = Utils.sub(order.coin_amount, order.trade_fee);
        sell_amount = order.coin_amount;
      } else {
        buy_amount = order.coin_amount;
        sell_amount = Utils.add(order.coin_amount, order.trade_fee);
      }
      let buy_user_asset_update = await cnt.execQuery(addassetsql, [buy_amount, buy_amount, order.buy_user_id, order.coin_id]);
      let sell_user_asset_update = await cnt.execQuery(unlocksql, [sell_amount, order.sell_user_id, order.coin_id]);
      if (updateorder.affectedRows && buy_user_asset_update.affectedRows && sell_user_asset_update.affectedRows) {
        cnt.commit();
        ///更新用户资产缓存
        let coins = await CoinModel.getCoinList();
        let coin = coins.find(item => item.coin_id === order.coin_id);
        let buy_user_asset = await AssetsModel.getUserAssetsByUserId(order.buy_user_id, true);
        let sell_user_asset = await AssetsModel.getUserAssetsByUserId(order.sell_user_id, true);
        let buy_user_coin_asset = buy_user_asset.find(item => item.coin_id === order.coin_id);
        let sell_user_coin_asset = sell_user_asset.find(item => item.coin_id === order.coin_id);
        ///更新买卖用户资产日志
        // serial_num, user_id, coin_id, coin_unit, trade_amount, balance_amount, in_out_type, user_assets_log_type_id, user_assets_log_type_name
        let buyuserasset = await AssetsLogModel.addUserAssetsLog(
          order.serial_num,
          order.buy_user_id,
          order.coin_id,
          coin.coin_name,
          buy_amount,
          buy_user_coin_asset.balance,
          1,
          11,
          "OTC买入");
        let selluserasset = await AssetsLogModel.addUserAssetsLog(order.serial_num, order.sell_user_id, order.coin_id, coin.coin_name,
          sell_amount, sell_user_coin_asset.balance, 1, 12, "OTC卖出");
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
