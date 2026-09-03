'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { gunzipSync } = require('node:zlib');

const projectRoot = path.resolve(__dirname, '..');
const binaryDirectory = path.join(projectRoot, 'resources', 'toolchain');
const requestHeaders = {
  accept: 'application/octet-stream',
  'user-agent': 'VideoAI-Downloader-macOS-build'
};

const assets = Object.freeze({
  ytDlp: {
    label: 'yt-dlp 2026.08.19 universal macOS executable',
    url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp_macos',
    sha256: '0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202'
  },
  ffmpeg: {
    label: 'FFmpeg 6.1.1 ARM64 static executable',
    url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64.gz',
    sha256: '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa'
  },
  ffprobe: {
    label: 'FFprobe 6.1.1 ARM64 static executable',
    url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffprobe-darwin-arm64.gz',
    sha256: 'd986a8ec7b030899fe66a8a288ed809a3543338705a3ce178cfb85869c5d80be'
  },
  aria2: {
    label: 'aria2 1.37.0 ARM64 standalone archive',
    url: 'https://github.com/q741451/aria2c-macos-standalone-binary/releases/download/v1.0.0/aria2c-macos-arm64.tar.gz',
    sha256: 'c56e9382b6248a2f82cfded27d77f4641e9d5e017e55a462fe935e85936444bb'
  }
});

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function download(asset) {
  process.stdout.write(`Downloading ${asset.label}...\n`);
  const response = await fetch(asset.url, {
    headers: requestHeaders,
    redirect: 'follow',
    signal: AbortSignal.timeout(300_000)
  });
  if (!response.ok) throw new Error(`Download failed for ${asset.label}: HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualDigest = sha256(bytes);
  if (actualDigest !== asset.sha256) {
    throw new Error(`Checksum mismatch for ${asset.label}. Expected ${asset.sha256}, received ${actualDigest}.`);
  }
  return bytes;
}

function readTarText(bytes) {
  return bytes.toString('utf8').replace(/\0.*$/su, '').trim();
}

function extractTarFile(gzipBytes, wantedBasename) {
  const tar = gunzipSync(gzipBytes);
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = readTarText(header.subarray(0, 100));
    const prefix = readTarText(header.subarray(345, 500));
    const completeName = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(readTarText(header.subarray(124, 136)) || '0', 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('The aria2 archive contains an invalid file size.');
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error('The aria2 archive is truncated.');
    if (path.posix.basename(completeName) === wantedBasename) {
      return Buffer.from(tar.subarray(dataStart, dataEnd));
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  throw new Error(`The aria2 archive does not contain ${wantedBasename}.`);
}

function assertMachO(bytes, label) {
  const magic = bytes.subarray(0, 4).toString('hex');
  const accepted = new Set(['cafebabe', 'cafebabf', 'bebafeca', 'bfbafeca', 'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe']);
  if (!accepted.has(magic)) throw new Error(`${label} is not a Mach-O executable.`);
}

function prepareDirectory() {
  fs.mkdirSync(binaryDirectory, { recursive: true });
  for (const name of fs.readdirSync(binaryDirectory)) {
    if (name === '.gitkeep') continue;
    fs.rmSync(path.join(binaryDirectory, name), { recursive: true, force: true });
  }
}

function writeExecutable(name, bytes) {
  assertMachO(bytes, name);
  const output = path.join(binaryDirectory, name);
  fs.writeFileSync(output, bytes, { mode: 0o755 });
  fs.chmodSync(output, 0o755);
  process.stdout.write(`Prepared ${name} (${(bytes.length / 1_048_576).toFixed(1)} MiB).\n`);
}

(async () => {
  const [ytDlpDownload, ffmpegDownload, ffprobeDownload, aria2Download] = await Promise.all([
    download(assets.ytDlp),
    download(assets.ffmpeg),
    download(assets.ffprobe),
    download(assets.aria2)
  ]);

  const ffmpeg = gunzipSync(ffmpegDownload);
  const ffprobe = gunzipSync(ffprobeDownload);
  const aria2 = extractTarFile(aria2Download, 'aria2c');

  prepareDirectory();
  writeExecutable('yt-dlp', ytDlpDownload);
  writeExecutable('ffmpeg', ffmpeg);
  writeExecutable('ffprobe', ffprobe);
  writeExecutable('aria2c', aria2);

  execFileSync(process.execPath, [path.join(__dirname, 'generate-tool-manifest.js')], {
    cwd: projectRoot,
    env: {
      ...process.env,
      VIDEOAI_TARGET_PLATFORM: 'darwin',
      VIDEOAI_TARGET_ARCH: 'arm64',
      VIDEOAI_YTDLP_VERSION: '2026.08.19',
      VIDEOAI_FFMPEG_VERSION: '6.1.1-static',
      VIDEOAI_ARIA2_VERSION: '1.37.0'
    },
    stdio: 'inherit'
  });
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
