'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolManager, compareVersions } = require('../src/core/tool-manager');

function hash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'videoai-tools-'));
  const bundled = path.join(root, 'bundled');
  const userData = path.join(root, 'data');
  fs.mkdirSync(bundled, { recursive: true });
  const contents = {
    'yt-dlp.exe': Buffer.from('MZ clean yt-dlp fixture'),
    'ffmpeg.exe': Buffer.from('MZ clean ffmpeg fixture'),
    'ffprobe.exe': Buffer.from('MZ clean ffprobe fixture'),
    'avcodec.dll': Buffer.from('MZ clean DLL fixture')
  };
  const files = {};
  for (const [name, bytes] of Object.entries(contents)) {
    fs.writeFileSync(path.join(bundled, name), bytes);
    files[name] = { sha256: hash(bytes), size: bytes.length, required: true };
  }
  fs.writeFileSync(path.join(bundled, 'tools-manifest.json'), JSON.stringify({
    schemaVersion: 2, appVersion: 'test', platform: 'win32', architectures: ['x64'],
    ytDlpVersion: 'test', ffmpegVersion: 'test', files
  }));
  return { root, bundled, userData };
}

function machOFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'videoai-mac-tools-'));
  const bundled = path.join(root, 'bundled');
  const userData = path.join(root, 'data');
  fs.mkdirSync(bundled, { recursive: true });
  const arm64MachO = () => {
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32LE(0xfeedfacf, 0);
    bytes.writeUInt32LE(0x0100000c, 4);
    return bytes;
  };
  const files = {};
  for (const name of ['yt-dlp', 'ffmpeg', 'ffprobe', 'aria2c']) {
    const bytes = arm64MachO();
    bytes.write(name, 16, 'utf8');
    fs.writeFileSync(path.join(bundled, name), bytes, { mode: 0o755 });
    files[name] = { sha256: hash(bytes), size: bytes.length, required: name !== 'aria2c', format: 'mach-o' };
  }
  fs.writeFileSync(path.join(bundled, 'tools-manifest.json'), JSON.stringify({
    schemaVersion: 2, appVersion: 'test', platform: 'darwin', architectures: ['arm64'],
    ytDlpVersion: '2026.08.19', ffmpegVersion: '6.1.1', aria2Version: '1.37.0', files
  }));
  return { root, bundled, userData };
}

test('verifies every required toolchain file and seeds a writable yt-dlp copy', (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  const manager = new ToolManager({ bundledDirectory: data.bundled, userDataDirectory: data.userData, platform: 'win32', architecture: 'x64' });
  const status = manager.initialize();
  assert.equal(status.ready, true);
  assert.equal(status.aria2Available, false);
  assert.equal(fs.readFileSync(status.ytDlpPath, 'utf8'), 'MZ clean yt-dlp fixture');
  assert.deepEqual(manager.publicStatus().versions, { ytDlp: 'test', ffmpeg: 'test', aria2: '' });
});

test('refuses to start when a required DLL has a size or hash mismatch', (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  fs.appendFileSync(path.join(data.bundled, 'avcodec.dll'), 'tampered');
  const manager = new ToolManager({ bundledDirectory: data.bundled, userDataDirectory: data.userData, platform: 'win32', architecture: 'x64' });
  const status = manager.initialize();
  assert.equal(status.ready, false);
  assert.match(status.error, /avcodec\.dll/u);
  assert.equal(status.ytDlpPath, '');
});

test('returns a clear reinstall error when the manifest is absent', (t) => {
  const data = fixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  fs.rmSync(path.join(data.bundled, 'tools-manifest.json'));
  const manager = new ToolManager({ bundledDirectory: data.bundled, userDataDirectory: data.userData, platform: 'win32', architecture: 'x64' });
  const status = manager.initialize();
  assert.equal(status.ready, false);
  assert.match(status.error, /manifest/u);
});

test('compares dated yt-dlp versions numerically', () => {
  assert.equal(compareVersions('2026.08.19', '2026.7.31'), 1);
  assert.equal(compareVersions('2026.08.19', '2026.08.19'), 0);
  assert.equal(compareVersions('2025.12.01', '2026.01.01'), -1);
});

test('accepts ARM64 Mach-O tools and uses extensionless macOS executable names', async (t) => {
  const data = machOFixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  const launches = [];
  const manager = new ToolManager({
    bundledDirectory: data.bundled,
    userDataDirectory: data.userData,
    platform: 'darwin',
    architecture: 'arm64',
    nodeRuntimePath: '/Applications/VideoAI Downloader.app/Contents/MacOS/VideoAI Downloader',
    runVersionImpl: async (executable, args, options) => {
      launches.push({ executable, args, options });
      return { ok: true, version: path.basename(executable), error: '' };
    }
  });
  const status = manager.initialize();
  assert.equal(status.ready, true);
  assert.equal(status.aria2Available, true);
  assert.equal(path.basename(status.ytDlpPath), 'yt-dlp');
  const health = await manager.healthCheck();
  assert.equal(health.verified, true);
  assert.deepEqual(launches.map(({ executable }) => path.basename(executable)), ['yt-dlp', 'ffmpeg', 'aria2c']);
  assert.equal(launches[0].options.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(manager.publicStatus().canUpdateYtDlp, true);
});

test('rejects a macOS toolchain built for the wrong architecture', (t) => {
  const data = machOFixture();
  t.after(() => fs.rmSync(data.root, { recursive: true, force: true }));
  const manager = new ToolManager({
    bundledDirectory: data.bundled,
    userDataDirectory: data.userData,
    platform: 'darwin',
    architecture: 'x64'
  });
  const status = manager.initialize();
  assert.equal(status.ready, false);
  assert.match(status.error, /Apple Silicon|x64/u);
});
