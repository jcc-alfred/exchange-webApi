var mysql = require('mysql');
var config = require('../config');


class DBHepler {
  /**
   * 构造方法
   * @param {Connection} cnt 通过DB.cluster得到的对象
   */
  constructor(cnt) {
    this.cnt = cnt;
    this.isOpenTransaction = false;
  }

  /**
   * 执行方法sql
   * @param {Stirng} sql sql语句 或者 CALL 存储过程
   * @param {*} data  "" | [] | {}
   */
  async execQuery(sql, data) {
    return new Promise((resolve, reject) => {
      this.cnt.query(sql, data, function (error, results, fields) {
        error ? reject(error, fields) : resolve(results);
      });
    })
  }

  /**
   * 查询一行
   * @param {Stirng} sql sql语句 或者 CALL 存储过程
   * @param {*} data  "" | [] | {}
   */
  async execReader(sql, data) {
    return new Promise((resolve, reject) => {
      this.cnt.query(sql, data, function (error, results, fields) {
        error ? reject(error, fields) : resolve(results[0] || null)
      });
    })
  }

  /**
   * 查询第一行第一列
   * @param {Stirng} sql sql语句 或者 CALL 存储过程
   * @param {*} data  "" | [] | {}
   */
  async execScalar(sql, data) {
    return new Promise((resolve, reject) => {
      this.cnt.query(sql, data, function (error, results, fields) {
        try {
          if (!results) {
            resolve(results);
          }

          let value = results[0][Object.keys(results[0])[0]];
          error ? reject(error, fields) : resolve(value)
        } catch (error) {
          reject(error)
        }
      });
    })
  }

  /**
   * 开启事务
   */
  async transaction() {
    return new Promise((resolve, reject) => {
      this.cnt.beginTransaction((err) => {
        if (err) {
          reject(err)
        } else {
          resolve(true);
          this.isOpenTransaction = true;
        }
      })
    })
  }

  /**
   * 提交事务
   */
  async commit() {
    return new Promise((resolve, reject) => {
      this.isOpenTransaction && this.cnt.commit((err) => {
        err ? resolve(false) : resolve(true);
      })
    })
  }

  /**
   * 回滚事务
   */
  async rollback() {
    this.isOpenTransaction && this.cnt.rollback()
    //this.cnt.release()
  }

  /**
   * 释放连接
   */
  async close() {
    this.cnt.release()
  }

  escape(arg) {
    return this.cnt.escape(arg)
  }

  /**
   * 分页 分组聚合的情况下慎用
   * @param {String} sql
   * @param {int} page
   * @param {int} pageSize
   */
  async page(sql, data, page, pageSize) {
    try {
      //获取 count
      let countSQl = sql.replace(/select.*from/ig, 'select count(1) from');
      let count = await this.execScalar(countSQl, data);
      if (!count) {
        return {count: 0, pageCount: 0, list: []}
      }

      let pageCount = 0;
      if (page && pageSize) {
        pageCount = Math.ceil(count / pageSize);
        page = page > pageCount ? pageCount : page;
        page = page < 1 ? 1 : page;
        page = (page - 1) * pageSize;

        sql += ` LIMIT ${page},${pageSize}`
      }
      let rows = await this.execQuery(sql, data);

      return rows ? {rowCount: count, pageCount: pageCount, list: rows} : false;

    } catch (error) {
      throw error;
    }
  }

  async edit(tname, data, where = false) {
    try {
      if (where) {

        let dataStr = this._buildSQL(data, ',');
        let whereStr = this._buildSQL(where, 'and');
        var sql = `UPDATE \`${tname}\` set ${dataStr} WHERE ${whereStr}`;

      } else {

        let dataStr = this._buildSQL(data, ',');
        var sql = `insert into  \`${tname}\` set ${dataStr}`;

      }
      let res = await this.execQuery(sql);
      return res;

    } catch (error) {
      throw error;
    }

  }

  //组装data 或是修改值
  _buildSQL(data, join = 'and') {
    let dataArray = [];
    //循环data
    for (let index in data) {
      //组装data字符串 并且添加到dataArray中
      dataArray.push(`${index} = ${this.escape(data[index])}`)
    }
    return dataArray.join(` ${join} `);
  }
}


class DB {
  /**
   * 初始化连接池 只在APP.js 中调用一次
   */
  static init() {
    try {
      this.poolCluster = mysql.createPoolCluster();
      this.poolCluster.add('MASTER', config.DB.master);
      config.DB.slaves.forEach((slave, key) => this.poolCluster.add('SLAVE' + key, slave));
    } catch (e) {
      console.error("cannot create MYSQL Pool" + JSON.stringify(config.DB));
      throw e;
    }
  }

  /**
   * 选择主从 并且返回 连接对象
   * @param {String} selector slave | master
   * @return {Connection} 数据库连接对象
   */
  static async cluster(selector = "slave") {
    return new Promise((resolve, reject) => {
      let pool = selector === 'slave' ? this.poolCluster.of('SLAVE*') : this.poolCluster.of('MASTER');
      pool.getConnection((error, cnt) => {
        error ? reject(error) : resolve(new DBHepler(cnt));
      })
    })
  }

}

DB.init();

module.exports = DB;
