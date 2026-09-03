'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const outputDirectory = path.join(projectRoot, '.devtools');
const outputPath = path.join(outputDirectory, 'yt-dlp');
const expectedSha256 = '1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6';
const url = 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp';

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

(async () => {
  if (fs.existsSync(outputPath) && digest(fs.readFileSync(outputPath)) === expectedSha256) {
    fs.chmodSync(outputPath, 0o755);
    console.log('Using the cached, checksum-verified integration yt-dlp.');
    return;
  }
  const response = await fetch(url, {
    headers: { accept: 'application/octet-stream', 'user-agent': 'VideoAI-Downloader-integration-test' },
    redirect: 'follow',
    signal: AbortSignal.timeout(180_000)
  });
  if (!response.ok) throw new Error(`Could not download the integration yt-dlp: HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha256 = digest(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Integration yt-dlp checksum mismatch. Expected ${expectedSha256}, received ${actualSha256}.`);
  }
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(outputPath, bytes, { mode: 0o755 });
  fs.chmodSync(outputPath, 0o755);
  console.log('Downloaded and verified the integration yt-dlp.');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
