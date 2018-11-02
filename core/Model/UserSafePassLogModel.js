let DB = require('../Base/Data/DB');
let config = require('../Base/config');
let Cache = require('../Base/Data/Cache');
class UserSafePassLogModel {


  constructor() {

  }

  /**
   * 插入日志
   * @param {int} userId
   */
  async addSafePassLog(userId) {
    // let cnt = await DB.cluster('master');
    // try {
    //   let res = cnt.edit('m_user_safe_pass_log', {
    //     user_id: userId
    //   });
    //   return res;
    // } catch (error) {
    //   throw error;
    // } finally {
    //   cnt.close();
    // }
    let cache = await Cache.init(config.cacheDB.users);
    try {
      let ckey = config.cacheKey.User_Exchange_Safe + userId;
      await cache.set(ckey, 1, 21600);
      //6小時驗證一次交易密碼
      return true
    } catch (e) {
      console.log(e);
      return false
    } finally {
      cache.close();
    }
  }

  async getIsSafe(userId) {
    let cache = await Cache.init(config.cacheDB.users);
    try {
      let ckey = config.cacheKey.User_Exchange_Safe + userId;
      return await cache.exists(ckey);
    } catch (e) {
      console.error(e);
    } finally {
      cache.close();
    }

    // let cnt = await DB.cluster('slave');
    // try {
    //   let sql = "SELECT COUNT(1) from m_user_safe_pass_log where user_id = ? and round((UNIX_TIMESTAMP(NOW())-UNIX_TIMESTAMP(create_time))/60) <= 360";
    //   let res = cnt.execScalar(sql, userId);
    //   return res;
    // } catch (error) {
    //   throw error;
    // } finally {
    //   cnt.close();
    // }
  }

}

module.exports = new UserSafePassLogModel();
