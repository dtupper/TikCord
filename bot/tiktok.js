const sharp = require('sharp');
const puppeteer = require('puppeteer');
const jssoup = require('jssoup').default;
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

let ramDisk;
function init(disk) {
    ramDisk = disk;
}

function getTikTokData(threadID, url) {
    return new Promise((res, rej) => {
        log.debug(`[${threadID}] Fetching data from API for ${url}`);

        const urlRe = /https:\/\/www\.tiktok\.com\/(?<user>.*?)\/video\/(?<id>\d*)/.exec(url);
        if (!urlRe) {
            res([VidTypes.Invalid, "link is not a valid TikTok video!", false]);
        }

        log.debug(`[${threadID}] Regex returned ID ${urlRe.groups.id}`);
        log.debug(`[${threadID}] Requesting http://192.168.1.214:9000/api?url=${url}`);
        axios({
            method: 'get',
            url: `http://192.168.1.214:9000/api?url=${url}`
        })
        .then(function (response) {
            let result = response.data;
            log.debug(`[${threadID}] Data length ${JSON.stringify(result).length}`);

            if (Object.keys(result).includes("image_data")) {
                res([VidTypes.Slideshow, [...result.image_data.no_watermark_image_list, result.image_data.no_watermark_image_list[result.image_data.no_watermark_image_list.length - 1]], result.music.play_url.uri]);
            } else if (Object.keys(result).includes("video_data")) {
                res([VidTypes.Video, result.video_data.nwm_video_url_HQ]);
            } else {
                res([VidTypes.Invalid, "unknown video!"]);
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

            let dir = `${ramDisk.name}/videos/`;
            let ogName = `${id}_${threadID}_encode.mp4`;
            let pass1Name = `${id}_${threadID}_pass1.mp4`;
            //let pass2Name = `${ramDisk.name}/videos/${id}_${threadID}.mp4`;

            //console.log(vidURL);
            getURLContent(vidURL).then((content) => {
                fs.writeFileSync(dir + ogName, content);
                log.info(`[${threadID}] Downloaded successfully to ${dir + ogName}`);

                ffmpegutils.compressVideo(dir, ogName, pass1Name, 8, 1)
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
            let file = fs.createWriteStream(`${ramDisk.name}/images/${id}_${threadID}_0.mp3`);
            https.get(audioURL, function (response) {
                response.pipe(file);
                file.on("finish", () => {
                    file.close();
                    res(`${ramDisk.name}/images/${id}_${threadID}_0.mp3`);
                });
            });
        }));
        Object.keys(imageURLs).forEach((imageURLkey) => {
            promises.push(new Promise((res, rej) => {
                let file = fs.createWriteStream(`${ramDisk.name}/images/${id}_${threadID}_${imageURLkey}.jpg`);
                https.get(imageURLs[imageURLkey], function (response) {
                    response.pipe(file);
                    file.on("finish", () => {
                        file.close(() => {
                            sharp(`${ramDisk.name}/images/${id}_${threadID}_${imageURLkey}.jpg`)
                                .toColourspace('srgb')
                                .toFile(`${ramDisk.name}/images/${id}_${threadID}_${imageURLkey}_c.jpg`, (err, info) => {
                                    if (err) { rej(err); return; }

                                    fs.unlinkSync(`${ramDisk.name}/images/${id}_${threadID}_${imageURLkey}.jpg`);
                                    res(`${ramDisk.name}/images/${id}_${threadID}_${imageURLkey}_c.jpg`);
                                });
                        });
                    });
                });
            }));
        });

        Promise.all(promises).then((results) => {
            let dir = `${ramDisk.name}/videos/`;
            let videoName = `${id}_${threadID}.mp4`;
            let pass1Name = `${id}_${threadID}_pass1.mp4`;

            let ffmpegExec = exec(`ffmpeg -hide_banner -loglevel error -r 1/2.5 -start_number 0 -i ${ramDisk.name}/images/${id}_${threadID}_%01d_c.jpg -i ${ramDisk.name}/images/${id}_${threadID}_0.mp3 -map 0 -map 1 -shortest -c:v libx264 -vf "scale=\'if(gt(a*sar,16/9),640,360*iw*sar/ih)\':\'if(gt(a*sar,16/9),640*ih/iw/sar,360)\',pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1" -r 30 -pix_fmt yuv420p ${ramDisk.name}/videos/${videoName}`, (error, stdout, stderr) => {
                if (error || stderr) { console.log(`error: ${error}, ${stderr}`); return; }
            });
            ffmpegExec.stdout.pipe(process.stdout);
            ffmpegExec.on('exit', function () {
                results.forEach((f) => {
                    fs.unlinkSync(f);
                });

                ffmpegutils.compressVideo(dir, videoName, pass1Name, 8, 1).then((encodedName) => {
                    res(encodedName);
                }).catch((e) => { log.error(e); rej(e); });
            });
        });
    });
}

module.exports = { init, VidTypes, getTikTokData, downloadVideo, downloadSlide };