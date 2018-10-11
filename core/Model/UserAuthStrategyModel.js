let DB = require('../Base/Data/DB');
let Cache = require('../Base/Data/Cache');
let config = require('../Base/config');

class UserAuthStrategyModel {


  constructor() {
    this.strategyTypeMap = {
      'login': 1,
      'exchange': 2,
      'withdraw': 3
    }
  }

  /**
   * 获取所有默认安全侧率
   */
  async getStrategyTypeAll() {
    let cacheCnt = await Cache.init(config.cacheDB.users);
    try {
      let cRes = await cacheCnt.hgetall(config.cacheKey.User_Auth_Strategy_Type);
      if (cRes) {
        let data = [];
        for (let i in cRes) {
          let item = cRes[i];
          data.push(JSON.parse(item));
        }
        cacheCnt.close();
        return data;
      }

      let cnt = await DB.cluster('slave');
      let res = await cnt.execQuery("select * from m_user_auth_strategy_type where record_status=1");
      cnt.close();

      let chRes = await Promise.all(res.map((info) => {
        return cacheCnt.hset(
          config.cacheKey.User_Auth_Strategy_Type,
          info.user_auth_strategy_type_id,
          info
        )
      }));
      cacheCnt.close();

      return res;
    } catch (error) {
      throw error;
    } finally {
      cacheCnt.close();
    }
  }

  /**
   * 获取用户所有安全策略
   * @param {int} userId
   */
  async getUserStrategyAllByUserId(userId, refresh = false) {
    let cache = await Cache.init(config.cacheDB.users);
    try {
      let ckey = config.cacheKey.User_Auth_Strategy + userId;
      if (await cache.exists(ckey) && !refresh) {
        let cRes = cache.hgetall(ckey);
        return cRes
      }

      let cnt = await DB.cluster('salve');
      let res = await cnt.execQuery('select * from m_user_auth_strategy where record_status=1 and user_id = ? ', userId);
      cnt.close();

      await Promise.all(res.map(async (row) => {
        return cache.hset(ckey, row.category_type_id, row);
      }));
      await cache.expire(ckey, 7200);

      let cRes = await cache.hgetall(ckey);
      return cRes;

    } catch (error) {
      throw error;
    } finally {
      cache.close();
    }

  }

  /**
   * 获取用户单个安全策略
   * @param {int} userId
   * @param {int} category_type_id
   */
  async getUserStrategyByUserId(userId, category_type_id) {

    let cache = await Cache.init(config.cacheDB.users);
    try {
      let ckey = config.cacheKey.User_Auth_Strategy + userId;
      let cData = await cache.hget(ckey, category_type_id);
      if (cData) {
        cache.close();
        return cData;
      }
      await this.getUserStrategyAllByUserId(userId);
      cData = await cache.hget(ckey, category_type_id);
      cache.close();
      return cData;
    } catch (e) {
      throw e;
    } finally {
      cache.close()
    }


  }

  /**
   * 用户注册初始化安全策略
   * @param {int} userId
   */
  async insertUserStrategy(userId) {
    let cnt = await DB.cluster('master');
    try {
      let types = await this.getStrategyTypeAll();
      let res = await Promise.all(types.map(async (type) => {
        if (type.default_status === 1) {
          return cnt.edit('m_user_auth_strategy', {
            user_id: userId,
            category_type_id: type.category_type_id,
            user_auth_strategy_type_id: type.user_auth_strategy_type_id,
            user_auth_strategy_status: 1,
          });
        }
      }));
      await this.getUserStrategyAllByUserId(userId, true);
      return res;
    } catch (error) {
      throw error;
    } finally {
      cnt.close();
    }
  }

  isCanUseStrategy(userInfo, strategy) {
    try {
      if (!userInfo.google_secret) {
        let needGoogle = [3, 4, 9, 10];
        return !needGoogle.includes(strategy.user_auth_strategy_type_id);
      }
      return true

    } catch (error) {
      throw error
    }
  }

  async setUserStrategy({userId, categoryTypeId, authStrategyTypeId}) {
    try {
      let cnt = await DB.cluster('master');
      let res = cnt.edit('m_user_auth_strategy',
        {
          user_auth_strategy_type_id: authStrategyTypeId
        },
        {
          user_id: userId,
          category_type_id: categoryTypeId,
        }
      );
      cnt.close();
      return res;
    } catch (error) {
      throw error
    }
  }

}

module.exports = new UserAuthStrategyModel();
