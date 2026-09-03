'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { JsonStore } = require('./json-store');

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function hasPeHeader(filePath) {
  try {
    const handle = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(2);
    fs.readSync(handle, header, 0, 2, 0);
    fs.closeSync(handle);
    return header.toString('ascii') === 'MZ';
  } catch {
    return false;
  }
}

const MACH_O_MAGICS = new Set([
  'cafebabe', // Universal binary, big endian
  'cafebabf', // Universal 64-bit binary, big endian
  'bebafeca', // Universal binary, little endian
  'bfbafeca', // Universal 64-bit binary, little endian
  'feedface',
  'feedfacf',
  'cefaedfe',
  'cffaedfe'
]);

function hasMachOHeader(filePath) {
  try {
    const handle = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(4);
    fs.readSync(handle, header, 0, header.length, 0);
    fs.closeSync(handle);
    return MACH_O_MAGICS.has(header.toString('hex'));
  } catch {
    return false;
  }
}

function isNativeExecutable(filePath, platform) {
  if (platform === 'win32') return hasPeHeader(filePath);
  if (platform === 'darwin') return hasMachOHeader(filePath);
  try {
    fs.accessSync(filePath, fs.constants.R_OK | fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function toolFilenames(platform) {
  const extension = platform === 'win32' ? '.exe' : '';
  return Object.freeze({
    ytDlp: `yt-dlp${extension}`,
    ffmpeg: `ffmpeg${extension}`,
    ffprobe: `ffprobe${extension}`,
    aria2: `aria2c${extension}`
  });
}

function compareVersions(left, right) {
  const leftParts = String(left || '').match(/\d+/gu)?.map(Number) || [];
  const rightParts = String(right || '').match(/\d+/gu)?.map(Number) || [];
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

function runVersion(executable, args, options = {}) {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    let timedOut = false;
    const { timeoutMs = 12_000, ...spawnOptions } = options;
    let child;
    try {
      child = spawn(executable, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...spawnOptions
      });
    } catch (error) {
      resolve({ ok: false, version: '', error: error.message });
      return;
    }
    const timer = setTimeout(() => {
      if (!settled) {
        timedOut = true;
        child.kill();
      }
    }, timeoutMs);

    const collect = (chunk) => {
      if (output.length < 16_384) output += chunk.toString('utf8');
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, version: '', error: error.message });
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        version: output.trim().split(/\r?\n/u)[0] || '',
        error: timedOut ? `Timed out after ${Math.round(timeoutMs / 1000)} seconds` : (code === 0 ? '' : output.trim() || `Exited with code ${code}`)
      });
    });
  });
}

class ToolManager {
  constructor({
    bundledDirectory,
    userDataDirectory,
    platform = process.platform,
    architecture = process.arch,
    nodeRuntimePath = process.execPath,
    runVersionImpl = runVersion
  }) {
    this.bundledDirectory = bundledDirectory;
    this.userDataDirectory = userDataDirectory;
    this.platform = platform;
    this.architecture = architecture;
    this.nodeRuntimePath = nodeRuntimePath;
    this.runVersionImpl = runVersionImpl;
    this.filenames = toolFilenames(platform);
    this.runtimeDirectory = path.join(userDataDirectory, 'runtime');
    this.stateStore = new JsonStore(path.join(this.runtimeDirectory, 'tool-state.json'));
    this.manifest = null;
    this.toolPaths = null;
  }

  loadManifest() {
    const manifestPath = path.join(this.bundledDirectory, 'tools-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest || !manifest.files || typeof manifest.files !== 'object') {
      throw new Error('The bundled tool manifest is invalid. Reinstall VideoAI Downloader.');
    }
    if (manifest.platform && manifest.platform !== this.platform) {
      throw new Error(`The bundled components target ${manifest.platform}, not ${this.platform}. Reinstall the correct VideoAI Downloader build.`);
    }
    const architectures = Array.isArray(manifest.architectures)
      ? manifest.architectures
      : (manifest.architecture ? [manifest.architecture] : []);
    if (architectures.length && !architectures.includes(this.architecture)) {
      throw new Error(`The bundled components do not support ${this.architecture}. Install the Apple Silicon build on an M-series Mac.`);
    }
    return manifest;
  }

  verifyBundledFile(filename) {
    const expected = this.manifest.files[filename];
    const filePath = path.join(this.bundledDirectory, filename);
    if (!expected || path.basename(filename) !== filename || !fs.existsSync(filePath)) return false;
    const expectedFormat = expected.format || (this.platform === 'win32' ? 'pe' : 'native');
    const isNamedTool = Object.values(this.filenames).includes(filename);
    if ((isNamedTool || expectedFormat !== 'data') && !isNativeExecutable(filePath, this.platform)) return false;
    if (Number(expected.size) !== fs.statSync(filePath).size) return false;
    return sha256(filePath) === expected.sha256;
  }

  initialize() {
    fs.mkdirSync(this.runtimeDirectory, { recursive: true });
    try {
      this.manifest = this.loadManifest();
    } catch (error) {
      this.toolPaths = {
        ready: false,
        error: error.message,
        ytDlpPath: '',
        ffmpegDirectory: '',
        aria2Available: false,
        binDirectory: this.bundledDirectory
      };
      return this.toolPaths;
    }

    const required = Object.entries(this.manifest.files)
      .filter(([, metadata]) => metadata.required !== false)
      .map(([filename]) => filename);
    const invalid = required.filter((filename) => !this.verifyBundledFile(filename));
    const aria2Available = this.verifyBundledFile(this.filenames.aria2);
    if (invalid.length) {
      this.toolPaths = {
        ready: false,
        error: `Missing or damaged component: ${invalid.join(', ')}. Reinstall VideoAI Downloader.`,
        ytDlpPath: '',
        ffmpegDirectory: '',
        aria2Available,
        binDirectory: this.bundledDirectory
      };
      return this.toolPaths;
    }

    const bundledYtDlp = path.join(this.bundledDirectory, this.filenames.ytDlp);
    const activeYtDlp = path.join(this.runtimeDirectory, this.filenames.ytDlp);
    const state = this.stateStore.read({});
    const activeValid = fs.existsSync(activeYtDlp) && isNativeExecutable(activeYtDlp, this.platform);
    const bundledIsNewer = compareVersions(this.manifest.ytDlpVersion, state.ytDlpVersion) > 0;
    if (!activeValid || bundledIsNewer) {
      fs.copyFileSync(bundledYtDlp, activeYtDlp);
      fs.chmodSync(activeYtDlp, 0o755);
      this.stateStore.write({
        seededFromAppVersion: this.manifest.appVersion,
        ytDlpVersion: this.manifest.ytDlpVersion,
        seededAt: new Date().toISOString()
      });
    } else if (!state.seededFromAppVersion) {
      this.stateStore.write({ ...state, seededFromAppVersion: this.manifest.appVersion });
    }

    this.toolPaths = {
      ready: true,
      error: '',
      ytDlpPath: activeYtDlp,
      ffmpegDirectory: this.bundledDirectory,
      aria2Available,
      binDirectory: this.bundledDirectory,
      filenames: this.filenames,
      nodeRuntimePath: this.nodeRuntimePath,
      versions: {
        ytDlp: this.manifest.ytDlpVersion || '',
        ffmpeg: this.manifest.ffmpegVersion || '',
        aria2: this.manifest.aria2Version || ''
      }
    };
    return this.toolPaths;
  }

  getTools() {
    return this.toolPaths || this.initialize();
  }

  publicStatus() {
    const tools = this.getTools();
    return {
      ready: tools.ready,
      error: tools.error,
      aria2Available: tools.aria2Available,
      canUpdateYtDlp: ['darwin', 'win32'].includes(this.platform),
      versions: tools.versions || {}
    };
  }

  async healthCheck() {
    const tools = this.getTools();
    if (!tools.ready) return this.publicStatus();

    const environment = {
      ...process.env,
      PATH: `${tools.binDirectory}${path.delimiter}${process.env.PATH || ''}`,
      ...(tools.nodeRuntimePath ? { ELECTRON_RUN_AS_NODE: '1' } : {})
    };
    const [ytDlp, ffmpeg, aria2] = await Promise.all([
      this.runVersionImpl(tools.ytDlpPath, ['--version'], { env: environment }),
      this.runVersionImpl(path.join(tools.ffmpegDirectory, tools.filenames.ffmpeg), ['-version'], { env: environment }),
      tools.aria2Available
        ? this.runVersionImpl(path.join(tools.binDirectory, tools.filenames.aria2), ['--version'], { env: environment })
        : Promise.resolve({ ok: false, version: '', error: 'Not bundled' })
    ]);

    return {
      ready: ytDlp.ok && ffmpeg.ok,
      error: ytDlp.ok && ffmpeg.ok ? '' : 'One or more download components failed their launch check.',
      aria2Available: aria2.ok,
      versions: {
        ytDlp: ytDlp.version,
        ffmpeg: ffmpeg.version,
        aria2: aria2.version
      },
      details: { ytDlp, ffmpeg, aria2 },
      verified: ytDlp.ok && ffmpeg.ok
    };
  }

  async updateYtDlp() {
    const tools = this.getTools();
    if (!tools.ready) throw new Error(tools.error || 'Download components are unavailable.');
    if (!['darwin', 'win32'].includes(this.platform)) {
      throw new Error('yt-dlp self-update is unavailable on this platform.');
    }

    const backup = `${tools.ytDlpPath}.backup`;
    fs.copyFileSync(tools.ytDlpPath, backup);
    const result = await this.runVersionImpl(tools.ytDlpPath, ['--update-to', 'stable'], {
      env: {
        ...process.env,
        PATH: `${tools.binDirectory}${path.delimiter}${process.env.PATH || ''}`,
        ...(tools.nodeRuntimePath ? { ELECTRON_RUN_AS_NODE: '1' } : {})
      },
      timeoutMs: 120_000
    });

    if (!result.ok || !isNativeExecutable(tools.ytDlpPath, this.platform)) {
      fs.copyFileSync(backup, tools.ytDlpPath);
      fs.rmSync(backup, { force: true });
      throw new Error(result.error || 'The update could not be verified; the previous version was restored.');
    }
    const version = await this.runVersionImpl(tools.ytDlpPath, ['--version'], {
      env: {
        ...process.env,
        ...(tools.nodeRuntimePath ? { ELECTRON_RUN_AS_NODE: '1' } : {})
      }
    });
    if (!version.ok) {
      fs.copyFileSync(backup, tools.ytDlpPath);
      fs.rmSync(backup, { force: true });
      throw new Error('The updated yt-dlp failed its launch check; the previous version was restored.');
    }
    fs.rmSync(backup, { force: true });
    tools.versions.ytDlp = version.version;
    this.stateStore.write({
      ...this.stateStore.read({}),
      ytDlpVersion: version.version,
      updatedAt: new Date().toISOString()
    });
    return { ok: true, message: result.version || 'yt-dlp was updated.', version: version.version };
  }
}

module.exports = {
  ToolManager,
  sha256,
  hasPeHeader,
  hasMachOHeader,
  isNativeExecutable,
  toolFilenames,
  runVersion,
  compareVersions
};
