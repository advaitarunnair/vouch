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
    CREATE TABLE IF NOT EXISTS uploads (
      check_id    TEXT PRIMARY KEY REFERENCES checks(id),
      mime        TEXT NOT NULL,
      data        BLOB NOT NULL
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

export function updateCheck(id: string, patch: { status?: CheckStatus; result?: unknown }) {
  const row = getCheck(id);
  if (!row) return;
  db()
    .prepare(`UPDATE checks SET status = ?, result_json = ?, updated_at = ? WHERE id = ?`)
    .run(
      patch.status ?? row.status,
      patch.result === undefined ? row.result_json : JSON.stringify(patch.result),
      new Date().toISOString(),
      id,
    );
}

/**
 * Atomically moves a check to 'running' so only one worker processes it.
 * A check stuck in 'running' for over 2 minutes (e.g. server restart) can be reclaimed.
 */
export function claimCheck(id: string): boolean {
  const staleBefore = new Date(Date.now() - 120_000).toISOString();
  const res = db()
    .prepare(
      `UPDATE checks SET status = 'running', updated_at = ?
       WHERE id = ? AND (status = 'pending' OR (status = 'running' AND updated_at < ?))`,
    )
    .run(new Date().toISOString(), id, staleBefore);
  return res.changes === 1;
}

export function saveUpload(checkId: string, mime: string, data: Buffer) {
  db().prepare(`INSERT OR REPLACE INTO uploads (check_id, mime, data) VALUES (?, ?, ?)`).run(checkId, mime, data);
}

export function getUpload(checkId: string): { mime: string; data: Buffer } | undefined {
  return db().prepare(`SELECT mime, data FROM uploads WHERE check_id = ?`).get(checkId) as { mime: string; data: Buffer } | undefined;
}

export function cacheGet<T>(key: string): T | undefined {
  const row = db().prepare(`SELECT value_json, expires_at FROM cache WHERE key = ?`).get(key) as
    | { value_json: string; expires_at: number }
    | undefined;
  if (!row || row.expires_at < Date.now()) return undefined;
  return JSON.parse(row.value_json) as T;
}

export function cacheSet(key: string, value: unknown, ttlMs: number) {
  db()
    .prepare(`INSERT OR REPLACE INTO cache (key, value_json, expires_at) VALUES (?, ?, ?)`)
    .run(key, JSON.stringify(value), Date.now() + ttlMs);
}
