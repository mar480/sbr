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
});
