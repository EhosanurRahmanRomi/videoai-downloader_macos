'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const releaseDirectory = path.join(projectRoot, 'release');
const appDirectory = path.join(releaseDirectory, 'mac-arm64');
const appName = `${packageJson.build.productName}.app`;
const archivePath = path.join(releaseDirectory, `VideoAI-Downloader-${packageJson.version}-macOS-arm64.zip`);

if (!fs.existsSync(path.join(appDirectory, appName))) {
  throw new Error('The unpacked Apple Silicon application is missing. Run electron-builder --mac dir --arm64 first.');
}

fs.rmSync(archivePath, { force: true });
let command;
let args;
if (process.platform === 'darwin') {
  command = 'ditto';
  args = ['-c', '-k', '--sequesterRsrc', '--keepParent', appName, archivePath];
} else {
  command = 'zip';
  args = ['-q', '-r', '-y', '-9', archivePath, appName];
}

const result = spawnSync(command, args, { cwd: appDirectory, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}.`);
console.log(`Created symlink-preserving macOS archive: ${path.basename(archivePath)}`);
