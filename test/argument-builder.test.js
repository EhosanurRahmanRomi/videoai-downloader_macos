'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDownloadArgs, buildInspectArgs, spawnEnvironment, videoFormatSelector } = require('../src/core/argument-builder');

const settings = {
  retryCount: 10,
  socketTimeout: 30,
  fragmentConcurrency: 12,
  ariaConnections: 8,
  useAria2: true
};

const tools = {
  ready: true,
  ffmpegDirectory: 'C:\\Program Files\\VideoAI\\bin',
  binDirectory: 'C:\\Program Files\\VideoAI\\bin',
  aria2Available: true
};

const baseJob = {
  url: 'https://example.com/watch?v=abc&list=xyz',
  outputDirectory: 'D:\\Media',
  archivePath: 'C:\\Data\\archives\\job.txt',
  mediaKind: 'video',
  quality: '1080',
  videoContainer: 'mp4',
  audioFormat: 'mp3',
  playlistMode: 'playlist',
  playlistItems: '1-10,15',
  overwrite: false,
  embedMetadata: true,
  embedThumbnail: true,
  includeSubtitles: true,
  includeAutoSubtitles: true,
  removeSponsorSegments: false,
  cookiesBrowser: 'none'
};

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

test('builds a high-speed playlist command as an argument array', () => {
  const args = buildDownloadArgs(baseJob, settings, tools);
  assert.equal(valueAfter(args, '--concurrent-fragments'), '12');
  assert.equal(valueAfter(args, '--playlist-items'), '1-10,15');
  assert.equal(valueAfter(args, '--download-archive'), baseJob.archivePath);
  assert.equal(valueAfter(args, '--ffmpeg-location'), tools.ffmpegDirectory);
  assert.equal(valueAfter(args, '--downloader'), 'http,ftp:aria2c');
  assert.match(valueAfter(args, '--downloader-args'), /-x8/u);
  assert.ok(args.includes('--yes-playlist'));
  assert.ok(args.includes('--write-auto-subs'));
  assert.ok(args.includes('--embed-subs'));
  assert.equal(args.at(-2), '--');
  assert.equal(args.at(-1), baseJob.url);
  assert.ok(!args.some((arg) => arg.includes('cmd.exe') || arg.includes('powershell')));
});

test('builds audio extraction and single-video options without video merge flags', () => {
  const args = buildDownloadArgs({
    ...baseJob,
    mediaKind: 'audio',
    audioFormat: 'flac',
    playlistMode: 'single',
    playlistItems: '',
    includeSubtitles: false,
    includeAutoSubtitles: false
  }, settings, { ...tools, aria2Available: false });

  assert.ok(args.includes('--extract-audio'));
  assert.equal(valueAfter(args, '--audio-format'), 'flac');
  assert.ok(args.includes('--no-playlist'));
  assert.ok(!args.includes('--format'));
  assert.ok(!args.includes('--merge-output-format'));
  assert.ok(!args.includes('--downloader'));
});

test('quality selector has compatible fallbacks', () => {
  assert.equal(
    videoFormatSelector('720', 'mp4'),
    'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b[height<=720]/b[ext=mp4]/b'
  );
  assert.equal(videoFormatSelector('best', 'auto'), 'bv*+ba/b');
});

test('inspection command uses the JavaScript runtime and puts the URL after an option terminator', () => {
  const inspectionTools = {
    nodeRuntimePath: '/Applications/VideoAI Downloader.app/Contents/MacOS/VideoAI Downloader'
  };
  const args = buildInspectArgs('https://example.com/--weird', 'firefox', inspectionTools);
  assert.equal(valueAfter(args, '--cookies-from-browser'), 'firefox');
  assert.equal(valueAfter(args, '--js-runtimes'), `node:${inspectionTools.nodeRuntimePath}`);
  assert.ok(args.includes('--flat-playlist'));
  assert.ok(args.includes('--ignore-errors'));
  assert.ok(!args.includes('--playlist-end'));
  assert.deepEqual(args.slice(-2), ['--', 'https://example.com/--weird']);
});

test('exposes the bundled Electron runtime to yt-dlp as a JavaScript engine', () => {
  const macTools = {
    ...tools,
    nodeRuntimePath: '/Applications/VideoAI Downloader.app/Contents/MacOS/VideoAI Downloader'
  };
  const args = buildDownloadArgs(baseJob, settings, macTools);
  assert.equal(valueAfter(args, '--js-runtimes'), `node:${macTools.nodeRuntimePath}`);
  const environment = spawnEnvironment(macTools, { PATH: '/usr/bin' });
  assert.equal(environment.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(environment.PYTHONUTF8, '1');
  assert.match(environment.PATH, /^C:\\Program Files\\VideoAI\\bin/u);
});
