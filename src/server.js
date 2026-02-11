const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const config = require("./config");
const { transcodeToMonoMp3 } = require("./ffmpeg");
const {
  createSubtitleJob,
  getSubtitleStatus,
  downloadSubtitleFile,
} = require("./speech7");
const logger = require("./logger");

const { port, uploadDir, audioDir, speech7 } = config;

// ensure dirs exist (must be real filesystem paths, not inside pkg snapshot)
[uploadDir, audioDir].forEach((dir) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    logger.error({ dir, err }, "Failed to create temp directory; set TMP_DIR/UPLOAD_DIR/AUDIO_DIR to a writable path");
    throw err;
  }
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, "_");
      cb(null, `${Date.now()}_${safe}`);
    },
  }),
  limits: {
    fileSize: 1024 * 1024 * 1024 * 20, // 20GB cap
  },
});

const app = express();
app.use(express.json());
app.locals.speech7ApiKeyValid = Boolean(speech7.apiKey);
logger.info(
  {
    header: speech7.authHeader,
    prefix: speech7.authPrefix || "",
    keyQueryParam: speech7.keyQueryParam || null,
    hasEnvKey: app.locals.speech7ApiKeyValid,
  },
  "Speech7 auth configuration ready (per-request override allowed)",
);

const statusBase = (speech7.statusBaseUrl || speech7.jobsUrl || speech7.baseUrl || "").replace(/\/$/, "");

app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

function resolveApiKey(req) {
  // priority: explicit header configured, default x-api-key, form/query/body field apiKey
  const configuredHeader = speech7.authHeader?.toLowerCase();
  const headerKey =
    (configuredHeader && req.headers[configuredHeader]) ||
    req.headers["x-api-key"];
  return (
    (typeof headerKey === "string" && headerKey.trim()) ||
    (req.query?.apiKey && String(req.query.apiKey).trim()) ||
    (req.body?.apiKey && String(req.body.apiKey).trim()) ||
    (speech7.apiKey && speech7.apiKey.trim()) ||
    ""
  );
}

function toAbsolute(pathOrUrl) {
  if (!pathOrUrl) return null;
  const base =
    speech7.statusBaseUrl ||
    speech7.jobsUrl ||
    speech7.baseUrl ||
    "http://localhost:3000";
  try {
    return new URL(pathOrUrl, base).toString();
  } catch (err) {
    return pathOrUrl;
  }
}

app.post("/subtitle", upload.single("video"), async (req, res) => {
  const cleanup = () => {
    if (req.file && fs.existsSync(req.file.path))
      fs.unlink(req.file.path, () => {});
  };

  const effectiveApiKey = resolveApiKey(req);

  if (!req.file) {
    return res.status(400).json({ error: "video file missing (field: video)" });
  }
  if (!effectiveApiKey) {
    return res.status(400).json({
      error:
        "Provide Speech7 API key via x-api-key header, apiKey field, or set SPEECH7_API_KEY env.",
    });
  }

  const { path: videoPath, originalname } = req.file;
  const audioPath = path.join(
    audioDir,
    `${path.parse(req.file.filename).name}.mp3`,
  );

  try {
    await transcodeToMonoMp3(videoPath, audioPath);
  } catch (err) {
    logger.error({ err }, "ffmpeg failed");
    cleanup();
    return res
      .status(500)
      .json({ error: "ffmpeg failed", details: err.stderr || err.message });
  }

  try {
    const apiResponse = await createSubtitleJob(
      audioPath,
      originalname,
      effectiveApiKey,
    );
    // Try to expose a friendly token field regardless of Speech7 key names
    const token =
      apiResponse?.token ||
      apiResponse?.id ||
      apiResponse?.jobId ||
      apiResponse?.requestId ||
      apiResponse?.uploadToken ||
      null;
    const statusUrl = !token
      ? null
      : toAbsolute(
          apiResponse?.statusUrl ||
            `${statusBase}/${token}`,
        );
    const downloadUrl = !token
      ? null
      : toAbsolute(
          apiResponse?.downloadUrl ||
            `${statusBase}/${token}/${speech7.downloadSuffix}`,
        );

    res.json({
      message: "submitted",
      token,
      statusUrl,
      downloadUrl,
      speech7: apiResponse,
    });
  } catch (err) {
    logger.error({ err }, "Speech7 request failed");
    res.status(err.response?.status || 500).json({
      error: "speech7 failed",
      status: err.response?.status,
      details: err.response?.data || err.message,
    });
  } finally {
    cleanup();
    if (fs.existsSync(audioPath)) fs.unlink(audioPath, () => {});
  }
});

app.get("/subtitle/:token", async (req, res) => {
  const token = req.query.token || req.params.token;
  const statusUrlOverride = req.query.statusUrl;
  const effectiveApiKey = resolveApiKey(req);
  if (!token) return res.status(400).json({ error: "token is required" });
  if (!effectiveApiKey) {
    return res.status(400).json({
      error:
        "Provide Speech7 API key via x-api-key header, apiKey field/query, or set SPEECH7_API_KEY env.",
    });
  }

  try {
    const status = await getSubtitleStatus(
      token,
      effectiveApiKey,
      statusUrlOverride,
    );
    res.json({ token, speech7: status });
  } catch (err) {
    logger.error({ err }, "Speech7 status request failed");
    res.status(err.response?.status || 500).json({
      error: "speech7 status failed",
      status: err.response?.status,
      details: err.response?.data || err.message,
    });
  }
});

app.get("/subtitle/:token/file", async (req, res) => {
  const token = req.params.token;
  const downloadUrlOverride = req.query.downloadUrl;
  const statusUrlOverride = req.query.statusUrl;
  const effectiveApiKey = resolveApiKey(req);
  if (!token) return res.status(400).json({ error: "token is required" });
  if (!effectiveApiKey) {
    return res.status(400).json({
      error:
        "Provide Speech7 API key via x-api-key header, apiKey field/query, or set SPEECH7_API_KEY env.",
    });
  }

  try {
    // First check status to avoid 404 when still processing
    const status = await getSubtitleStatus(
      token,
      effectiveApiKey,
      statusUrlOverride,
    );

    const resolvedDownloadUrl = toAbsolute(
      downloadUrlOverride ||
        status?.downloadUrl ||
        status?.file ||
        status?.subtitleUrl ||
        `${statusBase}/${token}/${speech7.downloadSuffix}`,
    );

    if (!status || status?.status !== "completed" || !resolvedDownloadUrl) {
      return res.status(202).json({
        status: status?.status || "processing",
        speech7: status,
      });
    }

    const stream = await downloadSubtitleFile(
      token,
      effectiveApiKey,
      resolvedDownloadUrl,
    );
    res.setHeader("Content-Type", "application/x-subrip; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${token}.srt"`);
    stream.pipe(res);
  } catch (err) {
    logger.error({ err }, "Speech7 download failed");
    res.status(err.response?.status || 500).json({
      error: "speech7 download failed",
      status: err.response?.status,
      details: err.response?.data || err.message,
    });
  }
});

app.listen(port, () => {
  logger.info(`Subtitle service listening on :${port}`);
});

module.exports = app;
