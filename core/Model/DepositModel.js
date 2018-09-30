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

      let sql = "select * from m_user_deposit where record_status=1 and user_id=? and coin_id = ? order by create_time desc";
      var params = [
        userId,
        coinId
      ];

      let res = cnt.page(sql, params, page, pageSize);
      return res;

    }
    catch (error) {
      throw error;
    } finally {
      cnt.close();
    }
  }
}

module.exports = new DepositModel();
