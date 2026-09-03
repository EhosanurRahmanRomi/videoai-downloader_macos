# VideoAI Downloader 2.1

VideoAI Downloader is a desktop application for saving individual videos, audio, and playlists through yt-dlp. The same interface and download workflow are available on Windows x64 and Apple Silicon macOS. Download execution stays in Electron's main process and always uses argument arrays instead of shell command strings.

## Highlights

- Native Apple Silicon build for M1, M2, M3, and M4 Macs
- No Homebrew, Python, FFmpeg, yt-dlp, aria2, or Rosetta installation required
- Two independent speed controls for simultaneous videos and concurrent DASH or HLS fragments
- Optional aria2 multi-connection acceleration for direct HTTP and FTP media
- Complete playlist analysis with thumbnails, titles, creators, durations, search, and individual selection
- Per-download archive files, duplicate-job protection, and safe no-overwrite defaults
- Pause and resume support that preserves partial files
- Video quality caps from 360p through 4K, automatic format fallbacks, and audio extraction
- Metadata, thumbnails, subtitles, automatic captions, SponsorBlock, and browser-cookie options
- Persistent queue and history with interrupted jobs restored as paused
- Structured progress, redacted diagnostic logs, component integrity checks, and in-app yt-dlp updates
- Context-isolated, sandboxed renderer with a restrictive Content Security Policy

## Requirements

### macOS

- Apple Silicon Mac, including MacBook Air M4
- macOS 13 Ventura or newer
- Internet connection

The macOS ZIP contains a self-contained `.app`. See [MACOS_INSTALL.md](MACOS_INSTALL.md) for installation and first-launch instructions.

### Windows

- Windows 10 or Windows 11, x64
- Internet connection

Only download media when the copyright owner or applicable law permits it.

## Build the Apple Silicon app

Install Node.js 22 or newer, then run:

```sh
npm ci
npm run dist:mac
```

This command downloads checksum-pinned native ARM64 tools, runs the complete test suite, builds the application, verifies its architecture and embedded component manifest, and writes these files to `release/`:

- `VideoAI-Downloader-2.1.0-macOS-arm64.zip`
- `SHA256SUMS-macOS.txt`

The build can be created on Linux or macOS. Apple Developer signing and notarization require a configured macOS signing environment. A locally built unsigned archive can be opened with macOS's standard Control-click, **Open** flow.

## Build the Windows app

Install Node.js 22 or newer, then run from PowerShell:

```powershell
npm ci
powershell -ExecutionPolicy Bypass -File scripts\fetch-tools.ps1
npm run dist:win
```

The Setup executable, portable executable, and SHA-256 checksums are written to `release\`.

## Test

```sh
npm test
npm run check
```

The tests cover URL and option validation, playlist enumeration and selection, large-list rendering, compact selection ranges, argument generation, high-speed controls, progress parsing, log redaction, queue concurrency, duplicate prevention, pause and resume behavior, archive isolation, interrupted-job recovery, process outcomes, platform-specific tool integrity, and the renderer contract.

The optional integration smoke test uses a local HTTP server and generated media, so it does not download copyrighted content:

```sh
npm run test:integration
```

## Architecture

- `src/main.js`: secure Electron lifecycle, native macOS menu, and IPC boundary
- `src/preload.js`: narrow renderer API
- `src/core/`: validation, argument generation, queue management, process execution, inspection, persistence, and tool integrity
- `src/renderer/`: accessible desktop interface shared by Windows and macOS
- `scripts/fetch-tools-macos.js`: pinned and checksummed Apple Silicon toolchain fetcher
- `scripts/verify-macos-release.js`: packaged app, architecture, permissions, manifest, and archive verifier
- `test/`: deterministic unit and renderer tests

## Reliability notes

Website changes can temporarily affect individual extractors. Use **Settings → Update yt-dlp** before reporting a site-specific failure. Download speed is still limited by the source website, network route, disk speed, and ISP. Increasing connections beyond a site's tolerance can reduce reliability.

Settings, queue history, per-download archives, and the writable yt-dlp runtime copy are stored in the normal per-user application-data directory. Existing completed files remain protected unless **Overwrite existing files** is explicitly enabled.
