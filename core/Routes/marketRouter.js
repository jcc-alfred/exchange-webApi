let express = require('express');
let router = express.Router();
let EntrustModel = require('../Model/EntrustModel');

router.post('/trade/kline',async(req,res,next)=>{
  try {
    let klineList =  await EntrustModel.getKlineData(req.body.coinExchangeId, req.body.range);
    let klineArray = [];
    if(klineList && klineList.length > 0){
      klineList = klineList.sort((item1,item2)=>{return item1.timestamp - item2.timestamp})
    }
    klineList.forEach(item => {
      let tmpArray = [item.timestamp * 1000,item.open_price,item.high_price,item.low_price,item.close_price,item.volume];
      klineArray.push(tmpArray);
    });
    res.send({
      code:1,
      msg: '获取kline成功',
      data: {
        kline:klineArray,
        date:new Date().getTime()
      }
    });
  } catch (error) {
    res.send({code:0,msg:'获取kline失败',error:error})
  }
});
module.exports = router;
