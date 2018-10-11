let config = require('../Base/config');
let DB = require('../Base/Data/DB');
let Cache = require('../Base/Data/Cache');
let MQ = require('../Base/Data/MQ');
let UserAuthStrategyModel = require('./UserAuthStrategyModel');
let UserAlertModel = require('./UserAlertModel');
let AssetsModel = require('../Model/AssetsModel');

class UserModel {

  constructor() {

  }

  async getUserById(id, refresh = false) {
    let cache = await Cache.init(config.cacheDB.users);
    try {
      if (await cache.exists(config.cacheKey.Users + id) && !refresh) {
        let res = cache.get(config.cacheKey.Users + id);
        return res;
      }
      let cnt = await DB.cluster('slave');
      let sql = `select * from m_user where record_status=1 and user_id = ? `;
      let res = await cnt.execReader(sql, [id]);
      cnt.close();
      if (res) {
        await cache.set(config.cacheKey.Users + res.user_id, res, 3600);
      }
      return res;
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      cache.close();
    }
  }

  async getUserByEmail(email) {
    let cnt = await DB.cluster('slave');
    let cache = await Cache.init(config.cacheDB.users);
    try {
      let sql = `select * from m_user where record_status=1 and email = ?`;
      let res = await cnt.execReader(sql, [email]);

      if (res) {
        await cache.set(config.cacheKey.Users + res.user_id, res, 3600);
      }
      return res;
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      cnt.close();
      cache.close();
    }
  }

  async getUserByPhone(phone) {
    try {
      let cnt = await DB.cluster('slave');
      let sql = `select * from m_user where record_status=1 and phone_number = ?`;
      let res = await cnt.execReader(sql, [phone]);
      cnt.close();

      if (res) {
        let cache = await Cache.init(config.cacheDB.users);
        await cache.set(config.cacheKey.Users + res.user_id, res, 3600);
        cache.close();
      }

      return res;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  async signUp(type, data) {
    let cnt = await DB.cluster('master');
    try {
      let res = null;
      if (type == "email") {
        res = await cnt.edit('m_user', {
          email: data.email,
          login_pass: data.login_pass,
          login_pass_level: data.login_pass_level,
          register_ip: data.register_ip,
          login_ip: data.register_ip,
          referral_code: data.referral_code,
          referral_path: data.referral_path,
          area_code: '',
          comments: '',
          full_name: '',
          google_secret: '',
          identity_status: '0',
          is_enable_trade: '1',
          is_enable_withdraw: '1',
          login_location: '',
          phone_number: '',
          register_location: '',
          safe_pass: '',
          safe_pass_level: '0'
        })

      } else {
        res = await cnt.edit('m_user', {
          phone_number: data.phone_number,
          area_code: data.area_code,
          login_pass: data.login_pass,
          login_pass_level: data.login_pass_level,
          register_ip: data.register_ip,
          login_ip: data.register_ip,
          referral_code: data.referral_code,
          referral_path: data.referral_path,
          comments: '', full_name: '', google_secret: '', identity_status: '0', is_enable_trade: '1', email: '',
          is_enable_withdraw: '1', login_location: '', register_location: '', safe_pass: '', safe_pass_level: '0'
        })
      }

      if (res.insertId) {
        //初始化安全信息
        await UserAuthStrategyModel.insertUserStrategy(res.insertId);
        //初始化提醒信息
        await UserAlertModel.insertUserAlert(res.insertId);
        //初始化资产信息
        await AssetsModel.insertUserAssets(res.insertId);
      }
      return res.insertId || false;
    } catch (error) {
      throw error;
    }
    finally {
      cnt.close();
    }
  }

  async getIPCount(ip) {
    let cnt = await DB.cluster('slave');
    try {
      let sql = `select count(1) from m_user where register_ip = ?`;
      let res = cnt.execScalar(sql, [ip]);
      return res;
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      cnt.close();
    }
  }

  async edit(id, data) {
    let cnt = await DB.cluster('master');
    try {
      let res = cnt.edit('m_user', data, {user_id: id});
      return res;
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      cnt.close();
    }

  }

  async loginPassRetryNum(user_id) {
    let cache = await Cache.init(config.cacheDB.users);
    try {
      let retry = await cache.get(config.cacheKey.User_Login_Pass_Retry + user_id) || 0;

      if (retry >= config.sys.loginPassRetryNum) {
        return 0;
      }

      retry = parseInt(retry, 10) + 1;

      await cache.set(config.cacheKey.User_Login_Pass_Retry + user_id, retry, 7200);

      return config.sys.loginPassRetryNum - retry

    } catch (error) {
      throw error;
    } finally {
      cache.close();
    }
  }

  async tokenToCache(user_id, token, clientType = 'Web') {
    let cache = await Cache.init(config.cacheDB.users);
    try {
      await cache.set(
        config.cacheKey.User_Token + user_id,
        token,
        clientType == 'Web' ? config.token.expire_Web : config.token.expire_APP
      )
    } catch (error) {
      throw error;
    } finally {
      cache.close();
    }
  }

  async isOpenAlert(userId, type) {
    try {
      let userAlerts = await UserAlertModel.getUserAlertByUserId(userId);
      let cRes = userAlerts.get(type);
      if (cRes) {
        return cRes.user_alert_status == 1 ? true : false;
      } else {
        return false
      }
    } catch (error) {
      throw error;
    }
  }

  async sendAlert(userId, type, lang, arg1, arg2) {
    try {
      if (!await this.isOpenAlert(userId, type)
      ) {
        return;
      }
      let userInfo = await
        this.getUserById(userId);

      let send = {};
      if (config.sys.sendAlertType === 1) {
        send.type = userInfo.email ? 'email' : 'phone'
      }
      if (config.sys.sendAlertType === 2) {
        send.type = userInfo.phone_number ? 'phone' : 'email'
      }
      if (config.sys.sendAlertType === 3) {
        if (!userInfo.email) {
          return;
        }
        send.type = 'email';
      }
      if (config.sys.sendAlertType === 4) {

        if (!userInfo.phone_number) {
          return;
        }
        send.type = 'phone';
      }

      if (send.type == 'phone') {
        send.area_code = userInfo.area_code;
        send.phone_number = userInfo.phone_number;
      } else {
        send.email = userInfo.email
      }

      send.lang = lang || 'en-us';

      if (type == UserAlertModel.alertTypeMap.login) {
        send.msg_type_id = 2;
        send.ip = arg1;
      }
      if (type == UserAlertModel.alertTypeMap.offsiteLogin) {
        send.msg_type_id = 3;
        send.ip = arg1;
      }
      if (type == UserAlertModel.alertTypeMap.safeSetting) {
        send.msg_type_id = 4;
      }
      if (type == UserAlertModel.alertTypeMap.payIn) {
        send.msg_type_id = 5;
        send.amount = arg1;
        send.unit = arg2;
      }
      if (type == UserAlertModel.alertTypeMap.payOut) {
        send.msg_type_id = 6;
        send.amount = arg1;
        send.unit = arg2;
      }
      let mRes = await
        MQ.push(config.MQKey.Send_Alert, send);
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new UserModel();
