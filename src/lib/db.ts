import "server-only";
import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

// SQLite store for checks and caches. Resetting on redeploy is acceptable:
// PayPal data is re-fetched and demo data is re-creatable by script.
const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "vouch.db");

declare global {
  var __vouchDb: Database.Database | undefined;
}

function open(): Database.Database {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS checks (
      id          TEXT PRIMARY KEY,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      source      TEXT NOT NULL,          -- 'link' | 'share' | 'screenshot' | 'demo'
      input_url   TEXT,
      input_text  TEXT,
      status      TEXT NOT NULL,          -- 'pending' | 'running' | 'needs_confirmation' | 'done' | 'error'
      result_json TEXT
    );
    CREATE TABLE IF NOT EXISTS cache (
      key         TEXT PRIMARY KEY,
      value_json  TEXT NOT NULL,
      expires_at  INTEGER NOT NULL
    );
  `);
  return db;
}

export function db(): Database.Database {
  // Reuse one connection across hot reloads in dev.
  return (globalThis.__vouchDb ??= open());
}

export type CheckStatus = "pending" | "running" | "needs_confirmation" | "done" | "error";
export type CheckSource = "link" | "share" | "screenshot" | "demo";

export interface CheckRow {
  id: string;
  created_at: string;
  updated_at: string;
  source: CheckSource;
  input_url: string | null;
  input_text: string | null;
  status: CheckStatus;
  result_json: string | null;
}

export function createCheck(input: { source: CheckSource; url?: string; text?: string }): CheckRow {
  const now = new Date().toISOString();
  const row: CheckRow = {
    id: randomBytes(8).toString("base64url"),
    created_at: now,
    updated_at: now,
    source: input.source,
    input_url: input.url ?? null,
    input_text: input.text ?? null,
    status: "pending",
    result_json: null,
  };
  db()
    .prepare(
      `INSERT INTO checks (id, created_at, updated_at, source, input_url, input_text, status, result_json)
       VALUES (@id, @created_at, @updated_at, @source, @input_url, @input_text, @status, @result_json)`,
    )
    .run(row);
  return row;
}

export function getCheck(id: string): CheckRow | undefined {
  return db().prepare(`SELECT * FROM checks WHERE id = ?`).get(id) as CheckRow | undefined;
}
