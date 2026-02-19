'use strict';

/**
 * Downloads the Linux yt-dlp binary into bin/yt-dlp for Vercel (and other
 * environments where node_modules/youtube-dl-exec/bin is missing).
 * Run before deploy: npm run build
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const BIN_PATH = path.join(BIN_DIR, 'yt-dlp');
const LINUX_ASSET = 'yt-dlp_linux';
const RELEASE_URL = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';

function get(url) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: { 'User-Agent': 'mp3-player-build' }
    };
    https.get(url, opts, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return get(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function downloadBinary(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'mp3-player-build' } }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return downloadBinary(res.headers.location).then(resolve).catch(reject);
      }
      const file = fs.createWriteStream(BIN_PATH, { mode: 0o755 });
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        fs.chmod(BIN_PATH, 0o755, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  if (process.platform === 'win32') {
    console.log('Skipping yt-dlp download on Windows (use local npm start)');
    return;
  }
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }
  console.log('Fetching latest yt-dlp release...');
  const release = await get(RELEASE_URL);
  const asset = release.assets && release.assets.find((a) => a.name === LINUX_ASSET);
  if (!asset || !asset.browser_download_url) {
    throw new Error('yt-dlp_linux asset not found in latest release');
  }
  console.log('Downloading', asset.name, 'to', BIN_PATH);
  await downloadBinary(asset.browser_download_url);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
