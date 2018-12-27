let express = require('express');
let router = express.Router();
let CoinModel = require('../Model/CoinModel');
let OTCEntrusModel = require('../Model/OTCEntrustModel');
let UserModel = require('../Model/UserModel');

router.post('/coins', async (req, res, next) => {
  try {
    let OTCExchangeArea = await CoinModel.getOTCExchangeArea();
    res.send({code: 1, msg: "", data: OTCExchangeArea});
  } catch (e) {
    throw e
  }
});
router.post('/entrustList', async (req, res, next) => {
  try {
    let data = await OTCEntrusModel.getOpenEntrustList(req.body.coin_id, req.body.type);
    res.send({code: 1, msg: "", data: data});
  } catch (e) {
    throw e
  }
});
router.post('/order/create', async (req, res, next) => {
  try {
    let entrust = await OTCEntrusModel.getEntrustByID(req.body.entrust_id);
    let data = await OTCEntrusModel.createOTCOrder(req.token.user_id, entrust, req.body.coin_amount);
    res.send({code: 1, msg: "successfully create order", data: data});
  } catch (e) {
    res.send({code: 0, msg: e});
    throw e;
  }
});
router.post('/order/:id', async (req, res, next) => {
  try {
    let order = await OTCEntrusModel.getOTCOrderByID(req.params.id);
    let sell_user = await UserModel.getUserById(order.sell_user_id);
    let buy_user = await UserModel.getUserById(order.buy_user_id);
    order.sell_user_name = sell_user.full_name ? sell_user.full_name : sell_user.email;
    order.buy_user_name = buy_user.full_name ? buy_user.full_name : buy_user.email;
    res.send({code: 1, msg: "", data: order});
  } catch (e) {
    res.send({code: 0, msg: e});
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
    throw e
  }
});
router.post('/order/pay', async (req, res, next) => {
  try {
    if (!req.body.order_id) {
      res.send({code: 0, msg: "order_id required"})
    }
    let order = await OTCEntrusModel.getOTCOrderByID(req.body.order_id);
    if (order.buy_user_id !== req.token.user_id) {
      ///支付用户只能是买用户
      res.status(401).end()
    }
    await OTCEntrusModel.PayOTCOrder(order);

    res.send({code: 1, msg: "successfully pay the order"});
  } catch (e) {
    throw e
  }
});
router.post('/order/confirm', async (req, res, next) => {
  try {
    if (!req.body.order_id) {
      res.send({code: 0, msg: "order_id required"})
    }
    let order = await OTCEntrusModel.getOTCOrderByID(req.body.order_id);
    if (order.sell_user_id !== req.token.user_id) {
      ///确认用户只能是卖币用户
      res.status(401).end();
      return
    }
    await OTCEntrusModel.ConfirmOTCOrder(order);

    res.send({code: 1, msg: "successfully pay the order"});
  } catch (e) {
    throw e
  }
});


module.exports = router;
