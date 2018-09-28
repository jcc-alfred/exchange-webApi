let DB = require('../Base/Data/DB');
let Cache = require('../Base/Data/Cache');
let config = require('../Base/config');
let CoinModel = require('../Model/CoinModel');

class AssetsModel{

    constructor(){
        
    }

    /**
     * 初始化用户资产信息
     * @param {int} userId 
     */
    async insertUserAssets(user_id){
        try {
            let coins = await CoinModel.getCoinList();
            let cnt =  await DB.cluster('master');

            let res = await Promise.all(coins.map((coin)=>{
                return cnt.edit('m_user_assets',{
                    user_id:user_id,
                    coin_id:coin.coin_id,
                    block_address:'',
                    private_key:'',
                    balance:0,
                    available:0,
                    frozen:0,
                    loan:0,
                })
            }));
            
            cnt.close();

        } catch (error) {
            throw error;
        }
    }
   
    async getUserAssetsByUserIdCoinId(userId,coinId){
        try {
            let userAssets = await this.getUserAssetsByUserId(userId);
            return userAssets.find((item)=>item.coin_id == coinId);
        } catch (error) {
            throw error; 
        }
    }

    /**
     * 获取用户资产信息
     * @param {int} userId 
     */
    async getUserAssetsByUserId(userId,refresh=false){
        try {

            let cache = await Cache.init(config.cacheDB.users);
            let ckey = config.cacheKey.User_Assets + userId;
            if(await cache.exists(ckey) && !refresh){
                let cRes =  await cache.hgetall(ckey);
                cache.close();
                return Object.keys(cRes).map((key)=>{
                    return  JSON.parse(cRes[key])
                })
            }
            
            let cnt = await DB.cluster('salve');
            let sql = `select user_assets_id,a.user_id,a.coin_id,b.coin_name,b.is_enable_deposit,b.is_enable_withdraw,b.is_enable_transfer,a.block_address,a.balance,a.available,a.frozen,a.loan 
            from m_user_assets as a LEFT JOIN m_coin as b on a.coin_id = b.coin_id
            where a.record_status=1 and a.user_id = ? order by b.order_by_num asc  `
            let res = await cnt.execQuery(sql,userId);
            cnt.close();
            
            
            await Promise.all(res.map(async (row)=>{
                return cache.hset(ckey,row.coin_id,row);
            }));
            await cache.expire(ckey,7200);

            let cRes = await cache.hgetall(ckey);
            cache.close();
            return res;

        } catch (error) {
            throw error;
        }
        
    }
    
}

module.exports = new AssetsModel();