let DB = require('../Base/Data/DB');
let Cache = require('../Base/Data/Cache');
let config = require('../Base/config');

class WithdrawAccountModel {


  constructor() {

  }

  async getUserWithdrawAccountByCoinId(userId, coinId) {
    let cnt = await DB.cluster('slave');
    try {
      let sql = "select * from m_user_withdraw_account where user_id = ? and coin_id = ? and record_status = 1 order by create_time desc";
      let res = cnt.execQuery(sql, [userId, coinId]);
      return res;
    }
    catch (error) {
      throw error;
    } finally {
      cnt.close();
    }
  }

  /**
   * 添加用户资产账户信息
   */
  async addUserWithdrawAccount(userId, coinId, blockAddress, memo) {
    console.log({
      user_id: userId,
      coin_id: coinId,
      block_address: blockAddress,
      memo: memo
    });
    let cnt = await DB.cluster('master');
    try {
      let res = cnt.edit('m_user_withdraw_account', {
        user_id: userId,
        coin_id: coinId,
        block_address: blockAddress,
        memo: memo
      });
      return res;
    } catch (error) {
      throw error;
    } finally {
      cnt.close();
    }
  }

  /**
   * 删除用户资产账户信息
   */
  async delUserWithdrawAccount(userWithdrawAccountId) {
    let cnt = await DB.cluster('master');
    try {
      let res = cnt.edit('m_user_withdraw_account', {
        record_status: -1
      }, {user_withdraw_account_id: userWithdrawAccountId});
      return res;
    } catch (error) {
      throw error;
    } finally {
      cnt.close();
    }
  }
}

module.exports = new WithdrawAccountModel();
