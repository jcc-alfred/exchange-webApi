let DB = require('../Base/Data/DB');
let Cache = require('../Base/Data/Cache');
let config = require('../Base/config');


class UserIdentityModel {

  constructor() {
    this.cardTypeMap = {
      IDCard: 1,
      Passport: 2
    }
  }

  async addUserKYC(params) {
    let cnt = await DB.cluster('master');
    try {
      let card_type_id = params.area_code == '86' ? this.cardTypeMap.IDCard : this.cardTypeMap.Passport;
      let identity_status = 1;//0 未认证 1 初级实名认证 2 高级实名认证中 3 高级认证 4 认证失败
      let sql = 'select count(1) from m_user_identity where user_id = ?';
      let isExisit = await cnt.execScalar(sql, params.user_id);
      let where = false;
      if (isExisit) {
        where = {user_id: params.user_id};
      }
      let res = cnt.edit('m_user_identity', {...params, card_type_id, identity_status}, where);
      return res;
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      await cnt.close();
    }
  }

  async addUserSeniorKYC(userId, params) {
    let cnt = await DB.cluster('master');
    try {
      let identity_status = 2;//0 未认证 1 初级实名认证 2 高级实名认证中 3 高级认证 4 认证失败
      let res = cnt.edit("m_user_identity", {...params, identity_status}, {user_id: userId});
      return res;
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      await cnt.close();
    }
  }

}

module.exports = new UserIdentityModel();
