const path = require("path");
const fs = require("fs");
require("dotenv").config();

// Use a writable location; packaged binaries run in a read-only snapshot, so default to cwd/tmp
const tmpRoot = process.env.TMP_DIR || path.resolve(process.cwd(), "tmp");

// Resolve ffmpeg path in a pkg-friendly way.
const exeDir = process.pkg ? path.dirname(process.execPath) : process.cwd();
const ffmpegCandidates = [
  process.env.FFMPEG_PATH,
  path.join(exeDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
  "ffmpeg",
].filter(Boolean);
const resolvedFfmpegPath =
  ffmpegCandidates.find((p) => {
    try {
      return require("fs").existsSync(p);
    } catch {
      return false;
    }
  }) || "ffmpeg";

const speech7Base =
  (process.env.SPEECH7_BASE_URL && process.env.SPEECH7_BASE_URL.trim()) ||
  "https://app.speech7.com";
const speech7JobsPath =
  (process.env.SPEECH7_JOBS_PATH && process.env.SPEECH7_JOBS_PATH.trim()) ||
  "/subtitle/jobs";
const speech7JobsUrl =
  (process.env.SPEECH7_JOBS_URL && process.env.SPEECH7_JOBS_URL.trim()) ||
  new URL(
    speech7JobsPath,
    speech7Base.endsWith("/") ? speech7Base : `${speech7Base}/`,
  ).toString();
const speech7StatusBaseUrl =
  (process.env.SPEECH7_STATUS_BASE_URL &&
    process.env.SPEECH7_STATUS_BASE_URL.trim()) ||
  speech7JobsUrl.replace(/\/$/, "");

module.exports = {
  port: Number(process.env.PORT) || 4000,
  tmpRoot,
  uploadDir: process.env.UPLOAD_DIR || path.join(tmpRoot, "uploads"),
  audioDir: process.env.AUDIO_DIR || path.join(tmpRoot, "audio"),
  ffmpegPath: resolvedFfmpegPath,
  speech7: {
    baseUrl: speech7Base,
    jobsPath: speech7JobsPath,
    jobsUrl: speech7JobsUrl,
    statusBaseUrl: speech7StatusBaseUrl,
    downloadSuffix: process.env.SPEECH7_DOWNLOAD_SUFFIX || "file",
    uploadField: process.env.SPEECH7_UPLOAD_FIELD || "audio",
    apiKey: (process.env.SPEECH7_API_KEY || "").trim(),
    language: process.env.SPEECH7_LANGUAGE || "en",
    authHeader: process.env.SPEECH7_AUTH_HEADER || "x-api-key",
    authPrefix: process.env.SPEECH7_AUTH_PREFIX || "",
    keyQueryParam: process.env.SPEECH7_KEY_QUERY_PARAM || "",
  },
};
