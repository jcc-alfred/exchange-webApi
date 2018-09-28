
let DB = require('../Base/Data/DB');


class UserSafePassLogModel{

            
    constructor(){
        
    }
    
    /**
     * 插入日志
     * @param {int} userId
     */
    async addSafePassLog(userId){

        try{

            let cnt = await DB.cluster('master');
            let res = cnt.edit('m_user_safe_pass_log',{
                user_id:userId
            });
            cnt.close();
            return res;

        }catch(error){
            throw error;
        }
    }
    
    async getIsSafe(userId){
        try{
            
            let sql = "SELECT COUNT(1) from m_user_safe_pass_log where user_id = ? and round((UNIX_TIMESTAMP(NOW())-UNIX_TIMESTAMP(create_time))/60) <= 360";
            let cnt = await DB.cluster('slave');
            let res = cnt.execScalar(sql,userId);
            cnt.close();
            return res;
        }
        catch(error){
            throw error;
        }
    }
    
}

module.exports = new UserSafePassLogModel();