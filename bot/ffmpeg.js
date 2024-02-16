const ffmpeg = require('fluent-ffmpeg');
const fs = require("fs");

const log = require("./log.js");

function compressVideo(dir, videoInputPath, videoOutputPath, targetSize, pass) {
    let min_audio_bitrate = 32000;
    let max_audio_bitrate = 256000;

    return new Promise((res, rej) => {
        ffmpeg.ffprobe(dir + videoInputPath, (err, probeOut) => {
            if (probeOut.format.size > 8 * 1048576) {
                //too big
                log.debug(`Encoding ${dir + videoInputPath} to under 8MB (pass ${pass}), current size ${probeOut.format.size / 1048576}MB`);

                let duration = probeOut.format.duration;
                let audioBitrate = probeOut.streams[1].bit_rate;
                let targetTotalBitrate = (targetSize * 8388608) /* size in bits */ / (1.1 * duration);

                if (10 * audioBitrate > targetTotalBitrate) {
                    audioBitrate = targetTotalBitrate / 10;
                    if (audioBitrate < min_audio_bitrate || audioBitrate > max_audio_bitrate) audioBitrate = (audioBitrate < min_audio_bitrate ? min_audio_bitrate : max_audio_bitrate);
                }
                let videoBitrate = targetTotalBitrate - audioBitrate;

                ffmpeg(dir + videoInputPath, { logger: log })
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
                        fs.unlinkSync(dir + videoInputPath);
                        fs.stat(dir + videoOutputPath, (err, stats) => {
                            log.debug(`Encode done (pass ${pass}), new size ${stats.size / 1048576}MB`);
                            res(dir + videoOutputPath);
                        });
                    })
                    .save(dir + videoOutputPath);
            } else {
                //small enough
                log.debug(`Not encoding ${dir + videoInputPath} (pass ${pass}), already small enough (${probeOut.format.size / 1048576}MB)`); //mebibyte
                fs.renameSync(dir + videoInputPath, dir + videoOutputPath);
                res(dir + videoOutputPath);
            }
        });
    });
}

module.exports = { compressVideo };