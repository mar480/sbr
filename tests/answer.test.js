import { describe, expect, it } from "vitest";
import { markAnswer } from "../server/answer.js";

const base = {
  id: "q1",
  type: "text",
  answer: "probable outflow of economic benefits",
  accepted_answers: "probable outflow|probable economic outflow",
  match_mode: "strict"
};

describe("markAnswer", () => {
  it("marks strict answers exactly after normalising case and spacing", () => {
    expect(markAnswer(base, " Probable   Outflow Of Economic Benefits ").correct).toBe(true);
    expect(markAnswer(base, "probable outflow").correct).toBe(false);
  });

  it("accepts configured variants", () => {
    expect(markAnswer({ ...base, match_mode: "variants" }, "probable economic outflow").correct).toBe(true);
  });

  it("marks dropdowns and MCQs strictly", () => {
    expect(markAnswer({ ...base, type: "dropdown", answer: "contract" }, "contract").correct).toBe(true);
    expect(markAnswer({ ...base, type: "mcq", answer: "Initial direct costs" }, "initial direct costs").correct).toBe(true);
  });

  it("supports self-marking", () => {
    expect(markAnswer({ ...base, type: "self_mark", match_mode: "self_mark" }, "").requiresSelfMark).toBe(true);
    expect(markAnswer({ ...base, type: "self_mark", match_mode: "self_mark" }, "", false).correct).toBe(false);
  });

  it("marks standard number/name matching as typed recall", () => {
    const question = {
      ...base,
      type: "standard_match",
      answer: "Revenue from Contracts with Customers",
      accepted_answers: "Revenue from contracts with customers|Revenue from contracts",
      match_mode: "variants"
    };
    expect(markAnswer(question, "revenue from contracts with customers").correct).toBe(true);
    expect(markAnswer(question, "IFRS 15").correct).toBe(false);
  });
});
