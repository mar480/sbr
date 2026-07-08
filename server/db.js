import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const QUESTION_FIELDS = [
  "question",
  "type",
  "answer",
  "explanation",
  "standard",
  "topic",
  "subtopic",
  "category",
  "choices",
  "accepted_answers",
  "match_mode",
  "difficulty",
  "active"
];

export function openDatabase(filePath = process.env.DATABASE_PATH || "./data/sbr.sqlite") {
  if (filePath !== ":memory:") fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      type TEXT NOT NULL,
      answer TEXT NOT NULL,
      explanation TEXT NOT NULL,
      standard TEXT DEFAULT '',
      topic TEXT DEFAULT '',
      subtopic TEXT DEFAULT '',
      category TEXT DEFAULT '',
      choices TEXT DEFAULT '',
      accepted_answers TEXT DEFAULT '',
      match_mode TEXT DEFAULT 'strict',
      difficulty TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      manual_edits TEXT DEFAULT '[]',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id TEXT NOT NULL,
      learner_id TEXT NOT NULL,
      submitted_answer TEXT DEFAULT '',
      correct INTEGER NOT NULL,
      attempted_at TEXT DEFAULT CURRENT_TIMESTAMP,
      standard TEXT DEFAULT '',
      topic TEXT DEFAULT '',
      subtopic TEXT DEFAULT '',
      category TEXT DEFAULT '',
      type TEXT DEFAULT '',
      FOREIGN KEY(question_id) REFERENCES questions(id)
    );
  `);
}

function parseManualEdits(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function rowToQuestion(row) {
  if (!row) return null;
  return {
    ...row,
    active: Boolean(row.active),
    choices: row.choices || "",
    accepted_answers: row.accepted_answers || ""
  };
}

export function listQuestions(db, filters = {}) {
  const where = [];
  const params = {};

  if (!filters.includeInactive) where.push("active = 1");
  for (const field of ["standard", "topic", "subtopic", "category", "type"]) {
    if (filters[field]) {
      where.push(`${field} = @${field}`);
      params[field] = filters[field];
    }
  }

  const sql = `SELECT * FROM questions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY standard, topic, category, question`;
  return db.prepare(sql).all(params).map(rowToQuestion);
}

export function getQuestion(db, id) {
  return rowToQuestion(db.prepare("SELECT * FROM questions WHERE id = ?").get(id));
}

export function upsertImportedQuestions(db, questions, { overwriteEditedFields = false } = {}) {
  const existingStmt = db.prepare("SELECT * FROM questions WHERE id = ?");
  const insertStmt = db.prepare(`
    INSERT INTO questions (${["id", ...QUESTION_FIELDS].join(", ")})
    VALUES (${["id", ...QUESTION_FIELDS].map((field) => `@${field}`).join(", ")})
  `);

  const updateStmt = db.prepare(`
    UPDATE questions SET
      question = @question,
      type = @type,
      answer = @answer,
      explanation = @explanation,
      standard = @standard,
      topic = @topic,
      subtopic = @subtopic,
      category = @category,
      choices = @choices,
      accepted_answers = @accepted_answers,
      match_mode = @match_mode,
      difficulty = @difficulty,
      active = @active,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `);

  const tx = db.transaction((items) => {
    let created = 0;
    let updated = 0;

    for (const item of items) {
      const existing = existingStmt.get(item.id);
      if (!existing) {
        insertStmt.run(item);
        created += 1;
        continue;
      }

      const manualEdits = parseManualEdits(existing.manual_edits);
      const next = { id: item.id };
      for (const field of QUESTION_FIELDS) {
        next[field] = !overwriteEditedFields && manualEdits.has(field) ? existing[field] : item[field];
      }
      updateStmt.run(next);
      updated += 1;
    }

    return { created, updated, total: items.length };
  });

  return tx(questions);
}

export function updateQuestion(db, id, changes) {
  const existing = getQuestion(db, id);
  if (!existing) return null;

  const allowed = new Set(QUESTION_FIELDS);
  const clean = {};
  for (const [key, value] of Object.entries(changes)) {
    if (allowed.has(key)) clean[key] = key === "active" ? (value ? 1 : 0) : String(value ?? "");
  }

  if (!Object.keys(clean).length) return existing;

  const manualEdits = parseManualEdits(existing.manual_edits);
  Object.keys(clean).forEach((field) => manualEdits.add(field));
  clean.manual_edits = JSON.stringify([...manualEdits]);
  clean.id = id;

  const assignments = Object.keys(clean)
    .filter((field) => field !== "id")
    .map((field) => `${field} = @${field}`)
    .join(", ");
  db.prepare(`UPDATE questions SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run(clean);
  return getQuestion(db, id);
}

export function createAttempt(db, { learnerId, question, submittedAnswer, correct }) {
  db.prepare(`
    INSERT INTO attempts (question_id, learner_id, submitted_answer, correct, standard, topic, subtopic, category, type)
    VALUES (@question_id, @learner_id, @submitted_answer, @correct, @standard, @topic, @subtopic, @category, @type)
  `).run({
    question_id: question.id,
    learner_id: learnerId,
    submitted_answer: String(submittedAnswer ?? ""),
    correct: correct ? 1 : 0,
    standard: question.standard,
    topic: question.topic,
    subtopic: question.subtopic,
    category: question.category,
    type: question.type
  });
}

export function getStats(db, learnerId) {
  const by = (field) => db.prepare(`
    SELECT ${field || "'all'"} AS label,
      COUNT(*) AS attempts,
      SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) AS correct,
      MAX(attempted_at) AS last_attempt
    FROM attempts
    WHERE learner_id = @learnerId
    ${field ? `GROUP BY ${field}` : ""}
    ORDER BY (COUNT(*) - SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END)) DESC, attempts DESC
  `).all({ learnerId }).map((row) => ({
    ...row,
    correct: Number(row.correct || 0),
    accuracy: row.attempts ? Math.round((Number(row.correct || 0) / row.attempts) * 100) : 0
  }));

  return {
    overall: by(null)[0] || { label: "all", attempts: 0, correct: 0, accuracy: 0 },
    byStandard: by("standard"),
    byTopic: by("topic"),
    byCategory: by("category"),
    byType: by("type")
  };
}
