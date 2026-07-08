import { openDatabase, upsertImportedQuestions } from "./db.js";
import { normalizeQuestionRow } from "./importer.js";

const db = openDatabase();

const sampleRows = [
  {
    id: "ifrs15-five-steps",
    standard: "IFRS 15",
    topic: "Revenue",
    subtopic: "Five-step model",
    category: "Recognition",
    type: "dropdown",
    question: "Under IFRS 15, revenue recognition starts by identifying the ____ with the customer.",
    choices: "contract|performance obligation|transaction price|warranty provision",
    answer: "contract",
    explanation: "The first step is to identify the **contract** with the customer.",
    match_mode: "strict",
    difficulty: "core",
    active: "true"
  },
  {
    id: "ias37-provision-criteria",
    standard: "IAS 37",
    topic: "Provisions",
    subtopic: "Recognition criteria",
    category: "Recognition",
    type: "text",
    question: "Name the probability threshold phrase needed before recognising a provision.",
    answer: "probable outflow of economic benefits",
    accepted_answers: "probable outflow|probable transfer of economic benefits|probable economic outflow",
    explanation: "A provision needs a present obligation, a **probable outflow of economic benefits**, and a reliable estimate.",
    match_mode: "variants",
    difficulty: "core",
    active: "true"
  },
  {
    id: "ifrs16-lessee-initial-measurement",
    standard: "IFRS 16",
    topic: "Leases",
    subtopic: "Lessee accounting",
    category: "Measurement",
    type: "mcq",
    question: "Which item is included in the initial measurement of a lessee's right-of-use asset?",
    choices: "Initial direct costs|Future variable lease payments linked to sales|General admin overhead|Expected future repairs",
    answer: "Initial direct costs",
    explanation: "The right-of-use asset includes the lease liability, payments made at/before commencement, **initial direct costs**, and restoration obligations where relevant.",
    match_mode: "strict",
    difficulty: "core",
    active: "true"
  },
  {
    id: "ifrs15-warranty-classification",
    standard: "IFRS 15",
    topic: "Revenue",
    subtopic: "Warranties",
    category: "Classification",
    type: "self_mark",
    question: "Explain to yourself whether a separately priced extended warranty is assurance-type or service-type, then reveal the answer.",
    answer: "A separately priced extended warranty is normally a service-type warranty and a separate performance obligation.",
    explanation: "A customer option to buy extra warranty cover points to a **service-type warranty** and separate revenue allocation.",
    match_mode: "self_mark",
    difficulty: "applied",
    active: "true"
  },
  {
    id: "ias37-best-estimate",
    standard: "IAS 37",
    topic: "Provisions",
    subtopic: "Measurement",
    category: "Measurement",
    type: "calculation",
    question: "For a large population of similar warranty claims, which measurement model should be used?",
    answer: "expected value",
    accepted_answers: "expected value method|probability weighted expected value",
    explanation: "For a large population, IAS 37 uses an **expected value** approach rather than a single most likely outcome.",
    match_mode: "variants",
    difficulty: "core",
    active: "true"
  }
].map(normalizeQuestionRow);

const result = upsertImportedQuestions(db, sampleRows, { overwriteEditedFields: false });
console.log(`Seed complete: ${result.created} created, ${result.updated} updated.`);
