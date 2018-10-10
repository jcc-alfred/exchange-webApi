let amqp = require('amqplib');
let config = require('../config');

class MQ {

  static async init() {
    try {
      this.open = await amqp.connect(config.MQ);
      this.ch = await this.open.createChannel();
    } catch (error) {
      console.error("cannot connect to MQ" + JSON.stringify(config.MQ));
      throw error;
    }

  }

  static async push(key, data) {
    try {
      await this.ch.assertQueue(key, {durable: true});
      return this.ch.sendToQueue(key, new Buffer(JSON.stringify(data)), {persistent: true});
    } catch (error) {
      console.error(error);
      return false;
    }
  }

}

MQ.init();

module.exports = MQ;
