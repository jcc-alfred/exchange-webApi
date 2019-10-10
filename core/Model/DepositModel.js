let DB = require('../Base/Data/DB');
let Cache = require('../Base/Data/Cache');
let config = require('../Base/config');
let moment = require('moment');

class DepositModel {

  constructor() {

  }

  async getUserDepositListByCoinId(userId, coinId, page, pageSize = 10) {
    let cnt = await DB.cluster('slave');
    try {

      let sql = "select * from m_user_deposit where record_status=1 and user_id=? and coin_id = ? order by user_deposit_id desc";
      var params = [
        userId,
        coinId
      ];

      let res = await cnt.page(sql, params, page, pageSize);
      return res

    }
    catch (error) {
      throw error;
    } finally {
      await cnt.close();
    }
  }

  async getUserDepositCountByCoinId(userId, coinId) {
    let cnt = await DB.cluster('master');
    try {

      let sql = `select count(1) as count from m_user_deposit where record_status=1 and user_id=${userId} and coin_id = ${coinId}`;

      let res = await cnt.execQuery(sql);
      if (res.length > 0) {
        return res[0].count
      } else {
        return 0
      }

    }
    catch (error) {
      throw error;
    } finally {
      await cnt.close();
    }
  }
}

module.exports = new DepositModel();
