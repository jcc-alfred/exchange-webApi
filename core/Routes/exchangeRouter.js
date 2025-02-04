let express = require('express');
let router = express.Router();
let Utils = require('../Base/Utils/Utils');
let GoogleUtils = require('../Base/Utils/GoogleUtils');
let CodeUtils = require('../Base/Utils/CodeUtils');
let TokenUtils = require('../Base/Utils/TokenUtils');

let config = require('../Base/config');
let UserModel = require('../Model/UserModel');
let AssetsModel = require('../Model/AssetsModel');
let CoinModel = require('../Model/CoinModel');
let UserAuthStrategyModel = require('../Model/UserAuthStrategyModel');
let UserSafePassLogModel = require('../Model/UserSafePassLogModel');
let EntrustModel = require('../Model/EntrustModel');

let Cache = require('../Base/Data/Cache');
let MQ = require('../Base/Data/MQ');

let Enumerable = require('linq');

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
    console.error(error);
  }
});

router.post('/getUserEntrustList', async (req, res, next) => {
  let allUserEntrustList = await EntrustModel.getEntrustListByUserId(req.token.user_id);
  if (req.body.coinExchangeId) {
    allUserEntrustList = allUserEntrustList.filter((item) => item.coin_exchange_id === req.body.coinExchangeId);
  }
  let userEntrustListTmp = allUserEntrustList.sort((item1, item2) => {
    return item2.entrust_id - item1.entrust_id;
  });
  res.send({code: 1, msg: "", data: userEntrustListTmp})
});
router.post('/getUserHistoryEntrustList', async (req, res, next) => {
  let allUserEntrustList = await EntrustModel.getHistoryEntrustListByUserId(req.token.user_id, req.body.coinExchangeId);
  // if (req.body.coinExchangeId) {
  //   allUserEntrustList = allUserEntrustList.filter((item) => item.coin_exchange_id === req.body.coinExchangeId);
  // }
  let userEntrustListTmp = allUserEntrustList.sort((item1, item2) => {
    return item2.entrust_id - item1.entrust_id;
  });
  res.send({code: 1, msg: "", data: userEntrustListTmp})
});

//获取交易市场列表
router.post('/getCoinExchangeAreaList', async (req, res, next) => {
  try {

    let data = await CoinModel.getCoinExchangeAreaList();

    res.send({code: 1, msg: '', data: data})
  } catch (error) {
    res.status(500).end();
    console.error(error);
  }
});

//获取加密货币交易对列表
router.post('/getCoinExchangeList', async (req, res, next) => {
  try {

    let data = await CoinModel.getCoinExchangeList();

    res.send({code: 1, msg: '', data: data})
  } catch (error) {
    res.status(500).end();
    console.error(error);
  }
});
//获取市场行情列表
router.post('/getMarketList', async (req, res, next) => {
  try {

    let data = await EntrustModel.getMarketList();
    res.send({code: 1, msg: '', data: data})
  } catch (error) {
    res.status(500).end();
    console.error(error);
  }
});

//获取市场行情列表
router.post('/getCoinPrice', async (req, res, next) => {
  try {

    let data = await EntrustModel.getCoinPrice();
    res.send({code: 1, msg: '', data: data})
  } catch (error) {
    res.status(500).end();
    console.error(error);
  }
});

router.post('/getOrderListByCoinExchangeId', async (req, res, next) => {
  try {
    if (!req.body.coinExchangeId) {
      res.send({code: 0, msg: "coinExchangeId[int] required"})
    }
    // let data = await EntrustModel.getOrderListByCoinExchangeId(req.body.coinExchangeId);
    let orderList = await EntrustModel.getOrderListByCoinExchangeId(req.body.coinExchangeId);
    let orderListTmp = orderList.sort((item1, item2) => {
      return item2.order_id - item1.order_id;
    }).slice(0, 25);
    res.send({code: 1, msg: '', data: orderListTmp})
  } catch (error) {
    res.status(500).end();
    console.error(error);
  }
});


//获取交易是否安全
router.post('/getIsExchangeSafe', async (req, res, next) => {
  try {
    //获取安全策略
    let exchangeStrategy = await UserAuthStrategyModel.getUserStrategyByUserId(req.token.user_id, UserAuthStrategyModel.strategyTypeMap.exchange);
    if (!exchangeStrategy) {
      res.send({code: 0, msg: '账户异常'});
      return
    }
    let isExchangeSafe = false;
    //5 不验证资金密码 6 每6小时验证一次资金密码 7 每次交易均验证资金密码
    if (exchangeStrategy.user_auth_strategy_type_id == 5) {
      isExchangeSafe = true;
    }
    else if (exchangeStrategy.user_auth_strategy_type_id == 6) {
      let isSafe = await UserSafePassLogModel.getIsSafe(req.token.user_id);
      isSafe ? isExchangeSafe = true : isExchangeSafe = false;
    }
    else {
      isExchangeSafe = false;
    }

    res.send({code: 1, msg: '', data: {isExchangeSafe: isExchangeSafe}});
  } catch (error) {
    res.status(500).end();
    console.error(error);
  }
});

//提交委托
router.post('/doEntrust', async (req, res, next) => {
  try {
    let userInfo = await UserModel.getUserById(req.token.user_id);
    if (!userInfo.safe_pass) {
      res.send({code: 0, msg: '您还未设置资金密码'});
      return;
    }


    // if (req.body.coin_exchange_id === config.gtb_gtt_exchangeId && config.internal_user_ids.indexOf(req.token.user_id) < 0 && req.body.entrustTypeId === 0) {
    //   let user_gtt_transaction_today = await EntrustModel.getGttTransactionAmount(req.token.user_id);
    //   if (req.body.entrustPrice * req.body.entrustVolume + user_gtt_transaction_today > config.gtt_sell_day_limit) {
    //     res.send({code: 0, msg: '超出日交易额限制'});
    //     return;
    //   }
    // }
    if (!req.body.isExchangeSafe) {
      if (!req.body.safePass || Utils.md5(req.body.safePass) != userInfo.safe_pass) {
        res.send({code: 0, msg: '资金密码错误'});
        return;
      }
      UserSafePassLogModel.addSafePassLog(req.token.user_id);
    }
    let coinExchangeListRes = await CoinModel.getCoinExchangeList();
    let coinEx = coinExchangeListRes.find((item) => item.coin_exchange_id == req.body.coin_exchange_id);


    if (coinEx.is_enable_trade !== 1 || userInfo.is_enable_trade !== 1) {
      res.send({code: 0, msg: '暂不支持交易功能'});
      return;
    }

    if (coinEx.entrust_min_price > req.body.entrustPrice) {
      res.send({code: 0, msg: '委托价格不能低于：' + coinEx.entrust_min_price});
      return;
    }
    if (coinEx.entrust_min_amount > req.body.entrustVolume) {
      res.send({code: 0, msg: '委托数量不能低于：' + coinEx.entrust_min_amount});
      return;
    }
    if (req.token.user_id != 2 && coinEx.day_transaction_limit) {
      let log_type = req.body.entrustTypeId === 0 ? 3 : 4;
      let day_transactions = await EntrustModel.getTransactionAmount(req.token.user_id, coinEx.exchange_coin_id, log_type);
      if (req.body.entrustPrice * req.body.entrustVolume + day_transactions > coinEx.day_transaction_limit) {
        res.send({code: 0, msg: '超出日交易额限制'});
        return;
      }
    }
    let assetsList = await AssetsModel.getUserAssetsByUserId(req.token.user_id);
    let assets = assetsList.find((item) => item.coin_id == coinEx.coin_id);
    let exchangeAssets = assetsList.find((item) => item.coin_id == coinEx.exchange_coin_id);
    if (req.body.entrustTypeId == 1) {
      if (parseFloat(exchangeAssets.available) < parseFloat(Utils.mul(req.body.entrustPrice, req.body.entrustVolume)) || parseFloat(exchangeAssets.balance) < parseFloat(Utils.mul(req.body.entrustPrice, req.body.entrustVolume))) {
        res.send({code: 0, msg: '委托数量大于可用数量'});
        return;
      }
    }
    else if (req.body.entrustTypeId == 0) {
      if (parseFloat(assets.available) < parseFloat(req.body.entrustVolume) || parseFloat(assets.balance) < parseFloat(req.body.entrustVolume)) {
        res.send({code: 0, msg: '委托数量大于可用数量'});
        return;
      }
    }
    else {
      res.send({code: 0, msg: '参数错误'});
      return;
    }

    //1. 交易时段
    //2. 检验涨跌幅20%

    let params = {
      userId: req.token.user_id,
      coinExchangeId: coinEx.coin_exchange_id,
      entrustTypeId: req.body.entrustTypeId,
      coinId: coinEx.coin_id,
      exchangeCoinId: coinEx.exchange_coin_id,
      buyFeesRate: coinEx.buy_fees_rate,
      sellFeesRate: coinEx.sell_fees_rate,
      entrustPrice: req.body.entrustPrice,
      entrustVolume: req.body.entrustVolume
    };
    let entrustRes = await EntrustModel.addEntrust(params);
    if (entrustRes) {
      res.send({code: 1, msg: '委托成功', data: {entrustId: entrustRes.entrust_id}});
    } else {
      res.status(500).end();
    }
  } catch (error) {
    res.status(500).end();
    console.error(error);
  }
});

router.post('/lastPrice', async (req, res, next) => {
  try {
    if (!req.body.coin_name) {
      res.send({code: 0, msg: "coin_name needed"})
    }
    let coinlist = await CoinModel.getCoinList();
    let coin = coinlist.find(coin => coin.coin_name.toLowerCase() === req.body.coin_name.toLowerCase());
    if (!coin) {
      res.send({code: 0, msg: "coin cannot find"});
      return
    }
    let coinExList = await CoinModel.getCoinExchangeList();
    let coin_exchange = coinExList.find(coinex => coinex.coin_id === coin.coin_id);
    if (!coin_exchange) {
      res.send({code: 0, msg: "coin exchange cannot find"});
      return
    }
    let last_order = await EntrustModel.getLastOrder(coin_exchange.coin_exchange_id);
    let Base_Prices = await EntrustModel.getCoinexchangeBasePrice();
    let exchange_coin_prices = Base_Prices.find(i => i.symbol.toLowerCase() === coin_exchange.exchange_coin_name.toLowerCase());
    res.send({
      code: 1,
      msg: '',
      data: {
        coin_name: req.body.coin_name,
        last_price_usd: last_order.trade_price * exchange_coin_prices.price_usd,
        order_time: last_order.create_time
      }
    });
  } catch (error) {
    res.status(500).end();
    console.error(error);
  }
});


//批量提交委托
router.post('/doBatchEntrust', async (req, res, next) => {
  let entrusts = req.body.data;
  let entrustIds = [];

  // if (entrusts.length > 1000) {
  //     return res.status(400).end();
  // }

  let user_id = req.token.user_id;
  // let user_id = 144;

  for (let i = 0; i < entrusts.length; i++) {
    try {
      let userInfo = await UserModel.getUserById(user_id);
      if (!userInfo.safe_pass) {
        res.send({code: 0, msg: '您还未设置资金密码'});
        return;
      }
      if (!entrusts[i].isExchangeSafe) {
        if (!entrusts[i].safePass || Utils.md5(entrusts[i].safePass) != userInfo.safe_pass) {
          res.send({code: 0, msg: '资金密码错误'});
          return;
        }
        UserSafePassLogModel.addSafePassLog(user_id);
      }
      let coinExchangeListRes = await CoinModel.getCoinExchangeList();
      let coinEx = coinExchangeListRes.find((item) => item.coin_exchange_id == entrusts[i].coin_exchange_id);
      if (coinEx.is_enable_trade !== 1 || userInfo.is_enable_trade !== 1) {
        res.send({code: 0, msg: '暂不支持交易功能'});
        return;
      }
      if (coinEx.entrust_min_price > entrusts[i].entrustPrice) {
        res.send({code: 0, msg: '委托价格不能低于：' + coinEx.entrust_min_price});
        return;
      }
      if (coinEx.entrust_min_amount > entrusts[i].entrustVolume) {
        res.send({code: 0, msg: '委托数量不能低于：' + coinEx.entrust_min_amount});
        return;
      }
      let assetsList = await AssetsModel.getUserAssetsByUserId(user_id);
      let assets = assetsList.find((item) => item.coin_id == coinEx.coin_id);
      let exchangeAssets = assetsList.find((item) => item.coin_id == coinEx.exchange_coin_id);
      if (entrusts[i].entrustTypeId == 1) {
        if (exchangeAssets.available < Utils.mul(entrusts[i].entrustPrice, entrusts[i].entrustVolume) || exchangeAssets.balance < Utils.mul(entrusts[i].entrustPrice, entrusts[i].entrustVolume)) {
          res.send({code: 0, msg: '委托数量大于可用数量'});
          return;
        }
      }
      else if (entrusts[i].entrustTypeId == 0) {
        if (assets.available < entrusts[i].entrustVolume || assets.balance < entrusts[i].entrustVolume) {
          res.send({code: 0, msg: '委托数量大于可用数量'});
          return;
        }
      }
      else {
        res.send({code: 0, msg: '参数错误'});
        return;
      }

      //1. 交易时段
      //2. 检验涨跌幅20%

      let params = {
        userId: user_id,
        coinExchangeId: coinEx.coin_exchange_id,
        entrustTypeId: entrusts[i].entrustTypeId,
        coinId: coinEx.coin_id,
        exchangeCoinId: coinEx.exchange_coin_id,
        buyFeesRate: coinEx.buy_fees_rate,
        sellFeesRate: coinEx.sell_fees_rate,
        entrustPrice: entrusts[i].entrustPrice,
        entrustVolume: entrusts[i].entrustVolume
      };
      let entrustRes = await EntrustModel.addEntrust(params);
      entrustIds.push(entrustRes.entrust_id);

    } catch (error) {
      console.error(error);
      res.status(500).end();
      return
    }
  }

  res.send({code: 1, msg: '委托成功', data: {entrustIds: entrustIds.join()}});
});

//取消委托
router.post('/doCancelEntrust', async (req, res, next) => {
  try {
    let result = await EntrustModel.cancelEntrust({
      userId: req.token.user_id,
      entrustId: req.body.entrustId,
      coinExchangeId: req.body.coinExchangeId,
      entrustTypeId: req.body.entrustTypeId
    });
    if (result > 0) {
      res.send({code: 1, msg: '操作成功'});
    }
    else {
      res.send({code: 0, msg: '操作失败'});

    }
  } catch (error) {
    res.status(500).end();
    console.error(error);
  }
});

//批量取消委托
router.post('/doBatchCancelEntrust', async (req, res, next) => {
  let user_id = req.token.user_id;
  let entrust_sns = req.body.entrust_sns;

  // if (!entrust_sns || entrust_sns.length > 10) {
  //     return res.status(400).end();
  // }
  try {
    for (let i = 0; i < entrust_sns.length; i++) {

      let result = await EntrustModel.cancelEntrust({
        userId: user_id,
        entrustId: entrust_sns[i].entrustId,
        coinExchangeId: entrust_sns[i].coinExchangeId,
        entrustTypeId: entrust_sns[i].entrustTypeId
      });
      if (!(result > 0)) {
        res.send({code: 0, msg: '操作失败' + JSON.stringify(entrust_sns[i])});
        return;
      }
    }
    res.send({code: 1, msg: '操作成功'});

  } catch (error) {
    res.status(500).end();
    console.error(error);
  }


});

router.post('/getEntrustList', async (req, res, next) => {
  try {
    let data = await EntrustModel.getEntrustListByUserId(req.token.user_id, req.body.refresh || false);
    if (req.body.coinExchangeId) {
      data = data.filter(item => item.coin_exchange_id == req.body.coinExchangeId);
    }
    res.send({code: 1, msg: '', data: data})
  } catch (error) {
    res.status(500).end();
    console.error(error);
  }
});

router.post('/entrustList', async (req, res, next) => {
  try {

    let entrustList = await EntrustModel.getEntrustList(req.body.coinExchangeId, req.body.refresh);
    res.send({code: 1, msg: '', data: entrustList});
  } catch (error) {
    res.status(500).end();
    console.error(error);
  }
});


router.post('/reset', async (req, res, next) => {
  try {
    if (config.reset && config.reset.status && config.reset.status == 1 && config.reset.token && req.body.super_token && req.body.super_token == config.reset.token) {
      // console.log(req.body.super_token == config.reset.token);
      if (!req.body.exchange_pair_name) {
        return res.send({"msg": "exchange_pair_name required, example: BTC/USDT"});
      }
      let coin_exchange_id = await CoinModel.getCoinIDbyName(req.body.exchange_pair_name);
      let reset = await EntrustModel.ResetEntrust(coin_exchange_id, req.token.user_id);
      if (reset) {
        res.send({code: 200, msg: "reset done"})
      }
      else {
        res.send({code: 400, msg: "reset failed"})
      }
    } else {
      res.status(404).end();
    }

  }
  catch (e) {
    res.status(500).end();
    console.error(e);
  }
});
module.exports = router;
