let DB = require('../Base/Data/DB');
let Cache = require('../Base/Data/Cache');
let config = require('../Base/config');
let Utils = require('../Base/Utils/Utils');
let moment = require('moment');

class AssetsLogModel{

    constructor(){
        
    }
    /**
     * 新增充值记录 
     */
    async addUserAssetsLog(serial_num,user_id,coin_id,coin_unit,trade_amount,balance_amount,in_out_type,user_assets_log_type_id,user_assets_log_type_name){
        try {
            let cnt =  await DB.cluster('master');
            let res = await cnt.edit('m_user_assets_log',{
                serial_num:serial_num,
                user_id:user_id,
                coin_id:coin_id,
                coin_unit:coin_unit,
                trade_amount:trade_amount,
                balance_amount:balance_amount,
                in_out_type:in_out_type,
                user_assets_log_type_id:user_assets_log_type_id,
                user_assets_log_type_name:user_assets_log_type_name
            });
            cnt.close();
            return res;
        } catch (error) {
            throw error;
        }
    }

    async getUserAssetsLogTypeList(){
        try{

            let cacheCnt = await Cache.init(config.cacheDB.users);
            let cRes = await cacheCnt.hgetall(config.cacheKey.User_Assets_Log_Type);

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
            let res =  await cnt.execQuery("select * from m_user_assets_log_type where record_status=1 order by user_assets_log_type_id asc");
            cnt.close();

            let chRes = await Promise.all(res.map((info)=>{
                return cacheCnt.hset(
                    config.cacheKey.User_Assets_Log_Type,
                    info.user_assets_log_type_id,
                    info
                )
            }));

            cacheCnt.close();

            return res;

        }catch(error){
            throw error;
        }
    }

    async getUserAssetsLogList(userId,coinId,userAssetsLogTypeId,startDate,endDate,page,pageSize=10){
        try{
            let whereStr = 'record_status=1 and user_id = ' + userId;
            if(coinId && Utils.isInt(coinId)){
                whereStr += ' and coin_id = ' + coinId;
            }
            if(userAssetsLogTypeId && Utils.isInt(userAssetsLogTypeId)){
                whereStr += ' and user_assets_log_type_id = ' + userAssetsLogTypeId;
            }
            if(startDate){
                whereStr += ` and create_time >= '` + startDate + `'`;
            }
            if(endDate){
                whereStr += ` and create_time < DATE_ADD('` + endDate + `',INTERVAL 1 DAY)` ;
            }
            
            let sql = `select * from m_user_assets_log where ` + whereStr + ` order by create_time desc`;
            let cnt = await DB.cluster('slave');
            let res = cnt.page(sql,null,page,pageSize);

            cnt.close();
            return res;
        }
        catch(error){
            throw error;
        }
    }
}

module.exports = new AssetsLogModel();