'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { hasMachOHeader, hasPeHeader, toolFilenames } = require('../src/core/tool-manager');

const projectRoot = path.resolve(__dirname, '..');
const binaryDirectory = path.join(projectRoot, 'resources', 'toolchain');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

function digest(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

const directoryNames = fs.readdirSync(binaryDirectory);
const targetPlatform = process.env.VIDEOAI_TARGET_PLATFORM
  || (directoryNames.includes('yt-dlp.exe') ? 'win32' : (directoryNames.includes('yt-dlp') ? 'darwin' : process.platform));
const targetArchitecture = process.env.VIDEOAI_TARGET_ARCH || process.arch;
const names = toolFilenames(targetPlatform);

const filenames = directoryNames
  .filter((name) => name !== 'tools-manifest.json' && !name.startsWith('.'))
  .filter((name) => fs.statSync(path.join(binaryDirectory, name)).isFile())
  .sort((a, b) => a.localeCompare(b));

for (const required of [names.ytDlp, names.ffmpeg, names.ffprobe]) {
  if (!filenames.includes(required)) throw new Error(`Required tool is missing: ${required}`);
}

function fileFormat(filePath) {
  if (hasPeHeader(filePath)) return 'pe';
  if (hasMachOHeader(filePath)) return 'mach-o';
  return 'data';
}

const manifest = {
  schemaVersion: 2,
  appVersion: packageJson.version,
  generatedAt: new Date().toISOString(),
  platform: targetPlatform,
  architectures: [targetArchitecture],
  ytDlpVersion: process.env.VIDEOAI_YTDLP_VERSION || '2026.08.19',
  ffmpegVersion: process.env.VIDEOAI_FFMPEG_VERSION || (targetPlatform === 'darwin' ? '6.1.1-static' : 'N-126390-g9fc8c785e2-20260902'),
  aria2Version: filenames.includes(names.aria2) ? (process.env.VIDEOAI_ARIA2_VERSION || '1.37.0') : '',
  files: Object.fromEntries(filenames.map((filename) => {
    const filePath = path.join(binaryDirectory, filename);
    return [filename, {
      sha256: digest(filePath),
      size: fs.statSync(filePath).size,
      required: filename !== names.aria2,
      format: fileFormat(filePath)
    }];
  }))
};

fs.writeFileSync(path.join(binaryDirectory, 'tools-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Wrote manifest for ${filenames.length} toolchain files.`);
