var config = require('../config');
var redis = require('redis')
var {promisify} = require('util')


class Cache {
    static async init(db=0){
        let client = new RedisHelper(db);
        return client;
    }
}

class RedisHelper {

    constructor(db){
        this.client =  redis.createClient(config.redis);
        this.client.select(db)
    }

    async select(database){
        let async =  promisify(this.client.select).bind(this.client);
        return async(database)
    }
    async exists(key){
        let async =  promisify(this.client.exists).bind(this.client);
        return async(key);
    }
    async hexists(key,field){
        let async =  promisify(this.client.hexists).bind(this.client);
        return async(key,field);
    }
    async del(key){
        let async = promisify(this.client.del).bind(this.client);
        return async(key);
    }
    async hdel(key,field){
        let async = promisify(this.client.hdel).bind(this.client);
        return async(key,field);
    }

    async close(){
        let async = promisify(this.client.quit).bind(this.client);
        return async();
    }
    async flushdb(){
      let async = promisify(this.client.flushdb).bind(this.client);
      return async();
    }
    async expire(key,second){
        if(!second){
            return;
        }
        return this.client.expire(key,second)
    }
    async expireat(key,timestamp){
        if(!second){
            return;
        }
        return this.client.expireat(key,timestamp)
    }

    async get(key){
        let async =  promisify(this.client.get).bind(this.client);
        let data = await async(key)
        return JSON.parse(data);
    }

    async set(key,value,ex=0){
        let async =  promisify(this.client.set).bind(this.client);
        let res = await async(key,JSON.stringify(value));
        this.expire(key,ex);
        return res
    }

    async hget(key,field){
        let async = promisify(this.client.hget).bind(this.client);
        let data = await async(key,field)
        return JSON.parse(data);
    }

    async hset(key,field,value,ex=0){
        let async =  promisify(this.client.hset).bind(this.client);
        let res = await async(key,field,JSON.stringify(value));
        await this.expire(key,ex)
        return res
    }

    async hgetall(key){
        let async =  promisify(this.client.hgetall).bind(this.client);
        return async(key)
    }

    async sadd(key,value){
        let async =  promisify(this.client.sadd).bind(this.client);
        return async(key,JSON.stringify(value))
    }

}



module.exports = Cache;
