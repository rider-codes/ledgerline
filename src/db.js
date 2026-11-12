'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const { DATA_DIR, DEFAULT_DB_PATH } = require('./paths');

const DB_PATH = path.resolve(process.env.DB_PATH || DEFAULT_DB_PATH);
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 3000;'); // wait, don't throw, if another process holds a write lock

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,                 -- YYYY-MM-DD
    amount      REAL NOT NULL,                 -- always > 0
    type        TEXT NOT NULL,                 -- 'expense' | 'income'
    category    TEXT NOT NULL,
    merchant    TEXT NOT NULL DEFAULT '',
    note        TEXT NOT NULL DEFAULT '',
    source      TEXT NOT NULL DEFAULT 'manual',-- 'manual' | 'csv' | future connectors
    import_hash TEXT,                          -- sha1(user|date|amount|desc) for dedupe
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_dedupe
    ON transactions(user_id, import_hash) WHERE import_hash IS NOT NULL;

  CREATE TABLE IF NOT EXISTS rules (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    match_text TEXT NOT NULL,
    category   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_rules_user ON rules(user_id);

  CREATE TABLE IF NOT EXISTS nb_model (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    payload    TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- one row per transaction: a unit-normalized embedding vector for semantic search
  CREATE TABLE IF NOT EXISTS tx_embed (
    transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
    model          TEXT NOT NULL,
    dim            INTEGER NOT NULL,
    doc_hash       TEXT NOT NULL,          -- hash of the embedded text; re-embed when it changes
    vec            BLOB NOT NULL,          -- Float32 little-endian
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Fixed category vocabulary. "Income" and "Uncategorized" are internal buckets.
const CATEGORIES = [
  'Groceries', 'Dining', 'Transport', 'Housing', 'Utilities', 'Entertainment',
  'Shopping', 'Health', 'Travel', 'Subscriptions', 'Education', 'Misc',
  'Income', 'Uncategorized',
];

// Categories a user may assign to an expense in the UI (excludes Income).
const EXPENSE_CATEGORIES = CATEGORIES.filter((c) => c !== 'Income');

module.exports = { db, DB_PATH, DATA_DIR, CATEGORIES, EXPENSE_CATEGORIES };
