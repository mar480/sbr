import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import express from "express";
import multer from "multer";
import { markAnswer } from "./answer.js";
import { createAttempt, getQuestion, getStats, listQuestions, openDatabase, updateQuestion, upsertImportedQuestions } from "./db.js";
import { parseSpreadsheet } from "./importer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const db = openDatabase();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const APP_PASSWORD = process.env.APP_PASSWORD || "sbr";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const SESSION_COOKIE = "sbr_session";
const LEARNER_COOKIE = "sbr_learner";

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser(SESSION_SECRET));

function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

function ensureLearner(req, res) {
  let learnerId = req.signedCookies[LEARNER_COOKIE];
  if (!learnerId) {
    learnerId = `learner_${makeToken().slice(0, 18)}`;
    res.cookie(LEARNER_COOKIE, learnerId, cookieOptions(365));
  }
  return learnerId;
}

function cookieOptions(days = 14) {
  return {
    httpOnly: true,
    sameSite: "lax",
    signed: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: days * 24 * 60 * 60 * 1000
  };
}

function sessionToken() {
  return crypto.createHmac("sha256", SESSION_SECRET).update(APP_PASSWORD).digest("hex");
}

function isAuthenticated(req) {
  return req.signedCookies[SESSION_COOKIE] === sessionToken();
}

function requireAuth(req, res, next) {
  if (!isAuthenticated(req)) return res.status(401).json({ error: "Unauthenticated" });
  ensureLearner(req, res);
  next();
}

app.post("/api/login", (req, res) => {
  if (String(req.body.password ?? "") !== APP_PASSWORD) {
    return res.status(401).json({ error: "Incorrect password" });
  }
  res.cookie(SESSION_COOKIE, sessionToken(), cookieOptions());
  ensureLearner(req, res);
  res.json({ authenticated: true });
});

app.post("/api/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ authenticated: false });
});

app.get("/api/me", (req, res) => {
  res.json({ authenticated: isAuthenticated(req) });
});

app.get("/api/questions", requireAuth, (req, res) => {
  const questions = listQuestions(db, {
    includeInactive: req.query.includeInactive === "true",
    standard: req.query.standard,
    topic: req.query.topic,
    subtopic: req.query.subtopic,
    category: req.query.category,
    type: req.query.type
  });
  res.json({ questions });
});

app.post("/api/attempts", requireAuth, (req, res) => {
  const question = getQuestion(db, req.body.questionId);
  if (!question || !question.active) return res.status(404).json({ error: "Question not found" });

  const result = markAnswer(question, req.body.answer, req.body.selfMarkedCorrect);
  if (!result.requiresSelfMark) {
    createAttempt(db, {
      learnerId: req.signedCookies[LEARNER_COOKIE],
      question,
      submittedAnswer: req.body.answer,
      correct: result.correct
    });
  }
  res.json({ ...result, question });
});

app.get("/api/stats", requireAuth, (req, res) => {
  res.json(getStats(db, req.signedCookies[LEARNER_COOKIE]));
});

app.post("/api/admin/import", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Upload a CSV or XLSX file" });
  try {
    const questions = await parseSpreadsheet(req.file.buffer, req.file.originalname);
    const result = upsertImportedQuestions(db, questions, {
      overwriteEditedFields: req.body.overwriteEditedFields === "true"
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.patch("/api/admin/questions/:id", requireAuth, (req, res) => {
  const question = updateQuestion(db, req.params.id, req.body);
  if (!question) return res.status(404).json({ error: "Question not found" });
  res.json({ question });
});

const distDir = path.join(__dirname, "..", "dist");
app.use(express.static(distDir));
app.get("*", (_req, res, next) => {
  if (process.env.NODE_ENV !== "production") return next();
  res.sendFile(path.join(distDir, "index.html"));
});

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`SBR revision app listening on http://localhost:${port}`);
  });
}

export { app, db };
