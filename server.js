require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const AWS = require("aws-sdk");
const app = express();
const port = process.env.PORT || 8080;
const permits = require("./permits.json");

app.use(cors());
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
  "HONOUR", "PAST", "VETERAN"
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

    const lines = detections
      .filter(d =>
        d.Type === "LINE" &&
        d.DetectedText.length >= 3 &&
        /^[A-Z0-9 ]+$/.test(d.DetectedText)
      )
      .map(d => d.DetectedText.trim())
      .filter(text => !RESERVED_WORDS.includes(text.toUpperCase()));

    let plate = null;

    const singleLineMatch = lines.find(line =>
      /^[A-Z0-9]{3} [A-Z0-9]{3}$/.test(line)
    );

    if (singleLineMatch) {
      plate = singleLineMatch;
    } else {
      for (let i = 0; i < lines.length - 1; i++) {
        if (
          /^[A-Z0-9]{2,4}$/.test(lines[i]) &&
          /^[A-Z0-9]{2,4}$/.test(lines[i + 1])
        ) {
          plate = `${lines[i]} ${lines[i + 1]}`;
          break;
        }
      }

      if (!plate) {
        const fallback = lines.find(line =>
          /^[A-Z0-9]{5,8}$/.test(line) && !/^[0-9]+$/.test(line)
        );
        if (fallback) {
          plate = fallback;
        }
      }
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
  console.log(`🚀 Server running at http://localhost:${port}`);
});
