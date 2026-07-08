Generate ACCA SBR rote-recall quiz questions for import into my app.

Output as CSV rows using exactly these columns:
id,standard,topic,subtopic,category,type,question,choices,answer,accepted_answers,match_mode,explanation,difficulty,active

Rules:
- One row per question.
- Do not add extra columns.
- Use terse, spreadsheet-safe text.
- Wrap key phrases in **bold** inside explanation.
- Use pipe-separated choices/accepted answers: option A|option B|option C.
- active must be true.
- difficulty should be core, applied, or tricky.
- id should be lowercase words with hyphens.

Question types:
- mcq: choices required; answer must exactly match one choice.
- dropdown: choices required; use ____ in the question if useful.
- text: typed answer; use strict or variants.
- calculation: typed answer about model/setup/placement, not long workings.
- self_mark: learner reveals answer and marks themselves.
- standard_match: match IFRS/IAS number to name, or name to number.

match_mode:
- strict: exact answer only.
- variants: answer plus accepted_answers are correct.
- self_mark: only for self_mark questions.

Content style:
- Focus on rote recall for SBR.
- Prefer recognition, measurement, presentation, disclosure, classification, derecognition.
- Make distractors plausible and finely different.
- Avoid long written-answer prompts.
- Feedback should state the exact answer and why it matters.
- Generate original questions unless I provide source text to transform.

Now generate [NUMBER] questions for [STANDARD/TOPIC], focusing on [CATEGORY].