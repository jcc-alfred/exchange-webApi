
let DB = require('../Base/Data/DB');
let Cache = require('../Base/Data/Cache');
let config = require('../Base/config');

class WithdrawAccountModel{

            
    constructor(){
        
    }
   
    async getUserWithdrawAccountByCoinId(userId,coinId){
        try{
            
            let sql = "select * from m_user_withdraw_account where user_id = ? and coin_id = ? and record_status = 1 order by create_time desc";
            let cnt = await DB.cluster('slave');
            let res = cnt.execQuery(sql,[userId,coinId]);
            cnt.close();
            return res;
        }
        catch(error){
            throw error;
        }
    }

    /**
     * 添加用户资产账户信息
     */
    async addUserWithdrawAccount(userId,coinId,blockAddress,memo){
        try {

            console.log({
                user_id:userId,
                coin_id:coinId,
                block_address:blockAddress,
                memo:memo
            });

            let cnt =  await DB.cluster('master');
            let res = cnt.edit('m_user_withdraw_account',{
                user_id:userId,
                coin_id:coinId,
                block_address:blockAddress,
                memo:memo
            });
            cnt.close();
            return res;
        } catch (error) {
            throw error;
        }
    }
    /**
     * 删除用户资产账户信息
     */
    async delUserWithdrawAccount(userWithdrawAccountId){
        try {
            let cnt =  await DB.cluster('master');
            let res = cnt.edit('m_user_withdraw_account',{
                record_status : -1
            },{user_withdraw_account_id:userWithdrawAccountId});
            cnt.close();
            return res;
        } catch (error) {
            throw error;
        }
    }
}

module.exports = new WithdrawAccountModel();