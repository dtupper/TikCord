const axios = require('axios');
const log = require("./log.js");

let upSince = Date.now();

function updateManager(client, dlS, dlF, dlFReasons) {
    let guilds = client.guilds.cache;

    let servers = guilds.size;
    let users = 0;
    guilds.forEach((g) => {
        users += g.memberCount;
    });

    log.info("Sending stats to manager");
    axios.post('https://manager.snadol.com/api', {
		type: "botsIn",
		auth: process.env.MANAGER_TOKEN,
		bot: "tiktok",
		uid: client.user.id,
		dlS: dlS,
		dlF: dlF,
		dlFR: dlFReasons,
		members: users,
		servers: servers,
		upsince: upSince
	}, { headers: { 'content-type': 'application/json' } })
        .then((res) => {
        	log.debug(`Sent stats to manager`);
		client.user.setPresence({ activities: [{ name: `${res.data.data.servers} servers`, type: 3 }], status: 'online' });
        })
        .catch((error) => {
         	log.warn(`Failed to send stats to mananger: ${error}`);
        });
}

function updateWebsites(client) {
    	let guilds = client.guilds.cache;
    	let users = 0;
    	guilds.forEach((g) => {
    	    	users += g.memberCount;
    	});
/*    	axios.post('https://top.gg/api/bots/946107355316252763/stats', {
			server_count: guilds.size
    		}, { headers: {
			'Authorization': process.env.TOPGG_TOKEN
		}}).then((res) => {
			log.debug(`Sent bot stats to top.gg: ${guilds.size} servers`);
		}).catch((error) => {
			log.warn(`Failed to send stats to top.gg: ${error}`);
		});
*/
	axios.post('https://discord.bots.gg/api/v1/bots/946107355316252763/stats', {
			guildCount: guilds.size
		}, { headers: {
			'Authorization': process.env.BOTSGG_TOKEN
		}}) .then((res) => {
				log.debug(`Sent bot stats to discord.bots.gg: ${guilds.size} servers`);
		}).catch((error) => {
				log.warn(`Failed to send stats to discord.bots.gg: ${error}`);
		});

	axios.post('https://discordbotlist.com/api/v1/bots/946107355316252763/stats', {
			guilds: guilds.size,
			users: users
		}, { headers: {
			'Authorization': process.env.DBL_TOKEN 
		}}) .then((res) => {
				log.debug(`Sent bot stats to discordbotlist.com: ${guilds.size} servers`);
		}).catch((error) => {
				log.warn(`Failed to send stats to discordbotlist.com: ${error}`);
		});
}

function update(client, dlS, dlF, dlFReasons) {
	updateManager(client, dlS, dlF, dlFReasons);
	updateWebsites(client);
}

module.exports = { update };
