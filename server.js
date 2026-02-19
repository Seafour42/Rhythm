const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const youtubedl = require('youtube-dl-exec');
const { args } = require('youtube-dl-exec');
const { YOUTUBE_DL_PATH } = require('youtube-dl-exec').constants;

const app = express();
const PORT = process.env.PORT || 3000;
const OUTPUT_DIR = path.join(__dirname, 'temp');
const downloads = new Map(); // downloadId -> { path, title }

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.static(__dirname));

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function sanitize(filename) {
  return filename.replace(/[<>:"/\\|?*]/g, '_').slice(0, 200);
}

app.post('/convert', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ message: 'Missing or invalid URL' });
  }

  const outputTemplate = path.join(OUTPUT_DIR, `audio-${Date.now()}`);
  const ffmpegPath = process.env.FFMPEG_PATH || process.env.FFMPEG_LOCATION;

  const baseOpts = {
    noCheckCertificates: true,
    noWarnings: true,
    addHeader: ['referer:youtube.com', 'user-agent:chrome'],
  };
  if (ffmpegPath) {
    baseOpts.ffmpegLocation = path.isAbsolute(ffmpegPath) ? ffmpegPath : path.resolve(process.cwd(), ffmpegPath);
  }

  let title = '';

  try {
    const titleOpts = { ...baseOpts, simulate: true, print: 'title' };
    const titleResult = await youtubedl(url, titleOpts).catch(() => null);
    if (titleResult && typeof titleResult === 'string') {
      const raw = titleResult.trim().split('\n')[0].trim();
      if (raw) title = sanitize(raw);
    }
    if (!title) {
      const dumpOpts = { ...baseOpts, dumpSingleJson: true, noDownload: true };
      const jsonResult = await youtubedl(url, dumpOpts).catch(() => null);
      if (jsonResult && typeof jsonResult === 'object' && jsonResult.title) {
        title = sanitize(String(jsonResult.title));
      }
    }
  } catch (_) {
    /* ignore title fetch errors, fall back to generic name */
  }

  try {
    const extractOpts = {
      ...baseOpts,
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: 7,
      format: 'bestaudio[abr<=128]/bestaudio/best',
      output: outputTemplate + '.%(ext)s',
      preferFreeFormats: true,
      postprocessorArgs: 'FFmpeg:-threads 0',
    };

    await youtubedl(url, extractOpts).catch((err) => {
      throw new Error(err.stderr || err.message || 'Conversion failed');
    });

    const fullPath = outputTemplate + '.mp3';
    if (!fs.existsSync(fullPath)) {
      throw new Error('Output file not found');
    }
    const stat = fs.statSync(fullPath);
    if (!title) title = path.basename(fullPath, '.mp3');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${title}.mp3"`);
    res.setHeader('Content-Length', stat.size);

    const stream = fs.createReadStream(fullPath);
    stream.pipe(res);
    stream.on('end', () => {
      fs.unlink(fullPath, () => {});
    });
    stream.on('error', () => {
      try { fs.unlinkSync(fullPath); } catch (_) {}
    });
  } catch (err) {
    const message = err.message || 'Conversion failed';
    res.status(500).json({ message });
  }
});

// Stream conversion progress via Server-Sent Events; client then fetches file from /download/:id
app.post('/convert-stream', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ message: 'Missing or invalid URL' });
  }

  const outputTemplate = path.join(OUTPUT_DIR, `audio-${Date.now()}`);
  const ffmpegPath = process.env.FFMPEG_PATH || process.env.FFMPEG_LOCATION;

  const baseOpts = {
    noCheckCertificates: true,
    noWarnings: true,
    addHeader: ['referer:youtube.com', 'user-agent:chrome'],
  };
  if (ffmpegPath) {
    baseOpts.ffmpegLocation = path.isAbsolute(ffmpegPath) ? ffmpegPath : path.resolve(process.cwd(), ffmpegPath);
  }

  let title = '';
  try {
    const titleOpts = { ...baseOpts, simulate: true, print: 'title' };
    const titleResult = await youtubedl(url, titleOpts).catch(() => null);
    if (titleResult && typeof titleResult === 'string') {
      const raw = titleResult.trim().split('\n')[0].trim();
      if (raw) title = sanitize(raw);
    }
    if (!title) {
      const dumpOpts = { ...baseOpts, dumpSingleJson: true, noDownload: true };
      const jsonResult = await youtubedl(url, dumpOpts).catch(() => null);
      if (jsonResult && typeof jsonResult === 'object' && jsonResult.title) {
        title = sanitize(String(jsonResult.title));
      }
    }
  } catch (_) {
    /* ignore */
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders && res.flushHeaders();
  if (res.socket) res.socket.setNoDelay(true);

  const sendEvent = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  };

  const extractOpts = {
    ...baseOpts,
    extractAudio: true,
    audioFormat: 'mp3',
    audioQuality: 7,
    format: 'bestaudio[abr<=128]/bestaudio/best',
    output: outputTemplate + '.%(ext)s',
    preferFreeFormats: true,
    postprocessorArgs: 'FFmpeg:-threads 0',
    newline: true,
  };

  const cliArgs = [url, ...args(extractOpts)].filter(Boolean);
  const child = spawn(YOUTUBE_DL_PATH, cliArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });

  let lastProgress = 0;
  let lastSent = 0;
  let stderrBuf = '';
  const progressRegex = /(\d+\.?\d*)\s*%/g;
  const startTime = Date.now();

  function trySendProgress(pct) {
    const n = Math.min(100, Math.max(0, parseFloat(pct)));
    if (n > lastProgress && Date.now() - lastSent > 200) {
      lastProgress = n;
      lastSent = Date.now();
      sendEvent({ progress: n });
    }
  }

  function extractLatestPct(str) {
    let pct = -1;
    let m;
    progressRegex.lastIndex = 0;
    while ((m = progressRegex.exec(str)) !== null) pct = parseFloat(m[1]);
    return pct;
  }

  // yt-dlp often does not emit progress when stderr is piped (non-TTY). Use a timer that ramps
  // progress toward 95% over time; on exit we send 100%.
  const progressInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const simulated = Math.min(95, 95 * (1 - Math.exp(-elapsed / 25)));
    if (simulated > lastProgress) trySendProgress(simulated);
  }, 500);

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderrBuf += chunk;
    const parts = stderrBuf.split(/\r?\n|\r/);
    stderrBuf = parts.pop() || '';
    for (const part of parts) {
      const pct = extractLatestPct(part);
      if (pct >= 0) trySendProgress(pct);
    }
    const pct = extractLatestPct(stderrBuf);
    if (pct >= 0) trySendProgress(pct);
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    const pct = extractLatestPct(chunk.toString());
    if (pct >= 0) trySendProgress(pct);
  });

  function stopProgressTimer() {
    clearInterval(progressInterval);
  }

  child.on('error', (err) => {
    stopProgressTimer();
    sendEvent({ error: err.message || 'Conversion failed' });
    res.end();
  });

  child.on('exit', (code) => {
    stopProgressTimer();
    const fullPath = outputTemplate + '.mp3';
    if (code !== 0 || !fs.existsSync(fullPath)) {
      sendEvent({ error: code !== 0 ? 'Conversion failed' : 'Output file not found' });
      res.end();
      return;
    }
    if (!title) title = path.basename(fullPath, '.mp3');
    const downloadId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    downloads.set(downloadId, { path: fullPath, title });
    sendEvent({ progress: 100 });
    sendEvent({ done: true, downloadId, title });
    res.end();
  });
});

app.get('/download/:id', (req, res) => {
  const entry = downloads.get(req.params.id);
  if (!entry) {
    return res.status(404).json({ message: 'Download not found or expired' });
  }
  downloads.delete(req.params.id);
  const { path: filePath, title } = entry;
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'File not found' });
  }
  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Disposition', `attachment; filename="${title}.mp3"`);
  res.setHeader('Content-Length', stat.size);
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  stream.on('end', () => {
    fs.unlink(filePath, () => {});
  });
  stream.on('error', () => {
    try { fs.unlinkSync(filePath); } catch (_) {}
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`MP3 Player server running at http://localhost:${PORT}`);
  console.log('Open this URL in your browser to use the player and YouTube converter.');
  if (!process.env.FFMPEG_PATH && !process.env.FFMPEG_LOCATION) {
    console.log('');
    console.log('If YouTube conversion fails with "ffmpeg not found", install FFmpeg and either:');
    console.log('  - Add its bin folder to your system PATH, or');
    console.log('  - Set FFMPEG_PATH to the folder containing ffmpeg.exe (e.g. set FFMPEG_PATH=C:\\ffmpeg\\bin)');
  }
});
