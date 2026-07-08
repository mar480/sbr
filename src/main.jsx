import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const QUESTION_TYPES = ["mcq", "dropdown", "text", "self_mark", "calculation", "standard_match"];
const CATEGORIES = ["Recognition", "Measurement", "Presentation", "Disclosure", "Classification"];

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Something went wrong");
  return body;
}

function splitList(value) {
  return String(value || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function renderRichText(value) {
  const parts = String(value || "").split(/(\*\*.*?\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function useAuth() {
  const [auth, setAuth] = useState({ loading: true, authenticated: false });
  useEffect(() => {
    api("/api/me")
      .then((result) => setAuth({ loading: false, authenticated: result.authenticated }))
      .catch(() => setAuth({ loading: false, authenticated: false }));
  }, []);
  return [auth, setAuth];
}

function Login({ onLogin }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify({ password }) });
      onLogin();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="auth-shell">
      <form className="login-panel" onSubmit={submit}>
        <p className="eyebrow">ACCA SBR</p>
        <h1>Revision practice</h1>
        <label>
          Password
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoFocus />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit">Enter</button>
      </form>
    </main>
  );
}

function Shell({ page, setPage, children }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">SBR</p>
          <h1>Rote recall</h1>
        </div>
        <nav>
          <button className={page === "practice" ? "active" : ""} onClick={() => setPage("/practice")}>Practice</button>
          <button className={page === "stats" ? "active" : ""} onClick={() => setPage("/stats")}>Stats</button>
          <button className={page === "import" ? "active" : ""} onClick={() => setPage("/admin/import")}>Import</button>
        </nav>
      </header>
      {children}
    </div>
  );
}

function FilterBar({ questions, filters, setFilters }) {
  const options = (field) => [...new Set(questions.map((q) => q[field]).filter(Boolean))].sort();
  const update = (field, value) => setFilters((current) => ({ ...current, [field]: value }));
  return (
    <section className="filters">
      {["standard", "topic", "subtopic", "category", "type"].map((field) => (
        <label key={field}>
          {field}
          <select value={filters[field] || ""} onChange={(event) => update(field, event.target.value)}>
            <option value="">All</option>
            {(field === "type" ? QUESTION_TYPES : options(field)).map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
      ))}
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={Boolean(filters.weakOnly)}
          onChange={(event) => update("weakOnly", event.target.checked)}
        />
        Weak only
      </label>
    </section>
  );
}

function QuestionCard({ question, onAttempt }) {
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState(null);
  const choices = splitList(question.choices);
  useEffect(() => {
    setAnswer("");
    setResult(null);
  }, [question.id]);

  async function submit(selfMarkedCorrect = null) {
    const response = await api("/api/attempts", {
      method: "POST",
      body: JSON.stringify({ questionId: question.id, answer, selfMarkedCorrect })
    });
    setResult(response);
    if (!response.requiresSelfMark) onAttempt?.();
  }

  return (
    <article className="question-card">
      <h2>{question.question}</h2>
      {question.type === "mcq" && (
        <div className="choice-list">
          {choices.map((choice) => (
            <label key={choice}>
              <input type="radio" name={question.id} value={choice} checked={answer === choice} onChange={(event) => setAnswer(event.target.value)} />
              {choice}
            </label>
          ))}
        </div>
      )}
      {question.type === "dropdown" && (
        <select className="answer-input" value={answer} onChange={(event) => setAnswer(event.target.value)}>
          <option value="">Choose...</option>
          {choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
        </select>
      )}
      {(question.type === "text" || question.type === "calculation" || question.type === "standard_match") && (
        <input className="answer-input" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Type your answer" />
      )}
      {question.type === "self_mark" ? (
        <button onClick={() => submit(null)}>Reveal answer</button>
      ) : (
        <button onClick={() => submit()} disabled={!answer}>Check</button>
      )}
      {result && (
        <section className={`feedback ${result.correct ? "correct" : "incorrect"}`}>
          {result.requiresSelfMark ? (
            <div className="self-mark-actions">
              <button onClick={() => submit(true)}>I got it</button>
              <button onClick={() => submit(false)}>I missed it</button>
            </div>
          ) : (
            <p>{result.correct ? "Correct." : "Not quite."}</p>
          )}
          <p><strong>Answer:</strong> {renderRichText(question.answer)}</p>
          <p>{renderRichText(question.explanation)}</p>
        </section>
      )}
    </article>
  );
}

function Practice({ goEdit }) {
  const [questions, setQuestions] = useState([]);
  const [stats, setStats] = useState(null);
  const [filters, setFilters] = useState({});
  const [index, setIndex] = useState(0);

  async function load() {
    const [q, s] = await Promise.all([api("/api/questions"), api("/api/stats")]);
    setQuestions(q.questions);
    setStats(s);
  }

  useEffect(() => { load(); }, []);

  const weakLabels = useMemo(() => new Set((stats?.byTopic || []).filter((row) => row.attempts >= 1 && row.accuracy < 70).map((row) => row.label)), [stats]);
  const filtered = questions.filter((question) => {
    for (const field of ["standard", "topic", "subtopic", "category", "type"]) {
      if (filters[field] && question[field] !== filters[field]) return false;
    }
    if (filters.weakOnly && !weakLabels.has(question.topic)) return false;
    return true;
  });
  const current = filtered[index % Math.max(filtered.length, 1)];

  return (
    <main>
      <FilterBar questions={questions} filters={filters} setFilters={(next) => { setIndex(0); setFilters(next); }} />
      <div className="practice-meta">
        <span>{filtered.length} questions</span>
        {current && <button className="secondary" onClick={() => goEdit(current.id)}>Edit question</button>}
      </div>
      {current ? (
        <>
          <QuestionCard question={current} onAttempt={load} />
          <div className="nav-row">
            <button className="secondary" onClick={() => setIndex((value) => Math.max(0, value - 1))}>Previous</button>
            <button onClick={() => setIndex((value) => value + 1)}>Next</button>
          </div>
        </>
      ) : (
        <p className="empty">No active questions match those filters.</p>
      )}
    </main>
  );
}

function Stats() {
  const [stats, setStats] = useState(null);
  useEffect(() => { api("/api/stats").then(setStats); }, []);
  if (!stats) return <main><p>Loading...</p></main>;
  const groups = [["Standard", stats.byStandard], ["Topic", stats.byTopic], ["Category", stats.byCategory], ["Type", stats.byType]];
  return (
    <main>
      <section className="summary-band">
        <p>Total attempts</p>
        <strong>{stats.overall.attempts}</strong>
        <p>{stats.overall.accuracy}% correct</p>
      </section>
      {groups.map(([title, rows]) => (
        <section className="stats-table" key={title}>
          <h2>{title}</h2>
          {rows.length === 0 ? <p className="empty">No attempts yet.</p> : rows.map((row) => (
            <div className="stat-row" key={`${title}-${row.label}`}>
              <span>{row.label || "Uncategorised"}</span>
              <strong>{row.accuracy}%</strong>
              <small>{row.correct}/{row.attempts}</small>
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}

function ImportPage() {
  const [file, setFile] = useState(null);
  const [overwrite, setOverwrite] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    const form = new FormData();
    form.append("file", file);
    form.append("overwriteEditedFields", String(overwrite));
    try {
      const result = await api("/api/admin/import", { method: "POST", body: form });
      setMessage(`${result.created} created, ${result.updated} updated, ${result.total} rows processed.`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main>
      <form className="panel" onSubmit={submit}>
        <h2>Import questions</h2>
        <input type="file" accept=".csv,.xlsx,.xls" onChange={(event) => setFile(event.target.files[0])} />
        <label className="checkbox-row">
          <input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />
          Overwrite fields edited in the app
        </label>
        <button disabled={!file}>Upload</button>
        {message && <p className="success">{message}</p>}
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}

function EditQuestion({ id, back }) {
  const [question, setQuestion] = useState(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    api("/api/questions?includeInactive=true").then((result) => {
      setQuestion(result.questions.find((item) => item.id === id));
    });
  }, [id]);

  if (!question) return <main><p>Loading...</p></main>;
  const setField = (field, value) => setQuestion((current) => ({ ...current, [field]: value }));

  async function save(event) {
    event.preventDefault();
    const payload = { ...question, active: Boolean(question.active) };
    const result = await api(`/api/admin/questions/${question.id}`, { method: "PATCH", body: JSON.stringify(payload) });
    setQuestion(result.question);
    setMessage("Saved.");
  }

  return (
    <main>
      <form className="editor" onSubmit={save}>
        <button type="button" className="secondary" onClick={back}>Back</button>
        <h2>Edit question</h2>
        {["standard", "topic", "subtopic", "category"].map((field) => (
          <label key={field}>{field}<input value={question[field] || ""} onChange={(event) => setField(field, event.target.value)} /></label>
        ))}
        <label>type<select value={question.type} onChange={(event) => setField("type", event.target.value)}>{QUESTION_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
        <label>match mode<select value={question.match_mode} onChange={(event) => setField("match_mode", event.target.value)}>{["strict", "variants", "self_mark"].map((mode) => <option key={mode}>{mode}</option>)}</select></label>
        <label>question<textarea value={question.question} onChange={(event) => setField("question", event.target.value)} /></label>
        <label>answer<textarea value={question.answer} onChange={(event) => setField("answer", event.target.value)} /></label>
        <label>explanation<textarea value={question.explanation} onChange={(event) => setField("explanation", event.target.value)} /></label>
        <label>choices<input value={question.choices || ""} onChange={(event) => setField("choices", event.target.value)} /></label>
        <label>accepted answers<input value={question.accepted_answers || ""} onChange={(event) => setField("accepted_answers", event.target.value)} /></label>
        <label>difficulty<input value={question.difficulty || ""} onChange={(event) => setField("difficulty", event.target.value)} /></label>
        <label className="checkbox-row"><input type="checkbox" checked={Boolean(question.active)} onChange={(event) => setField("active", event.target.checked)} /> Active</label>
        <button>Save</button>
        {message && <p className="success">{message}</p>}
      </form>
    </main>
  );
}

function App() {
  const [auth, setAuth] = useAuth();
  const [path, setPath] = useState(() => window.location.pathname === "/" ? "/practice" : window.location.pathname);
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname === "/" ? "/practice" : window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigate(nextPath) {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  }

  if (auth.loading) return <main className="auth-shell"><p>Loading...</p></main>;
  if (!auth.authenticated) return <Login onLogin={() => setAuth({ loading: false, authenticated: true })} />;
  const editMatch = path.match(/^\/admin\/questions\/([^/]+)$/);
  const page = editMatch ? "edit" : path === "/stats" ? "stats" : path === "/admin/import" ? "import" : "practice";

  return (
    <Shell page={page} setPage={navigate}>
      {editMatch ? <EditQuestion id={editMatch[1]} back={() => navigate("/practice")} /> : null}
      {!editMatch && page === "practice" ? <Practice goEdit={(id) => navigate(`/admin/questions/${id}`)} /> : null}
      {!editMatch && page === "stats" ? <Stats /> : null}
      {!editMatch && page === "import" ? <ImportPage /> : null}
    </Shell>
  );
}

createRoot(document.getElementById("root")).render(<App />);
