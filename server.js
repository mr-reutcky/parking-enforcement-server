require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const AWS = require("aws-sdk");
const app = express();
const port = process.env.PORT || 8080;
const permits = require("./permits.json");

// Replace with your actual frontend domain
const allowedOrigin = "https://mr-reutcky.github.io";

// Apply CORS policy
app.use(cors({
  origin: allowedOrigin
}));

// Middleware: Custom header verification
app.use((req, res, next) => {
  if (req.headers["x-app-client"] !== "lpr-client") {
    return res.status(403).json({ error: "Forbidden: Invalid client" });
  }
  next();
});

app.use(bodyParser.json({ limit: "10mb" }));

AWS.config.update({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const rekognition = new AWS.Rekognition();

const RESERVED_WORDS = [
  "FRIENDLY", "MANITOBA", "BASKETBALL", "FOR", "LIFE", "WHEAT", "KINGS",
  "KING", "WHEATKINGS", "CURLING", "FISH", "FUTURES", "CURE", "CHILDHOOD",
  "CANCER", "MMIWG2S", "FIGHTING", "PROSTATE", "SNOMAN", "RIDE", "SAFE", "SUPPORT",
  "OUR", "TROOPS", "WINNIPEG", "THE", "UNIVERSITY", "OF", "DISCOVER", "ACHIEVE",
  "BELONG", "GREY", "CUP", "CHAMPIONS", "BLUE", "BOMBERS", "GOLDEYES", "SHELTER",
  "WELFARE", "DIGNITY", "HUMANE", "SOCIETY", "FULLED", "BY", "PASSION", "JETS",
  "HONOUR", "PAST", "VETERAN", "SASKCTCHEWAN", "LAND", "OF", "LIVING", "SKIES",
  "RIDER", "NATION", "PRIDE", "LIVES", "HERE", "MEMORIAL", "CROSS", "COLLECTOR"
];

// POST /api/detect-plate
app.post("/api/detect-plate", async (req, res) => {
  const base64Image = req.body.image?.split(",")[1];
  if (!base64Image) {
    return res.status(400).json({ error: "No image provided." });
  }

  const imageBuffer = Buffer.from(base64Image, "base64");

  try {
    const params = { Image: { Bytes: imageBuffer } };
    const data = await rekognition.detectText(params).promise();
    const detections = data.TextDetections || [];

    const PLATE_REGEX_PATTERNS = [
      /^[A-Z]{3} ?[0-9]{3}$/,            // ABC 123 or ABC123
      /^[0-9]{3} ?[A-Z]{3}$/,            // 123 ABC
      /^[A-Z]{2} ?[0-9]{3}[A-Z]?$/,      // CC 123A
      /^[0-9][A-Z]{2}[~\-][0-9]{3}$/,    // 3MO~245 or 3M0-245
      /^[A-Z][0-9][~\-]?[0-9]{4}$/,      // B6~1234 or B6-1234
      /^[A-Z][0-9] ?[0-9]{4}$/,          // D8 5898, G9 1234
      /^[A-Z]{2}[0-9]{3}[A-Z]$/,         // HC123A, MC123R
      /^[0-9]{4} ?[0-9][A-Z]$/,          // 1234 2P, 1234 3U
      /^[A-Z][0-9]{3}[A-Z]{2}$/,         // RL123R, S123AA, RV123S
      /^[0-9]{3}[A-Z]{3}$/,              // 123VCL
      /^[0-9]{4}[A-Z]{2}$/,              // 1234LT
      /^[A-Z]{3}-[0-9]{3}$/,             // ABC-123
      /^[0-9]{5}$/,                      // 12345
      /^[A-Z]{2}-[0-9]{4}$/,             // CC-1234
      /^[A-Z][0-9]{5}$/,                 // M12345, D12345, T1234
      /^[0-9]-[A-Z]{2}[0-9]{3}$/,        // 0-AB123
      /^[A-Z]{2}[0-9]{4}$/,              // FB1498, DC1234
      /^[A-Z]{3}[0-9]$/,                 // VSK13
      /^[A-Z][0-9]{5}$/,                 // J12345, H12345
      /^[0-9]{5}[A-Z]$/,                 // 12345P
      /^[A-Z]{2}[0-9]{4}$/,              // BK1234, WK1234, etc.
      /^[A-Z]{2}[0-9]{6}$/,              // CL123455
      /^[A-Z0-9]{3,8}$/,                 // fallback pattern (broad)
    ];

    const lines = detections
      .filter(d =>
        d.Type === "LINE" &&
        d.DetectedText.length >= 3 &&
        /^[A-Z0-9 ~\-]+$/.test(d.DetectedText)
      )
      .map(d => d.DetectedText.trim())
      .filter(text => !RESERVED_WORDS.includes(text.toUpperCase()));

    let plate = null;

    // Try known plate patterns
    for (const line of lines) {
      const cleaned = line.replace(/\s+/g, " ").toUpperCase();
      if (PLATE_REGEX_PATTERNS.some(regex => regex.test(cleaned))) {
        plate = cleaned;
        break;
      }
    }

    // Fallback: try combining two short adjacent lines
    if (!plate) {
      for (let i = 0; i < lines.length - 1; i++) {
        const combo = `${lines[i]} ${lines[i + 1]}`.replace(/\s+/g, " ").toUpperCase();
        if (PLATE_REGEX_PATTERNS.some(regex => regex.test(combo))) {
          plate = combo;
          break;
        }
      }
    }

    // Last fallback: single block of 5–8 chars (alphanumeric)
    if (!plate) {
      plate = lines.find(line =>
        /^[A-Z0-9]{5,8}$/.test(line.replace(/\s+/g, "")) &&
        !/^[0-9]{4}$/.test(line)
      );
    }

    if (!plate) {
      return res.json({ plate: null, isAuthorized: false, permit: null });
    }

    const permit = permits.find(p => p.plate.toUpperCase() === plate.toUpperCase());

    if (!permit) {
      return res.json({ plate, isAuthorized: false, permit: null });
    }

    const now = new Date();
    const start = new Date(permit.permit_start);
    const end = new Date(permit.permit_end);
    const isAuthorized = now >= start && now <= end;

    res.json({
      plate,
      isAuthorized,
      permit: {
        ...permit
      }
    });
  } catch (err) {
    console.error("Rekognition error:", err);
    res.status(500).json({ error: "Failed to process image." });
  }
});

// POST /api/lookup-plate
app.post("/api/lookup-plate", (req, res) => {
  const inputPlate = req.body.plate;

  if (!inputPlate || typeof inputPlate !== "string") {
    return res.status(400).json({ error: "A valid plate string must be provided." });
  }

  const permit = permits.find(p => p.plate.toUpperCase() === inputPlate.toUpperCase());

  if (!permit) {
    return res.json({ plate: inputPlate, isAuthorized: false, permit: null });
  }

  const now = new Date();
  const start = new Date(permit.permit_start);
  const end = new Date(permit.permit_end);
  const isAuthorized = now >= start && now <= end;

  res.json({
    plate: permit.plate,
    isAuthorized,
    permit: {
      ...permit
    }
  });
});

// GET /api/permits
app.get("/api/permits", (req, res) => {
  res.json(permits);
});

// Root
app.get("/", (req, res) => {
  res.send("License Plate API is running.");
});

// Start server
app.listen(port, () => {
  console.log(`Server running at https://parking-enforcement-server.onrender.com:${port}`);
});
