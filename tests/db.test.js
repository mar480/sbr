import { describe, expect, it } from "vitest";
import { openDatabase, getQuestion, updateQuestion, upsertImportedQuestions } from "../server/db.js";

const question = {
  id: "q1",
  question: "Original?",
  type: "text",
  answer: "answer",
  explanation: "explanation",
  standard: "IFRS 15",
  topic: "Revenue",
  subtopic: "",
  category: "Recognition",
  choices: "",
  accepted_answers: "",
  parts: "[]",
  match_mode: "strict",
  difficulty: "",
  active: 1
};

describe("database import behaviour", () => {
  it("keeps manual edits unless overwrite is requested", () => {
    const db = openDatabase(":memory:");
    upsertImportedQuestions(db, [question]);
    updateQuestion(db, "q1", { answer: "manual answer" });

    upsertImportedQuestions(db, [{ ...question, answer: "import answer", explanation: "new explanation" }]);
    expect(getQuestion(db, "q1").answer).toBe("manual answer");
    expect(getQuestion(db, "q1").explanation).toBe("new explanation");

    upsertImportedQuestions(db, [{ ...question, answer: "import answer" }], { overwriteEditedFields: true });
    expect(getQuestion(db, "q1").answer).toBe("import answer");
  });
});
