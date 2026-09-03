# Install VideoAI Downloader on Apple Silicon macOS

The `macOS-arm64` build runs natively on M1, M2, M3, and M4 Macs with macOS 13 Ventura or newer. It does not require Rosetta, Homebrew, Python, or separate download tools.

## Install

1. Open `VideoAI-Downloader-2.1.0-macOS-arm64.zip`.
2. Drag **VideoAI Downloader.app** into the **Applications** folder.
3. For the first launch, Control-click the app, choose **Open**, then choose **Open** again.

The supplied development build is not notarized with a paid Apple Developer certificate. If macOS does not offer the **Open** option and you trust the downloaded file, verify its SHA-256 value against `SHA256SUMS-macOS.txt`, then run:

```sh
xattr -dr com.apple.quarantine "/Applications/VideoAI Downloader.app"
open "/Applications/VideoAI Downloader.app"
```

## Browser cookies

Normal public downloads need no extra permission. If you explicitly select Safari or another browser as a cookie source, macOS may require **System Settings → Privacy & Security → Full Disk Access** for VideoAI Downloader. Only enable this when downloading content your signed-in account is allowed to access.

## Download location

Downloads go to the macOS **Downloads** folder by default. Use **Browse…** inside the app to choose another folder.

## Remove the app

Quit VideoAI Downloader, then move it from **Applications** to the Trash. Its settings and queue history remain under your user Library unless you remove them separately.
