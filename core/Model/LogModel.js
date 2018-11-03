let DB = require('../Base/Data/DB');
let moment = require('moment');


class LogModel {


  constructor() {

    this.userLogTypeMap = {
      login: {id: 1, name: '登录'},
      safe: {id: 2, name: '安全设置'},
      notice: {id: 3, name: '通知设置'}
    }
  }

  /**
   * 插入用户日志
   * @param {Obj} data
   * @param {Obj} type
   */
  async userLog(data, type) {

    try {

      let cnt = await DB.cluster('master');
      let res = cnt.edit('m_user_log', {
        ...data,
        log_type_id: type.id,
        log_type_name: type.name,
      });
      await cnt.close();
      return res;

    } catch (error) {
      throw error;
    }
  }


  async getUserSafeLogs(userId, page, pageSize = 10) {
    try {

      let sql = "select * from m_user_log where record_status=1 and user_id=? and create_time >= ? order by user_log_id desc";
      let cnt = await DB.cluster('slave');


      var params = [
        userId,
        moment().add(-30, 'days').format('YYYY-MM-DD 00:00:00')
      ];

      let res = cnt.page(sql, params, page, pageSize);

      await cnt.close();
      return res;

    }
    catch (error) {
      throw error;
    }
  }

}

module.exports = new LogModel();
