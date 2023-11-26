let shardId = undefined;
function init(sId) {
    shardId = sId;
}

function error(message) {
    console.log(`[${shardId}] [${Date.now()}] [ERR] ${message}`);
}

function warn(message) {
    console.log(`[${shardId}] [${Date.now()}] [WRN] ${message}`);
}

function info(message) {
    console.log(`[${shardId}] [${Date.now()}] [INF] ${message}`);
}

function debug(message) {
    //console.log(`[${shardId}] [${Date.now()}] [DBG] ${message}`);
}

module.exports = { init, debug, info, warn, error }