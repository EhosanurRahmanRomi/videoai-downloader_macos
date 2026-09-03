'use strict';

const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const productFilename = context.packager.appInfo.productFilename;
  const application = path.join(context.appOutDir, `${productFilename}.app`);
  const binaryDirectory = path.join(application, 'Contents', 'Resources', 'bin');
  for (const filename of ['yt-dlp', 'ffmpeg', 'ffprobe', 'aria2c']) {
    const filePath = path.join(binaryDirectory, filename);
    if (!fs.existsSync(filePath)) throw new Error(`The packaged macOS component is missing: ${filename}`);
    fs.chmodSync(filePath, 0o755);
  }

  const infoPlistPath = path.join(application, 'Contents', 'Info.plist');
  let infoPlist = fs.readFileSync(infoPlistPath, 'utf8');
  for (const key of [
    'NSAudioCaptureUsageDescription',
    'NSBluetoothAlwaysUsageDescription',
    'NSBluetoothPeripheralUsageDescription',
    'NSCameraUsageDescription',
    'NSMicrophoneUsageDescription'
  ]) {
    infoPlist = infoPlist.replace(new RegExp(`\\s*<key>${key}</key>\\s*<string>[\\s\\S]*?</string>`, 'u'), '');
  }
  fs.writeFileSync(infoPlistPath, infoPlist, 'utf8');
};
