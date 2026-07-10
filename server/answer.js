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

export function parseParts(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function answerMatches(expected, acceptedAnswers, submittedAnswer, matchMode) {
  const submitted = normalizeAnswer(submittedAnswer);
  const exact = normalizeAnswer(expected);

  if (matchMode === "variants") {
    const accepted = [expected, ...splitList(acceptedAnswers)].map(normalizeAnswer);
    return submitted.length > 0 && accepted.includes(submitted);
  }

  return submitted.length > 0 && submitted === exact;
}

function normaliseSet(values) {
  return [...new Set(splitList(values).map(normalizeAnswer))].sort();
}

function setsEqual(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
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

  if (type === "multi_part") {
    const parts = parseParts(question.parts);
    const submitted = submittedAnswer && typeof submittedAnswer === "object" ? submittedAnswer : {};
    const partResults = parts.map((part, index) => {
      const submittedPart = submitted[String(index)] ?? submitted[index] ?? "";
      const correct = answerMatches(part.answer, part.accepted_answers, submittedPart, matchMode);
      return {
        index,
        label: part.label || `Part ${index + 1}`,
        answer: part.answer,
        submittedAnswer: submittedPart,
        correct
      };
    });

    return {
      correct: partResults.length > 0 && partResults.every((part) => part.correct),
      requiresSelfMark: false,
      expectedAnswer: parts.map((part) => part.answer).join(" | "),
      partResults
    };
  }

  if (type === "multi_select") {
    const expected = normaliseSet(question.answer);
    const submitted = normaliseSet(Array.isArray(submittedAnswer) ? submittedAnswer : splitList(submittedAnswer));
    const selected = new Set(submitted);
    const expectedSet = new Set(expected);
    return {
      correct: expected.length > 0 && setsEqual(expected, submitted),
      requiresSelfMark: false,
      expectedAnswer: question.answer,
      optionResults: splitList(question.choices).map((choice) => {
        const normalised = normalizeAnswer(choice);
        return {
          choice,
          selected: selected.has(normalised),
          expected: expectedSet.has(normalised),
          correct: selected.has(normalised) === expectedSet.has(normalised)
        };
      })
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
