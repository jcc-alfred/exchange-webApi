let nodemailer = require('nodemailer');
let config = require('../config');
let MailUtils = {
    transporter:null,
    init(host,port,secure,secureConnection,user,pass,mailFrom){
        let smtp = {host:host,port:parseInt(port),secure:secure,secureConnection:secureConnection,auth:{user:user,pass:pass}}
        this.transporter = nodemailer.createTransport(smtp,{from: mailFrom});
    },
    
    message({to,title,text,html}){
        return {
            to:to,
            subject:title,
            text:text,
            html:html,
        }
    },

    sendMail({to,title,text,html}){
        return new Promise((resolve,reject)=>{
            let option = this.message({to,title,text,html});
            this.transporter.sendMail(option, (error, info) => {
                error ? reject(error) : resolve(info)
            });
        })
    }


}

module.exports = MailUtils
