const { Client, GatewayIntentBits } = require('discord.js');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const axios = require('axios');
const fs = require("fs");
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const puppeteer = require('puppeteer');
const log = require("./utils/log.js");
const heartbeat = require("./utils/heartbeat.js");
const sharp = require('sharp');
const jssoup = require('jssoup').default;
const process = require("process");
const https = require('https');
const { exec } = require("child_process");

require('dotenv').config();

const VidTypes = {
    Video: 'Video',
    Slideshow: 'Slideshow',
    Invalid: 'Invalid'
};

let linkRegex = /(?<url>https?:\/\/(www\.)?(?<domain>vm\.tiktok\.com|vt\.tiktok\.com|tiktok\.com\/t\/|tiktok\.com\/@(.*[\/]))(?<path>[^\s]+))/;
const request = async (url, config = {}) => await (await axios.get(url, config));
const getURLContent = (url) => axios({ url, responseType: 'arraybuffer' }).then(res => res.data).catch((e) => { log.info(e); });

let heartbeatInterval;

if (!fs.existsSync("./videos/")) fs.mkdirSync("./videos/");
if (!fs.existsSync("./images/")) fs.mkdirSync("./images/");
if (!fs.existsSync("./logs/")) fs.mkdirSync("./logs/");

process.on('SIGTERM', function () {
    log.info("Caught SIGTERM");
    clearInterval(heartbeatInterval);
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

/*
process.on('unhandledRejection', (reason, p) => {
    log.error('Unhandled Rejection: ', reason, p);
});
*/

let dlS = 0, dlF = 0;
let dlFReasons = {};

client.on('ready', () => {
    log.info(`Logged in as ${client.user.tag}!`);

    if (!(process.env.DISABLE_HEARTBEAT && process.env.DISABLE_HEARTBEAT == "true")) {
        heartbeatInterval = setInterval(() => {
            log.debug(`Heartbeat: ${dlS} successes`);
            heartbeat.update(client, dlS, dlF, dlFReasons);
        }, 30 * 1000);
        heartbeat.update(client, dlS, dlF, dlFReasons);
    } else {
        log.info("Heartbeat logging disabled by process environment.");
    }
});
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ping') {
        await interaction.reply('Pong!');
    } else if (interaction.commandName === 'help') {
        await interaction.reply('Just send a TikTok link and the bot will automatically download and send it in the chat!');
    } else { }
});

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

            getTikTokData(url)
                .then((data) => {
                    let promise;
                    switch (data[0]) {
                        case VidTypes.Video:
                            promise = downloadVideo(url, data[1]);
                            break;
                        case VidTypes.Slideshow:
                            promise = downloadSlide(url, data[1], data[2]);
                            break;
                        case VidTypes.Invalid:
                            promise = new Promise((res, rej) => { rej("NOTVIDEO"); });
                            break;
                        default:
                            promise = new Promise((res, rej) => { rej("BADTYPE"); });
                    }

                    promise
                        .then((resp) => {
                            message.reply({ files: [resp] }).then(() => {
                                log.info(`[${threadID}] Message sent (reply), deleting ${resp}`);
                                fs.unlinkSync(resp);
                                dlS++;
                            }).catch((e) => {
                                if (e.code == 50035) {
                                    message.channel.send({ files: [resp] }).then(() => {
                                        log.info(`[${threadID}] Message sent (channel), deleting ${resp}`);
                                        fs.unlinkSync(resp);
                                        dlS++;
                                    }).catch((e) => {
                                        log.error(`[${threadID}] Error sending message (2): ${e.toString()}, deleting ${resp}`);
                                        fs.unlinkSync(resp);

                                        if (!Object.keys(dlFReasons).includes(e.toString())) dlFReasons[e.toString()] = 0;
                                        dlFReasons[e.toString()]++;
                                        if (!(e.toString() == "NOTFOUND" || e.toString() == "NOTVIDEO" || e.toString() == "Cannot download audios!" || e.toString() == "DiscordAPIError[50013]: Missing Permissions")) dlF++;
                                    });
                                } else {
                                    log.error(`[${threadID}] Error sending message (1): ${e}, deleting ${resp}`);
                                    fs.unlinkSync(resp);

                                    if (!Object.keys(dlFReasons).includes(e.toString())) dlFReasons[e.toString()] = 0;
                                    dlFReasons[e.toString()]++;
                                    if (!(e.toString() == "NOTFOUND" || e.toString() == "NOTVIDEO" || e.toString() == "Cannot download audios!" || e.toString() == "DiscordAPIError[50013]: Missing Permissions")) dlF++;
                                }
                                return;
                            });
                        })
                        .catch((e) => {
                            message.reply(`Could not download video: ${e}`).then(() => { }).catch((e) => {
                                log.debug(`[${threadID}] Count not send video download failure message to channel: ${e.toString()}`);
                            });
                            log.info(`Could not download video: ${e}`);

                            if (!Object.keys(dlFReasons).includes(e.toString())) dlFReasons[e.toString()] = 0;
                            dlFReasons[e.toString()]++;
                            if (!(e.toString() == "NOTFOUND" || e.toString() == "NOTVIDEO" || e.toString() == "Cannot download audios!" || e.toString() == "DiscordAPIError[50013]: Missing Permissions")) dlF++;
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

                if (!Object.keys(dlFReasons).includes(e.toString())) dlFReasons[e.toString()] = 0;
                dlFReasons[e.toString()]++;
                if (!(e.toString() == "NOTFOUND" || e.toString() == "NOTVIDEO" || e.toString() == "Cannot download audios!" || e.toString() == "DiscordAPIError[50013]: Missing Permissions")) dlF++;
            });
    }
});

function randomAZ(n = 5) {
    return Array(n)
        .fill(null)
        .map(() => Math.random() * 100 % 25 + 'A'.charCodeAt(0))
        .map(a => String.fromCharCode(a))
        .join('');
}

function getTikTokData(url) {
    return new Promise((res, rej) => {
        if (url.endsWith(".com/") || url.endsWith("/live")) {
            log.info(`Link is not a valid TikTok video!`);
            res([VidTypes.Invalid]);
        }

        puppeteer.launch({
            headless: (true ? "new" : false),
            devtools: false,
            ignoreHTTPSErrors: true,
            args: [
                '--no-sandbox', "--fast-start", "--disable-extensions", "--disable-gpu",
                //'--proxy-server=socks5://127.0.0.1:8080'
            ]
        }).then((browser) => {
            browser.newPage().then((page) => {
                page.setCacheEnabled(false).then(() => {
                    page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1").then(() => {
                        page.setViewport({ width: 1920, height: 1080 }).then(() => {
                            page.setRequestInterception(true).then(() => {
                                let videoURL, audioURL;
                                page.on('request', request => {
                                    if (request.resourceType() === 'media') {
                                        if (request.url().includes("audio_mpeg")) { audioURL = request.url().replace("&amp;", "&"); }
                                        if (request.url().includes("video_mp4")) { videoURL = request.url().replace("&amp;", "&"); }
                                    }
                                    request.continue();
                                });
                                page.goto(url, { waitUntil: "networkidle0" })
                                    .then(() => {
                                        log.debug("Type: " + (videoURL == undefined ? (audioURL == undefined ? "unknown" : "slideshow") : "video"));
                                        if (videoURL != undefined) {
                                            res([VidTypes.Video, videoURL]);
                                            browser.close();
                                        } else if (audioURL != undefined) {
                                            page.evaluate(() => document.querySelector('*').outerHTML)
                                                .then((pageHTML) => {
                                                    let soup = new jssoup(pageHTML);
                                                    let slides = soup.findAll('div', { class: "swiper-slide" });
                                                    let slideImages = {};
                                                    slides.forEach((slide) => {
                                                        if (slide.contents[0].attrs.src != undefined) {
                                                            slideImages[slide.attrs['data-swiper-slide-index']] = decodeURI(slide.contents[0].attrs.src).replace("&amp;", "&");
                                                        }
                                                    });

                                                    res([VidTypes.Slideshow, slideImages, audioURL]);
                                                    browser.close();
                                                })
                                                .catch((error) => {
                                                    console.log(error);
                                                    rej("error");
                                                    browser.close();
                                                });
                                        } else {
                                            //console.log("AUDIO ONLY");
                                            res([VidTypes.Invalid]);
                                            browser.close();
                                        }
                                    })
                                    .catch((error) => {
                                        log.info(error);
                                        rej("NOTFOUND@1");
                                        browser.close();
                                    });
                            });
                        });
                    });
                });
            });
        });
    });
}

function downloadVideo(ogURL, vidURL) {
    return new Promise((res, rej) => {
        if (vidURL == undefined) {
            log.warn("vidURL is undefined!");
            rej("NOTFOUND");
        } else {
            let id = ogURL.split("?")[0].split("/")[5];
            let randomName = randomAZ();

            let ogName = `./videos/${id}_${randomName}_encode.mp4`;
            let pass1Name = `./videos/${id}_${randomName}_pass1.mp4`;
            let pass2Name = `./videos/${id}_${randomName}.mp4`;

            //console.log(vidURL);
            getURLContent(vidURL).then((content) => {
                fs.writeFileSync(ogName, content);
                log.info(`Downloaded successfully to ${ogName}`);

                compressVideo(ogName, pass1Name, 8, 1)
                    .then((compressedName) => {
                        res(compressedName);
                    })
                    .catch((e) => { log.error(e); rej(e); });
            }).catch((e) => { log.error(e); rej(e); });
        }
    });
}

function downloadSlide(ogURL, imageURLs, audioURL) {
    return new Promise((res, rej) => {
        let id = ogURL.split("?")[0].split("/")[5];
        let randomName = randomAZ();
        let promises = [];

        promises.push(new Promise((res, rej) => {
            let file = fs.createWriteStream(`./images/${id}_${randomName}_0.mp3`);
            https.get(audioURL, function (response) {
                response.pipe(file);
                file.on("finish", () => {
                    file.close();
                    res(`./images/${id}_${randomName}_0.mp3`);
                });
            });
        }));
        Object.keys(imageURLs).forEach((imageURLkey) => {
            promises.push(new Promise((res, rej) => {
                let file = fs.createWriteStream(`./images/${id}_${randomName}_${imageURLkey}.jpg`);
                https.get(imageURLs[imageURLkey], function (response) {
                    response.pipe(file);
                    file.on("finish", () => {
                        file.close(() => {
                            sharp(`./images/${id}_${randomName}_${imageURLkey}.jpg`)
                                .toColourspace('srgb')
                                .toFile(`./images/${id}_${randomName}_${imageURLkey}_c.jpg`)
                                .then(() => {
                                    fs.unlinkSync(`./images/${id}_${randomName}_${imageURLkey}.jpg`);
                                    res(`./images/${id}_${randomName}_${imageURLkey}_c.jpg`);
                                }).catch((e) => { console.log(e); });
                        });
                    });
                });
            }));
        });

        Promise.all(promises).then((results) => {
            let videoName = `videos/${id}_${randomName}.mp4`;
            let pass1Name = `videos/${id}_${randomName}_pass1.mp4`;

            let ffmpegExec = exec(`ffmpeg -hide_banner -loglevel error -r 1/2.5 -start_number 0 -i ${process.cwd()}/images/${id}_${randomName}_%01d_c.jpg -i ${process.cwd()}/images/${id}_${randomName}_0.mp3 -map 0 -map 1 -shortest -c:v libx264 -vf "scale=\'if(gt(a*sar,16/9),640,360*iw*sar/ih)\':\'if(gt(a*sar,16/9),640*ih/iw/sar,360)\',pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1" -r 30 -pix_fmt yuv420p ${process.cwd()}/${videoName}`, (error, stdout, stderr) => {
                if (error || stderr) { console.log(`error: ${error}, ${stderr}`); return; }
            });
            ffmpegExec.stdout.pipe(process.stdout);
            ffmpegExec.on('exit', function () {
                results.forEach((f) => {
                    fs.unlinkSync(f);
                });

                compressVideo(videoName, pass1Name, 8, 1).then((encodedName) => {
                    res(encodedName);
                }).catch((e) => { log.error(e); rej(e); });
            });
        });
    });
}

function compressVideo(videoInputPath, videoOutputPath, targetSize, pass) {
    let min_audio_bitrate = 32000;
    let max_audio_bitrate = 256000;

    return new Promise((res, rej) => {
        ffmpeg.ffprobe(videoInputPath, (err, probeOut) => {
            if (probeOut.format.size > 8 * 1048576) {
                //too big
                log.debug(`Encoding ${videoInputPath} to under 8MB (pass ${pass}), current size ${probeOut.format.size / 1048576}MB`);

                let duration = probeOut.format.duration;
                let audioBitrate = probeOut.streams[1].bit_rate;
                let targetTotalBitrate = (targetSize * 8388608) /* size in bits */ / (1.1 * duration);

                if (10 * audioBitrate > targetTotalBitrate) {
                    audioBitrate = targetTotalBitrate / 10;
                    if (audioBitrate < min_audio_bitrate || audioBitrate > max_audio_bitrate) audioBitrate = (audioBitrate < min_audio_bitrate ? min_audio_bitrate : max_audio_bitrate);
                }
                let videoBitrate = targetTotalBitrate - audioBitrate;

                ffmpeg(videoInputPath, { logger: log })
                    .outputOptions([
                        '-b:v ' + videoBitrate,
                        '-b:a ' + audioBitrate,
                        '-preset ultrafast'
                    ])
                    .on('error', (err, stdout, stderr) => {
                        console.log(stderr);
                        rej();
                    })
                    .on('end', () => {
                        fs.unlinkSync(videoInputPath);
                        fs.stat(videoOutputPath, (err, stats) => {
                            log.debug(`Encode done (pass ${pass}), new size ${stats.size / 1048576}MB`);
                            res(videoOutputPath);
                        });
                    })
                    .save(videoOutputPath);
            } else {
                //small enough
                log.debug(`Not encoding ${videoInputPath} (pass ${pass}), already small enough (${probeOut.format.size / 1048576}MB)`); //mebibyte
                fs.renameSync(videoInputPath, videoOutputPath);
                res(videoOutputPath);
            }
        });
    });
}

log.info("Logging in");
client.login(process.env.TOKEN);
