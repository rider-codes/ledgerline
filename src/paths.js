'use strict';

// Where runtime data lives: the SQLite DB (+ WAL/SHM) and the generated session secret.
// DATA_DIR defaults to ./data; in production point it at a persistent disk (e.g. /var/data on Render),
// otherwise every redeploy starts with an empty database. No side effects here, so eval/lib/guard.js
// can use it without opening the database.

const path = require('node:path');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const DEFAULT_DB_PATH = path.join(DATA_DIR, 'finance.db');
const SESSION_SECRET_FILE = path.join(DATA_DIR, '.session-secret');

module.exports = { DATA_DIR, DEFAULT_DB_PATH, SESSION_SECRET_FILE };
