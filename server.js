require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const AWS = require("aws-sdk");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./swagger");

const app = express();
const port = process.env.PORT || 8080;
const permits = require("./permits.json");

// Replace with your actual frontend domain
const allowedOrigin = ["https://mr-reutcky.github.io", "https://localhost:8080", "http://localhost:3000"];

// Apply CORS policy
app.use(cors({ origin: allowedOrigin }));

// Middleware: Custom header verification
// Custom header verification (skip for Swagger docs)
app.use((req, res, next) => {
  const isSwaggerRoute = req.path.startsWith("/api-docs");
  if (isSwaggerRoute) return next();

  if (req.headers["x-app-client"] !== "lpr-client") {
    return res.status(403).json({ error: "Forbidden: Invalid client" });
  }
  next();
});

app.use(bodyParser.json({ limit: "10mb" }));

// Serve Swagger API Docs
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

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

/**
 * @swagger
 * /api/permits:
 *   get:
 *     summary: Get all mock parking permits
 *     responses:
 *       200:
 *         description: List of permit objects
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   spot:
 *                     type: integer
 *                     example: 1
 *                   plate:
 *                     type: string
 *                     example: LGX 137
 *                   owner:
 *                     type: string
 *                     example: Samuel Reutcky
 *                   make:
 *                     type: string
 *                     example: Hyundai
 *                   model:
 *                     type: string
 *                     example: Elantra
 *                   color:
 *                     type: string
 *                     example: White
 *                   permit_start:
 *                     type: string
 *                     format: date-time
 *                     example: 2025-07-08T00:15
 *                   permit_end:
 *                     type: string
 *                     format: date-time
 *                     example: 2025-07-31T01:45
 */
app.get("/api/permits", (req, res) => {
  res.json(permits);
});

/**
 * @swagger
 * /api/lookup-plate:
 *   post:
 *     summary: Check if a license plate has a valid permit
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               plate:
 *                 type: string
 *    responses:
 *      200:
 *        description: Plate validation result
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                plate:
 *                  type: string
 *                  example: LGX 137
 *                isAuthorized:
 *                  type: boolean
 *                  example: true
 *                permit:
 *                  type: object
 *                  properties:
 *                    spot:
 *                      type: integer
 *                      example: 1
 *                    plate:
 *                      type: string
 *                      example: LGX 137
 *                owner:
 *                  type: string
 *                  example: Samuel Reutcky
 *                make:
 *                  type: string
 *                  example: Hyundai
 *                model:
 *                  type: string
 *                  example: Elantra
 *                color:
 *                  type: string
 *                  example: White
 *                permit_start:
 *                  type: string
 *                  format: date-time
 *                  example: 2025-07-08T00:15
 *                permit_end:
 *                  type: string
 *                  format: date-time
 *                  example: 2025-07-31T01:45
 */
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

  res.json({ plate: permit.plate, isAuthorized, permit });
});

/**
 * @swagger
 * /api/detect-plate:
 *   post:
 *     summary: Detect a license plate from an image and check authorization
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               image:
 *                 type: string
 *                 format: base64
 *     responses:
 *       200:
 *         description: Plate detection result
 */
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

    for (const line of lines) {
      const cleaned = line.replace(/\s+/g, " ").toUpperCase();
      if (PLATE_REGEX_PATTERNS.some(regex => regex.test(cleaned))) {
        plate = cleaned;
        break;
      }
    }

    if (!plate) {
      for (let i = 0; i < lines.length - 1; i++) {
        const combo = `${lines[i]} ${lines[i + 1]}`.replace(/\s+/g, " ").toUpperCase();
        if (PLATE_REGEX_PATTERNS.some(regex => regex.test(combo))) {
          plate = combo;
          break;
        }
      }
    }

    if (!plate) {
      plate = lines.find(line =>
        /^[A-Z0-9]{3,8}$/.test(line.replace(/\s+/g, "")) &&
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

    res.json({ plate, isAuthorized, permit });
  } catch (err) {
    console.error("Rekognition error:", err);
    res.status(500).json({ error: "Failed to process image." });
  }
});

/**
 * @swagger
 * /:
 *   get:
 *     summary: Health check
 *     responses:
 *       200:
 *         description: API is running
 */
app.get("/", (req, res) => {
  res.send("License Plate API is running.");
});

// Start server
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server running at https://parking-enforcement-server.onrender.com:${port}`);
  });
} else {
  module.exports = app;
}
