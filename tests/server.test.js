
const request = require("supertest");
const app = require("../server");
const permits = require("../permits.json");
const AWS = require("aws-sdk");

jest.mock("aws-sdk");

describe("API Tests", () => {
  const validHeaders = { "x-app-client": "lpr-client" };
  const invalidHeaders = { "x-app-client": "invalid-client" };

  beforeEach(() => {
    AWS.config.update.mockReset();
    AWS.Rekognition.mockReset();
  });

  test("GET / should respond with API status", async () => {
    const res = await request(app).get("/").set(validHeaders);
    expect(res.statusCode).toBe(200);
    expect(res.text).toMatch(/License Plate API is running/);
  });

  test("GET /api/permits should return permits", async () => {
    const res = await request(app).get("/api/permits").set(validHeaders);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test("POST /api/lookup-plate - valid and active plate", async () => {
    const res = await request(app)
      .post("/api/lookup-plate")
      .send({ plate: "LGX 137" })
      .set(validHeaders);
    expect(res.body.plate).toBe("LGX 137");
    expect(res.body.isAuthorized).toBe(true);
  });

  test("POST /api/lookup-plate - invalid plate", async () => {
    const res = await request(app)
      .post("/api/lookup-plate")
      .send({ plate: "XYZ9999" })
      .set(validHeaders);
    expect(res.body.isAuthorized).toBe(false);
    expect(res.body.permit).toBe(null);
  });

  test("POST /api/lookup-plate - missing plate", async () => {
    const res = await request(app).post("/api/lookup-plate").send({}).set(validHeaders);
    expect(res.statusCode).toBe(400);
  });

  test("POST /api/lookup-plate - expired permit", async () => {
    const res = await request(app)
      .post("/api/lookup-plate")
      .send({ plate: "LMN 789" })
      .set(validHeaders);
    expect(res.body.isAuthorized).toBe(false);
  });

  test("POST /api/lookup-plate - future permit", async () => {
    const res = await request(app)
      .post("/api/lookup-plate")
      .send({ plate: "VAL 103" })
      .set(validHeaders);
    expect(res.body.isAuthorized).toBe(true);
  });

  test("POST /api/lookup-plate - plate with casing/whitespace", async () => {
    const res = await request(app)
      .post("/api/lookup-plate")
      .send({ plate: "  gMp 929  " })
      .set(validHeaders);
    expect(res.body.plate.trim().toUpperCase()).toBe("GMP 929");
  });

  test("POST /api/detect-plate - no image", async () => {
    const res = await request(app).post("/api/detect-plate").send({}).set(validHeaders);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("No image provided.");
  }); 

  test("POST /api/detect-plate - Rekognition failure", async () => {
    AWS.Rekognition.mockImplementation(() => ({
      detectText: () => ({
        promise: () => Promise.reject(new Error("Rekognition failed"))
      })
    }));

    const fakeImage = Buffer.from("img").toString("base64");
    const res = await request(app)
      .post("/api/detect-plate")
      .send({ image: "data:image/jpeg;base64," + fakeImage })
      .set(validHeaders);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/Failed to process image/);
  });

  test("Reject requests without valid x-app-client", async () => {
    const res = await request(app).get("/api/permits").set(invalidHeaders);
    expect(res.statusCode).toBe(403);
  });
});
