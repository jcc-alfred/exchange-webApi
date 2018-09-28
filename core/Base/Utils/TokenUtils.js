let jwt = require('jsonwebtoken');
let config = require('../config');
let Cache = require('../Data/Cache');

let TokenUtils = {

    signToken(data){
        let  exp = Math.floor(Date.now() / 1000) + (data.client_info.client_type == 'Web' ?  config.token.expire_Web : config.token.expire_APP);
        return jwt.sign({
            ...data,
            exp:exp
        },config.token.secret);

    },

    decodeToken(token){
        let data = false;
        try {
            data =  jwt.verify(token,config.token.secret);

        } catch (error) {
            data = false;
        } finally{
            return data;
        }
    },

    async verifyToken(token){
        
        try {
            let data =  jwt.verify(token,config.token.secret);
            if(!data.verify){
                return false;
            }

            let cache = await Cache.init(config.cacheDB.users);
            let cdata = await cache.get(config.cacheKey.User_Token+data.user_id);
            if(cdata === token){
                return data
            }else{
                return false
            }
            
        } catch (error) {
            return false;
        }
    }
}

module.exports = TokenUtils;