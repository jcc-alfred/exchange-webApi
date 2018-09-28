let express = require('express');
let router = express.Router();

let config = require('../Base/config');
let Utils = require('../Base/Utils/Utils');
let GoogleUtils = require('../Base/Utils/GoogleUtils');
let CodeUtils = require('../Base/Utils/CodeUtils');

let UserModel = require('../Model/UserModel');
let UserAlertModel = require('../Model/UserAlertModel');
let LogModel = require('../Model/LogModel');
let UserAuthStrategyModel = require('../Model/UserAuthStrategyModel');
let UserIdentityModel = require('../Model/UserIdentityModel');

let QRCode = require('qrcode');

//修改登录密码
router.post('/modifyLoginPass', async (req, res, next)=>{

    try {
        if(!req.body.loginPass || !Utils.getPassLevel(req.body.loginPass)){
            res.send({code:0,msg:'密码格式错误'});
            return;
        } 
        if(!req.body.newLoginPass || !Utils.getPassLevel(req.body.newLoginPass)){
            res.send({code:0,msg:'密码格式错误'});
            return;
        } 
        //短信邮件验证码
        if(!req.body.hasOwnProperty('phoneCode') && !req.body.hasOwnProperty('emailCode') ){
            res.send({code:0,msg:'参数异常'});
            return
        }

        let userInfo = await UserModel.getUserById(req.token.user_id);


        if(req.body.hasOwnProperty('phoneCode') && !await CodeUtils.codeQuals(userInfo.area_code+userInfo.phone_number,req.body.phoneCode) ){
            res.send({code:0,msg:'手机验证码错误'});
            return;
        }
        else if(req.body.hasOwnProperty('emailCode') &&  !await CodeUtils.codeQuals(userInfo.email,req.body.emailCode) ){
            res.send({code:0,msg:'邮箱验证码错误'});
            return;
        }
        if(Utils.md5(req.body.loginPass) != userInfo.login_pass){
            res.send({code:0,msg:'登录密码错误'});
            return;
        }
        if(Utils.md5(req.body.newLoginPass) == userInfo.login_pass){
            res.send({code:0,msg:'新密码不能与原密码相同'});
            return;
        }
        if(Utils.md5(req.body.newLoginPass) == userInfo.safe_pass){
            res.send({code:0,msg:'登录密码不能与资金密码相同'});
            return;
        }
        if(userInfo.google_secret){
            let verify = GoogleUtils.verifyGoogle(req.body.googleCode,userInfo.google_secret);
            if(!req.body.hasOwnProperty('googleCode') || !verify){
                res.send({code:0,msg:'Google 验证码错误'});
                return;
            }
        }
        
        let result =  await UserModel.edit(req.token.user_id,{
            login_pass:Utils.md5(req.body.newLoginPass),
            login_pass_level:Utils.getPassLevel(req.body.newLoginPass)
        });
        
        if(result.affectedRows == 0){
            res.send({code:0,msg:'设置失败'})
            return ;
        }

        res.send({code:1,msg:'设置成功'});
        //清理Session
        req.session.imgCode = null;
        //清除验证码

        CodeUtils.delCode(req.body.hasOwnProperty('emailCode') ? userInfo.email : userInfo.area_code + userInfo.phone_number)

        UserModel.getUserById(req.token.user_id,true);
        //增加用户日志
        LogModel.userLog({
            user_id:req.token.user_id,
            log_ip:Utils.getIP(req),
            log_location:'',
            comments:'修改登录密码',
        },LogModel.userLogTypeMap.safe);

        UserModel.sendAlert(
            req.token.user_id,
            UserAlertModel.alertTypeMap.safeSetting,
            req.headers.language
        );

    } catch (error) {
        res.status(500).end();
        throw error;
    }
});
//设置资金密码
router.post('/addSafePass', async (req, res, next)=>{

    try {
        if(!req.body.safePass || !Utils.getPassLevel(req.body.safePass)){
            res.send({code:0,msg:'密码格式错误'});
            return;
        } 
        //短信邮件验证码
        if(!req.body.hasOwnProperty('phoneCode') && !req.body.hasOwnProperty('emailCode') ){
            res.send({code:0,msg:'参数异常'});
            return
        }

        let userInfo = await UserModel.getUserById(req.token.user_id);

        if(req.body.hasOwnProperty('phoneCode') && !await CodeUtils.codeQuals(userInfo.area_code+userInfo.phone_number,req.body.phoneCode) ){
            res.send({code:0,msg:'手机验证码错误'});
            return;
        }
        else if(req.body.hasOwnProperty('emailCode') &&  !await CodeUtils.codeQuals(userInfo.email,req.body.emailCode) ){
            res.send({code:0,msg:'邮箱验证码错误'});
            return;
        }

        if(userInfo.safe_pass){
            res.send({code:0,msg:'您已设置资金密码'});
            return;
        }
        if(Utils.md5(req.body.safePass) == userInfo.login_pass){
            res.send({code:0,msg:'登录密码不能与资金密码相同'});
            return;
        }
        if(userInfo.google_secret){
            let verify = GoogleUtils.verifyGoogle(req.body.googleCode,userInfo.google_secret);
            if(!req.body.hasOwnProperty('googleCode') || !verify){
                res.send({code:0,msg:'Google 验证码错误'});
                return;
            }
        }
        let result =  await UserModel.edit(req.token.user_id,{
            safe_pass:Utils.md5(req.body.safePass),
            safe_pass_level:Utils.getPassLevel(req.body.safePass)
        });
        if(result.affectedRows == 0){
            res.send({code:0,msg:'设置失败'})
            return ;
        }

        CodeUtils.delCode(req.body.hasOwnProperty('emailCode') ? userInfo.email : userInfo.area_code + userInfo.phone_number)

        //清理Session
        req.session.imgCode = null;
        res.send({code:1,msg:'设置成功'});
        UserModel.getUserById(req.token.user_id,true);
        //增加用户日志
        LogModel.userLog({
            user_id:req.token.user_id,
            log_ip:Utils.getIP(req),
            log_location:'',
            comments:'设置资金密码',
        },LogModel.userLogTypeMap.safe);

        UserModel.sendAlert(
            req.token.user_id,
            UserAlertModel.alertTypeMap.safeSetting,
            req.headers.language
        );

    } catch (error) {
        res.status(500).end();
        throw error;
    }
});
//修改资金密码
router.post('/modifySafePass', async (req, res, next)=>{

    try {
        if(!req.body.safePass || !Utils.getPassLevel(req.body.safePass)){
            res.send({code:0,msg:'密码格式错误'});
            return;
        } 
        if(!req.body.newSafePass || !Utils.getPassLevel(req.body.newSafePass)){
            res.send({code:0,msg:'密码格式错误'});
            return;
        } 
        //短信邮件验证码
        if(!req.body.hasOwnProperty('phoneCode') && !req.body.hasOwnProperty('emailCode') ){
            res.send({code:0,msg:'参数异常'});
            return
        }

        let userInfo = await UserModel.getUserById(req.token.user_id);

        if(req.body.hasOwnProperty('phoneCode') && !await CodeUtils.codeQuals(userInfo.area_code+userInfo.phone_number,req.body.phoneCode) ){
            res.send({code:0,msg:'手机验证码错误'});
            return;
        }
        else if(req.body.hasOwnProperty('emailCode') &&  !await CodeUtils.codeQuals(userInfo.email,req.body.emailCode) ){
            res.send({code:0,msg:'邮箱验证码错误'});
            return;
        }
        if(!userInfo.safe_pass){
            res.send({code:0,msg:'您还未设置资金密码'});
            return;
        }
        if(Utils.md5(req.body.safePass) != userInfo.safe_pass){
            res.send({code:0,msg:'资金密码错误'});
            return;
        }
        if(Utils.md5(req.body.newSafePass) == userInfo.safe_pass){
            res.send({code:0,msg:'新密码不能与原密码相同'});
            return;
        }
        if(Utils.md5(req.body.newSafePass) == userInfo.login_pass){
            res.send({code:0,msg:'登录密码不能与资金密码相同'});
            return;
        }
        if(userInfo.google_secret){
            let verify = GoogleUtils.verifyGoogle(req.body.googleCode,userInfo.google_secret);
            if(!req.body.hasOwnProperty('googleCode') || !verify){
                res.send({code:0,msg:'Google 验证码错误'});
                return;
            }
        }
        
        let result =  await UserModel.edit(req.token.user_id,{
            safe_pass:Utils.md5(req.body.newSafePass),
            safe_pass_level:Utils.getPassLevel(req.body.newSafePass)
        });
        
        if(result.affectedRows == 0){
            res.send({code:0,msg:'设置失败'})
            return ;
        }

        res.send({code:1,msg:'设置成功'});
        //清理Session
        req.session.imgCode = null;
        CodeUtils.delCode(req.body.hasOwnProperty('emailCode') ? userInfo.email : userInfo.area_code + userInfo.phone_number)
        
        UserModel.getUserById(req.token.user_id,true);
        //增加用户日志
        LogModel.userLog({
            user_id:req.token.user_id,
            log_ip:Utils.getIP(req),
            log_location:'',
            comments:'修改资金密码',
        },LogModel.userLogTypeMap.safe);

        UserModel.sendAlert(
            req.token.user_id,
            UserAlertModel.alertTypeMap.safeSetting,
            req.headers.language
        );

    } catch (error) {
        res.status(500).end();
        throw error;
    }
});
// 谷歌认证二维码
router.post('/googleQRCode',async(req,res,next)=>{
    try{
        let userInfo = await UserModel.getUserById(req.token.user_id);
        let account = userInfo.email ? userInfo.email : userInfo.phone_number

        let secret = GoogleUtils.makeGoogleSecret(account);
        let base64 =  await QRCode.toDataURL(secret.otpauth_url);
        res.send({code:1,data:{
            img:base64,
            secret:secret.secret
        }})

    }catch(error){
        res.status(500).end();
        throw error;
    }
});

//添加谷歌认证
router.post('/addGoogleAuth',async(req,res,next)=>{

    try{
        if(!req.body.hasOwnProperty('googleCode') || !Utils.isInt(req.body.googleCode) ){
            res.send({code:0,msg:'Google 验证码错误'});
            return
        }
        if(!req.body.hasOwnProperty('phoneCode') && !req.body.hasOwnProperty('emailCode') ){
            res.send({code:0,msg:'参数异常'});
            return
        }

        var verified = GoogleUtils.verifyGoogle(req.body.googleCode,req.body.secret);

        if(!verified){
            res.send({code:0,msg:'Google 验证码错误'});
            return;
        }


        let userInfo = await UserModel.getUserById(req.token.user_id);

      
        if(!userInfo){
            res.send({code:0,msg:'账户不存在'})
        }

        if(req.body.hasOwnProperty('phoneCode') && !await CodeUtils.codeQuals(userInfo.area_code+userInfo.phone_number,req.body.phoneCode) ){
            res.send({code:0,msg:'手机验证码错误'});
            return;
        }

        else if(req.body.hasOwnProperty('emailCode') &&  !await CodeUtils.codeQuals(userInfo.email,req.body.emailCode) ){
            console.log(userInfo.email);
            console.log(req.body.emailCode);
            res.send({code:0,msg:'邮箱验证码错误'});
            return;
        }



        let result =  await UserModel.edit(req.token.user_id,{
            google_secret:req.body.secret
        })
        
        if(result.affectedRows == 0){
            res.send({code:0,msg:'设置失败'});
            return;
        }else{
            //清理Session
            req.session.imgCode = null;
            res.send({code:1,msg:'设置成功'});
            CodeUtils.delCode(req.body.hasOwnProperty('emailCode') ? userInfo.email : userInfo.area_code + userInfo.phone_number)
        }

       
    
        UserModel.getUserById(req.token.user_id,true);
        //增加用户日志
        LogModel.userLog({
            user_id:req.token.user_id,
            log_ip:Utils.getIP(req),
            log_location:'',
            comments:'设置 Google 验证',
        },LogModel.userLogTypeMap.safe);

        UserModel.sendAlert(
            req.token.user_id,
            UserAlertModel.alertTypeMap.safeSetting,
            req.headers.language
        );

    }catch(error){
        res.status(500).end();
        throw error;
    }
});

//关闭谷歌认证
router.post('/closeGoogleAuth',async(req,res,next)=>{
    try{
        if(!req.body.hasOwnProperty('googleCode') || !Utils.isInt(req.body.googleCode) ){
            res.send({code:0,msg:'Google 验证码错误'});
            return
        }
        if(!req.body.hasOwnProperty('phoneCode') && !req.body.hasOwnProperty('emailCode') ){
            res.send({code:0,msg:'参数异常'});
            return
        }

        let userInfo = await UserModel.getUserById(req.token.user_id);

        if(req.body.hasOwnProperty('phoneCode') && !await CodeUtils.codeQuals(userInfo.area_code+userInfo.phone_number,req.body.phoneCode) ){
            res.send({code:0,msg:'手机验证码错误'});
            return;
        }
        else if(req.body.hasOwnProperty('emailCode') &&  !await CodeUtils.codeQuals(userInfo.email,req.body.emailCode) ){
            res.send({code:0,msg:'邮箱验证码错误'});
            return;
        }

        var verified = GoogleUtils.verifyGoogle(req.body.googleCode,userInfo.google_secret);
        if(!verified){
            res.send({code:0,msg:'Google 验证码错误'});
            return;
        }
        let result =  await UserModel.edit(req.token.user_id,{
            google_secret:''
        })
        
        if(result.affectedRows == 0){
            res.send({code:0,msg:'设置失败'});
            return;
        }else{
            //清理Session
            req.session.imgCode = null;
            CodeUtils.delCode(req.body.hasOwnProperty('emailCode') ? userInfo.email : userInfo.area_code + userInfo.phone_number)
            res.send({code:1,msg:'设置成功'});
        }
        
        UserModel.getUserById(req.token.user_id,true);
        //增加用户日志
        LogModel.userLog({
            user_id:req.token.user_id,
            log_ip:Utils.getIP(req),
            log_location:'',
            comments:'关闭 Google 验证',
        },LogModel.userLogTypeMap.safe);

        UserModel.sendAlert(
            req.token.user_id,
            UserAlertModel.alertTypeMap.safeSetting,
            req.headers.language
        );

        //安全策略降级
        let loginStrategy = await UserAuthStrategyModel.getUserStrategyByUserId(req.token.user_id,UserAuthStrategyModel.strategyTypeMap.login);
        let withdrawStrategy = await UserAuthStrategyModel.getUserStrategyByUserId(req.token.user_id,UserAuthStrategyModel.strategyTypeMap.withdraw);
        
        if(loginStrategy && withdrawStrategy){
            //登录 3->1 4->2
            let setLoginStrategyId = 0;
            if(loginStrategy.user_auth_strategy_type_id == 3){
                setLoginStrategyId = 1
            }else if(loginStrategy.user_auth_strategy_type_id == 4){
                setLoginStrategyId = 2
            }
            if(setLoginStrategyId > 0){
                let authRes = await UserAuthStrategyModel.setUserStrategy({ 
                    userId:req.token.user_id,
                    categoryTypeId:loginStrategy.category_type_id,
                    authStrategyTypeId:setLoginStrategyId
                });
                if(authRes.affectedRows){
                    UserAuthStrategyModel.getUserStrategyAllByUserId(req.token.user_id,true);
                }
            }
            //提现 2->1 3->1
            if(withdrawStrategy.user_auth_strategy_type_id == 9 || withdrawStrategy.user_auth_strategy_type_id == 10){
                let setWithdrawStrategyId = 8;
                let authRes = await UserAuthStrategyModel.setUserStrategy({ 
                    userId:req.token.user_id,
                    categoryTypeId:withdrawStrategy.category_type_id,
                    authStrategyTypeId:setWithdrawStrategyId
                });
                if(authRes.affectedRows){
                    UserAuthStrategyModel.getUserStrategyAllByUserId(req.token.user_id,true);
                }
            }
        }

    }catch(error){
        res.status(500).end();
        throw error;
    }
});
//绑定手机号码/邮箱
router.post('/addAccount', async (req, res, next)=>{

    try {
        let userInfo = await UserModel.getUserById(req.token.user_id);
        if(req.body.accountType==='email'){

            if(!req.body.email || !Utils.isEmail(req.body.email)){
                res.send({code:0,msg:'邮箱格式错误'});
                return;
            }

            if(!req.body.emailCode || !await CodeUtils.codeQuals(req.body.email,req.body.emailCode)){
                res.send({code:0,msg:'邮箱验证码错误'});
                return;
            }

            if(!req.body.hasOwnProperty('phoneCode') ||!await CodeUtils.codeQuals(userInfo.area_code+userInfo.phone_number,req.body.phoneCode) ){
                res.send({code:0,msg:'手机验证码错误'});
                return;
            }

            if(userInfo.google_secret){
                let verify = GoogleUtils.verifyGoogle(req.body.googleCode,userInfo.google_secret);
                if(!req.body.hasOwnProperty('googleCode') || !verify){
                    res.send({code:0,msg:'Google 验证码错误'});
                    return;
                }
            }
            if(userInfo.email){
                res.send({code:0,msg:'您的邮箱已经通过验证'});
                return;
            }
            let emailUser = await UserModel.getUserByEmail(req.body.email);
            if(emailUser){
                res.send({code:0,msg:'邮箱已注册'});
                return;
            }
            let result =  await UserModel.edit(req.token.user_id,{
                email:req.body.email.toLowerCase()
            });
            
            if(result.affectedRows == 0){
                res.send({code:0,msg:'设置失败'})
                return ;
            }

            userInfo = await UserModel.getUserById(req.token.user_id,true);
            res.send({code:1,msg:'设置成功',data:{userInfo:Utils.userInfoFormat(userInfo)}});
            
            CodeUtils.delCode(userInfo.email);
            CodeUtils.delCode(req.body.email);
            //清理Session
            req.session.imgCode = null;
           
            //增加用户日志
            LogModel.userLog({
                user_id:req.token.user_id,
                log_ip:Utils.getIP(req),
                log_location:'',
                comments:'邮箱验证',
            },LogModel.userLogTypeMap.safe);

            UserModel.sendAlert(
                req.token.user_id,
                UserAlertModel.alertTypeMap.safeSetting,
                req.headers.language
            );
        }
        else if(req.body.accountType==='phone'){
            if(!req.body.areaCode || !Utils.isInt(req.body.areaCode)){
                res.send({code:0,msg:'国家代码错误'});
                return;
            }
            if(!req.body.phoneNumber || !Utils.isPhone(req.body.areaCode,req.body.phoneNumber)){
                res.send({code:0,msg:'手机号格式错误'});
                return;
            }
            if(!req.body.hasOwnProperty('phoneCode') ||!await CodeUtils.codeQuals(req.body.areaCode+req.body.phoneNumber,req.body.phoneCode) ){
                res.send({code:0,msg:'手机验证码错误'});
                return;
            }
            if(!req.body.emailCode || !await CodeUtils.codeQuals(userInfo.email,req.body.emailCode)){
                res.send({code:0,msg:'邮箱验证码错误'});
                return;
            }
            if(userInfo.google_secret){
                let verify = GoogleUtils.verifyGoogle(req.body.googleCode,userInfo.google_secret);
                if(!req.body.hasOwnProperty('googleCode') || !verify){
                    res.send({code:0,msg:'Google 验证码错误'});
                    return;
                }
            }
            if(userInfo.phone_number){
                res.send({code:0,msg:'您的手机已经通过验证'});
                return;
            }
            let phoneUser = await UserModel.getUserByPhone(req.body.phoneNumber);

            if(phoneUser){
                res.send({code:0,msg:'手机已注册'});
                return;
            }

            let result =  await UserModel.edit(req.token.user_id,{
                area_code:req.body.areaCode,
                phone_number:req.body.phoneNumber
            });
            
            if(result.affectedRows == 0){
                res.send({code:0,msg:'设置失败'})
                return ;
            }


            userInfo = await UserModel.getUserById(req.token.user_id,true);
            res.send({code:1,msg:'设置成功',data:{userInfo:Utils.userInfoFormat(userInfo)}});

            //清理Session
            req.session.imgCode = null;

            CodeUtils.delCode(userInfo.area_code+userInfo.phone_number);
            CodeUtils.delCode(req.body.areaCode,req.body.phoneNumber);


            //增加用户日志
            LogModel.userLog({
                user_id:req.token.user_id,
                log_ip:Utils.getIP(req),
                log_location:'',
                comments:'手机验证',
            },LogModel.userLogTypeMap.safe);

            UserModel.sendAlert(
                req.token.user_id,
                UserAlertModel.alertTypeMap.safeSetting,
                req.headers.language
            );

        }
        else{
            res.send({code:0,msg:'账号格式错误',data:{}})
        }
        
    } catch (error) {
        res.status(500).end();
        throw error;
    }
});

//修改手机号码/邮箱
router.post('/modifyAccount', async (req, res, next)=>{

    try {
        let userInfo = await UserModel.getUserById(req.token.user_id);
        if(req.body.accountType==='email'){
            if(!req.body.email || !Utils.isEmail(req.body.email)){
                res.send({code:0,msg:'邮箱格式错误'});
                return;
            }

            if(userInfo.google_secret){
                let verify = GoogleUtils.verifyGoogle(req.body.googleCode,userInfo.google_secret);
                if(!req.body.hasOwnProperty('googleCode') || !verify){
                    res.send({code:0,msg:'Google 验证码错误'});
                    return;
                }
            }
            if(!userInfo.email){
                res.send({code:0,msg:'您还未绑定邮箱'});
                return;
            }

            if(!req.body.emailCode || !await CodeUtils.codeQuals(userInfo.email,req.body.emailCode)){
                res.send({code:0,msg:'邮箱验证码错误'});
                return;
            }
            
            if(!req.body.newEmailCode || !await CodeUtils.codeQuals(req.body.email,req.body.newEmailCode) ){
                res.send({code:0,msg:'邮箱验证码错误'});
                return;
            }

            let emailUser = await UserModel.getUserByEmail(req.body.email);
            if(emailUser){
                res.send({code:0,msg:'邮箱已注册'});
                return;
            }
            let result =  await UserModel.edit(req.token.user_id,{
                email:req.body.email.toLowerCase()
            });
            
            if(result.affectedRows == 0){
                res.send({code:0,msg:'设置失败'})
                return ;
            }

            userInfo = await UserModel.getUserById(req.token.user_id,true);
            res.send({code:1,msg:'设置成功',data:{userInfo:Utils.userInfoFormat(userInfo)}});
           
            //清理Session
            req.session.imgCode = null;
            CodeUtils.delCode(userInfo.email);
            CodeUtils.delCode(req.body.email);

            //增加用户日志
            LogModel.userLog({
                user_id:req.token.user_id,
                log_ip:Utils.getIP(req),
                log_location:'',
                comments:'修改邮箱验证',
            },LogModel.userLogTypeMap.safe);
            UserModel.sendAlert(
                req.token.user_id,
                UserAlertModel.alertTypeMap.safeSetting,
                req.headers.language
            );
        }
        else if(req.body.accountType==='phone'){


            if(!req.body.areaCode || !Utils.isInt(req.body.areaCode)){
                res.send({code:0,msg:'国家代码错误'});
                return;
            }
            if(!req.body.phoneNumber || !Utils.isPhone(req.body.areaCode,req.body.phoneNumber)){
                res.send({code:0,msg:'手机号格式错误'});
                return;
            }

            if(userInfo.google_secret){
                let verify = GoogleUtils.verifyGoogle(req.body.googleCode,userInfo.google_secret);
                if(!req.body.hasOwnProperty('googleCode') || !verify){
                    res.send({code:0,msg:'Google 验证码错误'});
                    return;
                }
            }
            if(!userInfo.phone_number){
                res.send({code:0,msg:'您还未绑定手机'});
                return;
            }

            if(!req.body.phoneCode || !await CodeUtils.codeQuals(userInfo.area_code + userInfo.phone_number,req.body.phoneCode)){
                res.send({code:0,msg:'手机验证码错误'});
                return;
            }
            
            if(!req.body.newPhoneCode || !await CodeUtils.codeQuals(req.body.areaCode + req.body.phoneNumber ,req.body.newPhoneCode) ){
                res.send({code:0,msg:'手机验证码错误'});
                return;
            }

            let phoneUser = await UserModel.getUserByPhone(req.body.phoneNumber);

            if(phoneUser){
                res.send({code:0,msg:'手机已注册'});
                return;
            }

            let result =  await UserModel.edit(req.token.user_id,{
                area_code:req.body.areaCode,
                phone_number:req.body.phoneNumber
            });
            
            if(result.affectedRows == 0){
                res.send({code:0,msg:'设置失败'})
                return ;
            }

            userInfo = await UserModel.getUserById(req.token.user_id,true);
            res.send({code:1,msg:'设置成功',data:{userInfo:Utils.userInfoFormat(userInfo)}});


            //清理Session
            req.session.imgCode = null;
            CodeUtils.delCode(userInfo.area_code + userInfo.phone_number);
            CodeUtils.delCode(req.body.areaCode + req.body.phoneNumber);

            //增加用户日志
            LogModel.userLog({
                user_id:req.token.user_id,
                log_ip:Utils.getIP(req),
                log_location:'',
                comments:'修改手机验证',
            },LogModel.userLogTypeMap.safe);

            UserModel.sendAlert(
                req.token.user_id,
                UserAlertModel.alertTypeMap.safeSetting,
                req.headers.language
            );
        }
        else{
            res.send({code:0,msg:'账号格式错误',data:{}})
        }
        
    } catch (error) {
        res.status(500).end();
        throw error;
    }
});

//获取用户通知
router.post('/getUserAlertSettings',async(req,res,next)=>{
    
    try {
    
        let userAlert = await UserAlertModel.getUserAlertByUserId(req.token.user_id);
        let alertTypes = await UserAlertModel.getAlertAll();

        let data = Object.keys(userAlert).map((key)=>{

            let alert =  JSON.parse(userAlert[key]);
            let type =  alertTypes.find(alertTypes=>alertTypes.user_alert_type_id==alert.user_alert_type_id)

            return {
                ...alert,
                alert_type_name:type.alert_type_name,
                alert_type_comments:type.alert_type_comments
            }
        })  
    
        res.send({code:1,msg:'',data:data})

    
    } catch (error) {
        res.status(500).end();
        throw error;
    }

});

//设置用户通知
router.post('/setUserAlert',async(req,res,next)=>{
    try {
    
        if(!req.body.alertId || !Utils.isInt(req.body.alertId) || ![0,1,'0','1'].includes(req.body.status) || !req.body.safePass){
            res.send({code:0,msg:'参数错误'})
            return;
        }
        let userInfo = await UserModel.getUserById(req.token.user_id);
        if(!userInfo.safe_pass){
            res.send({code:0,msg:'您还未设置资金密码'});
            return;
        }
        if(Utils.md5(req.body.safePass) != userInfo.safe_pass){
            res.send({code:0,msg:'资金密码错误'});
            return;
        }
        let result = await UserAlertModel.setUserAlert(
            req.token.user_id,
            req.body.alertId,
            req.body.status
        );
        
        if(!result.affectedRows){
            res.send({code:0,msg:'设置失败'});
            return;
        }
        res.send({code:1,msg:'设置成功'})
        //增加用户日志
        LogModel.userLog({
            user_id:req.token.user_id,
            log_ip:Utils.getIP(req),
            log_location:'',
            comments:'修改通知设置',
        },LogModel.userLogTypeMap.notice);
    
    } catch (error) {
        res.status(500).end();
        throw error;
    }
});

//获取用户安全日志
router.post('/getUserLogs',async(req,res,next)=>{
    try {
    
        if(!req.body.page || !Utils.isInt(req.body.page) || !req.body.pageSize || !Utils.isInt(req.body.pageSize)  ){
            res.send({code:0,msg:'参数错误'})
            return;
        }

        let data =  await LogModel.getUserSafeLogs(req.token.user_id,req.body.page,req.body.pageSize);

        res.send({code:1,msg:'',data:data})
    } catch (error) {
        res.status(500).end();
        throw error;
    }
});

//用户初级实名认证
router.post('/addUserKYC',async(req,res,next)=>{
    try {
        if(!req.body.areaCode || !req.body.lastName || !req.body.firstName || !req.body.cardId){
            res.send({code:0,msg:'参数错误'})
            return;
        }
        if((req.body.areaCode == '86' && !Utils.isChinaCardId(req.body.cardId) || req.body.cardId.length < 6)){
            res.send({code:0,msg:'证件号码错误'})
            return;
        }
        let userInfo = await UserModel.getUserById(req.token.user_id);
        if(userInfo.identity_status > 0){
            res.send({code:0,msg:'已通过初级实名认证'});
            return;
        }
        let fullName = req.body.lastName + req.body.firstName;
        let result =  await UserIdentityModel.addUserKYC({
            user_id:req.token.user_id,
            area_code:req.body.areaCode,
            full_name: fullName,
            last_name:req.body.lastName,
            first_name:req.body.firstName,
            card_id:req.body.cardId
        });
        if(!result.affectedRows){
            res.send({code:0,msg:'设置失败'});
            return;
        }
        res.send({code:1,msg:'设置成功'})
        await UserModel.edit(req.token.user_id,{identity_status:1,full_name:fullName,area_code:req.body.areaCode});
        UserModel.getUserById(req.token.user_id,true);
        //增加用户日志
        LogModel.userLog({
            user_id:req.token.user_id,
            log_ip:Utils.getIP(req),
            log_location:'',
            comments:'初级身份认证',
        },LogModel.userLogTypeMap.safe);
    } catch (error) {
        res.status(500).end();
        throw error;
    }
});
//用户高级级实名认证
router.post('/addUserSeniorKYC',async(req,res,next)=>{
    try {
       
        if(!req.body.frontImage || !req.body.handImage){
            res.send({code:0,msg:'参数错误'})
            return;
        }
        let userInfo = await UserModel.getUserById(req.token.user_id);
        //0 未认证 1 初级实名认证 2 高级实名认证中 3 高级认证 4 认证失败 
        if(userInfo.identity_status != 1 && userInfo.identity_status != 4){
            res.send({code:0,msg:'认证信息不能重复提交'})
            return;
        }
        if(userInfo.area_code == '86' && !req.body.backImage){
            res.send({code:0,msg:'参数错误'})
            return;
        }
        let backImg = userInfo.area_code == '86' ? req.body.backImage : '';
        let result =  await UserIdentityModel.addUserSeniorKYC(req.token.user_id,{
            front_image:req.body.frontImage,
            back_image: backImg,
            hand_image:req.body.handImage,
        });
        
        if(!result.affectedRows){
            res.send({code:0,msg:'设置失败'});
            return;
        }
        res.send({code:1,msg:'设置成功'})
        await UserModel.edit(req.token.user_id,{identity_status:2});
        UserModel.getUserById(req.token.user_id,true);
        //增加用户日志
        LogModel.userLog({
            user_id:req.token.user_id,
            log_ip:Utils.getIP(req),
            log_location:'',
            comments:'高级身份认证',
        },LogModel.userLogTypeMap.safe);
    } catch (error) {
        res.status(500).end();
        throw error;
    }
});

//获取用户安全策略
router.post('/getUserSafeStrategySettings',async(req,res,next)=>{
    try {
        
        let userSafeInfo = await UserAuthStrategyModel.getUserStrategyAllByUserId(req.token.user_id);
        let safeTypes = await UserAuthStrategyModel.getStrategyTypeAll();
        let userInfo = await UserModel.getUserById(req.token.user_id)
    
            let data = Object.keys(userSafeInfo).map((key)=>{
    
                let safe =  JSON.parse(userSafeInfo[key]);
                let type =  safeTypes.find(type=>type.user_auth_strategy_type_id==safe.user_auth_strategy_type_id)
                let option = safeTypes.filter(type=>type.category_type_id==safe.category_type_id)

                return {
                    ...safe,
                    category_type_name:type.category_type_name,
                    strategy_name:type.strategy_name,
                    option:option.map((s)=>{
                        return {
                            ...s,
                            is_can_use: UserAuthStrategyModel.isCanUseStrategy(userInfo,s)
                        }
                    })
                }
            })  
        
            res.send({code:1,msg:'',data:data})
    
    
    } catch (error) {
        res.status(500).end();
        throw error;
    }
});

//设置用户安全策略
router.post('/setUserSafeStrategy',async(req,res,next)=>{
    try {

        if(!req.body.categoryTypeId || !Utils.isInt(req.body.categoryTypeId) || !req.body.authStrategyTypeId || !Utils.isInt(req.body.authStrategyTypeId) || !req.body.safePass ) {
            res.send({code:0,msg:'参数错误'});
            return
        }

        let userInfo = await UserModel.getUserById(req.token.user_id);
        if(!userInfo.safe_pass){
            res.send({code:0,msg:'您还未设置资金密码'});
            return;
        }
        if(userInfo.safe_pass != Utils.md5(req.body.safePass)){
            res.send({code:0,msg:'资金密码错误'});
            return
        }

        let result = await UserAuthStrategyModel.setUserStrategy({ 
            userId:req.token.user_id,
            categoryTypeId:req.body.categoryTypeId,
            authStrategyTypeId:req.body.authStrategyTypeId
        });
        
        if(result.affectedRows){
            res.send({code:1,msg:'设置成功'});
            UserAuthStrategyModel.getUserStrategyAllByUserId(req.token.user_id,true);
            //增加用户日志
            LogModel.userLog({
                user_id:req.token.user_id,
                log_ip:Utils.getIP(req),
                log_location:'',
                comments:'设置安全策略',
            },LogModel.userLogTypeMap.safe);
            UserModel.sendAlert(
                req.token.user_id,
                UserAlertModel.alertTypeMap.safeSetting,
                req.headers.language
            );
        }else{
            res.send({code:0,msg:'设置失败'});
        }
    
    } catch (error) {
        res.status(500).end();
        throw error;
    }
});

module.exports = router;