let DB = require('../Base/Data/DB');
let Cache = require('../Base/Data/Cache');
let config = require('../Base/config')
let moment = require('moment');

class DepositModel{

    constructor(){
        
    }
    
    async getUserDepositListByCoinId(userId,coinId,page,pageSize=10){
        try{
            
            let sql = "select * from m_user_deposit where record_status=1 and user_id=? and coin_id = ? order by create_time desc";
            let cnt = await DB.cluster('slave');

            var params = [
                userId,
                coinId
            ]

            let res = cnt.page(sql,params,page,pageSize);

            cnt.close();
            return res;

        }
        catch(error){
            throw error;
        }
    }
}

module.exports = new DepositModel();