'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ToolManager } = require('../src/core/tool-manager');

const projectRoot = path.resolve(__dirname, '..');
const releaseDirectory = path.join(projectRoot, 'release');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const productName = packageJson.build.productName;
const unpackedApplication = path.join(releaseDirectory, 'mac-arm64', `${productName}.app`);
const archiveName = `VideoAI-Downloader-${packageJson.version}-macOS-arm64.zip`;
const archivePath = path.join(releaseDirectory, archiveName);

function digest(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function cpuName(value) {
  const unsigned = value >>> 0;
  if (unsigned === 0x0100000c) return 'arm64';
  if (unsigned === 0x01000007) return 'x64';
  return `cpu-${unsigned.toString(16)}`;
}

function machOArchitectures(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert.ok(bytes.length >= 8, `${filePath} is too small to be a Mach-O executable.`);
  const magic = bytes.subarray(0, 4).toString('hex');
  if (magic === 'cffaedfe' || magic === 'cefaedfe') return [cpuName(bytes.readUInt32LE(4))];
  if (magic === 'feedfacf' || magic === 'feedface') return [cpuName(bytes.readUInt32BE(4))];

  const fatBigEndian = magic === 'cafebabe' || magic === 'cafebabf';
  const fatLittleEndian = magic === 'bebafeca' || magic === 'bfbafeca';
  assert.ok(fatBigEndian || fatLittleEndian, `${filePath} is not a Mach-O executable.`);
  const read32 = fatBigEndian ? Buffer.prototype.readUInt32BE : Buffer.prototype.readUInt32LE;
  const count = read32.call(bytes, 4);
  const entrySize = magic === 'cafebabf' || magic === 'bfbafeca' ? 32 : 20;
  assert.ok(count > 0 && count <= 16 && 8 + count * entrySize <= bytes.length, `${filePath} has an invalid universal Mach-O header.`);
  return Array.from({ length: count }, (_, index) => cpuName(read32.call(bytes, 8 + index * entrySize)));
}

function assertArm64Executable(filePath) {
  assert.ok(fs.existsSync(filePath), `Missing executable: ${filePath}`);
  assert.ok((fs.statSync(filePath).mode & 0o111) !== 0, `Executable permission is missing: ${filePath}`);
  assert.ok(machOArchitectures(filePath).includes('arm64'), `ARM64 architecture is missing: ${filePath}`);
}

assert.ok(fs.existsSync(unpackedApplication), 'The unpacked macOS application was not produced.');
assert.ok(fs.existsSync(archivePath), `The macOS ZIP archive was not produced: ${archiveName}`);

const contents = path.join(unpackedApplication, 'Contents');
const resources = path.join(contents, 'Resources');
const binaryDirectory = path.join(resources, 'bin');
const infoPlist = path.join(contents, 'Info.plist');
assert.ok(fs.statSync(infoPlist).size > 0, 'The application Info.plist is empty.');
assertArm64Executable(path.join(contents, 'MacOS', productName));
for (const filename of ['yt-dlp', 'ffmpeg', 'ffprobe', 'aria2c']) {
  assertArm64Executable(path.join(binaryDirectory, filename));
}

const temporaryUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'videoai-macos-verify-'));
try {
  const manager = new ToolManager({
    bundledDirectory: binaryDirectory,
    userDataDirectory: temporaryUserData,
    platform: 'darwin',
    architecture: 'arm64',
    nodeRuntimePath: path.join(contents, 'MacOS', productName)
  });
  const status = manager.initialize();
  assert.equal(status.ready, true, status.error);
  assert.equal(status.aria2Available, true);
} finally {
  fs.rmSync(temporaryUserData, { recursive: true, force: true });
}

const archiveEntries = execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
assert.match(archiveEntries, new RegExp(`^${productName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\.app/Contents/MacOS/`, 'mu'));
assert.match(archiveEntries, /\.app\/Contents\/Resources\/bin\/yt-dlp$/mu);

const checksum = digest(archivePath);
const checksumLine = `${checksum}  ${archiveName}`;
fs.writeFileSync(path.join(releaseDirectory, 'SHA256SUMS-macOS.txt'), `${checksumLine}\n`, 'utf8');
console.log(`Verified ARM64 macOS application and toolchain.\n${checksumLine}`);

module.exports = { machOArchitectures };
