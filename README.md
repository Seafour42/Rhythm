# MP3 Player

A web-based MP3 player with a queue, reorder, play/skip/shuffle, volume control, and YouTube-to-MP3 conversion.

## Features

- **Queue** – Add MP3 files, reorder by drag-and-drop or ▲/▼ buttons
- **Playback** – Play/pause, skip next, skip previous, shuffle
- **Volume** – Slider to adjust volume
- **YouTube to MP3** – Paste a YouTube link, convert, and download (requires server + FFmpeg)

## Quick start (player only)

Double-click `index.html` to open in your browser. You can add local MP3s and use all player controls including the volume slider. **YouTube conversion will not work** when opening the file directly.

## YouTube to MP3 (full setup)

### 1. Install FFmpeg (required for converting to MP3)

YouTube conversion needs **FFmpeg** (and FFprobe, included with FFmpeg) to extract audio.

**Option A – Windows (winget)**  
Open PowerShell or Command Prompt and run:
```bash
winget install ffmpeg
```
Then **close and reopen** your terminal so PATH is updated.

**Option B – Windows (manual)**  
1. Download FFmpeg for Windows from [getffmpeg.org](https://getffmpeg.org/) or [gyan.dev builds](https://www.gyan.dev/ffmpeg/builds/) (e.g. `ffmpeg-release-essentials.7z`).  
2. Extract the archive to a folder, e.g. `C:\ffmpeg`.  
3. Add the **bin** folder to your PATH (e.g. `C:\ffmpeg\bin`):  
   - Press **Win + X** → **System** → **Advanced system settings** → **Environment Variables**.  
   - Under **System variables**, select **Path** → **Edit** → **New** → enter `C:\ffmpeg\bin` (or your path) → OK.  
4. **Close and reopen** any terminal windows.  
5. Check: run `ffmpeg -version` in a new terminal; you should see version info.

**If you don’t add FFmpeg to PATH:** you can point the server at it when starting:
```bash
set FFMPEG_PATH=C:\ffmpeg\bin
npm start
```
Use the folder that contains `ffmpeg.exe` and `ffprobe.exe`.

### 2. Install dependencies and run the server

```bash
cd mp3-player
npm install
npm start
```

### 3. Use the app

1. Open **http://localhost:3000** in your browser.  
2. Paste a YouTube URL in **YouTube to MP3** and click **Convert & Download**.  
3. The MP3 will download and be added to your queue.

## Requirements for YouTube conversion

- **Node.js** (v18+)
- **FFmpeg** (on PATH or via `FFMPEG_PATH`)
- Network access (the server downloads the video and converts it)
