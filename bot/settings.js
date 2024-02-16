const fs = require('fs');

function init() {
    if (!fs.existsSync(`./bot/settings/`)) fs.mkdirSync(`./bot/settings/`);
}

function initServer(guildId) {
    return new Promise((res, rej) => {
        if (!fs.existsSync(`./bot/settings/${guildId}.json`)) {
            fs.writeFile(`./bot/settings/${guildId}.json`, JSON.stringify({
                deleteMessage: false,
                deleteEmbed: false
            }), 'utf8', () => {
                res();
            });
        } else {
            res();
        }
    });
}

function getSetting(guildId, setting = "all") {
    return new Promise((res, rej) => {
        initServer(guildId).then(() => {
            let data = JSON.parse(fs.readFileSync(`./bot/settings/${guildId}.json`, 'utf8'));
            if (setting == "all") {
                res(data);
            } else {
                if (Object.keys(data).includes(setting)) {
                    res(data[setting]);
                } else {
                    rej();
                }
            }
        });
    });
}

function setSetting(guildId, setting, value) {
    return new Promise((res, rej) => {
        initServer(guildId).then(() => {
            let data = JSON.parse(fs.readFileSync(`./bot/settings/${guildId}.json`, 'utf8'));
            if (Object.keys(data).includes(setting)) {
                data[setting] = value;
                fs.writeFile(`./bot/settings/${guildId}.json`, JSON.stringify(data), 'utf8', () => {
                    res();
                });
            } else {
                rej();
            }
        });
    });
}

module.exports = { init, getSetting, setSetting };