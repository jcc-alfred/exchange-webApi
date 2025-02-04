var express = require('express');
var router = express.Router();
var multer = require("multer");
var moment = require('moment');
var fs = require('fs');
var images = require("images");
var ccap = require('ccap');
let config = require('../Base/config');
let MailUtils = require('../Base/Utils/MailUtils');
var qr = require('qr-image');
var stream = require('stream');
let SMS_AWS = require('../Base/Utils/SMSUtils');
/* GET home page. */

router.get('/', async function (req, res, next) {
  try {

    res.render('index', {title: 'Express'});

  } catch (error) {
    res.status(500).end();
    throw error;
  }

});

router.get('/qrcode', async (req, res, next) => {
  try {


    var code = qr.image(req.query.code || '.', {type: 'png', margin: 1});
    res.setHeader('Content-type', 'image/png');  //sent qr image to client side
    code.pipe(res);

  } catch (error) {
    res.status(500).end();
    throw error;
  }
});

router.get('/imgCode', (req, res, next) => {


  var captcha = ccap({

    width: 256,//set width,default is 256

    height: 60,//set height,default is 60

    offset: 40,//set text spacing,default is 40

    quality: 100,//set pic quality,default is 50

    fontsize: 57,//set font size,default is 57
  });


  let [text, buffer] = captcha.get();

  req.session.imgCode = text;
  console.log(req.session.imgCode);

  res.end(buffer);
});


var upload = multer({
  storage: multer.diskStorage({

    destination: function (req, file, cb) {
      var path = './public/uploads/' + moment().format('YYYYMMDD');
      !fs.existsSync(path) && fs.mkdir(path);
      cb(null, path)
    },
    filename: function (req, file, cb) {
      let [fileanme, extension] = file.originalname.split(".");
      cb(null, Date.now() + "." + extension);
    }
  }),
  limits: {
    fields: 0,
    fileSize: 1024 * 1024 * 4
  },
  fileFilter: (req, file, cb) => {
    let types = ["image/jpg", "image/jpeg", "image/png", "image/pjpeg", "image/gif", "image/bmp", "image/x-png"];
    if (types.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('type error'))
    }
  },

});

router.post('/upload', upload.single('file'), (req, res) => {
  try {

    let watermark = images('./public/images/watermark.png');
    let img = images(req.file.path);

    img.draw(
      watermark,
      img.width() - watermark.width() - 10,
      img.height() - watermark.height() - 10
    )
      .save(req.file.path);

    res.send({
      code: 1,
      data: req.file.path.replace('public', '')
    })
  } catch (error) {
    res.status(500).end();
    throw error;
  }

});
var uploadDocument = multer({
  storage: multer.diskStorage({

    destination: function (req, file, cb) {
      var path = './public/documents/' + moment().format('YYYYMMDD');
      !fs.existsSync(path) && fs.mkdir(path);
      cb(null, path)
    },
    filename: function (req, file, cb) {
      let [fileanme, extension] = file.originalname.split(".");
      cb(null, Date.now() + "." + extension);
    }
  }),
  limits: {
    fields: 0,
    fileSize: 1024 * 1024 * 4
  },
  fileFilter: (req, file, cb) => {
    let types = ["image/jpg", "image/jpeg", "image/png", "image/pjpeg", "image/gif", "image/bmp", "image/x-png"];
    if (types.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('type error'))
    }
  },

});
router.post('/uploadDocument', uploadDocument.single('file'), (req, res) => {
  try {
    let img = images(req.file.path);
    img.save(req.file.path);
    res.send({
      code: 1,
      data: req.file.path.replace('public', '')
    })
  } catch (error) {
    res.status(500).end();
    throw error;
  }

});

var uploadQrcode = multer({
  storage: multer.diskStorage({

    destination: function (req, file, cb) {
      var path = './public/qrcodes/' + moment().format('YYYYMMDD');
      !fs.existsSync(path) && fs.mkdir(path);
      cb(null, path)
    },
    filename: function (req, file, cb) {
      let [fileanme, extension] = file.originalname.split(".");
      cb(null, Date.now() + "." + extension);
    }
  }),
  limits: {
    fields: 0,
    fileSize: 1024 * 1024 * 4
  },
  fileFilter: (req, file, cb) => {
    let types = ["image/jpg", "image/jpeg", "image/png", "image/pjpeg", "image/gif", "image/bmp", "image/x-png"];
    if (types.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('type error'))
    }
  },

});
router.post('/sendEmailSMS', async (req, res, next) => {

  let mRe = null;
  try {
    let params = req.body;
    if (params.token !== 'ScviZ3s2KMc6Kh32Q%!1^WNfAY0bnZ') {
      res.send({code: 0, msg: "验证码错误"});
      return
    }

    if (params.type === "phone") {
      if (!params.areaCode || !Utils.isInt(params.areaCode)) {
        res.send({code: 0, msg: '国家代码错误'});
        return;
      } else if (!params.phoneNumber || !Utils.isPhone(params.areaCode, params.phoneNumber)) {
        res.send({code: 0, msg: '手机号格式错误'});
        return;
      } else {
        let SMSClient = new SMS_AWS();
        let response = await SMSClient.SendMsg(params.msg, params.phoneNumber, params.areaCode, params.subject || 'AIM');
        mRes = response.MessageId
      }

    } else if (params.type === "email") {
      if (!params.email || !Utils.isEmail(params.email)) {
        res.send({code: 0, msg: '邮箱格式错误'});
        return;
      } else {
        MailUtils.init(config.AIMMail.host, config.AIMMail.port, config.AIMMail.secure,
          config.AIMMail.secureConnection, config.AIMMail.user, config.AIMMail.pass, config.AIMMail.mailFrom);
        let response = await MailUtils.sendMail({
          to: params.email,
          title: params.subject,
          text: params.msg,
          html: params.html
        });
        mRes = response.messageId
      }
    } else {
      res.send({code: 0, msg: '参数异常'});
      return;
    }


    mRes ? res.send({code: 1, msg: '发送成功'}) : res.send({code: 0, msg: '发送失败'});
  }
  catch (error) {
    res.status(500).end();
    throw error;
  }

});
router.post('/uploadQrcode', uploadQrcode.single('file'), (req, res) => {
  try {
    // console.log('111111111', req.file.path);
    let img = images(req.file.path);

    img.save(req.file.path);

    res.send({
      code: 1,
      data: req.file.path.replace('public', '')
    })
  } catch (error) {
    res.status(500).end();
    throw error;
  }

});
module.exports = router;
