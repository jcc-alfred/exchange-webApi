let crypto = require('crypto');
let config = require('../config');


Utils = {
  getIP(request) {
    var ip = request.headers['x-forwarded-for'] ||
      request.connection.remoteAddress ||
      request.socket.remoteAddress ||
      request.connection.socket.remoteAddress;
    ip = ip.split(',')[0];
    ip = ip.split(':').slice(-1); //in case the ip returned in a format: "::ffff:146.xxx.xxx.xxx"
    return Array.isArray(ip) ? ip[0] : ip
  },
  isInt(num) {
    return /^[\d]+$/.test(num)
  },
  isNum(num) {
    var regPos = /^\d+(\.\d+)?$/; //非负浮点数
    var regNeg = /^(-(([0-9]+\.[0-9]*[1-9][0-9]*)|([0-9]*[1-9][0-9]*\.[0-9]+)|([0-9]*[1-9][0-9]*)))$/; //负浮点数
    if (regPos.test(num) || regNeg.test(num)) {
      return true;
    } else {
      return false;
    }
  },
  isEmail: (email) => {
    return /^([a-zA-Z0-9]+[_|\_|\.]?)*[a-zA-Z0-9]+@([a-zA-Z0-9]+[_|\_|\.]?)*[a-zA-Z0-9]+\.[a-zA-Z]{2,3}$/i.test(email);
  },
  isPhone(areaCode, phone) {
    if (areaCode == '86') {
      return /^1\d{10}$/.test(phone);
    } else {
      return this.isInt(phone) && phone.length >= 5;
    }
  },
  isChinaPhone(phone) {
    return /^1\d{10}$/.test(phone);
  },
  isChinaCardId(cardId) {
    return /(^\d{15}$)|(^\d{18}$)|(^\d{17}(\d|X|x)$)/.test(cardId);
  },
  //银行卡号校验
  luhmCheck(bankno) {
    if (bankno.length < 16 || bankno.length > 19) {
      return false;
    }
    var num = /^\d*$/; //全数字
    if (!num.exec(bankno)) {
      return false;
    }
    //开头6位
    var strBin = "10,18,30,35,37,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,58,60,62,65,68,69,84,87,88,94,95,98,99";
    if (strBin.indexOf(bankno.substring(0, 2)) === -1) {
      return false;
    }
    var lastNum = bankno.substr(bankno.length - 1, 1);//取出最后一位（与luhm进行比较）
    var first15Num = bankno.substr(0, bankno.length - 1);//前15或18位
    var newArr = [];
    for (var i = first15Num.length - 1; i > -1; i--) { //前15或18位倒序存进数组
      newArr.push(first15Num.substr(i, 1));
    }
    var arrJiShu = []; //奇数位*2的积 <9
    var arrJiShu2 = []; //奇数位*2的积 >9
    var arrOuShu = []; //偶数位数组
    for (var j = 0; j < newArr.length; j++) {
      if ((j + 1) % 2 == 1) {//奇数位
        if (parseInt(newArr[j]) * 2 < 9)
          arrJiShu.push(parseInt(newArr[j]) * 2);
        else
          arrJiShu2.push(parseInt(newArr[j]) * 2);
      }
      else //偶数位
        arrOuShu.push(newArr[j]);
    }
    var jishu_child1 = [];//奇数位*2 >9 的分割之后的数组个位数
    var jishu_child2 = [];//奇数位*2 >9 的分割之后的数组十位数
    for (var h = 0; h < arrJiShu2.length; h++) {
      jishu_child1.push(parseInt(arrJiShu2[h]) % 10);
      jishu_child2.push(parseInt(arrJiShu2[h]) / 10);
    }
    var sumJiShu = 0; //奇数位*2 < 9 的数组之和
    var sumOuShu = 0; //偶数位数组之和
    var sumJiShuChild1 = 0; //奇数位*2 >9 的分割之后的数组个位数之和
    var sumJiShuChild2 = 0; //奇数位*2 >9 的分割之后的数组十位数之和
    var sumTotal = 0;
    for (var m = 0; m < arrJiShu.length; m++) {
      sumJiShu = sumJiShu + parseInt(arrJiShu[m]);
    }
    for (var n = 0; n < arrOuShu.length; n++) {
      sumOuShu = sumOuShu + parseInt(arrOuShu[n]);
    }
    for (var p = 0; p < jishu_child1.length; p++) {
      sumJiShuChild1 = sumJiShuChild1 + parseInt(jishu_child1[p]);
      sumJiShuChild2 = sumJiShuChild2 + parseInt(jishu_child2[p]);
    }
    //计算总和
    sumTotal = parseInt(sumJiShu) + parseInt(sumOuShu) + parseInt(sumJiShuChild1) + parseInt(sumJiShuChild2);
    //计算Luhm值
    var k = parseInt(sumTotal) % 10 == 0 ? 10 : parseInt(sumTotal) % 10;
    var luhm = 10 - k;
    if (lastNum == luhm) {
      return true;
    }
    else {
      return false;
    }
  },
  md5(string) {
    return crypto.createHash('md5').update(string).digest('hex').toUpperCase()
    // return md5.update(string).digest('hex').toUpperCase();
  },

  formatString(str, args) {
    for (var i in args) {

      let reg = new RegExp(`\\{${i}\\}`, "gi");
      str = str.replace(reg, args[i]);
    }
    return str;
  },

  getPassLevel(pass) {
    let level = 0;

    if (pass.length >= 6 && pass.length <= 32) {
      level += 10;
      if (/(?=[\x21-\x7e]+)[^A-Za-z0-9]/.test(pass)) {
        level += 40;
      }
      if (/[a-z]/.test(pass)) {
        level += 10;
      }
      if (/[A-Z]/.test(pass)) {
        level += 20
      }
      if (/[0-9]/.test(pass)) {
        level += 10
      }
    }
    return level;
  },

  getClientInfo(req) {
    return {
      client_type: 'Web',
    }
  },
  isEmail: (email) => {
    return /^([a-zA-Z0-9]+[_|.]?)*[a-zA-Z0-9]+@([a-zA-Z0-9]+[_|.]?)*[a-zA-Z0-9]+\.[a-zA-Z]{2,3}$/i.test(email);
  },

  userInfoFormat(userInfo) {

    let temp = {};

    temp.user_id = userInfo.user_id;
    temp.full_name = userInfo.full_name;
    temp.email = userInfo.email;
    temp.area_code = userInfo.area_code;
    temp.phone_number = userInfo.phone_number;
    temp.identity_status = userInfo.identity_status;   //身份认证
    temp.is_safe_pass = !userInfo.safe_pass ? 0 : 1; //资金密码
    temp.is_enable_trade = userInfo.is_enable_trade; //是否开启交易
    temp.is_enable_withdraw = userInfo.is_enable_withdraw; //是否开启提现
    temp.google_secret = userInfo.google_secret ? 1 : 0; //是否开启google验证

    return temp
  },

  fixNumber(value, unit) {
    var value = isNaN(value) ? "0" : parseFloat(value).toFixed(8);
    var unit = unit || 0;
    var isInt = value.indexOf(".") == -1 ? true : false;
    var intNum = value.split(".")[0];
    var floatNum = !isInt ? value.split(".")[1] : "0";
    var floatArry = floatNum.split("");
    var newFloatNum = ".";
    for (var i = 0; i < unit; i++) {
      if (!floatArry[i]) {
        newFloatNum += "0"
      } else {
        newFloatNum += floatArry[i]
      }
    }
    return parseFloat(intNum + newFloatNum).toFixed(unit)
  },
  fixDecimal(value, unit) {
    var result = this.fixNumber(value, unit);
    if (unit > 0) {
      result = parseFloat(result)
    } else {
      result = parseInt(result)
    }
    if (result > 0 && result < 0.000001) {
      result = this.fixNumber(value, unit)
    }
    return result
  },
  checkDecimal(value, unit) {
    var result = value;
    if (value !== "") {
      if (this.isNum(value) && value >= 0) {
        var valueStr = parseFloat(value).toFixed(8) + "";
        if (valueStr.indexOf(".") !== -1) {
          var newStr, intStr = valueStr.split(".")[0] + "",
            floatStr = valueStr.split(".")[1] + "";
          if (unit === 0) {
            result = intStr;
          } else {
            if (floatStr.split("").length > unit) {
              newStr = intStr + "." + floatStr.substr(0, unit);
              result = newStr;
            }
          }
        }
      } else {
        result = ""
      }
    }
    return result;
  },
  add(a, b) {
    var c, d, e;
    try {
      c = a.toString().split(".")[1].length;
    } catch (f) {
      c = 0;
    }
    try {
      d = b.toString().split(".")[1].length;
    } catch (f) {
      d = 0;
    }
    return e = Math.pow(10, Math.max(c, d)), (this.mul(a, e) + this.mul(b, e)) / e;
  },
  sub(a, b) {
    var c, d, e;
    try {
      c = a.toString().split(".")[1].length;
    } catch (f) {
      c = 0;
    }
    try {
      d = b.toString().split(".")[1].length;
    } catch (f) {
      d = 0;
    }
    return e = Math.pow(10, Math.max(c, d)), (this.mul(a, e) - this.mul(b, e)) / e;
  },
  mul(a, b) {
    var c = 0,
      d = a.toString(),
      e = b.toString();
    try {
      c += d.split(".")[1].length;
    } catch (f) {
    }
    try {
      c += e.split(".")[1].length;
    } catch (f) {
    }
    return Number(d.replace(".", "")) * Number(e.replace(".", "")) / Math.pow(10, c);
  },
  div(a, b) {
    var c, d, e = 0,
      f = 0;
    try {
      e = a.toString().split(".")[1].length;
    } catch (g) {
    }
    try {
      f = b.toString().split(".")[1].length;
    } catch (g) {
    }
    return c = Number(a.toString().replace(".", "")), d = Number(b.toString().replace(".", "")), this.mul(c / d, Math.pow(10, f - e));
  }

};

module.exports = Utils;

