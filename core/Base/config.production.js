const config = {

    socketDomain: 'http://127.0.0.1:5000/',

    sys: {
        domain: 'getdax.com',     //域名
        ipRegisterMaxNum: 100,       //IP注册最大次数
        loginPassRetryNum: 5,        //密码输入错误重试次数
        sendMsgRetryNum: 5,          //队列 向手机邮箱发送放心消息失败重试次数
        codeExpired: 5,              //验证码过期时间 分钟
        codeSendIntervalTime: 60,     // 重复发送间隔不得超过60秒
        sendAlertType: 1,            // 1 优先邮件 2 优先短信 3只发邮件 4只发短信
    },

    token: {
        secret: 'Melt@998',
        expire_Web: 7200,
        expire_APP: '7d'
    },


    DB: {
        master: {
            host: '127.0.0.1',
            user: 'root',
            password: 'gtdollar',
            database: 'MeltEx', // 前面建的user表位于这个数据库中
            port: 3306,
            connectionLimit: 100,
        },
        slaves: [{
            host: '127.0.0.1',
            user: 'root',
            password: 'gtdollar',
            database: 'MeltEx', // 前面建的user表位于这个数据库中
            port: 3306,
            connectionLimit: 100,
        }, {
            host: '127.0.0.1',
            user: 'root',
            password: 'gtdollar',
            database: 'MeltEx', // 前面建的user表位于这个数据库中
            port: 3306,
            connectionLimit: 100,
        }]
    },


    redis: {
        host: '127.0.0.1',
        port: '6379',
        password: 'gtdollar',
        db: 0,
        prefix: 'c_'
    },

    cacheDB: {
        users: 15,
        system: 0,
        order: 1
    },

    cacheKey: {
        Users: 'users_',                                         // 用户信息 data:15 String 用户id做索引,
        User_Login_Pass_Retry: 'User_Login_Pass_Retry_',         // 用户登录密码重试 data:15 String
        User_Token: "User_Token_",                               // 用户token data:15 String

        User_Auth_Strategy: 'User_Auth_Strategy_',               // 用户安全策略 data:15
        User_Auth_Strategy_Type: 'User_Auth_Strategy_Type',      // 用户安全策略类型 data:15 hash

        User_Alert: 'User_Alert_',                               // 用户通知 data:15 hash
        User_Alert_Type: 'User_Alert_Type',                      // 用户通知类型 data:15 hash
        User_Code: 'User_Code_',                                 // 用户验证码

        Sys_Lang: 'Sys_Lang',                                    // 系统语言 data:0 hash
        Sys_Msg_tpl: "Sys_Msg_tpl",                              // 系统通知模板 data0 hash
        Sys_Config: 'Sys_Config',                                //系统配置 data0 hash

        Sys_Coin: 'Sys_Coin',                                    // 所有币种 data:0 hash
        Sys_Coin_Exchange_Area: 'Sys_Coin_Exchange_Area',        // 交易市场 data:0 hash
        Sys_Coin_Exchange: 'Sys_Coin_Exchange',                  // 所有币种交易对 data:0 hash

        Sys_Coin_OTC: 'Sys_Coin_OTC',                            // 所有OTC币种 data:0 hash
        User_Assets_OTC: "User_Assets_OTC_",                     // 用户OTC资产信息 data:15 hash
        Buy_Entrust_OTC: "Buy_Entrust_OTC_",                     //买单委托OTC
        Sell_Entrust_OTC: "Sell_Entrust_OTC_",                   //卖单委托OTC
        Entrust_OTC_UserId: "Entrust_OTC_UserId_",               //用户委托OTC
        Order_OTC_UserId: "Order_OTC_UserId_",                   //用户订单OTC

        User_Assets: "User_Assets_",                             // 用户资产信息 data:15 hash

        User_Assets_Log_Type: "User_Assets_Log_Type",             // 用户资产日志类型 data:15 hash

        Buy_Entrust: "Buy_Entrust_",                             //买单委托
        Sell_Entrust: "Sell_Entrust_",                           //卖单委托
        Entrust_UserId: "Entrust_UserId_",                       //用户委托
        Order_Coin_Exchange_Id: "Order_Coin_Exchange_Id_",       //成交订单列表
        Market_List: "Market_List",                              //盘口行情数据

    },

    MQ: {
        protocol: 'amqp',
        hostname: '127.0.0.1',
        port: 5672,
        username: 'gtuser',
        password: 'gtdollar',
        vhost: '/',
        connectionLimit: 5,
    },
    MQKey: {
        Send_Code: 'Send_Code',
        Send_Alert: 'Send_Alert',
        Entrust_Queue: 'Entrust_CEId_',
        Entrust_OTC_Queue: 'Entrust_OTC_CoinId_',
        Order_OTC_Queue: 'Order_OTC_CoinId_',
    },
};

module.exports = config;