require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const AWS = require("aws-sdk");
const app = express();
const port = process.env.PORT || 4000;
const permits = require("./permits.json");

app.use(cors());
app.use(bodyParser.json({ limit: "5mb" }));

AWS.config.update({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const rekognition = new AWS.Rekognition();

app.post("/api/detect-plate", async (req, res) => {
  const base64Image = req.body.image?.split(",")[1];

  if (!base64Image) {
    return res.status(400).json({ error: "No image provided." });
  }

  const imageBuffer = Buffer.from(base64Image, "base64");

  try {
    const params = {
      Image: { Bytes: imageBuffer },
    };

    const rekogData = await rekognition.detectText(params).promise();

    const detectedTexts = rekogData.TextDetections || [];
    const textLine = detectedTexts.find(t => t.Type === "LINE");

    const plate = textLine?.DetectedText?.toUpperCase().trim() || "";

    const isAuthorized = permits.some(p => p.plate.toUpperCase() === plate);

    res.json({ plate, isAuthorized });
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
