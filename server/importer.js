import crypto from "node:crypto";
import { parse } from "csv-parse/sync";
import readXlsxFile from "read-excel-file/node";
import { splitList } from "./answer.js";

const REQUIRED_COLUMNS = ["question", "type", "answer", "explanation"];
const QUESTION_TYPES = new Set(["mcq", "dropdown", "text", "self_mark", "calculation", "standard_match"]);
const MATCH_MODES = new Set(["strict", "variants", "self_mark"]);

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

export function normalizeQuestionRow(input) {
  const row = normalizeRowKeys(input);
  for (const column of REQUIRED_COLUMNS) {
    if (!String(row[column] ?? "").trim()) {
      throw new Error(`Missing required column "${column}"`);
    }
  }

  const type = String(row.type).trim().toLowerCase();
  if (!QUESTION_TYPES.has(type)) throw new Error(`Unsupported question type "${row.type}"`);

  const matchMode = String(row.match_mode || (type === "self_mark" ? "self_mark" : "strict")).trim().toLowerCase();
  if (!MATCH_MODES.has(matchMode)) throw new Error(`Unsupported match_mode "${row.match_mode}"`);

  const activeText = String(row.active ?? "true").trim().toLowerCase();

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
