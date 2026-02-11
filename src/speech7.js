const fs = require('fs');
const http = require('http');
const https = require('https');
const axios = require('axios');
const FormData = require('form-data');
const { speech7 } = require('./config');
const logger = require('./logger');

const agentOptions = { keepAlive: true, maxSockets: 10 };
const httpAgent = new http.Agent(agentOptions);
const httpsAgent = new https.Agent(agentOptions);

async function requestWithRetry(fn, { retries = 1, delayMs = 500 } = {}) {
  try {
    return await fn();
  } catch (err) {
    const code = err.code || err.errno;
    if (retries > 0 && (code === 'EPIPE' || code === 'ECONNRESET')) {
      await new Promise((r) => setTimeout(r, delayMs));
      return requestWithRetry(fn, { retries: retries - 1, delayMs });
    }
    throw err;
  }
}

function resolveUrl(pathOrUrl, base) {
  if (!pathOrUrl) return null;
  try {
    const u = new URL(pathOrUrl, base);
    return u.toString();
  } catch (err) {
    return pathOrUrl;
  }
}

function buildAuth(apiKey) {
  const headers = {};
  const params = {};
  const key = (apiKey || '').trim();

  if (key) {
    if (speech7.authHeader) {
      headers[speech7.authHeader] = `${speech7.authPrefix || ''}${key}`;
    }
    if (speech7.keyQueryParam) {
      params[speech7.keyQueryParam] = key;
    }
  }

  return { headers, params, key };
}

async function createSubtitleJob(audioPath, originalFilename, apiKeyOverride) {
  const fileStats = fs.statSync(audioPath);
  const form = new FormData();
  form.append(speech7.uploadField, fs.createReadStream(audioPath), {
    filename: originalFilename.replace(/\.[^.]+$/, '.mp3'),
    contentType: 'audio/mpeg',
    knownLength: fileStats.size,
  });
  if (speech7.language) {
    form.append('language', speech7.language);
  }

  const { headers: authHeaders, params: authParams, key } = buildAuth(apiKeyOverride || speech7.apiKey);

  const headers = { ...form.getHeaders(), ...authHeaders };
  const params = { ...authParams };

  logger.info({ url: speech7.jobsUrl, size: fileStats.size }, 'Creating Speech7 job');

  const response = await requestWithRetry(
    () =>
      axios.post(speech7.jobsUrl, form, {
        headers,
        params,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 1000 * 60 * 15, // 15 minutes
        httpAgent,
        httpsAgent,
      }),
    { retries: 2, delayMs: 500 },
  );

  return response.data;
}

async function getSubtitleStatus(token, apiKeyOverride, statusUrlOverride) {
  if (!token) throw new Error('token is required');
  const { headers: authHeaders, params: authParams } = buildAuth(apiKeyOverride || speech7.apiKey);

  const params = { ...authParams };
  const headers = { ...authHeaders };

  const base = speech7.statusBaseUrl.replace(/\/$/, '');
  const statusUrl = resolveUrl(statusUrlOverride || `${base}/${token}`, speech7.statusBaseUrl);

  logger.info({ url: statusUrl, token }, 'Checking Speech7 status');

  try {
    const response = await requestWithRetry(
      () =>
        axios.get(statusUrl, {
          headers,
          params,
          timeout: 1000 * 60 * 2, // 2 minutes
          httpAgent,
          httpsAgent,
        }),
      { retries: 2, delayMs: 500 },
    );
    return response.data;
  } catch (err) {
    throw err;
  }
}

async function downloadSubtitleFile(token, apiKeyOverride, downloadUrlOverride) {
  if (!token) throw new Error('token is required');
  const { headers: authHeaders, params: authParams } = buildAuth(apiKeyOverride || speech7.apiKey);
  const base = speech7.statusBaseUrl.replace(/\/$/, '');
  const downloadUrl = resolveUrl(
    downloadUrlOverride || `${base}/${token}/${speech7.downloadSuffix}`,
    speech7.statusBaseUrl
  );

  logger.info({ url: downloadUrl, token }, 'Downloading Speech7 subtitle file');

  const response = await requestWithRetry(
    () =>
      axios.get(downloadUrl, {
        headers: authHeaders,
        params: authParams,
        responseType: 'stream',
        timeout: 1000 * 60 * 5, // 5 minutes
        httpAgent,
        httpsAgent,
      }),
    { retries: 2, delayMs: 500 },
  );

  return response.data; // stream
}

module.exports = { createSubtitleJob, getSubtitleStatus, downloadSubtitleFile };
