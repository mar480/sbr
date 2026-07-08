export function normalizeAnswer(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function splitList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function markAnswer(question, submittedAnswer, selfMarkedCorrect = null) {
  const type = question.type || "text";
  const matchMode = question.match_mode || (type === "self_mark" ? "self_mark" : "strict");

  if (matchMode === "self_mark" || type === "self_mark") {
    return {
      correct: selfMarkedCorrect === true,
      requiresSelfMark: selfMarkedCorrect === null,
      expectedAnswer: question.answer
    };
  }

  const submitted = normalizeAnswer(submittedAnswer);
  const exact = normalizeAnswer(question.answer);

  if (type === "mcq" || type === "dropdown" || matchMode === "strict") {
    return {
      correct: submitted.length > 0 && submitted === exact,
      requiresSelfMark: false,
      expectedAnswer: question.answer
    };
  }

  if (matchMode === "variants") {
    const accepted = [question.answer, ...splitList(question.accepted_answers)].map(normalizeAnswer);
    return {
      correct: submitted.length > 0 && accepted.includes(submitted),
      requiresSelfMark: false,
      expectedAnswer: question.answer
    };
  }

  return {
    correct: submitted.length > 0 && submitted === exact,
    requiresSelfMark: false,
    expectedAnswer: question.answer
  };
}
