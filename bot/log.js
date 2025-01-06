const fs = require('fs');

let shardId = undefined;

function init(sId) {
    shardId = sId;

    if (!fs.existsSync('/var/log/tikcord')){
        fs.mkdirSync('/var/log/tikcord');
    }
}

function error(message) {
    fs.writeFileSync(`/var/log/tikcord/${shardId}.log`, `[${Date.now()}] [ERR] ${message}`);
    console.log(`[${shardId}] [${Date.now()}] [ERR] ${message}`);
}

function warn(message) {
    fs.writeFileSync(`/var/log/tikcord/${shardId}.log`, `[${Date.now()}] [WRN] ${message}`);
    console.log(`[${shardId}] [${Date.now()}] [WRN] ${message}`);
}

function info(message) {
    fs.writeFileSync(`/var/log/tikcord/${shardId}.log`, `[${Date.now()}] [INF] ${message}`);
    console.log(`[${shardId}] [${Date.now()}] [INF] ${message}`);
}

function debug(message) {
    fs.writeFileSync(`/var/log/tikcord/${shardId}.log`, `[${Date.now()}] [DBG] ${message}`);
    console.log(`[${shardId}] [${Date.now()}] [DBG] ${message}`);
}

module.exports = { init, debug, info, warn, error }