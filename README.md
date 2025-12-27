# Backend - Media Download Server

## Overview
A Node.js/Express backend server that handles downloading media from various platforms including Instagram and YouTube using tools like `instaloader` and `yt-dlp`.

## Features
- **YouTube Downloads**: Download video information and content using `yt-dlp`
- **Instagram Downloads**: Download posts, reels, and stories using `instaloader`
- **CORS Enabled**: Cross-Origin Resource Sharing enabled for frontend communication
- **File Management**: Organized download structure with automatic directory creation

## Tech Stack
- **Framework**: Express.js 5.1.0
- **Server**: Node.js
- **Dependencies**:
  - `express`: Web application framework
  - `cors`: Cross-Origin Resource Sharing middleware
  - `yt-dlp`: YouTube video downloader (external)
  - `instaloader`: Instagram media downloader (external)

## Installation
1. Install Node.js dependencies:
```bash
npm install
```

2. Install external tools:
   - `yt-dlp`: https://github.com/yt-dlp/yt-dlp
   - `instaloader`: https://instaloader.github.io/

3. Configure Instagram session (if needed):
   - Update `INSTALOADER_SESSION_FILE` path in `server.js`

## Configuration
Edit `server.js` to modify:
- `INSTALOADER_SESSION_FILE`: Path to Instagram session file
- `DOWNLOADS_ROOT`: Root directory for downloaded files
- Server port (default: 3000)

## API Endpoints

### GET `/info`
Get information about a media URL
- **Query**: `url` (YouTube or Instagram URL)
- **Returns**: JSON metadata about the media

### Other Endpoints
Refer to `server.js` for additional endpoints and functionality

## Running the Server
```bash
npm start
# or
node server.js
```

## Project Structure
```
backend/
├── server.js           # Main server file
├── package.json        # Project dependencies
└── downloads/          # Downloaded files (auto-created)
```

## Notes
- Ensure external tools (`yt-dlp`, `instaloader`) are installed and accessible from command line
- Configure Instagram session before using Instagram features
- Downloaded files are stored in the `downloads` directory
