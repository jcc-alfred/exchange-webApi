let DB = require('../Base/Data/DB');
let Cache = require('../Base/Data/Cache');
let config = require('../Base/config');
let moment = require('moment');
let Utils = require('../Base/Utils/Utils');
let AssetsModel = require('../Model/AssetsModel');
let SystemModel = require('../Model/SystemModel');

class UserBonusModel {

  constructor() {

  }

  async getUserBonusStaticsByUserId(userId) {
    let cnt = await DB.cluster('salve');
    try {
      let sql = `SELECT a.coin_id,a.coin_name,a.coin_unit,
                            SUM(IFNULL(b.trade_amount,0)) as TotalAmount,
                            SUM(IFNULL(c.trade_amount,0)) as DayAmount,
                            SUM(IFNULL(c.trade_amount,0)) as Day30Amount
                        FROM m_coin a 
                        LEFT JOIN m_user_bonus b on b.user_id = ? AND a.coin_id = b.coin_id
                        LEFT JOIN m_user_bonus c on c.user_id = 142 AND a.coin_id = c.coin_id AND to_days(c.create_time) = to_days(now())
                        LEFT JOIN m_user_bonus d on d.user_id = 142 AND a.coin_id = d.coin_id AND DATE_SUB(CURDATE(), INTERVAL 30 DAY) <= date(d.create_time)
                        GROUP BY a.coin_id,a.coin_name,a.coin_unit,a.order_by_num
                        HAVING SUM(IFNULL(b.trade_amount,0)) > 0
                        ORDER BY a.order_by_num ASC `;//
      let res = await cnt.execQuery(sql, [userId, userId, userId]);
      return res;
    } catch (error) {
      throw error;
    } finally {
      await cnt.close();
    }
  }

  async getUserBonusListByUserId(userId, page, pageSize = 10) {
    let cnt = await DB.cluster('slave');
    try {
      let sql = "SELECT * FROM m_user_bonus WHERE user_id = ? and record_status = 1 ORDER BY user_bonus_id DESC ";
      var params = [userId];
      let res = cnt.page(sql, params, page, pageSize);
      return res;
    }
    catch (error) {
      throw error;
    } finally {
      await cnt.close();
    }
  }

  /**
   * 新增记录
   */
  async addRegBonus(userId, referral_path) {
    try {
      //1基本配置 2 客服配置 3邮件接口配置 4 短信接口配置 5 注册挖矿配置 6 交易挖矿配置
      let regConfig = await SystemModel.getSysConfigByTypeId(5);
      let isEnableReferral = regConfig.find((item) => {
        return item.config_key == 'isEnableReferral'
      }).config_value == '1' ? true : false;
      let referralLevel = parseInt(regConfig.find((item) => {
        return item.config_key == 'referralLevel'
      }).config_value);
      let coinId = parseInt(regConfig.find((item) => {
        return item.config_key == 'coinId'
      }).config_value);
      let L0Amount = parseFloat(regConfig.find((item) => {
        return item.config_key == 'L0Amount'
      }).config_value);
      let L1Amount = parseFloat(regConfig.find((item) => {
        return item.config_key == 'L1Amount'
      }).config_value);
      let L2Amount = parseFloat(regConfig.find((item) => {
        return item.config_key == 'L2Amount'
      }).config_value);
      let L3Amount = parseFloat(regConfig.find((item) => {
        return item.config_key == 'L3Amount'
      }).config_value);
      if (isEnableReferral && L0Amount > 0) {
        //奖励自己
        this.doRegBonus(userId, coinId, L0Amount, 0);
      }
      if (referral_path && isEnableReferral) {
        let refUsers = referral_path.substr(1).split('/').reverse();
        let L1UserId = refUsers.length > 0 && refUsers[0] && Untils.isInt(refUsers[0]) ? refUsers[0] : 0;
        let L2UserId = refUsers.length > 1 && refUsers[1] && Untils.isInt(refUsers[1]) ? refUsers[1] : 0;
        let L3UserId = refUsers.length > 2 && refUsers[2] && Untils.isInt(refUsers[2]) ? refUsers[2] : 0;
        //奖励1级
        if (referralLevel > 0 && L1Amount > 0 && L1UserId > 0) {
          this.doRegBonus(L1UserId, coinId, L1Amount, 1);
        }
        //奖励2级
        if (referralLevel > 1 && L2Amount > 0 && L2UserId > 0) {
          this.doRegBonus(L2UserId, coinId, L2Amount, 2);
        }
        //奖励3级
        if (referralLevel > 2 && L3Amount > 0 && L3UserId > 0) {
          this.doRegBonus(L3UserId, coinId, L3Amount, 3);
        }
      }

    } catch (error) {
      throw error;
    }
  }

  async doRegBonus(userId, coinId, tradeAmount, level) {
    let cnt = await DB.cluster('master');
    try {
      let serialNum = moment().format('YYYYMMDDHHmmssSSS');
      let [assets] = await cnt.execQuery(`select * from m_user_assets where record_status=1 and user_id=? and coin_id=?`, [userId, coinId]);
      let balanceAmount = Utils.add(assets.balance, tradeAmount);
      cnt.transaction();
      //增加用户资产
      let updAssets = await cnt.execQuery(`update m_user_assets set balance = balance + ? , available = available + ? 
            where user_id = ? and coin_id = ?`, [tradeAmount, tradeAmount, userId, coinId]);

      let [coin] = await cnt.execQuery("select * from m_coin where record_status=1 and coin_id = ?", coinId);
      let user_assets_log_type_id = level > 0 ? 6 : 5; //6 推荐奖励 5 注册奖励
      let user_assets_log_type_name = level > 0 ? '推荐奖励' : '注册奖励';
      //增加用户资产日志
      let addAssetsLog = await cnt.edit('m_user_assets_log', {
        serial_num: serialNum,
        user_id: userId,
        coin_id: coinId,
        coin_unit: coin.coin_unit,
        trade_amount: tradeAmount,
        balance_amount: balanceAmount,
        in_out_type: 1,
        user_assets_log_type_id: user_assets_log_type_id,
        user_assets_log_type_name: user_assets_log_type_name
      });
      let user_bonus_type_id = level > 0 ? 2 : 1; //2 推荐奖励 1 注册奖励
      let user_bonus_type_name = level > 0 ? '推荐奖励' : '注册奖励'; //2 推荐奖励 1 注册奖励
      //增加用户奖励记录
      let addUserBonus = await cnt.edit('m_user_bonus', {
        user_id: userId,
        user_bonus_type_id: user_bonus_type_id,
        user_bonus_type_name: user_bonus_type_name,
        coin_id: coinId,
        coin_unit: coin.coin_unit,
        trade_amount: tradeAmount,
        order_id: 0,
        referral_level: level
      });
      cnt.commit();
      AssetsModel.getUserAssetsByUserId(userId, true);
    } catch (error) {
      console.error(error);
      cnt.rollback();
      throw error;
    } finally {
      await cnt.close();
    }
  }
}

module.exports = new UserBonusModel();
