import crypto from "node:crypto";
import { parse } from "csv-parse/sync";
import readXlsxFile from "read-excel-file/node";
import { splitList } from "./answer.js";

const REQUIRED_COLUMNS = ["question", "type", "answer", "explanation"];
const QUESTION_TYPES = new Set(["mcq", "dropdown", "text", "self_mark", "calculation", "standard_match", "multi_part", "multi_select"]);
const MATCH_MODES = new Set(["strict", "variants", "self_mark"]);
const PART_TYPES = new Set(["text", "dropdown"]);

export function makeQuestionId(row) {
  if (row.id) return String(row.id).trim();
  const stable = [row.question, row.standard, row.topic, row.category].map((item) => String(item ?? "").trim()).join("|");
  return `q_${crypto.createHash("sha1").update(stable).digest("hex").slice(0, 16)}`;
}

function normalizeRowKeys(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [String(key).trim().toLowerCase(), value])
  );
}

function getParts(row) {
  const parts = [];
  for (let index = 1; index <= 6; index += 1) {
    const label = String(row[`part${index}_label`] ?? "").trim();
    const type = String(row[`part${index}_type`] ?? "").trim().toLowerCase();
    const choices = splitList(row[`part${index}_choices`]).join("|");
    const answer = String(row[`part${index}_answer`] ?? "").trim();
    const acceptedAnswers = splitList(row[`part${index}_accepted_answers`]).join("|");

    if (!label && !type && !choices && !answer && !acceptedAnswers) continue;
    if (!type) throw new Error(`part${index}_type is required`);
    if (!PART_TYPES.has(type)) throw new Error(`Unsupported part${index}_type "${type}"`);
    if (!answer) throw new Error(`part${index}_answer is required`);
    if (type === "dropdown" && !choices) throw new Error(`part${index}_choices is required for dropdown parts`);

    parts.push({
      label: label || `Part ${index}`,
      type,
      choices,
      answer,
      accepted_answers: acceptedAnswers
    });
  }
  return parts;
}

export function normalizeQuestionRow(input) {
  const row = normalizeRowKeys(input);
  const type = String(row.type).trim().toLowerCase();
  const requiredColumns = type === "multi_part" ? ["question", "type", "explanation"] : REQUIRED_COLUMNS;
  for (const column of requiredColumns) {
    if (!String(row[column] ?? "").trim()) {
      throw new Error(`Missing required column "${column}"`);
    }
  }

  if (!QUESTION_TYPES.has(type)) throw new Error(`Unsupported question type "${row.type}"`);

  const matchMode = String(row.match_mode || (type === "self_mark" ? "self_mark" : "strict")).trim().toLowerCase();
  if (!MATCH_MODES.has(matchMode)) throw new Error(`Unsupported match_mode "${row.match_mode}"`);

  const activeText = String(row.active ?? "true").trim().toLowerCase();
  const parts = getParts(row);
  if (type === "multi_part" && parts.length < 2) throw new Error("multi_part questions need at least 2 parts");
  if (type === "multi_select" && !splitList(row.choices).length) throw new Error("multi_select questions need choices");
  if (type === "multi_select" && !splitList(row.answer).length) throw new Error("multi_select questions need at least one answer");

  return {
    id: makeQuestionId(row),
    question: String(row.question).trim(),
    type,
    answer: String(row.answer).trim(),
    explanation: String(row.explanation).trim(),
    standard: String(row.standard ?? "").trim(),
    topic: String(row.topic ?? "").trim(),
    subtopic: String(row.subtopic ?? "").trim(),
    category: String(row.category ?? "").trim(),
    choices: splitList(row.choices).join("|"),
    accepted_answers: splitList(row.accepted_answers).join("|"),
    parts: JSON.stringify(parts),
    match_mode: matchMode,
    difficulty: String(row.difficulty ?? "").trim(),
    active: ["", "true", "yes", "1", "active"].includes(activeText) ? 1 : 0
  };
}

export async function parseSpreadsheet(buffer, filename = "questions.csv") {
  const lower = filename.toLowerCase();
  let rows;

  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const workbookData = await readXlsxFile(buffer);
    const table = Array.isArray(workbookData?.[0]?.data) ? workbookData[0].data : workbookData;
    const headers = (table[0] || []).map((cell) => String(cell ?? "").trim());
    rows = table.slice(1).map((values) => {
      const item = {};
      headers.forEach((header, index) => {
        if (header) item[header] = values[index] ?? "";
      });
      return item;
    }).filter((item) => Object.values(item).some((value) => String(value ?? "").trim()));
  } else {
    rows = parse(buffer.toString("utf8"), {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
  }

  return rows.map((row, index) => {
    try {
      return normalizeQuestionRow(row);
    } catch (error) {
      throw new Error(`Row ${index + 2}: ${error.message}`);
    }
  });
}
