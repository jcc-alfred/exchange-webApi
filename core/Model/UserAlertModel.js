let DB = require('../Base/Data/DB');
let Cache = require('../Base/Data/Cache');
let config = require('../Base/config');


class UserAlertModel {

  constructor() {
    this.alertTypeMap = {
      login: 1,
      offsiteLogin: 2,
      safeSetting: 3,
      payIn: 4,
      payOut: 5,
      otcPaied: 6,
      otcRecevied: 7,
      otcUnRecevied: 8
    }
  }

  async getAlertAll() {
    let cacheCnt = await Cache.init(config.cacheDB.users);
    try {
      let cRes = await cacheCnt.hgetall(config.cacheKey.User_Alert_Type);
      if (cRes) {
        let data = [];
        for (let i in cRes) {
          let item = cRes[i];
          data.push(JSON.parse(item));
        }
        return data;
      }

      let cnt = await DB.cluster('slave');
      let res = await cnt.execQuery("select * from m_user_alert_type where record_status=1");
      await cnt.close();
      let chRes = await Promise.all(res.map(async (info) => {
        return cacheCnt.hset(
          config.cacheKey.User_Alert_Type,
          info.user_alert_type_id,
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

  async getUserAlertByUserId(userId, refresh = false) {
    let cache = await Cache.init(config.cacheDB.users);
    try {
      let ckey = config.cacheKey.User_Alert + userId;
      if (await cache.exists(ckey) && !refresh) {
        let cRes = cache.hgetall(ckey);
        return cRes
      }
      let cnt = await DB.cluster('salve');
      let res = await cnt.execQuery('select * from m_user_alert where record_status=1 and user_id = ? ', userId);

      await Promise.all(res.map(async (row) => {
        return cache.hset(ckey, row.user_alert_type_id, row);
      }));
      await cache.expire(ckey, 7200);
      let cRes = await cache.hgetall(ckey);
      return cRes;
    } catch (error) {
      throw error;
    } finally {
      await cache.close();
    }
  }

  async insertUserAlert(userId) {
    let cnt = await DB.cluster('master');
    try {
      let alerts = await this.getAlertAll();
      let res = await Promise.all(alerts.map(async (alert) => {
        return cnt.edit('m_user_alert', {
          user_id: userId,
          user_alert_type_id: alert.user_alert_type_id,
          user_alert_status: alert.default_status,
        });
      }));
      this.getUserAlertByUserId(userId);
      return res;
    } catch (error) {
      throw error;
    } finally {
      await cnt.close();
    }
  }

  async setUserAlert(userId, alertId, status) {
    let cnt = await DB.cluster("master");
    try {
      let res = await cnt.edit("m_user_alert", {user_alert_status: status}, {user_alert_id: alertId});
      this.getUserAlertByUserId(userId, true);
      return res
    } catch (error) {
      throw error;
    } finally {
      await cnt.close();
    }
  }

}

module.exports = new UserAlertModel();
