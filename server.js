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

// Reserved words to ignore in OCR
const RESERVED_WORDS = [
  "FRIENDLY", "MANITOBA", "BASKETBALL", "FOR", "LIFE", "WHEAT", "KINGS", 
  "KING", "WHEATKINGS", "CURLING", "FISH", "FUTURES", "CURE", "CHILDHOOD", 
  "CANCER", "MMIWG2S", "FIGHTING", "PROSTATE", "SNOMAN", "RIDE", "SAFE", "SUPPORT", 
  "OUR", "TROOPS", "WINNIPEG", "THE", "UNIVERSITY", "OF", "DISCOVER", "ACHIEVE", 
  "BELONG", "GREY", "CUP", "CHAMPIONS", "BLUE", "BOMBERS", "GOLDEYES", "SHELTER", 
  "WELFARE", "DIGNITY", "HUMANE", "SOCIETY", "FULLED", "BY", "PASSION", "JETS", 
  "HONOUR", "PAST"
];

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

    console.log("Detected lines:", lines);

    // Pattern: ABC 123
    const singleLineMatch = lines.find(line =>
      /^[A-Z0-9]{3} [A-Z0-9]{3}$/.test(line)
    );

    let plate = null;

    if (singleLineMatch) {
      plate = singleLineMatch;
      console.log("Matched single line format:", plate);
    } else {
      // Pattern: two short lines that we can combine
      for (let i = 0; i < lines.length - 1; i++) {
        if (
          /^[A-Z0-9]{2,4}$/.test(lines[i]) &&
          /^[A-Z0-9]{2,4}$/.test(lines[i + 1])
        ) {
          plate = `${lines[i]} ${lines[i + 1]}`;
          console.log("Matched two-line format:", plate);
          break;
        }
      }

      if (!plate) {
        // Fallback: 5-8 alphanumeric characters, not pure numbers
        const fallback = lines.find(line =>
          /^[A-Z0-9]{5,8}$/.test(line) && !/^[0-9]+$/.test(line)
        );
        if (fallback) {
          plate = fallback;
          console.log("Matched fallback plate:", plate);
        }
      }
    }

    if (!plate) {
      return res.json({ plate: null, isAuthorized: false, owner: null });
    }

    const permit = permits.find(p => p.plate.toUpperCase() === plate.toUpperCase());
    const isAuthorized = permit?.isValid ?? false;
    const owner = permit?.owner ?? null;

    res.json({
      plate,
      isAuthorized,
      owner
    });
  } catch (err) {
    console.error("Rekognition error:", err);
    res.status(500).json({ error: "Failed to process image." });
  }
});

app.get("/api/permits", (req, res) => {
  res.json(permits);
});

app.get("/", (req, res) => {
  res.send("License Plate API is running.");
});

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
