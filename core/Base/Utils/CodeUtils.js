let Cache = require('../Data/Cache');
let config = require('../config');

let CodeUtils = {
  async codeIsCanReSend(username) {
    let cache = await Cache.init(config.cacheDB.users);
    try {
      let ckey = config.cacheKey.User_Code + username.toLocaleLowerCase();
      let data = await cache.get(ckey);

      if (!data) {
        return true
      }
      if ((Date.now() / 1000 - data.sendTime) < config.sys.codeSendIntervalTime) {
        return false
      }
      return true
    } catch (e) {
      throw e;
    } finally {
      cache.close();
    }
  },

  async codeQuals(username, code) {

    let cache = await Cache.init(15);
    try {
      let ckey = config.cacheKey.User_Code + username.toLowerCase();
      let data = await cache.get(ckey) || {};
      return data.code == code ? true : false;
    } catch (e) {
      throw e;
    } finally {
      cache.close();
    }

  },

  async delCode(username) {
    let cache = await Cache.init(15);
    try {
      let ckey = config.cacheKey.User_Code + username.toLowerCase();
      await cache.del(ckey);
    } catch (e) {
      throw e;
    } finally {
      cache.close();
    }
  },

  makeCode(places) {
    var random = '';
    for (var i = 0; i < places; i++) {
      random += Math.floor(Math.random() * 10);
    }
    return random;
  },
};

module.exports = CodeUtils;
