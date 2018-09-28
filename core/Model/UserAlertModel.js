let DB = require('../Base/Data/DB')
let Cache = require('../Base/Data/Cache')
let config = require('../Base/config')


class UserAlertModel {

    constructor(){
        this.alertTypeMap = {
            login:1,
            offsiteLogin:2,
            safeSetting:3,
            payIn:4,
            payOut:5,
            otcPaied:6,
            otcRecevied:7,
            otcUnRecevied:8
        }
    }
    
    async getAlertAll(){
        try{
            
            let cacheCnt = await Cache.init(config.cacheDB.users);
            let cRes = await cacheCnt.hgetall(config.cacheKey.User_Alert_Type);

            if(cRes){

                let data = [];
                for (let i in cRes) {
                    let item = cRes[i];
                    data.push(JSON.parse(item));
                }
                cacheCnt.close();
                return data;
            }

            let cnt =  await DB.cluster('slave');
            let res =  await cnt.execQuery("select * from m_user_alert_type where record_status=1");
            cnt.close();

            let chRes = await Promise.all(res.map((info)=>{
                return cacheCnt.hset(
                    config.cacheKey.User_Alert_Type,
                    info.user_alert_type_id,
                    info
                )
            }));

            cacheCnt.close()
            return res;
        }catch(error){
            throw error;
        }
    }

    async getUserAlertByUserId(userId , refresh=false){
        try{
            let cache = await Cache.init(config.cacheDB.users);
            let ckey = config.cacheKey.User_Alert + userId;
            
            if(await cache.exists(ckey) && !refresh){
                let cRes = cache.hgetall(ckey);
                cache.close();
                return cRes
            }
            
            let cnt = await DB.cluster('salve');
            let res = await cnt.execQuery('select * from m_user_alert where record_status=1 and user_id = ? ',userId);
            
            await Promise.all(res.map((row)=>{
                return cache.hset(ckey,row.user_alert_type_id,row);
            }));

            cache.expire(ckey,7200);

            let cRes = await cache.hgetall(ckey);

            cnt.close();
            cache.close();

            return cRes;
        }catch(error){
            throw error;
        }
    }

    async insertUserAlert(userId){
        try{
            let alerts = await this.getAlertAll();
            let cnt = await DB.cluster('master');
            let res = await Promise.all(alerts.map(async (alert)=>{

                return cnt.edit('m_user_alert',{
                    user_id:userId,
                    user_alert_type_id:alert.user_alert_type_id,
                    user_alert_status:alert.default_status,
                });
                
            }))

            this.getUserAlertByUserId(userId);
            cnt.close();
            return res;
        }catch(error){
            throw error;
        }
    }

    async setUserAlert(userId,alertId,status){
        try{
            let cnt = await DB.cluster("master");
            let res =  await cnt.edit("m_user_alert",{user_alert_status:status},{user_alert_id:alertId})
            this.getUserAlertByUserId(userId,true);
            cnt.close();
            return res
        }catch(error){
            throw error;
        }
    }

}

module.exports = new UserAlertModel();