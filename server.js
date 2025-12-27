const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");
const app = express();
app.use(cors());

/* ======================================================
    CONFIG
=========================================================*/

// 🔴 Make sure this path matches your Instaloader session path
const INSTALOADER_SESSION_FILE =
  "C:\\Users\\jeeva\\AppData\\Local\\Instaloader\\session-bad.heck";

// Root downloads folder
const DOWNLOADS_ROOT = path.join(__dirname, "downloads");
if (!fs.existsSync(DOWNLOADS_ROOT)) {
  fs.mkdirSync(DOWNLOADS_ROOT);
}

/* ======================================================
    HELPERS
=========================================================*/
function extractShortcode(igUrl) {
  if (!igUrl) return null;
  // Matches /p/SHORTCODE/ or /reel/SHORTCODE/
  const m = igUrl.match(/instagram\.com\/(?:p|reel)\/([^/?]+)/);
  return m ? m[1] : null;
}

function extractStoryUsername(igUrl) {
  if (!igUrl) return null;
  // Matches /stories/USERNAME/
  const m = igUrl.match(/instagram\.com\/stories\/([^/?]+)/);
  return m ? m[1] : null;
}

/* ======================================================
    YOUTUBE INFO 
=========================================================*/
app.get("/info", (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "No URL provided" });

  exec(`yt-dlp -J "${url}"`, (error, stdout, stderr) => {
    if (error) {
      console.error("YT INFO ERROR:", stderr || error.message);
      return res.status(500).json({ error: "Error fetching info" });
    }

    let info;
    try {
      info = JSON.parse(stdout);
    } catch (err) {
      console.error("YT JSON PARSE ERROR:", err);
      return res.status(500).json({ error: "Failed to parse info" });
    }

    const allFormats = info.formats || [];

    const videoFormats = allFormats
      .filter((f) => f.vcodec && f.vcodec !== "none")
      .map((f) => ({
        id: f.format_id,
        ext: f.ext,
        resolution: f.height ? `${f.height}p` : "Unknown",
        fps: f.fps || null,
        filesize: f.filesize || null,
      }));

    const audioFormats = allFormats
      .filter((f) => !f.vcodec || f.vcodec === "none")
      .map((f) => ({
        id: f.format_id,
        ext: f.ext,
        abr: f.abr || null,
        filesize: f.filesize || null,
      }));

    res.json({
      title: info.title,
      thumbnail: info.thumbnail,
      channel: info.channel || info.uploader,
      duration: info.duration,
      videoFormats,
      audioFormats,
    });
  });
});

/* ======================================================
    YOUTUBE DOWNLOAD
=========================================================*/
app.get("/download", (req, res) => {
  const url = req.query.url;
  const format = req.query.format;

  if (!url) return res.status(400).send("No URL provided");
  if (!format) return res.status(400).send("No format selected");

  exec(
    `yt-dlp -f ${format} -o "yt_download.%(ext)s" "${url}"`,
    (err, stdout, stderr) => {
      if (err) {
        console.error("YT DOWNLOAD ERROR:", stderr || err.message);
        return res.status(500).send("Download failed");
      }

      const file = fs
        .readdirSync(__dirname)
        .find((f) => f.startsWith("yt_download."));
      if (!file) return res.status(500).send("File not found");

      const filePath = path.join(__dirname, file);
      res.download(filePath, file, () => fs.unlinkSync(filePath));
    }
  );
});

/* ======================================================
    INSTAGRAM INFO USING INSTALOADER (metadata JSON)
=========================================================*/
app.get("/instagram-info", (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "No URL provided" });

  const shortcode = extractShortcode(url);
  if (!shortcode) {
    return res.status(400).json({ error: "Invalid Instagram link" });
  }

  const folderName = "ig_info_" + Date.now();
  const folderPath = path.join(DOWNLOADS_ROOT, folderName);
  fs.mkdirSync(folderPath);

  const cmd =
    `instaloader ` +
    `--sessionfile "${INSTALOADER_SESSION_FILE}" ` +
    `--dirname-pattern . ` +
    `--no-pictures -V --no-video-thumbnails ` +
    `--no-compress-json ` +
    `-- -${shortcode}`;

  exec(cmd, { cwd: folderPath }, (err, stdout, stderr) => {
    if (err) {
      console.error("Instaloader info error:", stderr || err.message);
      fs.rmSync(folderPath, { recursive: true, force: true });
      return res
        .status(500)
        .json({ error: "Login required or blocked by Instagram" });
    }

    // JSON metadata
    let jsonFiles = fs
      .readdirSync(folderPath)
      .filter((f) => f.endsWith(".json") && !f.startsWith("iterator"));

    if (jsonFiles.length === 0) {
      fs.rmSync(folderPath, { recursive: true, force: true });
      return res.status(500).json({ error: "No metadata found" });
    }

    const jsonPath = path.join(folderPath, jsonFiles[0]);
    let raw;
    try {
      raw = fs.readFileSync(jsonPath, "utf8");
    } catch (readErr) {
      console.error("Read JSON error:", readErr);
      fs.rmSync(folderPath, { recursive: true, force: true });
      return res.status(500).json({ error: "Failed to read metadata" });
    }

    let jsonData;
    try {
      jsonData = JSON.parse(raw);
    } catch (parseErr) {
      console.error("Parse JSON error:", parseErr);
      fs.rmSync(folderPath, { recursive: true, force: true });
      return res.status(500).json({ error: "Failed to parse metadata" });
    }

    const node = jsonData.node || jsonData;

    // caption
    let caption = "Instagram Post";
    try {
      const edges = node.edge_media_to_caption?.edges;
      if (edges && edges.length > 0 && edges[0].node?.text) {
        caption = edges[0].node.text;
      }
    } catch (_) {}

    const medias = [];

    // Carousel
    if (
      node.edge_sidecar_to_children &&
      Array.isArray(node.edge_sidecar_to_children.edges)
    ) {
      for (const edge of node.edge_sidecar_to_children.edges) {
        const child = edge.node;
        medias.push({
          id: child.shortcode || node.shortcode,
          url: child.is_video ? child.video_url : child.display_url,
          preview: child.display_url,
          type: child.is_video ? "video" : "image",
        });
      }
    } else {
      // Single
      medias.push({
        id: node.shortcode,
        url: node.is_video ? node.video_url : node.display_url,
        preview: node.display_url,
        type: node.is_video ? "video" : "image",
      });
    }

    const thumbnail =
      node.display_url ||
      node.thumbnail_src ||
      (medias[0] ? medias[0].preview : null);

    const result = {
      id: node.shortcode,
      title: caption.substring(0, 80),
      thumbnail,
      count: medias.length,
      medias,
    };

    fs.rmSync(folderPath, { recursive: true, force: true });

    res.json(result);
  });
});

/* ======================================================
    INSTAGRAM REEL/POST DOWNLOAD using Instaloader
=========================================================*/
app.get("/instagram-reel-instaloader", (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("No URL provided");

  const shortcode = extractShortcode(url);
  if (!shortcode) {
    return res.status(400).send("Invalid Instagram reel/post URL");
  }

  const folderName = "ig_reel_" + Date.now();
  const folderPath = path.join(DOWNLOADS_ROOT, folderName);
  fs.mkdirSync(folderPath);

  const cmd = `instaloader --sessionfile "${INSTALOADER_SESSION_FILE}" --dirname-pattern . -- -${shortcode}`;

  exec(cmd, { cwd: folderPath }, (err, stdout, stderr) => {
    if (err) {
      console.error("Instaloader reel/post error:", stderr || err.message);
      fs.rmSync(folderPath, { recursive: true, force: true });
      return res
        .status(500)
        .send("Failed to download reel/post via Instaloader");
    }

    let files = fs.readdirSync(folderPath).filter((f) => !f.startsWith("."));

    // media only
    const mediaFiles = files.filter((f) =>
      /\.(jpe?g|png|mp4|mov|webm)$/i.test(f)
    );

    if (mediaFiles.length === 0) {
      fs.rmSync(folderPath, { recursive: true, force: true });
      return res.status(500).send("No media found");
    }

    // Prefer video if exists (reel)
    const videoFile = mediaFiles.find((f) =>
      /\.(mp4|mov|webm)$/i.test(f)
    );

    if (videoFile) {
      const fullPath = path.join(folderPath, videoFile);
      return res.download(fullPath, videoFile, () => {
        fs.rmSync(folderPath, { recursive: true, force: true });
      });
    }

    // single image
    if (mediaFiles.length === 1) {
      const fullPath = path.join(folderPath, mediaFiles[0]);
      return res.download(fullPath, mediaFiles[0], () => {
        fs.rmSync(folderPath, { recursive: true, force: true });
      });
    }

    // multiple images (carousel) → zip
    const zipFileName = `${folderName}.zip`;
    const zipFilePath = path.join(DOWNLOADS_ROOT, zipFileName);

    exec(
      `tar -a -cf "${zipFileName}" "${folderName}"`,
      { cwd: DOWNLOADS_ROOT },
      (zipErr, zipStdout, zipStderr) => {
        if (zipErr) {
          console.error("Zip error:", zipStderr || zipErr.message);
          fs.rmSync(folderPath, { recursive: true, force: true });
          return res.status(500).send("Failed to create zip");
        }

        res.download(zipFilePath, zipFileName, () => {
          fs.rmSync(folderPath, { recursive: true, force: true });
          fs.rmSync(zipFilePath, { force: true });
        });
      }
    );
  });
});

/* ======================================================
   INSTAGRAM STORY DOWNLOAD using yt-dlp (single story)
=========================================================*/
app.get("/instagram-stories-instaloader", (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send("Provide story URL");
  }

  const outPattern = "ig_story.%(ext)s";
  const cmd = `yt-dlp --cookies-from-browser chrome:default -o "${outPattern}" "${url}"`;

  exec(cmd, { cwd: DOWNLOADS_ROOT }, (err, stdout, stderr) => {
    if (err) {
      console.error("Story yt-dlp error:", stderr || err.message);
      return res
        .status(500)
        .send("Failed to download story via yt-dlp (login or block?)");
    }

    const file = fs
      .readdirSync(DOWNLOADS_ROOT)
      .find((f) => f.startsWith("ig_story."));

    if (!file) {
      return res.status(500).send("Story file not found");
    }

    const filePath = path.join(DOWNLOADS_ROOT, file);
    res.download(filePath, file, () => {
      fs.unlinkSync(filePath);
    });
  });
});

/* ======================================================
    IMAGE PROXY (fix Instagram thumbnail blocking)
=========================================================*/
app.get("/proxy-image", (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).send("No url provided");

  if (!/^https?:\/\//i.test(imageUrl)) {
    return res.status(400).send("Invalid url");
  }

  https
    .get(imageUrl, (resp) => {
      if (resp.statusCode !== 200) {
        res.status(resp.statusCode || 500).send("Failed to load image");
        resp.resume();
        return;
      }

      const contentType = resp.headers["content-type"] || "image/jpeg";
      res.setHeader("Content-Type", contentType);

      resp.pipe(res);
    })
    .on("error", (err) => {
      console.error("Image proxy error:", err.message);
      res.status(500).send("Failed to fetch image");
    });
});


// ===============================================
//  PROXY VIDEO - stream IG video through backend
// ===============================================
app.get("/proxy-video", (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).send("No url provided");
  }

  if (!/^https?:\/\//i.test(videoUrl)) {
    return res.status(400).send("Invalid url");
  }

  const options = new URL(videoUrl);
  // Add some browser-like headers so IG CDN is happy
  options.headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "*/*",
    Referer: "https://www.instagram.com/",
  };

  https
    .get(options, (resp) => {
      const status = resp.statusCode || 500;

      if (status >= 300 && status < 400 && resp.headers.location) {
        // follow redirect if Instagram gives 302
        return res.redirect(resp.headers.location);
      }

      if (status !== 200) {
        res.status(status).send("Failed to load video");
        resp.resume();
        return;
      }

      const contentType = resp.headers["content-type"] || "video/mp4";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Access-Control-Allow-Origin", "*");

      resp.pipe(res);
    })
    .on("error", (err) => {
      console.error("Video proxy error:", err.message);
      res.status(500).send("Failed to fetch video");
    });
});

app.listen(5000, () => console.log("🔥 Backend running on port 5000"));
