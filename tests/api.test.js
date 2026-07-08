import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../server/index.js";

describe("api auth", () => {
  it("protects question endpoints", async () => {
    const response = await request(app).get("/api/questions");
    expect(response.status).toBe(401);
  });

  it("logs in with the shared password", async () => {
    const response = await request(app).post("/api/login").send({ password: process.env.APP_PASSWORD || "sbr" });
    expect(response.status).toBe(200);
    expect(response.body.authenticated).toBe(true);
    expect(response.headers["set-cookie"].join(" ")).toContain("sbr_session");
  });
});
