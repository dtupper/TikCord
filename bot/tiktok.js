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
                log.info(`Downloaded successfully to ${ogName}`);

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

module.exports = { VidTypes, getTikTokData, downloadVideo, downloadSlide }