const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    EmbedBuilder,
    REST,
    Routes
} = require('discord.js');

const axios = require('axios');
const fs = require("fs");
const process = require("process");
require('dotenv').config();

const log = require("./log.js");
const tiktok = require("./tiktok.js");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const shardId = client.shard.ids[0];
log.init(shardId);

const commands = [
    new SlashCommandBuilder().setName('help').setDescription('Displays the help message'),
    new SlashCommandBuilder().setName('ping').setDescription('Pings the bot\'s servers')
];
const test_commands = [
    new SlashCommandBuilder().setName("shards").setDescription("get list of shards")
];

const linkRegex = /(?<url>https?:\/\/(www\.)?(?<domain>vm\.tiktok\.com|vt\.tiktok\.com|tiktok\.com\/t\/|tiktok\.com\/@(.*[\/]))(?<path>[^\s]+))/;
const request = async (url, config = {}) => await (await axios.get(url, config));

if (!fs.existsSync("./bot/videos/")) fs.mkdirSync("./bot/videos/");
if (!fs.existsSync("./bot/images/")) fs.mkdirSync("./bot/images/");

process.on('SIGINT', function () {
    log.info("Caught SIGINT");
    process.exit();
});

process.on('SIGTERM', function () {
    log.info("Caught SIGTERM");
    client.destroy();
    process.exit();
});

process.on('uncaughtException', function (err) {
    log.error((new Date).toUTCString() + ' uncaughtException:', err.message);

    try {
        let lines = err.stack.split("\n");
        lines.forEach((l) => {
            log.error(l);
        });
    } catch (e) {
        log.error("Error formatting error");
        log.error(err.stack);
    }
});

client.tiktokstats = {
    dlS: 0,
    dlF: 0,
    dlFReasons: {}
};

client.on('ready', () => {
    log.info(`Logged in as ${client.user.tag}!`);

    const CLIENT_ID = client.user.id;
    const rest = new REST({ version: '9' }).setToken(process.env.TOKEN);
    (async () => {
        try {
            await rest.put(Routes.applicationCommands(CLIENT_ID), {
                body: commands
            });
            await rest.put(Routes.applicationGuildCommands(CLIENT_ID, "929881324167254106"), {
                body: test_commands
            });
        } catch (error) {
            if (error) console.error(error);
        }
    })();
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ping') {
        await interaction.reply('Pong!');
    } else if (interaction.commandName === 'help') {
        await interaction.reply('Just send a TikTok link and the bot will automatically download and send it in the chat!');
    } else if (interaction.commandName === "shards") {
        client.shard.broadcastEval((client) => [client.shard.ids, client.ws.status, client.ws.ping, client.guilds.cache.size, client.tiktokstats])
            .then((results) => {
                const embed = new EmbedBuilder()
                    .setTitle(`👨‍💻 Bot Shards (${interaction.client.shard.count})`)
                    .setColor('#ccd6dd')
                    .setTimestamp();

                results.map((data) => {
                    embed.addFields([
                        {
                            name: `📡 Shard ${data[0]}`,
                            value: `**Status:** ${data[1] == 0 ? "✅" : "❌"}\n**Guilds:** ${data[3]}\n**Downloads:** ${data[4].dlS} / ${data[4].dlF}`,
                            inline: true
                        }
                    ]);
                });

                interaction.reply({ embeds: [embed] });
            });
    } else { }
});

function randomAZ(n = 5) {
    return Array(n)
        .fill(null)
        .map(() => Math.random() * 100 % 25 + 'A'.charCodeAt(0))
        .map(a => String.fromCharCode(a))
        .join('');
}

client.on('messageCreate', (message) => {
    if (message.content.includes("https://") && message.content.includes("tiktok.com")) {
        linkRegex.lastIndex = 0;
        let rgx = linkRegex.exec(message.content);
        if (rgx == null) {
            return;
        }

        let threadID = randomAZ();

        let url = rgx.groups.url;
        log.info(`[${threadID}] Initiating download on ${url}`);

        //start typing, ignore errors
        message.channel.sendTyping().catch((e) => { });

        new Promise((res, rej) => {
            if (rgx.groups.domain.includes("vm.tiktok.com") || rgx.groups.domain.includes("vt.tiktok.com") || rgx.groups.url.includes("/t/")) {
                request(url, {
                    headers: {
                        //"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.81 Safari/537.36"
                    }
                })
                    .then((resp) => {
                        //log.info(`Redirect to ${resp.request.res.responseUrl}`);
                        res(resp.request.res.responseUrl.split("?")[0]);
                    })
                    .catch((error) => {
                        log.error(error);
                        rej(`NOTFOUND`);
                    });
            } else {
                res(rgx.groups.url.split("?")[0]);
            }
        }).then((url) => {
            log.info(`[${threadID}] Downloading ${url}`);

            tiktok.getTikTokData(url)
                .then((data) => {
                    let promise;
                    switch (data[0]) {
                        case tiktok.VidTypes.Video:
                            promise = tiktok.downloadVideo(threadID, url, data[1]);
                            break;
                        case tiktok.VidTypes.Slideshow:
                            promise = tiktok.downloadSlide(threadID, url, data[1], data[2]);
                            break;
                        case tiktok.VidTypes.Invalid:
                            promise = new Promise((res, rej) => { rej(data[1], data[2]); });
                            break;
                        default:
                            promise = new Promise((res, rej) => { rej("BADTYPE"); });
                    }

                    promise
                        .then((resp) => {
                            message.reply({ files: [resp] }).then(() => {
                                log.info(`[${threadID}] Message sent (reply), deleting ${resp}`);
                                fs.unlinkSync(resp);
                                client.tiktokstats.dlS++;
                            }).catch((e) => {
                                if (e.code == 50035) {
                                    message.channel.send({ files: [resp] }).then(() => {
                                        log.info(`[${threadID}] Message sent (channel), deleting ${resp}`);
                                        fs.unlinkSync(resp);
                                        client.tiktokstats.dlS++;
                                    }).catch((e) => {
                                        log.error(`[${threadID}] Error sending message (2): ${e.toString()}, deleting ${resp}`);
                                        fs.unlinkSync(resp);

                                        if (!Object.keys(client.tiktokstats.dlFReasons).includes(e.toString())) client.tiktokstats.dlFReasons[e.toString()] = 0;
                                        client.tiktokstats.dlFReasons[e.toString()]++;
                                        if (!(e.toString() == "NOTFOUND" || e.toString() == "NOTVIDEO" || e.toString() == "Cannot download audios!" || e.toString() == "DiscordAPIError[50013]: Missing Permissions")) client.tiktokstats.dlF++;
                                    });
                                } else {
                                    log.error(`[${threadID}] Error sending message (1): ${e}, deleting ${resp}`);
                                    fs.unlinkSync(resp);

                                    if (!Object.keys(client.tiktokstats.dlFReasons).includes(e.toString())) client.tiktokstats.dlFReasons[e.toString()] = 0;
                                    client.tiktokstats.dlFReasons[e.toString()]++;
                                    if (!(e.toString() == "NOTFOUND" || e.toString() == "NOTVIDEO" || e.toString() == "Cannot download audios!" || e.toString() == "DiscordAPIError[50013]: Missing Permissions")) client.tiktokstats.dlF++;
                                }
                                return;
                            });
                        })
                        .catch((e, send) => {
                            if (send) {
                                message.reply(`Could not download video: ${e}`).then(() => { }).catch((e) => {
                                    log.debug(`[${threadID}] Count not send video download failure message to channel: ${e.toString()}`);
                                });
                            }
                            log.info(`Could not download video: ${e}`);

                            if (!Object.keys(client.tiktokstats.dlFReasons).includes(e.toString())) client.tiktokstats.dlFReasons[e.toString()] = 0;
                            client.tiktokstats.dlFReasons[e.toString()]++;
                            if (!(e.toString() == "NOTFOUND" || e.toString() == "NOTVIDEO" || e.toString() == "Cannot download audios!" || e.toString() == "DiscordAPIError[50013]: Missing Permissions")) client.tiktokstats.dlF++;
                            return;
                        });
                })
                .catch((e) => {
                    console.log(e);
                });
        })
            .catch((e) => {
                message.reply(`Could not download video: ${e}`).then(() => { }).catch((e) => {
                    log.debug(`[${threadID}] Count not send video download failure message to channel: ${e.toString()}`);
                });
                log.info(`Could not download video: ${e}`);

                if (!Object.keys(client.tiktokstats.dlFReasons).includes(e.toString())) client.tiktokstats.dlFReasons[e.toString()] = 0;
                client.tiktokstats.dlFReasons[e.toString()]++;
                if (!(e.toString() == "NOTFOUND" || e.toString() == "NOTVIDEO" || e.toString() == "Cannot download audios!" || e.toString() == "DiscordAPIError[50013]: Missing Permissions")) client.tiktokstats.dlF++;
            });
    }
});

log.info("Logging in");
client.login(process.env.TOKEN);