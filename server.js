const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());

/* ======================================================
   CONFIG
====================================================== */

const PORT = process.env.PORT || 5000;
const DOWNLOADS_ROOT = path.join(__dirname, "downloads");

if (!fs.existsSync(DOWNLOADS_ROOT)) {
  fs.mkdirSync(DOWNLOADS_ROOT);
}

/* expose downloaded files */
app.use("/files", express.static(DOWNLOADS_ROOT));

/* helper: run yt-dlp safely in docker */
function runYtDlp(args, callback) {
  exec(`python3 -m yt_dlp ${args}`, callback);
}

/* ======================================================
   YOUTUBE INFO
====================================================== */
app.get("/info", (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "No URL provided" });

  runYtDlp(`-J "${url}"`, (err, stdout, stderr) => {
    if (err) {
      console.error("YT INFO ERROR:", stderr || err.message);
      return res.status(500).json({ error: "Failed to fetch info" });
    }

    let info;
    try {
      info = JSON.parse(stdout);
    } catch (e) {
      console.error("YT JSON PARSE ERROR:", e);
      return res.status(500).json({ error: "Invalid yt-dlp output" });
    }

    const formats = info.formats || [];

    const videoFormats = formats
      .filter(f => f.vcodec && f.vcodec !== "none")
      .map(f => ({
        id: f.format_id,
        ext: f.ext,
        resolution: f.height ? `${f.height}p` : "unknown",
        filesize: f.filesize || null,
      }));

    const audioFormats = formats
      .filter(f => !f.vcodec || f.vcodec === "none")
      .map(f => ({
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
   YOUTUBE DOWNLOAD (MOBILE SAFE)
====================================================== */
app.get("/download", (req, res) => {
  const { url, format } = req.query;
  if (!url || !format) {
    return res.status(400).json({ error: "Missing url or format" });
  }

  const outputTemplate = path.join(
    DOWNLOADS_ROOT,
    `yt_${Date.now()}.%(ext)s`
  );

  runYtDlp(`-f ${format} -o "${outputTemplate}" "${url}"`, (err) => {
    if (err) {
      console.error("YT DOWNLOAD ERROR:", err.message);
      return res.status(500).json({ error: "Download failed" });
    }

    const file = fs
      .readdirSync(DOWNLOADS_ROOT)
      .find(f => f.startsWith("yt_"));

    if (!file) {
      return res.status(500).json({ error: "File not found" });
    }

    res.json({
      downloadUrl: `${req.protocol}://${req.get("host")}/files/${file}`,
    });
  });
});

/* ======================================================
   INSTAGRAM INFO (yt-dlp)
====================================================== */
app.get("/instagram-info", (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "No URL provided" });

  runYtDlp(`-J "${url}"`, (err, stdout, stderr) => {
    if (err) {
      console.error("IG INFO ERROR:", stderr || err.message);
      return res
        .status(500)
        .json({ error: "Instagram blocked or private" });
    }

    let info;
    try {
      info = JSON.parse(stdout);
    } catch (e) {
      return res.status(500).json({ error: "Failed to parse IG info" });
    }

    res.json({
      id: info.id,
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      formats: (info.formats || [])
        .filter(f => f.url)
        .map(f => ({
          url: f.url,
          ext: f.ext,
          resolution: f.height ? `${f.height}p` : null,
        })),
    });
  });
});

/* ======================================================
   HEALTH CHECK
====================================================== */
app.get("/", (_, res) => {
  res.send("🔥 Downloadables backend is running");
});

app.listen(PORT, () =>
  console.log(`🚀 Backend running on port ${PORT}`)
);
