let DB = require('../Base/Data/DB');
let Cache = require('../Base/Data/Cache');
let config = require('../Base/config');
let Utils = require('../Base/Utils/Utils');
let moment = require('moment');

class DocModel {

  constructor() {

  }

  async getNewsList(typeId, page, pageSize = 10) {
    let cnt = await DB.cluster('slave');
    try {
      let sql = `select * from m_page_news where news_type_id = ? and record_status=1 order by update_time desc`;
      let res = cnt.page(sql, typeId, page, pageSize);
      return res;
    }
    catch (error) {
      throw error;
    } finally {
      cnt.close();
    }
  }

  async getNewsModelById(id) {
    let cnt = await DB.cluster('slave');
    try {
      let sql = `select * from m_page_news where record_status=1 and page_news_id = ? `;
      let res = await cnt.execReader(sql, [id]);
      return res;
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      cnt.close();
    }
  }

  async getArticleModelById(id) {
    let cnt = await DB.cluster('slave');
    try {
      let sql = `select * from m_page_doc where record_status=1 and page_doc_id = ? `;
      let res = await cnt.execReader(sql, [id]);
      return res;
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      cnt.close();
    }
  }
}

module.exports = new DocModel();
