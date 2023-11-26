const { ShardingManager } = require('discord.js');
const axios = require('axios');
require('dotenv').config();

const upSince = Date.now();
const sites = {
    'https://top.gg/api/bots/946107355316252763/stats': {
        variable: "server_count",
        token: process.env.TOPGG_TOKEN
    },
    'https://discord.bots.gg/api/v1/bots/946107355316252763/stats': {
        variable: "guildCount",
        token: process.env.BOTSGG_TOKEN
    },
    'https://discordbotlist.com/api/v1/bots/946107355316252763/stats': {
        variable: "guilds",
        token: process.env.DBL_TOKEN
    }
};

function reduceObj(ex, add) {
    Object.keys(add).forEach((key) => {
        if (!Object.keys(ex).includes(key)) { ex[key] = 0; }
        ex[key] += add[key];
    });
    return ex;
}

let sinceWebsiteUpdated = 10;
function updateServerCount() {
    manager.broadcastEval((client) => [client.guilds.cache, client.tiktokstats]).then((shards) => {
        let serverCount = shards.reduce((total, shard) => total + shard[0].length, 0);
        let memberCount = shards.reduce((total, shard) => total + shard[0].reduce((members, guild) => members + guild.memberCount, 0), 0);

        //update shard activities
        manager.broadcastEval((c, { servers }) => {
            [
                c.user.setPresence({ activities: [{ name: `${servers} servers`, type: 3 }], status: 'online' })
            ];
        }, { context: { servers: serverCount } });

        if (!process.env.DISABLE_HEARTBEAT) {
            //update bot listing sites
            if (sinceWebsiteUpdated > 9) {
                Object.keys(sites).forEach((site) => {
                    axios.post(site, {
                        [sites[site].variable]: serverCount
                    }, {
                        headers: {
                            'Authorization': sites[site].token
                        }
                    })
                        .then((res) => {
                            console.log(`Updated ${site}`);
                        })
                        .catch((error) => {
                            console.log(`Failed to send stats to ${site}: ${error}`);
                        });
                });
                sinceWebsiteUpdated = 0;
            } else {
                sinceWebsiteUpdated++;
            }

            //update manager
            axios.post('https://manager.snadol.com/api', {
                type: "botsIn",
                auth: process.env.MANAGER_TOKEN,
                bot: "tiktok",
                dlS: shards.reduce((total, shard) => total + shard[1].dlS, 0),
                dlF: shards.reduce((total, shard) => total + shard[1].dlF, 0),
                dlFR: shards.reduce((total, shard) => reduceObj(total, shard[1].dlFReasons), {}),
                members: memberCount,
                servers: serverCount,
                upsince: upSince
            }, { headers: { 'content-type': 'application/json' } })
                .then((res) => { })
                .catch((error) => {
                    console.log(`Failed to send stats to mananger: ${error}`);
                });
        }
    });
}

const manager = new ShardingManager('./bot/bot.js', { token: process.env.TOKEN });
manager.spawn({
    delay: 1000
}).then(() => {
    updateServerCount();
    setInterval(updateServerCount, 30 * 1000);
});

process.on('SIGINT', function () {
    process.exit()
});
