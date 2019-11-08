let AWS = require('aws-sdk');
let config = require('../../Base/config');

class SMS_AWS {
  constructor() {
    this.client = new AWS.SNS({
      apiVersion: '2010-03-31',
      accessKeyId: config.aws.accessKeyId,
      secretAccessKey: config.aws.secretAccessKey,
      region: "ap-southeast-1"
    })
  }

  async SendMsg(msg, phone_number, area_code, title = 'AIM') {
    let params = {
      Message: msg, /* required */
      PhoneNumber: "+" + area_code + phone_number,
      MessageAttributes: {
        'AWS.SNS.SMS.SenderID': {'DataType': 'String', 'StringValue': title},
        'AWS.SNS.SMS.SMSType': {'DataType': 'String', 'StringValue': 'Promotional'}
      }
    };
    let res = await this.client.publish(params).promise();
    return res
  }

  async publish(params) {
    let async = promisify(this.client.publish).bind(this.client);
    return async(params)
  }
}

module.exports = SMS_AWS;
