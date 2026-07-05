# Campanion Album Downloader Extension

A Chrome and Brave browser extension that downloads full photo albums from **Campanionapp.com** as a single high-resolution ZIP file.

---

## Features

- **Highest Resolution**: Automatically retrieves full-resolution (`/standard` 1440×960) image files, bypassing lower-res grid thumbnails.
- **In-Page Integration**: Adds a native-looking **Download Album (.ZIP)** button next to the album title.
- **Background Multi-Threaded Queue**: Downloads up to 5 photos concurrently with auto-retry logic for rock-solid reliability.
- **Polished Glassmorphic Progress UI**: Shows active status, percentage, and overall progress with a smooth, premium overlay.
- **Clean Package Naming**: Automatically preserves original filenames and packages the ZIP file named after the album (e.g. `Album Title.zip`).

---

## How to Install the Extension

1. Open your Chrome or Brave Browser.
2. Navigate to `chrome://extensions/`.
3. In the top-right corner, toggle **Developer mode** to **ON**.
4. Click **Load unpacked** in the top-left.
5. Select the **`dist`** folder inside this directory: `/home/pi/campanion-album-downloader/dist`.

---

## How to Use

1. Go to **Campanionapp.com** and log in to your account.
2. Open any photo album.
3. Once the page loads, you will see a purple **📥 Download Album (.ZIP)** button next to the album title.
4. Click the button. A progress modal will show up showing the download status.
5. Once completed, the browser will prompt you to save the generated ZIP file!

---

## Development

If you make modifications to the source code:

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Build the extension:
   ```bash
   pnpm run build
   ```
3. Or run it in watch-mode during development to auto-rebuild on file changes:
   ```bash
   pnpm run dev
   ```
4. Remember to click the **Reload** icon on the extension card in `chrome://extensions/` after rebuilding.
