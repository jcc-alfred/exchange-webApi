let express = require('express');
let router = express.Router();
let Utils = require('../Base/Utils/Utils');
let GoogleUtils = require('../Base/Utils/GoogleUtils');
let CodeUtils = require('../Base/Utils/CodeUtils');
let TokenUtils = require('../Base/Utils/TokenUtils');

let config = require('../Base/config');
let UserModel = require('../Model/UserModel');
let LogModel = require('../Model/LogModel');
let UserAuthStrategyModel = require('../Model/UserAuthStrategyModel');
let UserAlertModel = require('../Model/UserAlertModel');
let SystemModel = require('../Model/SystemModel');
let AssetsModel = require('../Model/AssetsModel');
let UserBonusModel = require('../Model/UserBonusModel');

let Cache = require('../Base/Data/Cache');
let MQ = require('../Base/Data/MQ');


//注册
router.post('/signUp', async (req, res, next) => {
  try {

    if (!req.session.imgCode || req.session.imgCode.toLowerCase() != req.body.imgCode.toLowerCase()) {
      res.send({code: 0, msg: '验证码错误'});
      return;
    }

    if (req.body.referralCode && !Utils.isInt(req.body.referralCode)) {
      res.send({code: 0, msg: '推荐编码错误'});
      return;
    }
    if (!req.body.loginPass || !Utils.getPassLevel(req.body.loginPass)) {
      res.send({code: 0, msg: '密码格式错误'});
      return;
    }

    if (req.body.accountType === 'email') {

      if (!req.body.email || !Utils.isEmail(req.body.email)) {
        res.send({code: 0, msg: '邮箱格式错误'});
        return;
      }

      if (!await CodeUtils.codeQuals(req.body.email, req.body.emailCode)) {
        res.send({code: 0, msg: '邮箱验证码错误'});
        return;
      }

      let emailUser = await UserModel.getUserByEmail(req.body.email);

      if (emailUser) {
        res.send({code: 0, msg: '邮箱已注册'});
        return;
      }

      if (config.sys.ipRegisterMaxNum) {
        let ipCount = await UserModel.getIPCount(Utils.getIP(req));
        if (ipCount >= config.sys.ipRegisterMaxNum) {
          res.send({code: 0, msg: '注册次数过多'});
          return;
        }
      }

      if (req.body.referralCode) {

        let referralUser = await UserModel.getUserById(req.body.referralCode);
        if (referralUser) {
          req.body.referralPath = referralUser.referral_path ? referralUser.referral_path + '/' + req.body.referralCode : '/' + req.body.referralCode
        } else {
          req.body.referralCode = '';
          req.body.referralPath = '';
        }
      }

      let result = await UserModel.signUp('email', {
        email: req.body.email,
        login_pass: Utils.md5(req.body.loginPass),
        referral_code: req.body.referralCode || '',
        referral_path: req.body.referralPath || '',
        login_pass_level: Utils.getPassLevel(req.body.loginPass),
        register_ip: Utils.getIP(req),
      });

      if (!result) {
        res.send({code: 0, msg: '注册失败'});
        return;
      }
      let userInfo = await UserModel.getUserById(result);
      let token = TokenUtils.signToken({
        user_id: userInfo.user_id,
        login_ip: Utils.getIP(req),
        client_info: Utils.getClientInfo(req),
        verify: true,
      });

      res.send({code: 1, msg: '注册成功', data: {userInfo: Utils.userInfoFormat(userInfo), token: token}});
      UserModel.tokenToCache(userInfo.user_id, token, Utils.getClientInfo(req).client_type);
      req.session.imgCode = null;
      CodeUtils.delCode(req.body.email);
      //发送注册奖励
        // UserBonusModel.addRegBonus(userInfo.user_id, userInfo.referral_path);
    }

    else if (req.body.accountType === 'phone') {

      if (!req.body.areaCode || !Utils.isInt(req.body.areaCode)) {
        res.send({code: 0, msg: '国家代码错误'});
        return;
      }

      if (!req.body.phoneNumber || !Utils.isPhone(req.body.areaCode, req.body.phoneNumber)) {
        res.send({code: 0, msg: '手机号格式错误'});
        return;
      }

      if (!req.body.phoneCode || !await CodeUtils.codeQuals(req.body.areaCode + req.body.phoneNumber, req.body.phoneCode)) {
        res.send({code: 0, msg: '手机验证码错误'});
        return;
      }

      let phoneUser = await UserModel.getUserByPhone(req.body.phoneNumber);

      if (phoneUser) {
        res.send({code: 0, msg: '手机已注册'});
        return;
      }

      if (config.sys.ipRegisterMaxNum) {
        let ipCount = await UserModel.getIPCount(Utils.getIP(req));
        if (ipCount >= config.sys.ipRegisterMaxNum) {
          res.send({code: 0, msg: '注册次数过多'});
          return;
        }
      }

      if (req.body.referralCode) {

        let referralUser = await UserModel.getUserById(req.body.referralCode);
        if (referralUser) {
          req.body.referralPath = referralUser.referral_path ? referralUser.referral_path + '/' + req.body.referralCode : '/' + req.body.referralCode
        } else {
          req.body.referralCode = '';
          req.body.referralPath = '';
        }
      }

      let result = await UserModel.signUp('phone', {
        phone_number: req.body.phoneNumber,
        area_code: req.body.areaCode,
        login_pass: Utils.md5(req.body.loginPass),
        referral_code: req.body.referralCode || '',
        referral_path: req.body.referralPath || '',
        login_pass_level: Utils.getPassLevel(req.body.loginPass),
        register_ip: Utils.getIP(req),
      });

      if (!result) {
        res.send({code: 0, msg: '注册失败'});
        return;
      }

      let userInfo = await UserModel.getUserById(result);
      let token = TokenUtils.signToken({
        user_id: userInfo.user_id,
        login_ip: Utils.getIP(req),
        client_info: Utils.getClientInfo(req),
        verify: true,
      });

      res.send({code: 1, msg: '注册成功', data: {token: token, userInfo: Utils.userInfoFormat(userInfo)}});

      await UserModel.tokenToCache(userInfo.user_id, token, Utils.getClientInfo(req).client_type);
      req.session.imgCode = null;
      CodeUtils.delCode(req.body.areaCode + req.body.phoneNumber);
      //发送注册奖励
      UserBonusModel.addRegBonus(userInfo.user_id, userInfo.referral_path);
    }
    else {
      res.send({code: 0, msg: '账号格式错误', data: {}})
    }

  } catch (error) {
    res.status(500).end();
    throw error;
  }

});

//登录
router.post('/login', async (req, res, next) => {

  let params = req.body;
  try {
    if (params.imgCode && params.imgCode != "0C4$m*") {
      if (!params.imgCode || req.session.imgCode.toLowerCase() != params.imgCode.toLowerCase()) {
        res.send({code: 0, msg: '验证码输入错误'});
        return
      }
    }

    let userInfo = {};

    if (req.body.accountType === 'email') {

      if (!params.email || !Utils.isEmail(params.email) || !params.loginPass || params.loginPass.length < 6) {
        res.send({code: 0, msg: '账号或密码错误'});
        return
      }

      userInfo = await UserModel.getUserByEmail(params.email);
      if (!userInfo) {
        res.send({code: 0, msg: '账号或密码错误'});
        return
      }
    } else if (req.body.accountType === 'phone') {
      if (!params.phoneNumber || !Utils.isPhone(null, params.phoneNumber) || !params.loginPass || params.loginPass.length < 6) {
        res.send({code: 0, msg: '账号或密码错误'});
        return
      }
      userInfo = await UserModel.getUserByPhone(params.phoneNumber);
      if (!userInfo) {
        res.send({code: 0, msg: '账号或密码错误'});
        return
      }

    } else {
      res.send({code: 0, msg: '账号格式错误', data: {}});
      return;
    }

    //比较密码
    if (userInfo.login_pass !== Utils.md5(params.loginPass)) {
      //密码重试 次数校验
      let retry = await UserModel.loginPassRetryNum(userInfo.user_id);
      if (retry > 0) {
        res.send({code: 0, msg: '账号或密码错误', data: {retry: retry}})
      } else {
        res.send({code: 0, msg: '重试次数过多', data: {}});
      }

      return
    }

    //获取安全策略
    let strategy = await UserAuthStrategyModel.getUserStrategyByUserId(userInfo.user_id, UserAuthStrategyModel.strategyTypeMap.login);
    if (!strategy) {
      res.send({code: 0, msg: '账户异常'});
    }

    let token = null;
    let verify = true;
    let isOffsite = userInfo.login_ip === Utils.getIP(req) ? false : true;


    // 1.登录密码 2.登录密码+异地登录验证（短信/邮件）3.登录密码+Google验证码 4.登录密码+Google验证码+异地登录验证（短信/邮件）
    if (strategy.user_auth_strategy_type_id === 1) {
      //生成token
      token = TokenUtils.signToken({
        user_id: userInfo.user_id,
        login_ip: Utils.getIP(req),
        client_info: Utils.getClientInfo(req),
        verify: verify,
      });
      res.send({code: 1, msg: '登录成功', data: {token: token, userInfo: Utils.userInfoFormat(userInfo)}})

    } else {

      verify = strategy.user_auth_strategy_type_id == 2 && isOffsite;

      //生成token
      token = TokenUtils.signToken({
        user_id: userInfo.user_id,
        login_ip: Utils.getIP(req),
        client_info: Utils.getClientInfo(req),
        verify: verify,
      });

      let data = {
        token: token,
        userInfo: Utils.userInfoFormat(userInfo)
      };

      !verify && (data.safe = strategy.user_auth_strategy_type_id);

      res.send({code: 1, msg: '登录成功', data: {...data, is_offsite: isOffsite}});

    }

    UserModel.sendAlert(
      userInfo.user_id,
      UserAlertModel.alertTypeMap.login,
      req.headers.language,
      Utils.getIP(req)
    );

    if (verify) {

      req.session.imgCode = null;

      //记录token
      await UserModel.tokenToCache(userInfo.user_id, token, Utils.getClientInfo(req).client_type);

      //修改登录IP
      UserModel.edit(userInfo.user_id, {login_ip: Utils.getIP(req)});
      //增加用户日志
      LogModel.userLog({
        user_id: userInfo.user_id,
        log_ip: Utils.getIP(req),
        log_location: '',
        comments: '用户登录',
      }, LogModel.userLogTypeMap.login);

    }
  } catch (error) {
    res.status(500).end();
    throw error;
  }
});

//安全登录
router.post('/authSafety', async (req, res, next) => {

  try {
    if (!req.token) {
      res.send({code: 0, msg: 'token无效'});
      return
    }

    let token = req.token;
    if (!token) {
      res.send({code: 0, msg: '请登录'});
      return;
    }

    let strategy = await UserAuthStrategyModel.getUserStrategyByUserId(token.user_id, UserAuthStrategyModel.strategyTypeMap.login);

    //2.登录密码+异地登录验证（短信/邮件）3.登录密码+Google验证码 4.登录密码+Google验证码+异地登录验证（短信/邮件)

    let userInfo = await UserModel.getUserById(token.user_id);

    let offsiteLogin = false;


    if (strategy.user_auth_strategy_type_id == 2) {

      offsiteLogin = true;

      if (!req.body.hasOwnProperty('phoneCode') && !req.body.hasOwnProperty('emailCode')) {
        res.send({code: 0, msg: '参数异常'});
        return
      }

      if (req.body.hasOwnProperty('phoneCode') && !await CodeUtils.codeQuals(userInfo.area_code + userInfo.phone_number, req.body.phoneCode)) {
        res.send({code: 0, msg: '手机验证码错误'});
        return;
      }
      else if (req.body.hasOwnProperty('emailCode') && !await CodeUtils.codeQuals(userInfo.email, req.body.emailCode)) {
        res.send({code: 0, msg: '邮箱验证码错误'});
        return;
      }

    } else if (strategy.user_auth_strategy_type_id == 3) {

      let verify = GoogleUtils.verifyGoogle(req.body.googleCode, userInfo.google_secret);

      if (!req.body.hasOwnProperty('googleCode') || !verify) {
        res.send({code: 0, msg: 'Google 验证码错误'});
        return;
      }

    } else if (strategy.user_auth_strategy_type_id == 4) {

      if (userInfo.login_ip !== Utils.getIP(req)) {

        if (!req.body.hasOwnProperty('phoneCode') && !req.body.hasOwnProperty('emailCode')) {
          res.send({code: 0, msg: '参数异常'});
          return
        }

        if (req.body.hasOwnProperty('phoneCode') && !await CodeUtils.codeQuals(userInfo.area_code + userInfo.phone_number, req.body.phoneCode)) {
          res.send({code: 0, msg: '手机验证码错误'});
          return;
        }

        if (req.body.hasOwnProperty('emailCode') && !await CodeUtils.codeQuals(userInfo.email, req.body.emailCode)) {
          res.send({code: 0, msg: '邮箱验证码错误'});
          return;
        }
        offsiteLogin = true;
      }

      let verify = GoogleUtils.verifyGoogle(req.body.googleCode, userInfo.google_secret);

      if (!req.body.hasOwnProperty('googleCode') || !verify) {
        res.send({code: 0, msg: 'Google 验证码错误'});
        return;
      }
    }
    let newToken = TokenUtils.signToken({
      user_id: token.user_id,
      login_ip: Utils.getIP(req),
      client_info: Utils.getClientInfo(req),
      verify: true,
    });

    res.send({code: 1, msg: '登录成功', data: {token: newToken}});

    CodeUtils.delCode(req.body.hasOwnProperty('emailCode') ? userInfo.email : userInfo.area_code + userInfo.phone_number);

    //清理Session
    req.session.imgCode = null;
    //记录token
    UserModel.tokenToCache(token.user_id, newToken, Utils.getClientInfo(req).client_type);
    //修改登录IP
    UserModel.edit(token.user_id, {login_ip: Utils.getIP(req)});
    //增加用户日志
    LogModel.userLog({
      user_id: token.user_id,
      log_ip: Utils.getIP(req),
      log_location: '',
      comments: '用户登录',
    }, LogModel.userLogTypeMap.login);

    if (offsiteLogin) {
      UserModel.sendAlert(
        req.token.user_id,
        UserAlertModel.alertTypeMap.offsiteLogin,
        req.headers.language,
        Utils.getIP(req)
      );
    }
  } catch (error) {
    res.status(500).end();
    throw error;
  }
});

//找回登录密码
router.post('/forgotLoginPass', async (req, res, next) => {
  try {
    let userInfo = {};
    if (!req.body.imgCode || req.session.imgCode.toLowerCase() != req.body.imgCode.toLowerCase()) {
      res.send({code: 0, msg: '验证码输入错误'});
      return
    }
    if (!req.body.loginPass || !Utils.getPassLevel(req.body.loginPass)) {
      res.send({code: 0, msg: '密码格式错误'});
      return;
    }
    //短信邮件验证码
    if (!req.body.hasOwnProperty('phoneCode') && !req.body.hasOwnProperty('emailCode')) {
      res.send({code: 0, msg: '参数异常'});
      return
    }
    if (req.body.accountType === 'email') {

      userInfo = await UserModel.getUserByEmail(req.body.email);

      if (!userInfo) {
        res.send({code: 0, msg: '账号不存在'});
        return
      }

      if (!req.body.hasOwnProperty('emailCode') || !await CodeUtils.codeQuals(userInfo.email, req.body.emailCode)) {
        res.send({code: 0, msg: '邮箱验证码错误'});
        return;
      }

      if (Utils.md5(req.body.loginPass) == userInfo.safe_pass) {
        res.send({code: 0, msg: '登录密码不能与资金密码相同'});
        return;
      }
    }
    else if (req.body.accountType === 'phone') {

      userInfo = await UserModel.getUserByPhone(req.body.phoneNumber);

      if (!userInfo) {
        res.send({code: 0, msg: '账号不存在'});
        return
      }

      if (!req.body.hasOwnProperty('phoneCode') || !await CodeUtils.codeQuals(userInfo.area_code + userInfo.phone_number, req.body.phoneCode)) {
        res.send({code: 0, msg: '手机验证码错误'});
        return;
      }

      if (Utils.md5(req.body.loginPass) == userInfo.safe_pass) {
        res.send({code: 0, msg: '登录密码不能与资金密码相同'});
        return;
      }
    }
    else {
      res.send({code: 0, msg: '参数异常'});
      return
    }

    let result = await UserModel.edit(userInfo.user_id, {
      login_pass: Utils.md5(req.body.loginPass),
      login_pass_level: Utils.getPassLevel(req.body.loginPass)
    });

    if (result.affectedRows == 0) {
      res.send({code: 0, msg: '操作失败'});
      return;
    }

    res.send({code: 1, msg: '操作成功'});

    //清理Session
    req.session.imgCode = null;

    //清除验证码
    CodeUtils.delCode(req.body.accountType === 'email' ? userInfo.email : userInfo.area_code + userInfo.phone_number);

    UserModel.getUserById(userInfo.user_id, true);
    //增加用户日志
    LogModel.userLog({
      user_id: userInfo.user_id,
      log_ip: Utils.getIP(req),
      log_location: '',
      comments: '找回登录密码',
    }, LogModel.userLogTypeMap.safe);

    UserModel.sendAlert(
      userInfo.user_id,
      UserAlertModel.alertTypeMap.safeSetting,
      req.headers.language
    );

  } catch (error) {
    res.status(500).end();
    throw error;
  }
});
//找回资金密码
router.post('/forgotSafePass', async (req, res, next) => {
  try {

    if (!req.body.safePass || !Utils.getPassLevel(req.body.safePass)) {
      res.send({code: 0, msg: '密码格式错误'});
      return;
    }
    //短信邮件验证码
    if (!req.body.hasOwnProperty('phoneCode') && !req.body.hasOwnProperty('emailCode')) {
      res.send({code: 0, msg: '参数异常'});
      return
    }

    let userInfo = await UserModel.getUserById(req.token.user_id);

    if (req.body.hasOwnProperty('phoneCode') && !await CodeUtils.codeQuals(userInfo.area_code + userInfo.phone_number, req.body.phoneCode)) {
      res.send({code: 0, msg: '手机验证码错误'});
      return;
    }

    if (req.body.hasOwnProperty('emailCode') && !await CodeUtils.codeQuals(userInfo.email, req.body.emailCode)) {
      res.send({code: 0, msg: '邮箱验证码错误'});
      return;
    }

    //比较密码
    if (Utils.md5(req.body.safePass) == userInfo.login_pass) {
      res.send({code: 0, msg: '登录密码不能与资金密码相同'});
      return;
    }

    let result = await UserModel.edit(userInfo.user_id, {
      safe_pass: Utils.md5(req.body.safePass),
      safe_pass_level: Utils.getPassLevel(req.body.safePass)
    });

    if (result.affectedRows == 0) {
      res.send({code: 0, msg: '操作失败'});
      return;
    }

    res.send({code: 1, msg: '操作成功'});

    //清理Session
    req.session.imgCode = null;
    CodeUtils.delCode(req.body.accountType === 'email' ? userInfo.email : userInfo.area_code + userInfo.phone_number);

    UserModel.getUserById(userInfo.user_id, true);
    //增加用户日志
    LogModel.userLog({
      user_id: userInfo.user_id,
      log_ip: Utils.getIP(req),
      log_location: '',
      comments: '找回资金密码',
    }, LogModel.userLogTypeMap.safe);

    UserModel.sendAlert(
      userInfo.user_id,
      UserAlertModel.alertTypeMap.safeSetting,
      req.headers.language
    );
  } catch (error) {
    res.status(500).end();
    throw error;
  }
});

//获取验证码
router.post('/sendCode', async (req, res, next) => {

  try {
    let params = req.body;
    if (params.type == "phone") {

      if (!params.areaCode || !Utils.isInt(params.areaCode)) {
        res.send({code: 0, msg: '国家代码错误'});
        return;
      }

      if (!params.phoneNumber || !Utils.isPhone(params.areaCode, params.phoneNumber)) {
        res.send({code: 0, msg: '手机号格式错误'});
        return;
      }

    }
    else if (params.type == "email") {

      if (!params.email || !Utils.isEmail(params.email)) {
        res.send({code: 0, msg: '邮箱格式错误'});
        return;
      }

    }
    else {
      res.send({code: 0, msg: '参数异常'});
      return;
    }

    let username = params.type == 'phone' ? params.areaCode.toString() + params.phoneNumber.toString() : params.email;

    if (!await CodeUtils.codeIsCanReSend(username)) {
      res.send({code: 0, msg: '请稍后再试'});
      return;
    }


    let mRes = await MQ.push(config.MQKey.Send_Code, {

      type: req.body.type,
      area_code: req.body.areaCode,
      phone_number: req.body.phoneNumber,
      email: req.body.email,
      lang: req.headers.language || 'en-us',
      msg_type_id: 1,

    });

    mRes ? res.send({code: 1, msg: '发送成功'}) : res.send({code: 0, msg: '发送失败'});

  }
  catch (error) {
    res.status(500).end();
    throw error;
  }

});

//用户信息
router.post('/userInfo', async (req, res, next) => {
  try {
    let token = req.token;
    let userInfo = await UserModel.getUserById(token.user_id);
    if (userInfo) {
      res.send({code: 1, msg: '', data: Utils.userInfoFormat(userInfo)});
    } else {
      res.send({code: 0, msg: '暂无用户数据'});
    }
  }
  catch (error) {
    res.status(500).end();
    throw error;
  }
});

//注销
router.post('/logout', async (req, res, next) => {
  let cache = await Cache.init(config.cacheDB.users);
  try {
    let token = req.token;
    if (token && token.user_id) {
      if (await cache.exists(config.cacheKey.Users + token.user_id)) {
        cache.del(config.cacheKey.Users + token.user_id);
      }
      if (await cache.exists(config.cacheKey.User_Login_Pass_Retry + token.user_id)) {
        cache.del(config.cacheKey.User_Login_Pass_Retry + token.user_id);
      }
      if (await cache.exists(config.cacheKey.User_Token + token.user_id)) {
        cache.del(config.cacheKey.User_Token + token.user_id);
      }
      if (await cache.exists(config.cacheKey.User_Auth_Strategy + token.user_id)) {
        cache.del(config.cacheKey.User_Auth_Strategy + token.user_id);
      }
      if (await cache.exists(config.cacheKey.User_Alert + token.user_id)) {
        cache.del(config.cacheKey.User_Alert + token.user_id);
      }
      if (await cache.exists(config.cacheKey.User_Assets + token.user_id)) {
        cache.del(config.cacheKey.User_Assets + token.user_id);
      }
      cache.close();
      res.send({code: 1, msg: '注销成功'});
    }
  }
  catch (error) {
    res.status(500).end();
    throw error;
  } finally {
    cache.close();
  }
});

module.exports = router;
