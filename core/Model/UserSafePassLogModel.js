let DB = require('../Base/Data/DB');


class UserSafePassLogModel {


  constructor() {

  }

  /**
   * 插入日志
   * @param {int} userId
   */
  async addSafePassLog(userId) {
    let cnt = await DB.cluster('master');
    try {
      let res = cnt.edit('m_user_safe_pass_log', {
        user_id: userId
      });
      return res;
    } catch (error) {
      throw error;
    } finally {
      cnt.close();
    }
  }

  async getIsSafe(userId) {
    let cnt = await DB.cluster('slave');
    try {
      let sql = "SELECT COUNT(1) from m_user_safe_pass_log where user_id = ? and round((UNIX_TIMESTAMP(NOW())-UNIX_TIMESTAMP(create_time))/60) <= 360";
      let res = cnt.execScalar(sql, userId);
      return res;
    } catch (error) {
      throw error;
    } finally {
      cnt.close();
    }
  }

}

module.exports = new UserSafePassLogModel();
