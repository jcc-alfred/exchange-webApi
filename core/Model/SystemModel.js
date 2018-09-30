let DB = require('../Base/Data/DB');
let Cache = require('../Base/Data/Cache');
let config = require('../Base/config');


class SystemModel {

  async getLangByCode(code) {
    let cache = await Cache.init(0);
    try {
      let cRes = await  cache.hget(config.cacheKey.Sys_Lang, code);
      if (cRes) {
        cache.close();
        return cRes
      }
      let cnt = await DB.cluster('slave');
      let sql = `select * from m_sys_lang where record_status=1 and lang_code=?`;
      let res = await cnt.execReader(sql, code);
      if (res) {
        await cache.hset(config.cacheKey.Sys_Lang, code, res);
      }
      cache.close();
      cnt.close();
      return res;
    } catch (error) {
      throw error
    } finally {
      cache.close();
    }
  }

  async getLangById(id) {
    let cache = await Cache.init(0);
    try {
      let cRes = await cache.hget(config.cacheKey.Sys_Lang, id);
      if (cRes) {
        cache.close();
        return cRes
      }

      let cnt = await DB.cluster('slave');
      let sql = `select * from m_sys_lang where record_status=1 and sys_lang_id=?`;
      let res = await cnt.execReader(sql, id);
      if (res) {
        await cache.hset(config.cacheKey.Sys_Lang, id, res);
      }
      cache.close();
      cnt.close();
      return res;
    } catch (error) {
      throw error
    } finally {
      cache.close();
    }
  }

  async getSysMsgTplByLangAndType(langId, tplType) {
    let cache = await Cache.init(0);
    try {
      let cRes = await cache.hget(config.cacheKey.Sys_Msg_tpl, langId + '_' + tplType);

      if (cRes) {
        cache.close();
        return cRes
      }

      let cnt = await DB.cluster('slave');

      let sql = `select * from m_sys_msg_tmpl where record_status=1 and sys_lang_id=? and msg_type_id=? `;

      let res = await cnt.execReader(sql, [langId, tplType]);

      if (res) {
        await cache.hset(
          config.cacheKey.Sys_Msg_tpl,
          langId + '_' + tplType,
          res
        );
      }

      cache.close();
      cnt.close();
      return res;
    } catch (error) {
      throw error
    } finally {
      cache.close();
    }
  }

  async getMsgTpl(langCode, tplType) {
    try {
      let lang = await this.getLangByCode(langCode);
      let tpl = await this.getSysMsgTplByLangAndType(lang.sys_lang_id, tplType);
      return tpl;
    } catch (error) {
      throw error
    }
  }

  async getSysConfigByTypeId(typeId) {
    let cache = await Cache.init(config.cacheDB.system);
    try {
      let cRes = await cache.hgetall(config.cacheKey.Sys_Config);
      if (cRes) {
        let data = [];
        for (let i in cRes) {
          let item = cRes[i];
          data.push(JSON.parse(item));
        }
        cache.close();
        return data.filter((item) => {
          return item.config_type_id == typeId
        });
      }

      let cnt = await DB.cluster('slave');

      let sql = `select * from m_sys_config where record_status=1`;

      let res = await cnt.execQuery(sql);

      let chRes = await Promise.all(res.map((info) => {
        return cache.hset(
          config.cacheKey.Sys_Config,
          info.sys_config_id,
          info
        )
      }));

      cache.close();
      cnt.close();
      return res.filter((item) => {
        return item.config_type_id == typeId
      });
    } catch (error) {
      throw error
    } finally {
      cache.close();
    }
  }
}

module.exports = new SystemModel();
