const fs = require("fs");

const logFile = fs.createWriteStream('./logs/TIKTOK_' + Date.now() + '.log', { flags: 'a' });

function error(message) {
    console.log("[" + Date.now() + "] " + "[ERR] " + message);
    logFile.write("[" + Date.now() + "] " + "[ERR] " + message + '\n');
}

function warn(message) {
    console.log("[" + Date.now() + "] " + "[WRN] " + message);
    logFile.write("[" + Date.now() + "] " + "[WRN] " + message + '\n');
}

function info(message) {
    console.log("[" + Date.now() + "] " + "[INF] " + message);
    logFile.write("[" + Date.now() + "] " + "[INF] " + message + '\n');
}

function debug(message) {
    //console.log("[" + Date.now() + "] " + "[DBG] " + message);
    logFile.write("[" + Date.now() + "] " + "[DBG] " + message + '\n');
}

module.exports = { debug, info, warn, error }