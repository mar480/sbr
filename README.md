# SBR Revision Quiz

Phone-friendly ACCA SBR rote-recall quiz app with a React/Vite frontend, Express backend, SQLite storage, and CSV/XLSX question import.

## Requirements

- Node 22 LTS is recommended. This repo includes `.nvmrc` and `.node-version`.
- npm 10 or newer.

`better-sqlite3` and `esbuild` use install scripts to prepare native binaries for your machine. If npm blocks scripts, approve those packages and reinstall.

## First Install

```bash
npm install
```

If npm shows an `allow-scripts` warning, run:

```bash
npm approve-scripts --allow-scripts-pending
npm install
```

Approve `better-sqlite3` and `esbuild` if prompted.

Avoid `npm audit fix --force` as a first response. It can upgrade test/build tools across major versions. Check the app first with:

```bash
npm run build
npm test
```

## Environment

Copy `.env.example` to `.env` and change the secrets:

```bash
APP_PASSWORD=change-me
SESSION_SECRET=replace-with-a-long-random-string
PORT=3000
DATABASE_PATH=./data/sbr.sqlite
```

The app also works locally with defaults, but production should use a real password and session secret.

## Commands

```bash
npm run dev
```

Starts the local development app. The frontend is on `http://localhost:5173` and the API is on `http://localhost:3000`.

```bash
npm run dev:phone
```

Starts the development app with the Vite frontend visible on your local network for phone testing. Use this only when you deliberately want LAN access.

```bash
npm run seed
```

Adds or updates the sample questions in SQLite.

```bash
npm run build
```

Builds the production frontend into `dist/`.

```bash
npm start
```

Starts the production Express server and serves the built frontend. Run `npm run build` first.

```bash
npm test
```

Runs the unit/API tests.

## Audit Notes

Use this to check production dependencies:

```bash
npm audit --omit=dev
```

If full `npm audit` reports dev-tooling issues, treat those separately from production runtime risk. Prefer deliberate package updates over forced audit upgrades.
