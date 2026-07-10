Generate ACCA SBR rote-recall quiz questions for import into my app.

Output as CSV rows using exactly these columns:
id,standard,topic,subtopic,category,type,question,choices,answer,accepted_answers,match_mode,explanation,difficulty,active,part1_label,part1_type,part1_choices,part1_answer,part1_accepted_answers,part2_label,part2_type,part2_choices,part2_answer,part2_accepted_answers,part3_label,part3_type,part3_choices,part3_answer,part3_accepted_answers,part4_label,part4_type,part4_choices,part4_answer,part4_accepted_answers,part5_label,part5_type,part5_choices,part5_answer,part5_accepted_answers,part6_label,part6_type,part6_choices,part6_answer,part6_accepted_answers

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
- multi_part: multiple text/dropdown answers in one question.
- multi_select: pick all that apply using checkboxes.

Multi-part rules:
- Use type=multi_part.
- Leave choices, answer, and accepted_answers blank unless a top-level answer is useful.
- Populate part1_* to part6_* as needed.
- Each part needs partN_type and partN_answer.
- partN_type must be text or dropdown.
- dropdown parts need pipe-separated partN_choices.
- text parts can use pipe-separated partN_accepted_answers.
- At least two parts are required.

Multi-select rules:
- Use type=multi_select.
- Put all checkbox options in choices, pipe-separated.
- Put all correct options in answer, pipe-separated.
- Order does not matter, but extra selected options are wrong.

match_mode:
- strict: exact answer only.
- variants: answer plus accepted_answers are correct.
- For multi_part, variants also allows each part's accepted answers.
- self_mark: only for self_mark questions.

Content style:
- Focus on rote recall for SBR.
- Prefer recognition, measurement, presentation, disclosure, classification, derecognition.
- Make distractors plausible and finely different.
- Avoid long written-answer prompts.
- Feedback should state the exact answer and why it matters.
- Generate original questions unless I provide source text to transform.

Now generate [NUMBER] questions for [STANDARD/TOPIC], focusing on [CATEGORY].
