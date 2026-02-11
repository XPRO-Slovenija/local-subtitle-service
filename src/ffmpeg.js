const { spawn } = require("child_process");
const fs = require("fs");
const { ffmpegPath } = require("./config");
const logger = require("./logger");

function transcodeToMonoMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      "-i",
      inputPath,
      "-vn", // drop video
      "-ac",
      "1", // mono
      "-ar",
      "44100", // resample to 44.1kHz to be safe
      "-b:a",
      "128k",
      "-map_metadata",
      "-1", // strip metadata
      "-y", // overwrite
      outputPath,
    ];

    logger.info({ args }, "Running ffmpeg");
    const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        return resolve({ outputPath });
      }
      const err = new Error(`ffmpeg exited with code ${code}`);
      err.stderr = stderr;
      reject(err);
    });
  });
}

module.exports = { transcodeToMonoMp3 };
