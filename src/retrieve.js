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
// Rows scored per query. High enough to cover a whole account (imports are capped at 20,000 rows),
// so old transactions are ranked too; it is only a safety bound.
const MAX_CANDIDATES = () => Math.max(100, parseInt(process.env.RAG_MAX_CANDIDATES || '20000', 10) || 20000);
const CUR = () => process.env.CURRENCY || '$';
const money = (n) => `${CUR()}${Number(n).toFixed(2)}`;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CUR_SYMBOLS = () => [...new Set(['$', '₹', '€', '£', CUR()])];
const CUR_MARK = () => `(?:${CUR_SYMBOLS().map(escapeRe).join('|')}|\\brs\\.?|\\binr)?`;

// what follows a number when it is a duration, count or ordinal rather than money
const NOT_MONEY_NEXT = /^\s*(?:months?|days?|weeks?|years?|yrs?|hours?|times?|x\b|%|percent|(?:st|nd|rd|th)\b)/;

const KNOWN_CATS = new Set(CATEGORIES);
// a month's full name or 3-letter abbreviation (plus "sept"), as a whole word
const MONTH_RE = MONTH_NAMES.map((name, i) => new RegExp(`\\b(?:${name}|${name.slice(0, 3)}${i === 8 ? '|sept' : ''})\\b`));

/* ---------------- filter parsing ---------------- */

function parseFilters(q, defaultMonth, userId) {
  const s = ` ${q.toLowerCase()} `;
  const f = { consumed: new Set() };

  // amount comparisons — an optional currency marker ($, ₹, €, £, the configured symbol, "rs", "inr") then the number
  const num = `(${CUR_MARK()})\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)`;
  // First number after one of `keywords` that reads as money: not a count of time ("for 3 months",
  // "over 2 weeks"), and — for weak cues like "of"/"for" — only when written as money ("for ₹45", "of 45.50").
  const amountAfter = (keywords, { weak = false } = {}) => {
    const re = new RegExp(`(?:${keywords})\\s*${num}`, 'g');
    let hit;
    while ((hit = re.exec(s))) {
      const rest = s.slice(hit.index + hit[0].length);
      if (/^\.?\d/.test(rest) || NOT_MONEY_NEXT.test(rest)) continue;
      if (weak && !hit[1] && !hit[2].includes('.')) continue;
      return parseFloat(hit[2].replace(/,/g, ''));
    }
    return null;
  };
  let m;
  if ((m = s.match(new RegExp(`\\bbetween\\s+${num}\\s+and\\s+${num}`))) && !NOT_MONEY_NEXT.test(s.slice(m.index + m[0].length))) {
    f.minAmount = parseFloat(m[2].replace(/,/g, ''));
    f.maxAmount = parseFloat(m[4].replace(/,/g, ''));
    f.consumed.add('between');
    f.consumed.add('and');
  } else {
    const min = amountAfter('\\b(?:over|above|more than|greater than|at least|min(?:imum)?)\\s|>=?');
    const max = amountAfter('\\b(?:under|below|less than|at most|max(?:imum)?)\\s|<=?');
    const exact = amountAfter('\\b(?:exactly|around|about)\\s|~') ?? amountAfter('\\b(?:of|for)\\s', { weak: true });
    if (min != null) f.minAmount = min;
    if (max != null) f.maxAmount = max;
    if (exact != null) {
      f.minAmount = exact - 0.5;
      f.maxAmount = exact + 0.5;
    }
  }
  (s.match(/[0-9][0-9,]*(?:\.[0-9]{1,2})?/g) || []).forEach((tok) => f.consumed.add(tok.replace(/[^0-9.]/g, '')));

  // month / date window
  if (/last month|previous month|month before/.test(s) && defaultMonth) f.month = addMonths(defaultMonth, -1);
  else if (/this month|current month/.test(s) && defaultMonth) f.month = defaultMonth;
  const iso = s.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  if (iso) f.month = iso[0];
  const months = distinctMonths(userId);
  for (let i = 0; i < 12; i++) {
    // whole words only: "doctor" is not October and "supermarket" is not March
    if (MONTH_RE[i].test(s)) {
      const hit = months.filter((mm) => Number(mm.slice(5, 7)) === i + 1).sort().pop();
      if (hit) f.month = hit;
      f.consumed.add(MONTH_NAMES[i]);
      f.consumed.add(MONTH_NAMES[i].slice(0, 3));
    }
  }

  // type
  if (/\b(income|deposit|deposits|paycheck|payroll|salary|refund|credited)\b/.test(s)) f.type = 'income';
  else if (/\b(expense|expenses|charge|charges|spent|purchase|purchases|debit)\b/.test(s)) f.type = 'expense';

  // category — matched on a words-only view of the question, so "dining?" and "dining," still count
  const words = ` ${q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  for (const cat of KNOWN_CATS) {
    if (words.includes(` ${cat.toLowerCase()} `)) { f.category = cat; f.consumed.add(cat.toLowerCase()); }
  }
  if (!f.category) {
    for (const [cat, syns] of Object.entries(CAT_SYNONYMS)) {
      for (const w of syns) {
        if (BRANDS.has(w)) continue; // keep brand names as free search terms
        if (words.includes(` ${w} `) || words.includes(` ${w}s `)) { f.category = cat; f.consumed.add(w); break; }
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

const MODES = ['auto', 'lexical', 'semantic', 'hybrid'];

/**
 * retrieve(userId, query, opts)
 *
 * opts.k            rows to return (default RAG_MAX_ROWS)
 * opts.defaultMonth YYYY-MM that "this month"/"last month" resolve against
 * opts.mode         'auto'     (default) the app's own logic: structured if no free-text terms,
 *                              else hybrid when embeddings work, else lexical
 *                   'lexical'  SQL filters + BM25-lite only (never touches embeddings)
 *                   'semantic' SQL filters + cosine only; rows below semMin are dropped
 *                   'hybrid'   SQL filters + (1-weight)*lexical + weight*cosine, always embeds
 *                   (opts.semantic === false is the legacy spelling of 'lexical')
 * opts.weight       semantic weight for 'hybrid' (default RAG_SEMANTIC_WEIGHT)
 * opts.semMin       cosine cut-off (default RAG_SEMANTIC_MIN)
 * opts.evalMode     never write embeddings; throw if semantic search is needed but fails or
 *                   any candidate lacks a current vector (no silent keyword-only fallback)
 *
 * Legacy result fields are unchanged. Added: requestedMode, scores[], matchCount,
 * sqlTotals, candidateCount, qualifiedCount, truncatedCandidates, semantic, params.
 * Note `totalSpend`/`totalIncome` are sums over the *returned* rows; `sqlTotals` is the
 * true total over every row passing the structured filters.
 */
async function retrieve(userId, query, opts = {}) {
  const k = opts.k || MAX_ROWS();
  const requested = opts.mode || (opts.semantic === false ? 'lexical' : 'auto');
  if (!MODES.includes(requested)) throw new Error(`unknown retrieval mode "${requested}" (expected ${MODES.join('|')})`);
  const evalMode = !!opts.evalMode;
  const weight = opts.weight != null ? Math.max(0, Math.min(1, Number(opts.weight))) : embed.SEM_WEIGHT();
  const semMin = opts.semMin != null ? Number(opts.semMin) : embed.SEM_MIN();
  const f = parseFilters(String(query || ''), opts.defaultMonth, userId);

  const where = ['user_id = ?'];
  const args = [userId];
  if (f.month) { where.push('substr(date,1,7) = ?'); args.push(f.month); }
  if (f.type) { where.push('type = ?'); args.push(f.type); }
  if (f.category) { where.push('category = ?'); args.push(f.category); }
  if (f.minAmount != null) { where.push('amount >= ?'); args.push(f.minAmount); }
  if (f.maxAmount != null) { where.push('amount <= ?'); args.push(f.maxAmount); }

  // ground truth for the structured filters, uncapped (the candidate list below is capped)
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS spend,
              COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS income
       FROM transactions WHERE ${where.join(' AND ')}`
    )
    .get(...args);
  const sqlTotals = { count: agg.n, spend: agg.spend, income: agg.income };

  const candidates = db
    .prepare(`SELECT id, date, amount, type, category, merchant, note FROM transactions WHERE ${where.join(' AND ')} ORDER BY date DESC LIMIT ?`)
    .all(...args, MAX_CANDIDATES());

  const semantic = { requested: false, used: false, error: null };
  const meta = {
    requestedMode: requested, k, params: { weight, semMin }, matchCount: agg.n, sqlTotals,
    candidateCount: candidates.length, truncatedCandidates: agg.n > candidates.length, semantic,
  };
  // eval diagnostics only: which rows survived the SQL filters (and the candidate bound)
  if (evalMode) meta.candidateIds = candidates.map((r) => r.id);

  if (!candidates.length) {
    return { rows: [], scores: [], filters: f, count: 0, mode: 'none', qualifiedCount: 0, matched: { count: 0, spend: 0, income: 0 }, ...meta };
  }

  // free-text terms: drop $ and numbers first, then stopwords / consumed / anything with a digit
  const cleaned = CUR_SYMBOLS().reduce((t, sym) => t.split(sym).join(' '), String(query)).replace(/[0-9][0-9,.]*/g, ' ');
  const qTerms = [...new Set(
    tokenize(cleaned).filter((t) => t.length >= 3 && !/\d/.test(t) && !STOPWORDS.has(t) && !f.consumed.has(t))
  )];

  // every ranked entry: { r, s (final), lex (raw BM25-lite|null), lexN, sem (cosine|null) }
  let qualified;
  let mode = 'lexical';
  const structuredPath = !qTerms.length && (requested === 'auto' || requested === 'lexical');
  if (structuredPath) {
    // purely structured query — take the filtered rows newest-first
    qualified = candidates.map((r) => ({ r, s: 1, lex: null, lexN: null, sem: null, structured: true }));
    mode = 'structured';
  } else {
    const lex = score(candidates, qTerms); // [{ r, s }]
    const maxLex = Math.max(0, ...lex.map((x) => x.s));
    const lexOnly = () => lex.filter((x) => x.s > 0)
      .map(({ r, s }) => ({ r, s, lex: s, lexN: maxLex ? s / maxLex : 0, sem: null }))
      .sort((a, b) => b.s - a.s);

    // does this request want embeddings? 'auto' only asks when there are free-text terms
    const wantSemantic = requested === 'semantic' || requested === 'hybrid' || (requested === 'auto' && qTerms.length > 0);
    // in evalMode an explicit semantic/hybrid request must succeed; 'auto' must succeed only when embeddings are enabled
    const strict = evalMode && (requested !== 'auto' || embed.enabled());
    semantic.requested = wantSemantic;
    let sem = null;
    if (wantSemantic) {
      try {
        sem = await embed.semanticScores(candidates, query, evalMode ? { readOnly: true, strict } : undefined);
      } catch (e) {
        if (strict) throw e;
        semantic.error = e.message;
        sem = null;
      }
      if (!sem && !semantic.error) semantic.error = 'semantic scores unavailable (embeddings disabled or unreachable)';
    }

    if (sem && requested === 'semantic') {
      mode = 'semantic';
      semantic.used = true;
      qualified = lex
        .map(({ r, s }) => {
          const semV = Math.max(0, sem.get(r.id) ?? 0);
          return { r, s: semV, lex: s, lexN: maxLex ? s / maxLex : 0, sem: semV };
        })
        .filter((x) => x.sem >= semMin)
        .sort((a, b) => b.s - a.s);
    } else if (sem) {
      mode = 'hybrid';
      semantic.used = true;
      qualified = lex
        .map(({ r, s }) => {
          const lexN = maxLex ? s / maxLex : 0;
          const semV = Math.max(0, sem.get(r.id) ?? 0);
          const qualifies = s > 0 || semV >= semMin;
          return { r, s: (1 - weight) * lexN + weight * semV, lex: s, lexN, sem: semV, qualifies };
        })
        .filter((x) => x.qualifies)
        .sort((a, b) => b.s - a.s);
    } else if (!qTerms.length) {
      // semantic/hybrid requested, embeddings unavailable (non-eval only), and nothing lexical to rank on
      qualified = candidates.map((r) => ({ r, s: 1, lex: null, lexN: null, sem: null, structured: true }));
      mode = 'structured';
    } else {
      qualified = lexOnly();
    }
    // nothing matched: don't dump unrelated rows — return empty (honest)
  }

  const ranked = qualified.slice(0, k);
  const rows = ranked.map((x) => x.r);
  const scores = ranked.map((x) => ({
    id: x.r.id,
    final: x.structured ? null : x.s,
    lex: x.lex, lexN: x.lexN, sem: x.sem,
  }));
  const totalSpend = rows.filter((r) => r.type === 'expense').reduce((a, r) => a + r.amount, 0);
  const totalIncome = rows.filter((r) => r.type === 'income').reduce((a, r) => a + r.amount, 0);
  // Every row that matched, not just the k returned. When the filters alone decide the match, the
  // SQL aggregate is exact; otherwise sum over all rows that qualified.
  const sumQualified = (type) => qualified.reduce((a, x) => (x.r.type === type ? a + x.r.amount : a), 0);
  const matched = mode === 'structured'
    ? { count: sqlTotals.count, spend: sqlTotals.spend, income: sqlTotals.income }
    : { count: qualified.length, spend: sumQualified('expense'), income: sumQualified('income') };
  return {
    rows, scores, filters: f, count: rows.length, totalSpend, totalIncome, matched, mode,
    truncated: matched.count > rows.length,
    qualifiedCount: qualified.length,
    ...meta,
  };
}

// Compact, JSON-safe description of a retrieve() result for traces and eval logs.
function summarizeRetrieval(res) {
  return {
    requestedMode: res.requestedMode, mode: res.mode, k: res.k, params: res.params,
    filters: { ...res.filters, consumed: [...res.filters.consumed].sort() },
    rowIds: res.rows.map((r) => r.id),
    scores: res.scores,
    shown: { count: res.count, spend: res.totalSpend ?? 0, income: res.totalIncome ?? 0 },
    matched: res.matched,
    matchCount: res.matchCount, sqlTotals: res.sqlTotals,
    candidateCount: res.candidateCount, qualifiedCount: res.qualifiedCount,
    truncatedCandidates: res.truncatedCandidates, truncated: res.truncated ?? false,
    semantic: res.semantic,
  };
}

function formatForPrompt(result) {
  if (!result.rows.length) return 'RELEVANT TRANSACTIONS: none matched this question.';
  // counts and totals cover every matching transaction, not only the rows listed below
  const m = result.matched;
  const more = m.count - result.rows.length;
  const head = `RELEVANT TRANSACTIONS (retrieved for this question — ${m.count} matched`
    + (more > 0 ? `, the ${result.rows.length} most relevant listed` : '')
    + (m.spend ? `, ${money(m.spend)} spent in total` : '')
    + (m.income ? `, ${money(m.income)} in in total` : '')
    + `):`;
  const lines = result.rows.map(
    (r) => `- ${r.date} | ${r.merchant || r.note || '—'} | ${r.category} | ${r.type === 'income' ? '+' : '-'}${money(r.amount)}`
  );
  if (more > 0) lines.push(`- …(${more} more matches not listed; the totals above include them)`);
  return `${head}\n${lines.join('\n')}`;
}

// Deterministic answer for the rules backend when the question is a search.
async function searchAnswer(userId, query, opts = {}) {
  const { trace, ...retrieveOpts } = opts;
  const res = await retrieve(userId, query, { ...retrieveOpts, k: Math.min(20, opts.k || 20) });
  if (trace) trace.retrieval = summarizeRetrieval(res);
  if (!res.rows.length) return `I couldn't find any transactions matching that.`;
  const parts = [];
  const bits = [];
  if (res.filters.category) bits.push(res.filters.category);
  if (res.filters.month) bits.push(res.filters.month);
  if (res.filters.minAmount != null) bits.push(`≥ ${money(res.filters.minAmount)}`);
  if (res.filters.maxAmount != null) bits.push(`≤ ${money(res.filters.maxAmount)}`);
  // count and totals cover every match; only the first 12 rows are listed
  const m = res.matched;
  parts.push(`Found ${m.count} transaction(s)${bits.length ? ` (${bits.join(', ')})` : ''}${m.spend ? `, ${money(m.spend)} spent` : ''}${m.income ? `, ${money(m.income)} in` : ''}:`);
  res.rows.slice(0, 12).forEach((r) => parts.push(`• ${r.date} — ${r.merchant || r.note || '—'} (${r.category}) ${r.type === 'income' ? '+' : '−'}${money(r.amount)}`));
  if (m.count > 12) parts.push(`…and ${m.count - 12} more.`);
  return parts.join('\n');
}

module.exports = { retrieve, formatForPrompt, searchAnswer, parseFilters, summarizeRetrieval, MODES };
