let express = require('express');
let router = express.Router();
let multer = require('multer');
let AWS = require('aws-sdk');
let config = require('../Base/config');
let moment = require('moment');
let storage = multer.memoryStorage({
  destination: function (req, file, callback) {
    callback(null, '');
  }
});
// let multipleUpload = multer({ storage: storage }).array('file');
let upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    let types = ["image/jpg", "image/jpeg", "image/png", "image/pjpeg", "image/gif", "image/bmp", "image/x-png"];
    if (types.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('type error'))
    }
  },
}).single('file');


router.post('/upload', upload, function (req, res) {
  const item = req.file;
  let s3bucket = new AWS.S3({
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
    Bucket: config.aws.s3.buckit_name
  });
  s3bucket.createBucket(function () {
    let Bucket_Path = config.aws.s3.buckit_name + config.aws.s3.file_prefix + moment().format("/YYYY/MM/DD");
    //Where you want to store your file
    // var ResponseData = [];
    // file.map((item) => {
    var params = {
      Bucket: Bucket_Path,
      Key: moment().unix() + "-" + item.originalname,
      Body: item.buffer,
      ContentType: item.mimetype,
      ACL: 'public-read'
    };
    s3bucket.upload(params, function (err, data) {
      if (err) {
        res.send({code: 0, msg: err});
      } else {
        // ResponseData.push(data);
        // if(ResponseData.length == file.length){
        res.send({
          code: 1,
          msg: "File Uploaded SuceesFully",
          data: config.aws.s3.cdn_domain ? config.aws.s3.cdn_domain + "/" + Bucket_Path + "/" + params.Key : data.Location
        });
        // }
      }
    });
    // });
  });
});
module.exports = router;
