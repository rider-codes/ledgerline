'use strict';

/*
 * Lightweight retrieval over a user's transactions ("RAG" without a vector DB).
 * Parses structured filters from the question, narrows with SQL, then ranks the
 * remaining rows with a BM25-lite lexical score. Returns rows + a prompt block.
 */

const { db, CATEGORIES } = require('./db');
const { CAT_SYNONYMS, MONTH_NAMES, BRANDS, STOPWORDS, tokenize } = require('./vocab');
const embed = require('./embed');

const MAX_ROWS = () => Math.max(5, Math.min(120, parseInt(process.env.RAG_MAX_ROWS || '40', 10)));
const CUR = () => process.env.CURRENCY || '$';
const money = (n) => `${CUR()}${Number(n).toFixed(2)}`;

const KNOWN_CATS = new Set(CATEGORIES);

/* ---------------- filter parsing ---------------- */

function parseFilters(q, defaultMonth, userId) {
  const s = ` ${q.toLowerCase()} `;
  const f = { consumed: new Set() };

  // amount comparisons
  const num = '\\$?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)';
  let m;
  if ((m = s.match(new RegExp(`between\\s+${num}\\s+and\\s+${num}`)))) {
    f.minAmount = parseFloat(m[1].replace(/,/g, ''));
    f.maxAmount = parseFloat(m[2].replace(/,/g, ''));
    f.consumed.add('between');
    f.consumed.add('and');
  } else {
    if ((m = s.match(new RegExp(`(?:over|above|more than|greater than|at least|>=?|\\bmin(?:imum)?)\\s+${num}`)))) f.minAmount = parseFloat(m[1].replace(/,/g, ''));
    if ((m = s.match(new RegExp(`(?:under|below|less than|at most|<=?|\\bmax(?:imum)?)\\s+${num}`)))) f.maxAmount = parseFloat(m[1].replace(/,/g, ''));
    if ((m = s.match(new RegExp(`(?:exactly|of|for|around|about|~)\\s+${num}\\b`)))) {
      const v = parseFloat(m[1].replace(/,/g, ''));
      f.minAmount = v - 0.5;
      f.maxAmount = v + 0.5;
    }
  }
  (s.match(/\$?\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?/g) || []).forEach((tok) => f.consumed.add(tok.replace(/[^0-9.]/g, '')));

  // month / date window
  if (/last month|previous month|month before/.test(s) && defaultMonth) f.month = addMonths(defaultMonth, -1);
  else if (/this month|current month/.test(s) && defaultMonth) f.month = defaultMonth;
  const iso = s.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  if (iso) f.month = iso[0];
  const months = distinctMonths(userId);
  for (let i = 0; i < 12; i++) {
    if (s.includes(MONTH_NAMES[i]) || s.includes(MONTH_NAMES[i].slice(0, 3))) {
      const hit = months.filter((mm) => Number(mm.slice(5, 7)) === i + 1).sort().pop();
      if (hit) f.month = hit;
      f.consumed.add(MONTH_NAMES[i]);
      f.consumed.add(MONTH_NAMES[i].slice(0, 3));
    }
  }

  // type
  if (/\b(income|deposit|deposits|paycheck|payroll|salary|refund|credited)\b/.test(s)) f.type = 'income';
  else if (/\b(expense|expenses|charge|charges|spent|purchase|purchases|debit)\b/.test(s)) f.type = 'expense';

  // category
  for (const cat of KNOWN_CATS) {
    if (s.includes(` ${cat.toLowerCase()} `)) { f.category = cat; f.consumed.add(cat.toLowerCase()); }
  }
  if (!f.category) {
    for (const [cat, words] of Object.entries(CAT_SYNONYMS)) {
      for (const w of words) {
        if (BRANDS.has(w)) continue; // keep brand names as free search terms
        if (s.includes(` ${w} `) || s.includes(` ${w}s `)) { f.category = cat; f.consumed.add(w); break; }
      }
      if (f.category) break;
    }
  }
  return f;
}

function addMonths(ym, delta) {
  let [y, mo] = ym.split('-').map(Number);
  mo += delta;
  y += Math.floor((mo - 1) / 12);
  mo = ((mo - 1) % 12 + 12) % 12 + 1;
  return `${y}-${String(mo).padStart(2, '0')}`;
}
function distinctMonths(userId) {
  const sql = 'SELECT DISTINCT substr(date,1,7) ym FROM transactions'
    + (userId != null ? ' WHERE user_id = ?' : '')
    + ' ORDER BY ym';
  const stmt = db.prepare(sql);
  return (userId != null ? stmt.all(userId) : stmt.all()).map((r) => r.ym);
}

/* ---------------- scoring ---------------- */

function docText(r) {
  const [y, mo] = r.date.split('-');
  const mName = MONTH_NAMES[Number(mo) - 1] || '';
  return `${y} ${mName} ${r.merchant} ${r.category} ${r.note} ${Math.round(r.amount)}`;
}

function score(candidates, queryTerms) {
  if (!queryTerms.length) return candidates.map((r) => ({ r, s: 0 }));
  const docs = candidates.map((r) => ({ r, toks: tokenize(docText(r)) }));
  const N = docs.length;
  const avgdl = docs.reduce((a, d) => a + d.toks.length, 0) / (N || 1) || 1;
  const df = {};
  for (const t of queryTerms) df[t] = docs.filter((d) => d.toks.includes(t)).length;
  const k1 = 1.5;
  const b = 0.75;
  return docs.map(({ r, toks }) => {
    let sc = 0;
    for (const t of queryTerms) {
      const n = df[t];
      if (!n) continue;
      const tf = toks.filter((x) => x === t).length;
      if (!tf) {
        // partial: query term is a prefix of a doc token (AMZN vs amazon-ish handled loosely)
        if (toks.some((x) => x.startsWith(t) || t.startsWith(x))) sc += 0.4;
        continue;
      }
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      sc += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (toks.length / avgdl))));
    }
    // whole-phrase merchant bonus
    if (queryTerms.length >= 1 && r.merchant && queryTerms.every((t) => r.merchant.toLowerCase().includes(t))) sc += 2;
    return { r, s: sc };
  });
}

/* ---------------- public ---------------- */

async function retrieve(userId, query, opts = {}) {
  const k = opts.k || MAX_ROWS();
  const f = parseFilters(String(query || ''), opts.defaultMonth, userId);

  const where = ['user_id = ?'];
  const args = [userId];
  if (f.month) { where.push('substr(date,1,7) = ?'); args.push(f.month); }
  if (f.type) { where.push('type = ?'); args.push(f.type); }
  if (f.category) { where.push('category = ?'); args.push(f.category); }
  if (f.minAmount != null) { where.push('amount >= ?'); args.push(f.minAmount); }
  if (f.maxAmount != null) { where.push('amount <= ?'); args.push(f.maxAmount); }

  const candidates = db
    .prepare(`SELECT id, date, amount, type, category, merchant, note FROM transactions WHERE ${where.join(' AND ')} ORDER BY date DESC LIMIT 800`)
    .all(...args);

  if (!candidates.length) return { rows: [], filters: f, count: 0, mode: 'none' };

  // free-text terms: drop $ and numbers first, then stopwords / consumed / anything with a digit
  const cleaned = String(query).replace(/\$/g, ' ').replace(/[0-9][0-9,.]*/g, ' ');
  const qTerms = [...new Set(
    tokenize(cleaned).filter((t) => t.length >= 3 && !/\d/.test(t) && !STOPWORDS.has(t) && !f.consumed.has(t))
  )];

  let ranked;
  let mode = 'lexical';
  if (!qTerms.length) {
    // purely structured query — take the filtered rows newest-first
    ranked = candidates.slice(0, k).map((r) => ({ r, s: 1 }));
    mode = 'structured';
  } else {
    const lex = score(candidates, qTerms); // [{ r, s }]
    const maxLex = Math.max(0, ...lex.map((x) => x.s));

    let sem = null;
    if (opts.semantic !== false) {
      try { sem = await embed.semanticScores(candidates, query); } catch { sem = null; }
    }

    if (sem) {
      mode = 'hybrid';
      const w = embed.SEM_WEIGHT();
      const min = embed.SEM_MIN();
      ranked = lex
        .map(({ r, s }) => {
          const lexN = maxLex ? s / maxLex : 0;
          const semV = Math.max(0, sem.get(r.id) ?? 0);
          const qualifies = s > 0 || semV >= min;
          return { r, s: (1 - w) * lexN + w * semV, qualifies };
        })
        .filter((x) => x.qualifies)
        .sort((a, b) => b.s - a.s)
        .slice(0, k);
    } else {
      ranked = lex.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k);
    }
    // nothing matched: don't dump unrelated rows — return empty (honest)
  }

  const rows = ranked.map((x) => x.r);
  const totalSpend = rows.filter((r) => r.type === 'expense').reduce((a, r) => a + r.amount, 0);
  const totalIncome = rows.filter((r) => r.type === 'income').reduce((a, r) => a + r.amount, 0);
  return { rows, filters: f, count: rows.length, totalSpend, totalIncome, mode, truncated: candidates.length > rows.length && ranked.length === k };
}

function formatForPrompt(result) {
  if (!result.rows.length) return 'RELEVANT TRANSACTIONS: none matched this question.';
  const head = `RELEVANT TRANSACTIONS (retrieved for this question — ${result.count} rows`
    + (result.totalSpend ? `, ${money(result.totalSpend)} spent` : '')
    + (result.totalIncome ? `, ${money(result.totalIncome)} in` : '')
    + `):`;
  const lines = result.rows.map(
    (r) => `- ${r.date} | ${r.merchant || r.note || '—'} | ${r.category} | ${r.type === 'income' ? '+' : '-'}${money(r.amount)}`
  );
  if (result.truncated) lines.push('- …(more matches not shown)');
  return `${head}\n${lines.join('\n')}`;
}

// Deterministic answer for the rules backend when the question is a search.
async function searchAnswer(userId, query, opts = {}) {
  const res = await retrieve(userId, query, { ...opts, k: Math.min(20, opts.k || 20) });
  if (!res.rows.length) return `I couldn't find any transactions matching that.`;
  const parts = [];
  const bits = [];
  if (res.filters.category) bits.push(res.filters.category);
  if (res.filters.month) bits.push(res.filters.month);
  if (res.filters.minAmount != null) bits.push(`≥ ${money(res.filters.minAmount)}`);
  if (res.filters.maxAmount != null) bits.push(`≤ ${money(res.filters.maxAmount)}`);
  parts.push(`Found ${res.count} transaction(s)${bits.length ? ` (${bits.join(', ')})` : ''}${res.totalSpend ? `, ${money(res.totalSpend)} spent` : ''}${res.totalIncome ? `, ${money(res.totalIncome)} in` : ''}:`);
  res.rows.slice(0, 12).forEach((r) => parts.push(`• ${r.date} — ${r.merchant || r.note || '—'} (${r.category}) ${r.type === 'income' ? '+' : '−'}${money(r.amount)}`));
  if (res.count > 12) parts.push(`…and ${res.count - 12} more.`);
  return parts.join('\n');
}

module.exports = { retrieve, formatForPrompt, searchAnswer, parseFilters };
