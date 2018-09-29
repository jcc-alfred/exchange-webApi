let speakeasy = require('speakeasy');
let config = require('../config');

let GoogleUtils = {
    verifyGoogle(googleCode,secret){
        return speakeasy.totp.verify({ secret: secret,
            encoding: 'base32',
            token: googleCode 
        });
    },

    makeGoogleSecret(account){
        var secret = speakeasy.generateSecret();
        console.log(secret);
        return {
            secret:secret.base32,
            otpauth_url :`otpauth://totp/${config.sys.domain}:${account}?secret=${secret.base32}&issuer=${config.sys.domain}`
        }
    }
}

module.exports = GoogleUtils;