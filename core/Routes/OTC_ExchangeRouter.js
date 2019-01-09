let express = require('express');
let router = express.Router();
let CoinModel = require('../Model/CoinModel');
let OTCEntrusModel = require('../Model/OTCEntrustModel');
let UserModel = require('../Model/UserModel');
let UserSafePassLogModel = require('../Model/UserSafePassLogModel');
let Enumerable = require('linq');


router.post('/coins', async (req, res, next) => {
  try {
    let OTCExchangeArea = await CoinModel.getOTCExchangeArea(req.body.type || "all");
    res.send({code: 1, msg: "", data: OTCExchangeArea});
  } catch (e) {
    res.status(500).end();
    throw e
  }
});
router.post('/entrustList', async (req, res, next) => {
  try {
    if ([0, 1].indexOf(req.body.type) < 0) {
      res.send({code: 0, msg: "params  type required"});
      return
    }
    let data = await OTCEntrusModel.getOpenEntrustList(req.body.coin_id || 'all', req.body.type);
    let ordered_data = [];
    if (req.body.type === 1) {
      ordered_data = Enumerable.from(data).orderByDescending("$.price").toArray();
    } else {
      ordered_data = Enumerable.from(data).orderBy("$.price").toArray();
    }

    res.send({code: 1, msg: "", data: ordered_data});
  } catch (e) {
    res.status(500).end();
    throw e
  }
});
router.get('/entrust', async (req, res, next) => {
  try {
    if (!req.query.entrust_id) {
      res.send({code: 0, msg: "entrust_id required"});
      return;
    }
    let data = await OTCEntrusModel.getEntrustByID(req.query.entrust_id);
    if (data) {
      delete data.secret_remark;
      res.send({code: 1, msg: "", data: data})
    } else {
      res.send({code: 0, msg: "cannot find specific entrust"});
    }
  } catch (e) {
    res.status(500).end();
    throw e
  }
});

router.post('/entrust/cancel', async (req, res, next) => {
  try {
    if (!req.body.entrust_id) {
      res.send({code: 0, msg: "entrust_id required"});
      return;
    }
    let entrust = await OTCEntrusModel.getEntrustByID(req.body.entrust_id);
    if (!entrust || [0, 1].indexOf(entrust.status) < 0) {
      res.send({code: 0, msg: "open entrust cannot find"});
      return
    }
    if (req.token.user_id !== entrust.ad_user_id) {
      res.status(401).end();
      return
    }
    let data = await OTCEntrusModel.cancelEntrust(entrust);
    if (data) {
      res.send({code: 1, msg: "cancel entrust successfully"})
    } else {
      res.send({code: 0, msg: "fail to cancel entrust"});
    }
  } catch (e) {
    res.status(500).end();
    throw e
  }
});

router.get('/entrust/my', async (req, res, next) => {
  try {
    let data = await OTCEntrusModel.getEntrustByUserID(req.token.user_id);
    res.send({code: 1, msg: "", data: data});
  } catch (e) {
    res.status(500).end();
    throw e
  }
});
router.get('/order/my', async (req, res, next) => {
  try {
    let data = await OTCEntrusModel.getOrderByUserID(req.token.user_id);
    if (req.query.coin_id) {
      data = data.filter(item => item.coin_id == req.query.coin_id)
    }
    data = data.map(function (a) {
      a.role = req.token.user_id == a.buy_user_id ? "buy" : "sell";
      return a;
    });
    res.send({code: 1, msg: "", data: data});
  } catch (e) {
    res.status(500).end();
    throw e
  }
});
router.post('/order/cancel', async (req, res, next) => {
  try {
    let order = await OTCEntrusModel.getOrderByID(req.body.order_id);
    if ([order.buy_user_id, order.sell_user_id].indexOf(req.token.user_id) < 0) {
      res.status(401).end();
      return;
    }
    if (order.status == 3) {
      res.send({code: 1, msg: "the order is already invalid"});
      return
    } else if (order.status == 4) {
      res.send({code: 1, msg: "the order is already canceled"});
      return
    } else if (order.status == 2) {
      res.send({code: 1, msg: "the order has been completed"});
      return
    }
    if (await OTCEntrusModel.cancelOrder(order)) {
      res.send({code: 1, msg: "cancel entrust successfully"});
    } else {
      res.send({code: 0, msg: "fail to cancel entrust"})
    }

  } catch (e) {
    res.status(500).end();
    throw e
  }
});
router.post('/order/create', async (req, res, next) => {
  try {
    let entrust = await OTCEntrusModel.getEntrustByID(req.body.entrust_id);
    if (!entrust) {
      res.send({code: 0, msg: "the entrust doesn't exist"});
      return
    }
    if (req.body.coin_amount < entrust.min_trade_amount) {
      res.send({code: 0, msg: "coin amount not enough"});
      return
    }
    let data = await OTCEntrusModel.createOTCOrder(req.token.user_id, entrust, req.body.coin_amount);
    if (data) {
      res.send({code: 1, msg: "successfully create order", data: data})
    } else {
      res.send({code: 0, msg: "fail to create order"});
    }
  } catch (e) {
    res.status(500).end();
    throw e;
  }
});
router.get('/order/:id([0-9]+)', async (req, res, next) => {
  try {
    let order = await OTCEntrusModel.getOrderByID(req.params.id, req.token.user_id);
    if (!order) {
      res.send({code: 0, msg: "the order doesn't exist"});
      return
    }
    let sell_user = await UserModel.getUserById(order.sell_user_id);
    let buy_user = await UserModel.getUserById(order.buy_user_id);
    order.entrust = await OTCEntrusModel.getEntrustByID(order.entrust_id);
    order.sell_user_name = sell_user.full_name ? sell_user.full_name : sell_user.email;
    order.buy_user_name = buy_user.full_name ? buy_user.full_name : buy_user.email;
    if (order.trigger_type == 0) {
      if (req.token.user_id == order.buy_user_id) {
        order.trade_fee_rate = "0%"
      } else {
        order.trade_fee_rate = order.trade_fee_rate * 100 + "%"
      }

      if (!order.secret_remark) {
        order.secret_remark = await OTCEntrusModel.getUserDefaultSecretRemark(order.sell_user_id);
      }
    } else {
      if (req.token.user_id == order.sell_user_id) {
        order.trade_fee_rate = "0%"
      } else {
        order.trade_fee_rate = order.trade_fee_rate * 100 + "%"
      }
      order.secret_remark = await OTCEntrusModel.getUserDefaultSecretRemark(order.sell_user_id);
    }
    res.send({code: 1, msg: "", data: order});
  } catch (e) {
    res.status(500).end();
    throw e;
  }
});

router.post('/secret_remark', async (req, res, next) => {
  try {
    if (req.body.secret_remark === undefined) {
      res.send({code: 0, msg: "secret_remark required"});
      return
    }
    let update_secret_remark = await OTCEntrusModel.updateUserDefaultSecretRemark(req.token.user_id, req.body.secret_remark);
    res.send({code: 1, msg: "update successfully"});
  } catch (e) {
    res.status(500).end();
    throw e;
  }
});

router.get('/secret_remark', async (req, res, next) => {
  try {
    let secret_remark = await OTCEntrusModel.getUserDefaultSecretRemark(req.token.user_id);
    res.send({code: 1, msg: "", data: secret_remark});
  } catch (e) {
    res.status(500).end();
    throw e;
  }
});


router.post('/entrust/create', async (req, res, next) => {
  try {
    let data = await OTCEntrusModel.CreateEntrust(null, req.token.user_id, req.body.type, req.body.coin_id,
      req.body.amount, req.body.price, req.body.currency, req.body.min_amount, req.body.remark,
      req.body.secret_remark, req.body.methods, req.body.valid_duration
    );
    res.send({code: 1, msg: "", data: data});
  } catch (e) {
    res.status(500).end();
    throw e
  }
});
router.post('/order/pay', async (req, res, next) => {
  try {
    if (!req.body.order_id) {
      res.send({code: 0, msg: "order_id required"});
      return
    }
    let order = await OTCEntrusModel.getOrderByID(req.body.order_id, req.token.user_id);
    if (order.buy_user_id !== req.token.user_id) {
      ///支付用户只能是买用户
      res.send({code: 1, msg: "You are not authorized to pay the order"});
      return
    }
    await OTCEntrusModel.PayOTCOrder(order);
    res.send({code: 1, msg: "successfully pay the order"});
  } catch (e) {
    res.status(500).end();
    throw e
  }
});

router.post('/order/confirm', async (req, res, next) => {
  try {
    if (!req.body.order_id) {
      res.send({code: 0, msg: "order_id required"})
    }
    let order = await OTCEntrusModel.getOrderByID(req.body.order_id, req.token.user_id);
    if (order.sell_user_id !== req.token.user_id) {
      ///确认用户只能是卖币用户
      res.status(401).end();
      return
    }
    let userInfo = await UserModel.getUserById(req.token.user_id);
    if (!userInfo.safe_pass) {
      res.send({code: 0, msg: '您还未设置资金密码'});
      return;
    }
    if (!req.body.isExchangeSafe) {
      if (!req.body.safePass || Utils.md5(req.body.safePass) != userInfo.safe_pass) {
        res.send({code: 0, msg: '资金密码错误'});
        return;
      }
      UserSafePassLogModel.addSafePassLog(req.token.user_id);
    }
    let confirm_order = await OTCEntrusModel.ConfirmOTCOrder(order);

    confirm_order ? res.send({code: 1, msg: "successfully confirm the order"}) : res.send({
      code: 0,
      msg: "failed to confirm the order"
    });
  } catch (e) {
    res.status(500).end();
    throw e

  }
});


module.exports = router;
