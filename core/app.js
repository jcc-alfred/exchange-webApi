var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var cookieSession = require('cookie-session');
var bodyParser = require('body-parser');
var url = require('url');
var TokenUtils = require('./Base/Utils/TokenUtils');

var app = express();
app.set('env', 'production');
// let domainList = ['https://www.asiaedx.com', 'https://admin.asiaedx.com', 'http://localhost:8888', 'http://54.169.107.53:8888', 'http://54.169.107.53:3006', 'http://54.169.107.53:8080'];
app.use(function (req, res, next) {
  // if (domainList.includes(req.headers.origin)) {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Content-Length,Authorization,Accept,X-Requested-With,token,language');
  res.header('Access-Control-Allow-Credentials', true);
  // }
  req.method == "OPTIONS" ? res.status(200).end() : next();
  /*让options请求快速返回*/
});


// view engine setup
app.set('views', path.join(__dirname, 'Views'));
app.set('view engine', 'ejs');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('combined'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));
app.use(cookieParser());
app.use(cookieSession({
  name: 'session',
  keys: ['melt'],
  // maxAge: 24 * 60 * 60 * 1000 // 24 hours
}));

app.use(express.static(path.join(__dirname, '../public')));




app.all('*', async (req, res, next) => {
  let allowList = [
    '/',
    '/upload',
    '/photo/upload',
    '/uploadDocument',
    '/uploadQrcode',
    '/imgCode',
    '/sendEmailSMS',
    '/qrcode',
    '/user/signUp',
    '/user/login',
    '/user/authSafety',
    '/user/sendCode',
    '/user/forgotLoginPass',
    '/exchange/getCoinExchangeAreaList',
    '/exchange/getMarketList',
    '/exchange/getCoinPrice',
    '/exchange/getOrderListByCoinExchangeId',
    '/exchange/lastPrice',
    '/doc/getHomeNewsList',
    '/doc/getArticleList',
    '/doc/getNewsList',
    '/doc/getNewsModelById',
    '/doc/getArticleModelById',
    '/otc/coins',
    '/otc/entrustList',
    '/otc/entrust/',

    // Add for no login
    '/exchange/getCoinExchangeList',
    '/exchange/getCoinList',
    '/market/trade/kline',
  ];
  let urlParse = url.parse(req.url);

  for (let aUrl of allowList) {
    if (aUrl.toLowerCase() == urlParse.pathname.toLowerCase()) {
      req.token = TokenUtils.decodeToken(req.headers.token) || null;
      next();
      return;
    }
  }

  let data = await TokenUtils.verifyToken(req.headers.token);

  if (data) {
    req.token = data;
    next();
  } else {
    //没有token 403 有token无效是401
    res.status(401).end();
  }
});


app.use('/', require('./Routes/indexRouter'));
app.use('/user', require('./Routes/userRouter'));
app.use('/safe', require('./Routes/safeRouter'));
app.use('/assets', require('./Routes/assetsRouter'));
app.use('/exchange', require('./Routes/exchangeRouter'));
app.use('/doc', require('./Routes/docRouter'));
app.use('/market', require('./Routes/marketRouter'));
app.use('/otc', require('./Routes/OTC_ExchangeRouter'));
app.use('/photo', require('./Routes/photoRouter'));


// catch 404 and forward to error handler
app.use(function (req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});


module.exports = app;
