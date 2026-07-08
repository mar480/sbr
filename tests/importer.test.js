import { describe, expect, it } from "vitest";
import { parseSpreadsheet } from "../server/importer.js";

describe("parseSpreadsheet", () => {
  it("parses terse CSV rows and generates stable IDs", async () => {
    const csv = Buffer.from("question,type,answer,explanation,standard,topic,category,choices\nWhat first?,dropdown,contract,Pick **contract**,IFRS 15,Revenue,Recognition,contract|price\n");
    const rows = await parseSpreadsheet(csv, "questions.csv");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "dropdown",
      answer: "contract",
      standard: "IFRS 15",
      active: 1
    });
    expect(rows[0].id).toMatch(/^q_/);
  });

  it("reports row-level validation errors", async () => {
    const csv = Buffer.from("question,type,answer,explanation\nBad,essay,x,y\n");
    await expect(parseSpreadsheet(csv, "questions.csv")).rejects.toThrow(/Row 2/);
  });

  it("accepts standard matching questions", async () => {
    const csv = Buffer.from("question,type,answer,explanation\nIFRS 15,standard_match,Revenue from Contracts with Customers,IFRS 15 is **Revenue from Contracts with Customers**.\n");
    const rows = await parseSpreadsheet(csv, "questions.csv");
    expect(rows[0].type).toBe("standard_match");
  });

  it("parses multi-part questions into structured parts", async () => {
    const csv = Buffer.from("question,type,answer,explanation,part1_label,part1_type,part1_choices,part1_answer,part2_label,part2_type,part2_answer,match_mode\nA provision requires a present ____ and probable ____.,multi_part,,Know the criteria.,First gap,dropdown,asset|obligation,obligation,Second gap,text,outflow,variants\n");
    const rows = await parseSpreadsheet(csv, "questions.csv");
    expect(rows[0].type).toBe("multi_part");
    expect(JSON.parse(rows[0].parts)).toHaveLength(2);
  });

  it("validates incomplete multi-part dropdowns", async () => {
    const csv = Buffer.from("question,type,answer,explanation,part1_label,part1_type,part1_answer,part2_label,part2_type,part2_answer\nA provision requires two things.,multi_part,,Know the criteria.,First gap,dropdown,obligation,Second gap,text,outflow\n");
    await expect(parseSpreadsheet(csv, "questions.csv")).rejects.toThrow(/part1_choices/);
  });

  it("accepts multi-select questions", async () => {
    const csv = Buffer.from("question,type,choices,answer,explanation\nWhich are criteria?,multi_select,Present obligation|Probable outflow|Future plan,Present obligation|Probable outflow,Know the criteria.\n");
    const rows = await parseSpreadsheet(csv, "questions.csv");
    expect(rows[0].type).toBe("multi_select");
    expect(rows[0].answer).toBe("Present obligation|Probable outflow");
  });
});
