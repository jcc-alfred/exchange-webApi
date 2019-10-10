let DB = require('../Base/Data/DB');
let Cache = require('../Base/Data/Cache');
let config = require('../Base/config');
let Utils = require('../Base/Utils/Utils');
let moment = require('moment');
let DepositModel = require('../Model/DepositModel');

let AssetsModel = require('../Model/AssetsModel');

class WithdrawModel {

  constructor() {

  }

  async getUserWithdrawListByCoinId(userId, coinId, page, pageSize = 10) {
    let cnt = await DB.cluster('slave');
    try {
      let sql = "select * from m_user_withdraw where record_status=1 and user_id=? and coin_id = ? order by user_withdraw_id desc";
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
      await cnt.close();
    }
  }

  async getUserDayWithdrawAmountByCoinId(userId, coinId) {
    let cnt = await DB.cluster('slave');
    try {
      let sql = `select IFNULL(SUM(IFNULL(submit_amount,0)),0)
            from m_user_withdraw
            where user_id = ? and coin_id = ? and confirm_status in (0,1,2) and DATEDIFF(create_time,NOW())=0`;
      let res = cnt.execScalar(sql, [userId, coinId]);
      return res;
    }
    catch (error) {
      throw error;
    } finally {
      await cnt.close();
    }
  }


  async addUserWithdraw(userId, coinId, toBlockAddress, submitAmount, balance, fees, feesRate) {
    let cnt = await DB.cluster('master');
    let res = 0;
    try {
      let tradeAmount = Utils.sub(submitAmount, fees);
      let balanceAmount = Utils.sub(balance, submitAmount);
      let serialNum = moment().format('YYYYMMDDHHmmssSSS');
      let confirmStatus = 0;
      let confirmStatusName = '审核中';
      if ([17].indexOf(coinId) >= 0 && submitAmount <= 10000) {
        confirmStatus = 1;
        confirmStatusName = "已审核"
      } else if ([8, 22].indexOf(coinId) >= 0) {
        confirmStatus = 1;
        confirmStatusName = "已审核"
      } else if ([22].indexOf(coinId) >= 0) {
        confirmStatus = 1;
        confirmStatusName = "已审核"
      } else if (coinId === 5 && submitAmount <= 300) {
        let AIM_Deposit_Count = await DepositModel.getUserDepositCountByCoinId(userId, 22);
        if (AIM_Deposit_Count > 0) {
          confirmStatus = 1;
          confirmStatusName = "已审核"
        }
      }
      await cnt.transaction();
      let withdrawRes = await cnt.edit('m_user_withdraw', {
        serial_num: serialNum,
        user_id: userId,
        coin_id: coinId,
        txid: '',
        from_block_address: '',
        to_block_address: toBlockAddress,
        submit_amount: submitAmount,
        fees_rate: feesRate,
        fees: fees,
        trade_amount: tradeAmount,
        balance_amount: balanceAmount,
        confirm_status: confirmStatus,
        confirm_status_name: confirmStatusName
      });
      if (withdrawRes.affectedRows) {
        //增加用户资产
        let updAssets = await cnt.execQuery(`update m_user_assets set balance = balance - ? , available = available - ? 
                where user_id = ? and coin_id = ? and available >= ? `, [submitAmount, submitAmount, userId, coinId, submitAmount]);
        if (updAssets.affectedRows) {
          await cnt.commit();
          res = 1;
        } else {
          cnt.rollback();
        }
      } else {
        cnt.rollback();
      }
    } catch (error) {
      console.error(error);
      cnt.rollback();
      throw error;
    } finally {
      await cnt.close();
    }
    return res;
  }

  async cancelUserWithdraw(userWithdrawId, userId) {
    let cnt = await DB.cluster('master');
    let res = 0;
    try {
      let sql = `select * from m_user_withdraw where user_withdraw_id = ? and user_id = ? and confirm_status = 0 and record_status=1`;
      let withraw = await cnt.execReader(sql, [userWithdrawId, userId]);
      if (withraw && withraw.user_withdraw_id) {
        let confirmStatus = -1;
        let confirmStatusName = '已取消';
        await cnt.transaction();
        let withdrawUpd = await cnt.edit('m_user_withdraw', {
          confirm_status: confirmStatus,
          confirm_status_name: confirmStatusName
        }, {user_withdraw_id: userWithdrawId, confirm_status: 0});
        if (withdrawUpd.affectedRows) {
          //减少用户资产
          let updAssets = await cnt.execQuery(`update m_user_assets set balance = balance + ? , available = available + ?  
                    where user_id = ? and coin_id = ?`, [withraw.submit_amount, withraw.submit_amount, userId, withraw.coin_id]);
          if (updAssets.affectedRows) {
            await cnt.commit();
            res = 1;
          } else {
            cnt.rollback();
          }
        } else {
          cnt.rollback();
        }
      } else {
        res = -1;
      }
    } catch (error) {
      console.error(error);
      cnt.rollback();
      throw error;
    } finally {
      await cnt.close();
    }
    return res;
  }
}

module.exports = new WithdrawModel();
