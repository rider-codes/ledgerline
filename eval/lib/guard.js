'use strict';

// Eval tooling must never run against the live database. src/db.js opens DB_PATH if set and
// otherwise $DATA_DIR/finance.db (creating tables, switching to WAL), so we refuse to proceed
// unless DB_PATH points at a different, existing file. Call this BEFORE requiring anything in src/.

const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_DB_PATH: REAL_DB } = require('../../src/paths'); // honours DATA_DIR
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function assertSnapshotPath(p) {
  if (!p) throw new Error('refusing to run: no snapshot database given (set DB_PATH to a copy, e.g. eval/snapshots/eval.db)');
  if (same(p, REAL_DB)) throw new Error(`refusing to run: ${p} is the live database. Use a snapshot copy.`);
  if (!fs.existsSync(p)) throw new Error(`snapshot database not found: ${p}`);
  return path.resolve(p);
}

function requireSnapshotDb() {
  return assertSnapshotPath(process.env.DB_PATH);
}

module.exports = { REAL_DB, assertSnapshotPath, requireSnapshotDb };
