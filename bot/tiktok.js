const puppeteer = require('puppeteer');
const jssoup = require('jssoup').default;
const sharp = require('sharp');
const https = require('https');
const fs = require("fs");
const { exec } = require("child_process");

const ffmpegutils = require("./ffmpeg.js");
const log = require("./log.js");

const VidTypes = {
    Video: 'Video',
    Slideshow: 'Slideshow',
    Invalid: 'Invalid'
};

const axios = require('axios');
const getURLContent = (url) => axios({ url, responseType: 'arraybuffer' }).then(res => res.data).catch((e) => { log.info(e); });

function getTikTokData(url) {
    return new Promise((res, rej) => {
        const urlRe = /https:\/\/www\.tiktok\.com\/(?<user>.*?)\/video\/(?<id>\d*)/.exec(url);
        if (!urlRe) {
            res([VidTypes.Invalid, "link is not a valid TikTok video!", false]);
        }

        axios({
            method: 'get',
            url: `https://api16-normal-c-useast1a.tiktokv.com/aweme/v1/feed/?aweme_id=${urlRe.groups.id}`
        })
        .then(function (response) {
            let result = response.data;
            if (result.aweme_list[0].aweme_id != urlRe.groups.id) {
                res([VidTypes.Invalid, "video was deleted!", true]);
            }

            if (!!result.aweme_list[0].image_post_info) {
                let slideImgs = result.aweme_list[0].image_post_info.images.map((img) => { return img.display_image.url_list[0]; });
                slideImgs.push(slideImgs.slice(-1)[0]);
                res([VidTypes.Slideshow, slideImgs, result.aweme_list[0].video.play_addr.url_list[0]]);
            } else {
                res([VidTypes.Video, result.aweme_list[0].video.play_addr.url_list[0]]);
            }
        })
        .catch(function (error) {
            console.log(error);
        });
    });
}

function downloadVideo(threadID, ogURL, vidURL) {
    return new Promise((res, rej) => {
        if (vidURL == undefined) {
            log.warn("vidURL is undefined!");
            rej("NOTFOUND");
        } else {
            let id = ogURL.split("?")[0].split("/")[5];

            let ogName = `./bot/videos/${id}_${threadID}_encode.mp4`;
            let pass1Name = `./bot/videos/${id}_${threadID}_pass1.mp4`;
            let pass2Name = `./bot/videos/${id}_${threadID}.mp4`;

            //console.log(vidURL);
            getURLContent(vidURL).then((content) => {
                fs.writeFileSync(ogName, content);
                log.info(`[${threadID}] Downloaded successfully to ${ogName}`);

                ffmpegutils.compressVideo(ogName, pass1Name, 8, 1)
                    .then((compressedName) => {
                        res(compressedName);
                    })
                    .catch((e) => { log.error(e); rej(e); });
            }).catch((e) => { log.error(e); rej(e); });
        }
    });
}

function downloadSlide(threadID, ogURL, imageURLs, audioURL) {
    return new Promise((res, rej) => {
        let id = ogURL.split("?")[0].split("/")[5];
        let promises = [];

        promises.push(new Promise((res, rej) => {
            let file = fs.createWriteStream(`./bot/images/${id}_${threadID}_0.mp3`);
            https.get(audioURL, function (response) {
                response.pipe(file);
                file.on("finish", () => {
                    file.close();
                    res(`./bot/images/${id}_${threadID}_0.mp3`);
                });
            });
        }));
        Object.keys(imageURLs).forEach((imageURLkey) => {
            promises.push(new Promise((res, rej) => {
                let file = fs.createWriteStream(`./bot/images/${id}_${threadID}_${imageURLkey}.jpg`);
                https.get(imageURLs[imageURLkey], function (response) {
                    response.pipe(file);
                    file.on("finish", () => {
                        file.close(() => {
                            sharp(`./bot/images/${id}_${threadID}_${imageURLkey}.jpg`)
                                .toColourspace('srgb')
                                .toFile(`./bot/images/${id}_${threadID}_${imageURLkey}_c.jpg`)
                                .then(() => {
                                    fs.unlinkSync(`./bot/images/${id}_${threadID}_${imageURLkey}.jpg`);
                                    res(`./bot/images/${id}_${threadID}_${imageURLkey}_c.jpg`);
                                }).catch((e) => { console.log(e); });
                        });
                    });
                });
            }));
        });

        Promise.all(promises).then((results) => {
            let videoName = `bot/videos/${id}_${threadID}.mp4`;
            let pass1Name = `bot/videos/${id}_${threadID}_pass1.mp4`;

            let ffmpegExec = exec(`ffmpeg -hide_banner -loglevel error -r 1/2.5 -start_number 0 -i ${process.cwd()}/bot/images/${id}_${threadID}_%01d_c.jpg -i ${process.cwd()}/bot/images/${id}_${threadID}_0.mp3 -map 0 -map 1 -shortest -c:v libx264 -vf "scale=\'if(gt(a*sar,16/9),640,360*iw*sar/ih)\':\'if(gt(a*sar,16/9),640*ih/iw/sar,360)\',pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1" -r 30 -pix_fmt yuv420p ${process.cwd()}/${videoName}`, (error, stdout, stderr) => {
                if (error || stderr) { console.log(`error: ${error}, ${stderr}`); return; }
            });
            ffmpegExec.stdout.pipe(process.stdout);
            ffmpegExec.on('exit', function () {
                results.forEach((f) => {
                    fs.unlinkSync(f);
                });

                ffmpegutils.compressVideo(videoName, pass1Name, 8, 1).then((encodedName) => {
                    res(encodedName);
                }).catch((e) => { log.error(e); rej(e); });
            });
        });
    });
}

module.exports = { VidTypes, getTikTokData, downloadVideo, downloadSlide };