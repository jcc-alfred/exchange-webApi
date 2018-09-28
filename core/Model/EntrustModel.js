let DB = require('../Base/Data/DB');
let Cache = require('../Base/Data/Cache');
let config = require('../Base/config');
let Utils = require('../Base/Utils/Utils');
let moment = require('moment');
let io = require('socket.io-client');
let socket = io(config.socketDomain);

let AssetsModel = require('../Model/AssetsModel');
let CoinModel = require('../Model/CoinModel');

class EntrustModel {

    constructor() {

    }

    async getEntrustByEntrustId(entrustId, coinExchangeId, entrustTypeId, refresh = false) {
        try {

            let cache = await Cache.init(config.cacheDB.order);
            let ckey = (entrustTypeId == 1 ? config.cacheKey.Buy_Entrust : config.cacheKey.Sell_Entrust) + coinExchangeId;
            if (await cache.exists(ckey) && !refresh) {
                let cRes = await cache.hgetall(ckey);
                if (Object.keys(cRes) && await Object.keys(cRes).includes(entrustId.toString())) {
                    cache.close();
                    return JSON.parse(cRes[entrustId])
                } else {
                    let cnt = await DB.cluster('salve');
                    let sql = `select * from m_entrust where entrust_id = ? and (entrust_status = 0 or entrust_status = 1)  `;
                    let res = await cnt.execReader(sql, entrustId);
                    cnt.close();
                    await cache.hset(ckey, res.entrust_id, res);
                    cache.close();
                    return res;
                }

            }
            let cnt = await DB.cluster('salve');
            let sql = `select * from m_entrust where entrust_id = ? and (entrust_status = 0 or entrust_status = 1)  `;
            let res = await cnt.execReader(sql, entrustId);
            cnt.close();
            if (res) {
                await cache.hset(ckey, res.entrust_id, res);
                //let cRes = await cache.hgetall(ckey);
            }
            cache.close();
            return res;

        } catch (error) {
            throw error;
        }

    }

    async addEntrust({userId, coinExchangeId, entrustTypeId, coinId, exchangeCoinId, buyFeesRate, sellFeesRate, entrustPrice, entrustVolume}) {
        let cnt = await DB.cluster('master');
        let res = 0;
        try {
            let serialNum = moment().format('YYYYMMDDHHmmssSSS');
            let feesRate = entrustTypeId == 1 ? buyFeesRate : sellFeesRate;
            let totalAmount = Utils.checkDecimal(Utils.mul(entrustPrice, entrustVolume), 8);
            cnt.transaction();
            //冻结用户资产
            let updAssets = null;
            if (entrustTypeId == 1) {
                console.log('userId:', userId, 'exchangeCoinId:', exchangeCoinId, 'totalAmount:', totalAmount);
                updAssets = await cnt.execQuery(`update m_user_assets set available = available - ? , frozen = frozen + ?
                where user_id = ? and coin_id = ?`, [totalAmount, totalAmount, userId, exchangeCoinId]);
            } else {
                updAssets = await cnt.execQuery(`update m_user_assets set available = available - ? , frozen = frozen + ?
                where user_id = ? and coin_id = ?`, [entrustVolume, entrustVolume, userId, coinId]);
            }
            let params = {
                serial_num: serialNum,
                user_id: userId,
                coin_exchange_id: coinExchangeId,
                entrust_type_id: entrustTypeId,
                entrust_price: entrustPrice,
                entrust_volume: entrustVolume,
                completed_volume: 0,
                no_completed_volume: entrustVolume,
                total_amount: totalAmount,
                completed_total_amount: 0,
                average_price: 0,
                trade_fees_rate: feesRate,
                trade_fees: 0,
                entrust_status: 0,
                entrust_status_name: '待成交'
            };
            let entrustRes = await cnt.edit('m_entrust', params);
            if (entrustRes.affectedRows) {
                cnt.commit();
                await AssetsModel.getUserAssetsByUserId(userId, true);
                res = {...params, entrust_id: entrustRes.insertId, create_time: Date.now()};
            } else {
                cnt.rollback();
            }
        } catch (error) {
            console.error(error);
            cnt.rollback();
            throw error;
        } finally {
            cnt.close();
        }
        return res;
    }

    async cancelEntrust({userId, entrustId, coinExchangeId, entrustTypeId}) {
        let cnt = await DB.cluster('master');
        let res = 0;
        try {
            let entrust = await this.getEntrustByEntrustId(entrustId, coinExchangeId, entrustTypeId);
            if (entrust && entrust.user_id == userId && (entrust.entrust_status == 0 || entrust.entrust_status == 1)) {
                //0 待成交 1 部分成交 2 已完成 3 已取消
                let coinExchangeList = await CoinModel.getCoinExchangeList();
                let coinEx = coinExchangeList.find(item => item.coin_exchange_id == coinExchangeId);
                let totalNoCompleteAmount = Utils.checkDecimal(Utils.mul(entrust.no_completed_volume, entrust.entrust_price), coinEx.exchange_decimal_digits);
                cnt.transaction();
                let updEntrust = await cnt.edit('m_entrust', {
                    entrust_status: 3,
                    entrust_status_name: '已取消'
                }, {entrust_id: entrustId});
                let updAssets = null;
                if (entrust.entrust_type_id == 1) {
                    updAssets = await cnt.execQuery(`update m_user_assets set available = available + ? , frozen = frozen - ? 
                    where user_id = ? and coin_id = ?`, [totalNoCompleteAmount, totalNoCompleteAmount, userId, coinEx.exchange_coin_id]);
                } else {
                    updAssets = await cnt.execQuery(`update m_user_assets set available = available + ? , frozen = frozen - ? 
                    where user_id = ? and coin_id = ?`, [entrust.no_completed_volume, entrust.no_completed_volume, userId, coinEx.coin_id]);
                }
                if (updEntrust.affectedRows) {
                    cnt.commit();
                    let refreshAssets = await AssetsModel.getUserAssetsByUserId(userId, true);
                    let cache = await Cache.init(config.cacheDB.order);
                    //buy or sell entrust list
                    let ckey = (entrust.entrust_type_id == 1 ? config.cacheKey.Buy_Entrust : config.cacheKey.Sell_Entrust) + coinExchangeId;
                    if (await cache.exists(ckey) && await cache.hexists(ckey, entrust.entrust_id)) {
                        await cache.hdel(ckey, entrust.entrust_id);
                    }
                    //entrust_ceid_userid
                    let uckey = config.cacheKey.Entrust_UserId + entrust.user_id;
                    if (await cache.exists(uckey) && await cache.hexists(uckey, entrust.entrust_id)) {
                        await cache.hdel(uckey, entrust.entrust_id);
                    }
                    cache.close();
                    socket.emit('entrustList', {coin_exchange_id: coinExchangeId});
                    socket.emit('userEntrustList', {user_id: entrust.user_id, coin_exchange_id: coinExchangeId});
                    res = 1;
                } else {
                    cnt.rollback();
                }
            } else {
                res = -1;
            }
        } catch (error) {
            console.error(error);
            cnt.rollback();
            throw error;
        } finally {
            cnt.close();
        }
        return res;
    }

    async getMarketList(refresh = false) {
        try {

            let cache = await Cache.init(config.cacheDB.order);
            let ckey = config.cacheKey.Market_List;
            if (await cache.exists(ckey) && !refresh) {
                let cRes = await cache.hgetall(ckey);
                if (cRes) {
                    let data = [];
                    for (let i in cRes) {
                        let item = cRes[i];
                        data.push(JSON.parse(item));
                    }
                    cache.close();
                    return data;
                }
            }

            let cnt = await DB.cluster('slave');
            let coinExList = await CoinModel.getCoinExchangeList();
            let marketList = [];
            await Promise.all(coinExList.map(async (item) => {
                let marketModel = {
                    last_price: 0,
                    change_rate: 0,
                    high_price: 0,
                    low_price: 0,
                    total_volume: 0,
                    total_amount: 0
                };
                //1. LastPrice
                let orderList = await this.getOrderListByCoinExchangeId(item.coin_exchange_id);
                let lastOrder = orderList.sort((item1, item2) => {
                    return item2.order_id - item1.order_id
                })[0];
                if (lastOrder && lastOrder.trade_price) {
                    marketModel.last_price = lastOrder.trade_price;
                    //2. highPrice lowPrice total_volume total_amount
                    let marketSQL = `SELECT max(trade_price) as high_price,min(trade_price) as low_price,sum(trade_volume) as total_volume,sum(trade_amount) as total_amount
                    FROM m_order Where coin_exchange_id = ? and create_time >= (now() - interval 24 hour) `;
                    let marketRes = await cnt.execReader(marketSQL, item.coin_exchange_id);
                    //3. pre24HourPrice
                    let pre24PriceSQL = `SELECT trade_price FROM m_order Where coin_exchange_id = ? and create_time >= (now() - interval 24 hour) ORDER BY order_id ASC LIMIT 1 `;
                    let pre24PriceRes = await cnt.execReader(pre24PriceSQL, item.coin_exchange_id);
                    if (marketRes && marketRes.high_price && pre24PriceRes && pre24PriceRes.trade_price) {
                        marketModel.high_price = marketRes.high_price;
                        marketModel.low_price = marketRes.low_price;
                        marketModel.total_volume = marketRes.total_volume;
                        marketModel.total_amount = marketRes.total_amount;
                        marketModel.change_rate = (marketModel.last_price - pre24PriceRes.trade_price) / pre24PriceRes.trade_price;
                    }
                }
                marketList.push({coin_exchange_id: item.coin_exchange_id, market: marketModel, coinEx: item});

            }));
            cnt.close();

            let chRes = await Promise.all(marketList.map((market) => {
                return cache.hset(
                    ckey,
                    market.coin_exchange_id,
                    market
                )
            }));

            cache.close();
            return marketList;

        } catch (error) {
            throw error;
        }
    }

    async getOrderListByCoinExchangeId(coinExchangeId, refresh = false) {
        try {

            let cache = await Cache.init(config.cacheDB.order);
            let ckey = config.cacheKey.Order_Coin_Exchange_Id + coinExchangeId;
            if (await cache.exists(ckey) && !refresh) {
                let cRes = await cache.hgetall(ckey);
                if (cRes) {
                    let data = [];
                    for (let i in cRes) {
                        let item = cRes[i];
                        data.push(JSON.parse(item));
                    }
                    cache.close();
                    return data;
                }
            }
            let cnt = await DB.cluster('slave');
            let sql = `SELECT * FROM m_order WHERE coin_exchange_id = ? ORDER BY create_time DESC LIMIT 30 `;
            let res = await cnt.execQuery(sql, coinExchangeId);
            cnt.close();

            let chRes = await Promise.all(res.map((info) => {
                return cache.hset(
                    ckey,
                    info.order_id,
                    info
                )
            }));

            cache.close();

            return res;

        } catch (error) {
            throw error;
        }
    }

    async getEntrustListByUserId(userId, coinExchangeId, refresh = false) {
        try {

            let cache = await Cache.init(config.cacheDB.order);
            let ckey = config.cacheKey.Entrust_UserId + userId;
            if (await cache.exists(ckey) && !refresh) {
                let cRes = await cache.hgetall(ckey);
                if (cRes) {
                    let data = [];
                    for (let i in cRes) {
                        let item = cRes[i];
                        data.push(JSON.parse(item));
                    }
                    cache.close();
                    return data;
                }
            }
            let cnt = await DB.cluster('slave');
            let sql = `SELECT * FROM m_entrust WHERE user_id = ? and (entrust_status = 0 or entrust_status = 1) `;
            let res = await cnt.execQuery(sql, userId);
            cnt.close();

            let chRes = await Promise.all(res.map((info) => {
                return cache.hset(
                    ckey,
                    info.entrust_id,
                    info
                )
            }));

            cache.close();

            return res;

        } catch (error) {
            throw error;
        }
    }

    async getBuyEntrustListByCEId(coinExchangeId, refresh = false) {
        try {

            let cache = await Cache.init(config.cacheDB.order);
            let ckey = config.cacheKey.Buy_Entrust + coinExchangeId;
            if (await cache.exists(ckey) && !refresh) {
                let buyRes = await cache.hgetall(ckey);
                if (buyRes) {
                    let data = [];
                    for (let i in buyRes) {
                        let item = buyRes[i];
                        data.push(JSON.parse(item));
                    }
                    cache.close();
                    return data;
                }
            }
            let cnt = await DB.cluster('slave');
            let sql = `SELECT * FROM m_entrust WHERE coin_exchange_id = ? and entrust_type_id = 1 and (entrust_status = 0 or entrust_status = 1) ORDER BY entrust_price DESC, entrust_id ASC LIMIT 20`;
            let res = await cnt.execQuery(sql, coinExchangeId);
            cnt.close();

            let chRes = await Promise.all(res.map((info) => {
                return cache.hset(
                    ckey,
                    info.entrust_id,
                    info
                )
            }));

            cache.close();

            return res;

        } catch (error) {
            throw error;
        }
    }

    async getSellEntrustListByCEId(coinExchangeId, refresh = false) {
        try {

            let cache = await Cache.init(config.cacheDB.order);
            let ckey = config.cacheKey.Sell_Entrust + coinExchangeId;
            if (await cache.exists(ckey) && !refresh) {
                let sellRes = await cache.hgetall(ckey);
                if (sellRes) {
                    let data = [];
                    for (let i in sellRes) {
                        let item = sellRes[i];
                        data.push(JSON.parse(item));
                    }
                    cache.close();
                    return data;
                }
            }

            let cnt = await DB.cluster('slave');
            let sql = `SELECT * FROM m_entrust WHERE coin_exchange_id = ? and entrust_type_id = 0 and (entrust_status = 0 or entrust_status = 1) ORDER BY entrust_price ASC, entrust_id ASC LIMIT 20`;
            let res = await cnt.execQuery(sql, coinExchangeId);
            cnt.close();

            let chRes = await Promise.all(res.map((info) => {
                return cache.hset(
                    ckey,
                    info.entrust_id,
                    info
                )
            }));

            cache.close();

            return res;

        } catch (error) {
            throw error;
        }
    }
}

module.exports = new EntrustModel();