let EntrustModel = require("../Model/EntrustModel");
let express = require('express');
let router = express.Router();
let Utils = require('../Base/Utils/Utils');
let GoogleUtils = require('../Base/Utils/GoogleUtils');
let CodeUtils = require('../Base/Utils/CodeUtils');
let TokenUtils = require('../Base/Utils/TokenUtils');

let config = require('../Base/config');
let UserModel = require('../Model/UserModel');

let UserAuthStrategyModel = require('../Model/UserAuthStrategyModel');
let UserAlertModel = require('../Model/UserAlertModel');
let SystemModel = require('../Model/SystemModel');
let AssetsModel = require('../Model/AssetsModel');
let CoinModel = require('../Model/CoinModel');
let DepositModel = require('../Model/DepositModel');
let WithdrawAccountModel = require('../Model/WithdrawAccountModel');
let WithdrawModel = require('../Model/WithdrawModel');
let AssetsLogModel = require('../Model/AssetsLogModel');
let UserBonusModel = require('../Model/UserBonusModel');
let Cache = require('../Base/Data/Cache');
let MQ = require('../Base/Data/MQ');
let nodeEth = require('node-eth-address');


//获取加密货币列表
router.post('/getCoinList', async (req, res, next) => {
  try {

    let data = await CoinModel.getCoinList();
    let coinList = data.map(coin => {
      let temp = {};
      temp.coin_id = coin.coin_id;
      temp.coin_name = coin.coin_name;
      temp.coin_type_id = coin.coin_type_id;
      temp.coin_type_name = coin.coin_type_name;
      temp.coin_api_type_id = coin.coin_api_type_id;
      temp.qrcode_prefix = coin.qrcode_prefix;
      temp.coin_unit = coin.coin_unit;
      temp.coin_symbol = coin.coin_symbol;
      temp.coin_icon = coin.coin_icon;
      temp.decimal_digits = coin.decimal_digits;
      temp.confirm_count = coin.confirm_count;
      temp.is_enable_deposit = coin.is_enable_deposit;
      temp.is_enable_transfer = coin.is_enable_transfer;
      temp.is_enable_withdraw = coin.is_enable_withdraw;
      temp.withdraw_min_amount = coin.withdraw_min_amount;
      temp.withdraw_max_amount = coin.withdraw_max_amount;
      temp.withdraw_day_amount = coin.withdraw_day_amount;
      temp.withdraw_fees_rate = coin.withdraw_fees_rate;
      temp.withdraw_min_fees_amount = coin.withdraw_min_fees_amount;
      temp.deposit_account_key = coin.deposit_account_key;
      temp.deposit_tips_key = coin.deposit_tips_key;
      temp.withdraw_tips_key = coin.withdraw_tips_key;
      temp.order_by_num = coin.order_by_num;
      temp.record_status = coin.record_status;
      return temp;
    });
    res.send({code: 1, msg: '', data: coinList})
  } catch (error) {
    res.status(500).end();
    throw error;
  }
});

//获取用户资产信息列表
router.post('/getUserAssets', async (req, res, next) => {
  try {
    let data = await AssetsModel.getUserAssetsByUserId(req.token.user_id, req.body.refresh || false);
    res.send({code: 1, msg: '', data: data});
  } catch (error) {
    res.status(500).end();
    throw error;
  }
});

router.post('/getUserAssetsValue', async (req, res, next) => {
  try {
    let data = await AssetsModel.getUserAssetsByUserId(req.token.user_id, req.body.refresh || false);
    let CoinPrices = await EntrustModel.getCoinPrice();
    let BTCPrice = CoinPrices.find(i => i.symbol.toLowerCase() === 'btc').price_usd;
    data.map((i, index) => {
      let PriceUSD = CoinPrices.find(item => item.symbol.toLowerCase() === i.coin_name.toLowerCase());
      if (PriceUSD) {
        data[index]['value_USD'] = (PriceUSD.price_usd * i.balance).toFixed(2);
        data[index]['value_BTC'] = (data[index]['value_USD'] / BTCPrice).toFixed(8);
      } else {
        data[index]['value_USD'] = 0;
        data[index]['value_BTC'] = 0
      }
    });

    res.send({code: 1, msg: '', data: data});
  } catch (error) {
    res.status(500).end();
    throw error;
  }
});

//获取用户充值记录
router.post('/getUserDepositListByCoinId', async (req, res, next) => {
  try {

    if (!req.body.page || !Utils.isInt(req.body.page) || !req.body.pageSize || !Utils.isInt(req.body.pageSize) ||
      !req.body.coinId || !Utils.isInt(req.body.coinId)) {
      res.send({code: 0, msg: '参数错误'});
      return;
    }

    let data = await DepositModel.getUserDepositListByCoinId(req.token.user_id, req.body.coinId, req.body.page, req.body.pageSize);

    res.send({code: 1, msg: '', data: data})
  } catch (error) {
    res.status(500).end();
    throw error;
  }
});

//获取用户资产账户记录
router.post('/getUserWithdrawAccountByCoinId', async (req, res, next) => {
  try {

    if (!req.body.coinId || !Utils.isInt(req.body.coinId)) {
      res.send({code: 0, msg: '参数错误'});
      return;
    }
    let data = await WithdrawAccountModel.getUserWithdrawAccountByCoinId(req.token.user_id, req.body.coinId);
    res.send({code: 1, msg: '', data: data})
  } catch (error) {
    res.status(500).end();
    throw error;
  }
});

//添加用户资产账户
router.post('/addUserWithdrawAccount', async (req, res, next) => {
  try {
    if (!req.body.safePass || !Utils.getPassLevel(req.body.safePass)) {
      res.send({code: 0, msg: '密码格式错误'});
      return;
    }
    if (!req.body.blockAddress || !req.body.memo || !req.body.coinId || !Utils.isInt(req.body.coinId)) {
      res.send({code: 0, msg: '参数异常'});
      return
    }
    //短信邮件验证码
    if (!req.body.hasOwnProperty('phoneCode') && !req.body.hasOwnProperty('emailCode')) {
      res.send({code: 0, msg: '参数异常'});
      return
    }
    //验证blockAddress 是否有效
    //

    let userInfo = await UserModel.getUserById(req.token.user_id);
    if (!userInfo.safe_pass) {
      res.send({code: 0, msg: '您还未设置资金密码'});
      return;
    }
    if (req.body.hasOwnProperty('phoneCode') && !await CodeUtils.codeQuals(userInfo.area_code + userInfo.phone_number, req.body.phoneCode)) {
      res.send({code: 0, msg: '手机验证码错误'});
      return;
    }
    else if (req.body.hasOwnProperty('emailCode') && !await CodeUtils.codeQuals(userInfo.email, req.body.emailCode)) {
      res.send({code: 0, msg: '邮箱验证码错误'});
      return;
    }

    if (Utils.md5(req.body.safePass) != userInfo.safe_pass) {
      res.send({code: 0, msg: '资金密码错误'});
      return;
    }
    if (userInfo.google_secret) {
      let verify = GoogleUtils.verifyGoogle(req.body.googleCode, userInfo.google_secret);
      if (!req.body.hasOwnProperty('googleCode') || !verify) {
        res.send({code: 0, msg: 'Google 验证码错误'});
        return;
      }
    }

    let result = await WithdrawAccountModel.addUserWithdrawAccount(req.token.user_id, req.body.coinId, req.body.blockAddress, req.body.memo);

    if (result.affectedRows == 0) {
      res.send({code: 0, msg: '设置失败'});
      return;
    }

    res.send({code: 1, msg: '设置成功'});
    CodeUtils.delCode(req.body.hasOwnProperty('emailCode') ? userInfo.email : userInfo.area_code + userInfo.phone_number);
  } catch (error) {
    res.status(500).end();
    throw error;
  }
});

//删除用户资产账户
router.post('/delUserWithdrawAccount', async (req, res, next) => {
  try {

    if (!req.body.userWithdrawAccountId || !Utils.isInt(req.body.userWithdrawAccountId)) {
      res.send({code: 0, msg: '参数异常'});
      return
    }

    let result = await WithdrawAccountModel.delUserWithdrawAccount(req.body.userWithdrawAccountId);

    if (result.affectedRows == 0) {
      res.send({code: 0, msg: '处理失败'});
      return;
    }
    res.send({code: 1, msg: '处理成功'});
  } catch (error) {
    res.status(500).end();
    throw error;
  }
});

//获取用户提现记录
router.post('/getUserWithdrawListByCoinId', async (req, res, next) => {
  try {

    if (!req.body.page || !Utils.isInt(req.body.page) || !req.body.pageSize || !Utils.isInt(req.body.pageSize) ||
      !req.body.coinId || !Utils.isInt(req.body.coinId)) {
      res.send({code: 0, msg: '参数错误'});
      return;
    }

    let data = await WithdrawModel.getUserWithdrawListByCoinId(req.token.user_id, req.body.coinId, req.body.page, req.body.pageSize);

    res.send({code: 1, msg: '', data: data})
  } catch (error) {
    res.status(500).end();
    throw error;
  }
});

//用户申请提现
router.post('/doUserWithdraw', async (req, res, next) => {

  try {
    if (!req.body.safePass || !Utils.getPassLevel(req.body.safePass)) {
      res.send({code: 0, msg: '密码格式错误'});
      return;
    }
    if (req.body.coinId != 1) {
      if (!nodeEth.validateAddress(req.body.toBlockAddress)) {
        if (req.body.coinId != 17) {
          res.send({code: 0, msg: "提款地址不合法"});
          return;
        } else if (req.body.toBlockAddress.indexOf("@") < 0) {
          res.send({code: 0, msg: "提款地址不合法"});
          return;
        }
      }
    }


    if (!req.body.toBlockAddress || !req.body.submitAmount || !req.body.coinId || !Utils.isInt(req.body.coinId)) {
      res.send({code: 0, msg: '参数异常'});
      return
    }
    //验证toBlockAddress是否有效
    //
    let userInfo = await UserModel.getUserById(req.token.user_id);
    if (!userInfo.safe_pass) {
      res.send({code: 0, msg: '您还未设置资金密码'});
      return;
    }
    if (Utils.md5(req.body.safePass) != userInfo.safe_pass) {
      res.send({code: 0, msg: '资金密码错误'});
      return;
    }
    //判断是否允许提现
    let coinList = await CoinModel.getCoinList();
    let coin = coinList.find((item) => item.coin_id == req.body.coinId);

    if (!coin) {
      res.send({code: 0, msg: '参数异常'});
      return
    }
    if (!coin.is_enable_withdraw) {
      res.send({code: 0, msg: '暂不支持提现功能'});
      return
    }
    let userAssets = await AssetsModel.getUserAssetsByUserIdCoinId(req.token.user_id, req.body.coinId);
    if (!userAssets.is_enable_withdraw) {
      res.send({code: 0, msg: '暂不支持提现功能'});
      return
    }
    let strategy = await UserAuthStrategyModel.getUserStrategyByUserId(req.token.user_id, UserAuthStrategyModel.strategyTypeMap.withdraw);

    //8.资金密码+短信/邮件验证码 9.资金密码+Google验证码 10.资金密码+Google验证码+短信/邮件验证码

    if (strategy.user_auth_strategy_type_id == 8) {

      if (!req.body.hasOwnProperty('phoneCode') && !req.body.hasOwnProperty('emailCode')) {
        res.send({code: 0, msg: '参数异常'});
        return
      }
      if (req.body.hasOwnProperty('phoneCode') && req.body.phoneCode !== '' && !await CodeUtils.codeQuals(userInfo.area_code + userInfo.phone_number, req.body.phoneCode)) {
        res.send({code: 0, msg: '手机验证码错误'});
        return;
      }
      else if (req.body.hasOwnProperty('emailCode') && req.body.emailCode !== '' && !await CodeUtils.codeQuals(userInfo.email, req.body.emailCode)) {
        res.send({code: 0, msg: '邮箱验证码错误'});
        return;
      }

    } else if (strategy.user_auth_strategy_type_id == 9) {

      let verify = GoogleUtils.verifyGoogle(req.body.googleCode, userInfo.google_secret);

      if (!req.body.hasOwnProperty('googleCode') || !verify) {
        res.send({code: 0, msg: 'Google 验证码错误'});
        return;
      }

    } else if (strategy.user_auth_strategy_type_id == 10) {

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

      let verify = GoogleUtils.verifyGoogle(req.body.googleCode, userInfo.google_secret);

      if (!req.body.hasOwnProperty('googleCode') || !verify) {
        res.send({code: 0, msg: 'Google 验证码错误'});
        return;
      }
    }
    if (coin.withdraw_min_amount > 0 && req.body.submitAmount < coin.withdraw_min_amount) {
      res.send({code: -1, data: coin.withdraw_min_amount, msg: '提现数量不能小于最小提现数量'});
      return
    }
    if (coin.withdraw_max_amount > 0 && req.body.submitAmount > coin.withdraw_max_amount) {
      res.send({code: -2, data: coin.withdraw_max_amount, msg: '提现数量不能大于最大提现数量'});
      return
    }
    //可用余额
    if (userAssets.available < req.body.submitAmount || userAssets.balance < req.body.submitAmount) {
      res.send({code: 0, msg: '提现数量大于可用数量'});
      return;
    }
    //日限额
    let user = await UserModel.getUserById(req.token.user_id);
    if (user.identity_status === 3) {
      //高级实名验证
      if (coin.senior_withdraw_day_amount && coin.senior_withdraw_day_amount > 0) {
        let hasWithdrawAmount = await WithdrawModel.getUserDayWithdrawAmountByCoinId(req.token.user_id, req.body.coinId);
        let totalAmount = Utils.add(hasWithdrawAmount, req.body.submitAmount);
        if (totalAmount > coin.senior_withdraw_day_amount) {
          let maxAmount = Utils.sub(coin.senior_withdraw_day_amount, hasWithdrawAmount);
          res.send({code: -2, data: maxAmount, msg: '当日提交提现数额超过最大限额'});
          return
        }
      }
    } else {
      //普通用户
      if (coin.withdraw_day_amount > 0) {
        let hasWithdrawAmount = await WithdrawModel.getUserDayWithdrawAmountByCoinId(req.token.user_id, req.body.coinId);
        let totalAmount = Utils.add(hasWithdrawAmount, req.body.submitAmount);
        if (totalAmount > coin.withdraw_day_amount) {
          let maxAmount = Utils.sub(coin.withdraw_day_amount, hasWithdrawAmount);
          res.send({code: -2, data: maxAmount, msg: '当日提交提现数额超过最大限额'});
          return
        }
      }
    }


    let fees = Utils.mul(req.body.submitAmount, coin.withdraw_fees_rate);
    if (fees < coin.withdraw_min_fees_amount) {
      fees = coin.withdraw_min_fees_amount;
    }
    fees = Utils.checkDecimal(fees, coin.decimal_digits);
    let submitAmount = Utils.checkDecimal(req.body.submitAmount, coin.decimal_digits);
    var result = await WithdrawModel.addUserWithdraw(req.token.user_id, req.body.coinId, req.body.toBlockAddress, submitAmount, userAssets.balance, fees, coin.withdraw_fees_rate);
    if (result <= 0) {
      res.send({code: 0, msg: '处理失败'});
      return;
    }
    res.send({code: 1, msg: '处理成功'});
    //清空验证码
    CodeUtils.delCode(req.body.hasOwnProperty('emailCode') ? userInfo.email : userInfo.area_code + userInfo.phone_number);
    //刷新用户资产信息
    AssetsModel.getUserAssetsByUserId(req.token.user_id, true);
  } catch (error) {
    res.status(500).end();
    throw error;
  }
});

//用户取消提现
router.post('/cancelUserWithdraw', async (req, res, next) => {

  try {
    if (!req.body.userWithdrawId || !Utils.isInt(req.body.userWithdrawId)) {
      res.send({code: 0, msg: '参数异常'});
      return
    }

    var cres = await WithdrawModel.cancelUserWithdraw(req.body.userWithdrawId, req.token.user_id);
    if (cres <= 0) {
      res.send({code: 0, msg: '处理失败'});
      return;
    }
    res.send({code: 1, msg: '处理成功'});
    //刷新用户资产信息
    AssetsModel.getUserAssetsByUserId(req.token.user_id, true);
  } catch (error) {
    res.status(500).end();
    throw error;
  }
});

//获取用户资产日志类型列表
router.post('/getUserAssetsLogTypeList', async (req, res, next) => {
  try {
    let data = await AssetsLogModel.getUserAssetsLogTypeList();
    res.send({code: 1, msg: '', data: data})
  } catch (error) {
    res.status(500).end();
    throw error;
  }
});

//获取用户资产日志列表
router.post('/getUserAssetsLogList', async (req, res, next) => {
  try {

    if (!req.body.page || !Utils.isInt(req.body.page) || !req.body.pageSize || !Utils.isInt(req.body.pageSize)) {
      res.send({code: 0, msg: '参数错误'});
      return;
    }

    let data = await AssetsLogModel.getUserAssetsLogList(
      req.token.user_id,
      req.body.coinId,
      req.body.userAssetsLogTypeId,
      req.body.startDate,
      req.body.endDate,
      req.body.page,
      req.body.pageSize
    );

    res.send({code: 1, msg: '', data: data})
  } catch (error) {
    res.status(500).end();
    throw error;
  }
});

//获取用户推广收益统计
router.post('/getUserBonusStatics', async (req, res, next) => {
  try {
    let data = await UserBonusModel.getUserBonusStaticsByUserId(req.token.user_id);
    res.send({code: 1, msg: '', data: data})
  } catch (error) {
    res.status(500).end();
    throw error;
  }
});
//获取用户推广收益明细列表
router.post('/getUserBonusList', async (req, res, next) => {
  try {

    if (!req.body.page || !Utils.isInt(req.body.page) || !req.body.pageSize || !Utils.isInt(req.body.pageSize)) {
      res.send({code: 0, msg: '参数错误'});
      return;
    }

    let data = await UserBonusModel.getUserBonusListByUserId(
      req.token.user_id,
      req.body.page,
      req.body.pageSize
    );

    res.send({code: 1, msg: '', data: data})
  } catch (error) {
    res.status(500).end();
    throw error;
  }
});

module.exports = router;
