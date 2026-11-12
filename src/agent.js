'use strict';

const { db, CATEGORIES } = require('./db');
const A = require('./analytics');
const { CAT_SYNONYMS, MONTH_NAMES, BRANDS } = require('./vocab');
const { retrieve, formatForPrompt, searchAnswer, summarizeRetrieval, parseFilters } = require('./retrieve');

const CURRENCY = () => process.env.CURRENCY || '$';
const fmt = (n) => `${CURRENCY()}${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmt2 = (n) => `${CURRENCY()}${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SYSTEM_PROMPT = `You are the assistant inside "Ledgerline", a personal finance tracker.
You are given a summary of ONE user's own transaction data. Answer only from that data.
When asked where spending was high or low, name the specific months and categories and cite the numbers.
When asked where to save, give concrete, quantified suggestions grounded in the user's actual spending
(e.g. "cut delivery from 9 orders to 4 -> about $57/month, ~$685/year"). Prefer discretionary categories
(Dining, Shopping, Subscriptions, Entertainment) and never suggest cutting rent, utilities, or health.
Copy totals, percentages and counts exactly as they appear in the data. Never recompute a month or
category total yourself and never relabel one figure as another (net savings is not a category).
If the data does not contain a number you need, say so instead of estimating it.
Be concise and specific. Use the user's currency symbol. Do NOT give investment advice.`;

/* ------------------------------------------------------------------ *
 * Backend 1: deterministic rule-based analysis (default, no deps)
 * ------------------------------------------------------------------ */

const DISCRETIONARY = ['Dining', 'Shopping', 'Subscriptions', 'Entertainment', 'Travel'];

function findCategory(q) {
  const s = ` ${q} `;
  for (const cat of CATEGORIES) {
    const c = cat.toLowerCase();
    if (s.includes(` ${c} `) || s.includes(` ${c}s `) || s.includes(` ${c},`) || s.includes(` ${c}?`)) return cat;
  }
  for (const [cat, words] of Object.entries(CAT_SYNONYMS)) {
    for (const w of words) {
      if (BRANDS.has(w)) continue; // a brand ("uber") names a merchant, not its whole category
      if (s.includes(` ${w} `) || s.includes(` ${w}s `) || s.includes(` ${w},`) || s.includes(` ${w}?`)) return cat;
    }
  }
  return null;
}

// Months the question names, resolved the same way the retriever resolves them (years honoured,
// and a month with no data kept as itself rather than swapped for another month).
function namedMonths(userId, q) {
  return parseFilters(q, A.defaultMonth(userId), userId).months || [];
}

function findMonth(userId, q) {
  const named = namedMonths(userId, q);
  return named.length ? named[0] : A.defaultMonth(userId);
}

// Month names in the order they appear in the question, resolved to YYYY-MM.
function monthsInQuery(userId, q) {
  const months = A.listMonths(userId);
  const hits = [];
  const re = /\b(january|february|march|april|may|june|july|august|september|october|november|december|20\d{2}-(?:0[1-9]|1[0-2]))\b/g;
  let m;
  while ((m = re.exec(q))) {
    const tok = m[1];
    if (/^\d/.test(tok)) { if (months.includes(tok)) hits.push(tok); continue; }
    const idx = MONTH_NAMES.indexOf(tok);
    const ym = months.filter((x) => Number(x.slice(5, 7)) === idx + 1).sort().pop();
    if (ym) hits.push(ym);
  }
  return hits;
}

function findMerchant(userId, q) {
  const rows = db
    .prepare(`SELECT merchant, COUNT(*) c FROM transactions WHERE user_id = ? AND merchant <> '' GROUP BY merchant`)
    .all(userId);
  // a full merchant name beats a match on its first word ("uber" -> "Uber", not "Uber Eats");
  // ties go to the longer name
  const hasWord = (w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(q);
  let best = null;
  let bestScore = 0;
  for (const r of rows) {
    const m = r.merchant.toLowerCase();
    const head = m.split(/\s|—|-/)[0];
    const score = m.length >= 4 && hasWord(m) ? 2 : head.length >= 4 && hasWord(head) ? 1 : 0;
    if (score && (score > bestScore || (score === bestScore && r.merchant.length > best.length))) {
      best = r.merchant;
      bestScore = score;
    }
  }
  return best;
}

// "at Tesla" / "from Tesla" naming a place that is not one of the user's merchants -> "Tesla"
const NOT_A_PLACE = new Set(['least', 'most', 'all', 'once', 'home', 'work', 'the moment', 'this point', 'this rate']);
function unknownPlace(q, merchant) {
  if (merchant) return null;
  const m = q.match(/\b(?:at|from)\s+(?:the\s+)?([a-z0-9][a-z0-9'&.\- ]{1,40}?)(?=\s+(?:in|on|during|for|this|last|since|over|under|between|and)\b|[?.,!]|\s*$)/);
  if (!m || NOT_A_PLACE.has(m[1].trim())) return null;
  return m[1].trim().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function trendLine(userId, category, endMonth) {
  const parts = [];
  for (let i = 3; i >= 0; i--) {
    const ym = A.addMonths(endMonth, -i);
    const amt = db
      .prepare(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE user_id=? AND category=? AND substr(date,1,7)=?`)
      .get(userId, category, ym).s;
    parts.push(`${A.monthLabel(ym).split(' ')[0]} ${fmt(amt)}`);
  }
  return parts.join(' → ');
}

function answerCategory(userId, category, month) {
  const cats = A.categoryBreakdown(userId, month);
  const c = cats.find((x) => x.category === category);
  const label = A.monthLabel(month);
  if (!c) return `You had no ${category} spending in ${label}.`;
  const topM = db
    .prepare(
      `SELECT merchant, ROUND(SUM(amount),2) amt, COUNT(*) n FROM transactions
       WHERE user_id=? AND category=? AND substr(date,1,7)=? AND merchant<>''
       GROUP BY merchant ORDER BY amt DESC LIMIT 3`
    )
    .all(userId, category, month);
  const parts = [
    `${category} in ${label}: ${fmt2(c.amount)} across ${c.count} transactions — ${c.pct}% of the month's spending.`,
  ];
  if (c.avg3) {
    const d = Math.round(((c.amount - c.avg3) / c.avg3) * 100);
    parts.push(`That's ${d >= 0 ? '+' : ''}${d}% vs your 3-month average of ${fmt(c.avg3)}${c.spike ? ' — running hot.' : '.'}`);
  }
  if (topM.length) parts.push(`Top: ${topM.map((m) => `${m.merchant} ${fmt2(m.amt)} (${m.n})`).join(', ')}.`);
  parts.push(`Last 4 months: ${trendLine(userId, category, month)}.`);
  return parts.join('\n');
}

function answerMerchant(userId, merchant, month) {
  const all = db
    .prepare(
      `SELECT ROUND(SUM(amount),2) total, COUNT(*) n, ROUND(AVG(amount),2) avg, MAX(category) cat, MIN(date) first, MAX(date) last
       FROM transactions WHERE user_id=? AND merchant=?`
    )
    .get(userId, merchant);
  const inMonth = db
    .prepare(`SELECT ROUND(SUM(amount),2) total, COUNT(*) n FROM transactions WHERE user_id=? AND merchant=? AND substr(date,1,7)=?`)
    .get(userId, merchant, month);
  const parts = [
    `${merchant} (${all.cat}): ${fmt2(all.total)} total across ${all.n} charges since ${all.first}, averaging ${fmt2(all.avg)} each.`,
  ];
  if (inMonth.n) parts.push(`In ${A.monthLabel(month)}: ${fmt2(inMonth.total)} over ${inMonth.n} charge(s).`);
  else parts.push(`Nothing from them in ${A.monthLabel(month)} (last seen ${all.last}).`);
  return parts.join('\n');
}

// Largest expenses in a month, narrowed to the category or merchant the question names.
function answerBiggest(userId, month, { category, merchant } = {}) {
  const where = ["user_id=?", "type='expense'", 'substr(date,1,7)=?'];
  const args = [userId, month];
  if (merchant) { where.push('merchant=?'); args.push(merchant); }
  else if (category) { where.push('category=?'); args.push(category); }
  const rows = db
    .prepare(`SELECT date, merchant, category, amount FROM transactions WHERE ${where.join(' AND ')} ORDER BY amount DESC LIMIT 5`)
    .all(...args);
  const scope = merchant ? `${merchant} ` : category ? `${category} ` : '';
  if (!rows.length) return `No ${scope}expenses recorded in ${A.monthLabel(month)}.`;
  const parts = [`Biggest ${scope}expenses in ${A.monthLabel(month)}:`];
  rows.forEach((r, i) => parts.push(`${i + 1}. ${fmt2(r.amount)} — ${r.merchant || r.category} (${r.category}, ${r.date})`));
  return parts.join('\n');
}

function answerIncome(userId, month) {
  const t = A.monthTotals(userId, month);
  const src = db
    .prepare(
      `SELECT merchant, ROUND(SUM(amount),2) amt, COUNT(*) n FROM transactions
       WHERE user_id=? AND type='income' AND substr(date,1,7)=? GROUP BY merchant ORDER BY amt DESC`
    )
    .all(userId, month);
  const parts = [`Income in ${t.label}: ${fmt2(t.income)}.`];
  if (src.length) parts.push(src.map((s) => `• ${s.merchant || 'Deposit'}: ${fmt2(s.amt)} (${s.n})`).join('\n'));
  parts.push(`After ${fmt2(t.spend)} of spending, you kept ${fmt2(t.net)}.`);
  return parts.join('\n');
}

function answerSavings(userId, month) {
  const totals = A.monthlyTotals(userId, 4, month);
  const cur = totals[totals.length - 1];
  const parts = [
    `In ${cur.label} you saved ${fmt2(cur.net)} — a ${cur.income ? Math.round((cur.net / cur.income) * 100) : 0}% savings rate on ${fmt2(cur.income)} of income.`,
    'Recent months (spend / income / net):',
    ...totals.map((t) => `• ${t.label}: ${fmt(t.spend)} / ${fmt(t.income)} / ${fmt(t.net)}`),
  ];
  return parts.join('\n');
}

function answerTotal(userId, month) {
  const cur = A.monthTotals(userId, month);
  const prev = A.monthTotals(userId, A.addMonths(month, -1));
  const d = prev.spend ? Math.round(((cur.spend - prev.spend) / prev.spend) * 100) : null;
  const parts = [
    `You spent ${fmt2(cur.spend)} in ${cur.label}${d != null ? ` — ${d >= 0 ? '+' : ''}${d}% vs ${prev.label} (${fmt2(prev.spend)})` : ''}.`,
  ];
  const cats = A.categoryBreakdown(userId, month).slice(0, 4);
  parts.push(`Where it went: ${cats.map((c) => `${c.category} ${fmt(c.amount)}`).join(', ')}.`);
  return parts.join('\n');
}

function subscriptionRows(userId) {
  return db
    .prepare(
      `SELECT merchant, COUNT(*) AS months, ROUND(AVG(amount),2) AS avg, ROUND(SUM(amount),2) AS total,
              MAX(date) AS last_seen
       FROM transactions
       WHERE user_id = ? AND category = 'Subscriptions'
       GROUP BY merchant ORDER BY total DESC`
    )
    .all(userId);
}

function answerOverspend(userId, month) {
  const cats = A.categoryBreakdown(userId, month);
  const label = A.monthLabel(month);
  const spikes = cats.filter(
    (c) => c.spike || (c.deltaPct != null && c.deltaPct >= 25 && c.amount >= 120 && (!c.avg3 || c.amount > c.avg3 * 1.15))
  );
  if (!spikes.length) {
    const top = cats.slice(0, 3).map((c) => `${c.category} ${fmt(c.amount)} (${c.pct}%)`).join(', ');
    return `Nothing really ran hot in ${label}. Your biggest categories were ${top}. Every category was within ~20% of its recent average.`;
  }
  const parts = [`In ${label}, these ran above your recent average:`];
  for (const c of spikes.slice(0, 3)) {
    const m = A.topMerchants(userId, month, 20).filter((x) => x.category === c.category)[0];
    const vs = c.avg3 ? ` vs a 3-month average of ${fmt(c.avg3)}` : '';
    const driver = m ? ` The biggest driver was ${m.merchant} at ${fmt2(m.amount)} across ${m.count} charges.` : '';
    parts.push(`• ${c.category} — ${fmt2(c.amount)}${vs}${c.deltaPct != null ? `, ${c.deltaPct > 0 ? '+' : ''}${c.deltaPct}% vs last month` : ''}.${driver}`);
  }
  return parts.join('\n');
}

function answerSave(userId, month) {
  const cats = A.categoryBreakdown(userId, month);
  const label = A.monthLabel(month);
  const ideas = [];
  for (const cat of DISCRETIONARY) {
    const c = cats.find((x) => x.category === cat);
    if (!c || c.amount < 60) continue;
    // aim for the lower of "your recent 3-month average" and a 25% trim — never suggest cutting more than 40%
    const floor = c.amount * 0.6;
    const target = c.avg3 && c.avg3 > floor && c.avg3 < c.amount ? c.avg3 : Math.max(floor, c.amount * 0.75);
    const monthly = c.amount - target;
    if (monthly < 15) continue;
    ideas.push({ cat, monthly, yearly: monthly * 12, from: c.amount, to: target });
  }
  ideas.sort((a, b) => b.monthly - a.monthly);
  if (!ideas.length) {
    return `Your discretionary spending in ${label} is already lean — nothing jumps out as an easy cut.`;
  }
  const parts = [`Best opportunities from ${label}, biggest first:`];
  let totM = 0;
  for (const i of ideas.slice(0, 3)) {
    totM += i.monthly;
    parts.push(`• ${i.cat}: bring ${fmt(i.from)} down toward ${fmt(i.to)} → about ${fmt(i.monthly)}/month, ~${fmt(i.yearly)}/year.`);
  }
  parts.push('', `Together that's roughly ${fmt(totM)}/month, about ${fmt(totM * 12)}/year — without touching rent, utilities, or health.`);
  return parts.join('\n');
}

function answerCompare(userId, month, otherMonth) {
  const cur = A.monthTotals(userId, month);
  const prevYm = otherMonth || A.addMonths(month, -1);
  const prev = A.monthTotals(userId, prevYm);
  const curMap = Object.fromEntries(A.categoryBreakdown(userId, month).map((c) => [c.category, c.amount]));
  const prevMap = Object.fromEntries(A.categoryBreakdown(userId, prevYm).map((c) => [c.category, c.amount]));
  const movers = [...new Set([...Object.keys(curMap), ...Object.keys(prevMap)])]
    .map((cat) => ({ cat, delta: (curMap[cat] || 0) - (prevMap[cat] || 0), from: prevMap[cat] || 0, to: curMap[cat] || 0 }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);
  const parts = [
    `${cur.label} vs ${prev.label}:`,
    `• Spending: ${fmt2(cur.spend)} vs ${fmt2(prev.spend)} (${prev.spend ? (cur.spend >= prev.spend ? '+' : '') + Math.round(((cur.spend - prev.spend) / prev.spend) * 100) + '%' : 'n/a'}).`,
    `• Net: ${fmt2(cur.net)} vs ${fmt2(prev.net)}.`,
    'Biggest category moves:',
    ...movers.map((c) => `• ${c.cat}: ${c.delta >= 0 ? '+' : ''}${fmt2(c.delta)} (${fmt(c.from)} → ${fmt(c.to)})`),
  ];
  return parts.join('\n');
}

function answerSubscriptions(userId) {
  const subs = subscriptionRows(userId);
  if (!subs.length) return `I don't see anything categorized as a subscription yet.`;
  const annual = subs.reduce((s, r) => s + r.avg * 12, 0);
  const parts = [`You have ${subs.length} recurring charges, about ${fmt(annual)}/year all together:`];
  for (const s of subs) parts.push(`• ${s.merchant}: ~${fmt2(s.avg)}/charge → ~${fmt(s.avg * 12)}/year (last seen ${s.last_seen})`);
  const smallest = [...subs].sort((a, b) => a.avg - b.avg).slice(0, 2).map((s) => s.merchant);
  parts.push('', `Lowest-value to review first: ${smallest.join(' and ')}. Cancelling both would save about ${fmt(subs.filter((s) => smallest.includes(s.merchant)).reduce((x, s) => x + s.avg * 12, 0))}/year.`);
  return parts.join('\n');
}

function answerOverview(userId, month) {
  const k = A.kpis(userId, month);
  const cats = A.categoryBreakdown(userId, month);
  const top = cats.slice(0, 3).map((c) => `${c.category} ${fmt(c.amount)} (${c.pct}%)`).join(', ');
  const spike = cats.find((c) => c.spike);
  const parts = [
    `In ${k.label} you spent ${fmt2(k.spend)} against ${fmt2(k.income)} of income — you kept ${k.savingsRate}%.`,
    `Top categories: ${top}.`,
  ];
  if (spike) parts.push(`${spike.category} looks high at ${fmt(spike.amount)} (3-mo avg ${fmt(spike.avg3)}).`);
  parts.push('Ask me "where can I save?" or "compare to last month" for more.');
  return parts.join('\n');
}

// ctx (all optional): { trace, retrieval, evalMode } — see askStream.
async function viaRules(userId, summary, message, ctx = {}) {
  const q = ` ${String(message || '').toLowerCase().replace(/[^\w\s%$?,.-]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const month = findMonth(userId, q);
  const category = findCategory(q);
  const merchant = findMerchant(userId, q);
  const place = category ? null : unknownPlace(q, merchant);
  // record which handler answered, so an eval can tell "retrieval question" from "analytics question"
  const done = (route, text) => {
    if (ctx.trace) Object.assign(ctx.trace, { route, month, category, merchant });
    return text;
  };

  // the question names one month and nothing is recorded for it: say so instead of answering for another month
  const named = namedMonths(userId, q);
  if (named.length === 1 && !A.listMonths(userId).includes(named[0])) {
    return done('no-data', `I don't see any transactions in ${A.monthLabel(named[0])}.`);
  }

  // explicit intents first
  if (/(savings? rate|saving enough|am i saving|how.?s my saving|left ?over|surplus|net income|how much (do|did|am) i (save|saving|keep))/.test(q)) return done('savings', answerSavings(userId, month));
  if (/(where can i save|save money|cut back|cut down|reduce (my )?spend|trim|spend less|help me save|save on|tighten)/.test(q)) return done('save', answerSave(userId, month));
  if (/(overspend|over-?spent|over spend|too much|spik|blew|splurg|worst|ran hot|went over)/.test(q)) return done('overspend', answerOverspend(userId, month));
  if (/(subscription|recurring charge|unused|streaming service|memberships?)/.test(q)) return done('subscriptions', answerSubscriptions(userId));
  if (/(biggest|largest|most expensive|priciest|top (purchase|expense|transaction)|single (biggest|largest))/.test(q)) {
    if (place) return done('no-merchant', `I don't see any transactions at ${place}.`);
    return done('biggest', answerBiggest(userId, month, { category, merchant }));
  }
  if (/(income|salary|paycheck|paychecks|get paid|\bearn|made this|how much.*made|deposits?)/.test(q)) return done('income', answerIncome(userId, month));
  if (/(compare|\bvs\b|versus|month.*to.*month|to last month|against last)/.test(q)) {
    const mm = monthsInQuery(userId, q);
    if (mm.length >= 2) return done('compare', answerCompare(userId, mm[0], mm[1]));
    return done('compare', answerCompare(userId, month));
  }

  // transaction search (retrieval): "show me / list / find ...", explicit amount windows,
  // or "my <thing> purchases/charges/orders/runs/trips/visits"
  if (
    /(show me|list |find |look up|search for|which (transaction|charge|purchase|one)|every (charge|purchase|transaction|time)|transactions? (over|under|above|below|with|for|from)|charges? (over|under|above|below|with))/.test(q) ||
    (/(over|under|above|below|between|more than|less than)\s+\$?\d/.test(q) && /(transaction|charge|purchase|spent|bought|paid)/.test(q)) ||
    /\b(purchases|charges|orders|runs|trips|visits)\b/.test(q)
  ) {
    const text = await searchAnswer(userId, message, {
      defaultMonth: A.defaultMonth(userId), ...ctx.retrieval, evalMode: !!ctx.evalMode, trace: ctx.trace,
    });
    return done('search', text);
  }

  // "spend on <topic>" where the topic is not one category or merchant ("street food and sweets",
  // "chai and snacks"): search for matching rows instead of answering with the month's overall total
  // or with one merchant that covers only part of the topic
  const topic = spendTopic(q);
  if (topic && !place) {
    const cats = new Set(topic.map((t) => findCategory(t)));
    const oneCategory = cats.size === 1 && !cats.has(null) && !merchant;
    const covered = topic.length === 1 ? Boolean(category || merchant) : oneCategory;
    if (!covered) return done('topic', await topicAnswer(userId, message, topic, ctx));
  }

  // entity-driven
  if (merchant && /(spend|spent|cost|how much|paid|charge|at |on )/.test(q)) return done('merchant', answerMerchant(userId, merchant, month));
  if (category) return done('category', answerCategory(userId, category, month));
  if (merchant) return done('merchant', answerMerchant(userId, merchant, month));
  if (place) return done('no-merchant', `I don't see any transactions at ${place}.`);
  if (/(total|how much did i spend|how much have i spent|spending this|spend this|spent in|what did i spend)/.test(q)) return done('total', answerTotal(userId, month));

  return done('fallback', fallback(userId, month));
}

// The thing after "spend/spent/spending/paid on|for", split on "and" / "," / "&" / "+".
// Returns null when there is none or it only names everything ("on everything", "on stuff").
const TOPIC_STOP = /\s+(?:in|during|this|last|since|over|under|between|from|so|per|each|every)\b|[?.!]|\s*$/;
const NOT_A_TOPIC = new Set(['everything', 'anything', 'stuff', 'things', 'all', 'average', 'total', 'it', 'that', 'this']);
function spendTopic(q) {
  const m = q.match(/\b(?:spen[dt]|spending|paid|pay)\s+(?:on|for)\s+(.*)$/);
  if (!m) return null;
  const raw = m[1].split(TOPIC_STOP)[0].replace(/^(?:my|the|our)\s+/, '').trim();
  if (!raw || NOT_A_TOPIC.has(raw)) return null;
  const parts = raw.split(/\s*(?:,|&|\+|\band\b)\s*/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : null;
}

// Spending on a free-text topic. A total is stated only when every matching row fits in the
// result; when retrieval matches more than that, the match set is too loose to sum honestly,
// so list the closest rows and say why there is no total.
const TOPIC_K = 20;
async function topicAnswer(userId, message, topic, ctx) {
  const res = await retrieve(userId, message, {
    defaultMonth: A.defaultMonth(userId), ...ctx.retrieval, k: TOPIC_K, evalMode: !!ctx.evalMode,
  });
  if (ctx.trace) ctx.trace.retrieval = summarizeRetrieval(res);
  const label = topic.join(' and ');
  const rows = res.rows.filter((r) => r.type === 'expense');
  if (!rows.length) return `I couldn't find any spending on ${label}.`;
  const line = (r) => `• ${r.date} — ${r.merchant || r.note || '—'} (${r.category}) ${fmt2(r.amount)}`;
  const m = res.matched;
  if (m.count <= TOPIC_K) {
    return [`Spending on ${label}: ${fmt2(m.spend)} across ${rows.length} transaction(s):`, ...rows.slice(0, 12).map(line),
      ...(rows.length > 12 ? [`…and ${rows.length - 12} more.`] : [])].join('\n');
  }
  return [
    `I can't give a reliable total for ${label}: ${m.count} transactions loosely match, too many to sum with confidence. Closest matches:`,
    ...rows.slice(0, 12).map(line),
    'Try naming a category or merchant (e.g. "how much did I spend on dining") for an exact total.',
  ].join('\n');
}

function fallback(userId, month) {
  const base = answerOverview(userId, month);
  return `${base}\n\nI can also answer things like: "how much did I spend on dining", "biggest purchase in July", "how much at Amazon", "list charges over $100 in August", "what's my income", "am I saving enough". For open-ended questions, switch AI_BACKEND to \`ollama\` (free, local) or \`anthropic\` in your .env.`;
}

// Retrieval block shared by the LLM backends. Capped tighter than a raw search so
// the prompt stays small (local models slow down fast with context length).
async function ragBlock(userId, message, ctx = {}) {
  try {
    const k = Math.max(5, Math.min(25, parseInt(process.env.RAG_LLM_ROWS || '20', 10)));
    const res = await retrieve(userId, message, {
      defaultMonth: A.defaultMonth(userId), k, ...ctx.retrieval, evalMode: !!ctx.evalMode,
    });
    const text = formatForPrompt(res);
    if (ctx.trace) { ctx.trace.retrieval = summarizeRetrieval(res); ctx.trace.ragBlock = text; }
    return `\n\n--- ${text}`;
  } catch (e) {
    if (ctx.evalMode) throw e; // an eval must not silently run without retrieval
    return '';
  }
}

/* ------------------------------------------------------------------ *
 * Backend 2: local model via Ollama (streaming)
 * ------------------------------------------------------------------ */

async function streamOllama(userId, systemBase, message, history, emit, abort, ctx) {
  const url = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
  const model = process.env.OLLAMA_MODEL || 'llama3.1:8b';
  const rag = await ragBlock(userId, message, ctx);
  const timer = setTimeout(() => abort.abort(), 150_000);
  try {
    const res = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: `${systemBase}${rag}` },
          ...history.slice(-8),
          { role: 'user', content: message },
        ],
        stream: true,
        keep_alive: process.env.OLLAMA_KEEP_ALIVE || '30m',
        options: { temperature: 0.3, num_predict: Number(process.env.OLLAMA_NUM_PREDICT || 700) },
      }),
      signal: abort.signal,
    });
    if (!res.ok || !res.body) throw new Error(`Ollama HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let any = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let j;
        try { j = JSON.parse(line); } catch { continue; }
        if (j.error) throw new Error(j.error);
        const piece = j.message && j.message.content;
        if (piece) { any = true; emit({ type: 'delta', text: piece }); }
        if (j.done) { if (!any) throw new Error('empty response from Ollama'); return; }
      }
    }
    if (!any) throw new Error('empty response from Ollama');
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * Backend 3: Claude via the official SDK (streaming)
 * ------------------------------------------------------------------ */

async function streamAnthropic(userId, systemBase, message, history, emit, abort, ctx) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // ctx.anthropic (from the demo, see src/demoai.js) overrides the key, model and limits for one call
  const o = ctx.anthropic || {};
  const client = new Anthropic({ apiKey: o.apiKey || process.env.ANTHROPIC_API_KEY });
  const model = o.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const rag = await ragBlock(userId, message, ctx);
  let any = false;
  const stream = client.messages.stream(
    {
      model,
      max_tokens: o.maxTokens || Number(process.env.ANTHROPIC_MAX_TOKENS || 4000),
      ...(o.thinking === false ? {} : { thinking: { type: 'adaptive' } }), // the demo skips extended thinking to keep answers fast and cheap
      system: `${systemBase}${rag}`,
      messages: [
        ...history.slice(-8).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) })),
        { role: 'user', content: String(message) },
      ],
    },
    { signal: abort && abort.signal }
  );
  stream.on('text', (delta) => { if (delta) { any = true; emit({ type: 'delta', text: delta }); } });
  await stream.finalMessage();
  if (!any) throw new Error('empty response from Claude');
}

/* ------------------------------------------------------------------ *
 * Dispatcher
 * ------------------------------------------------------------------ */

function normalizeHistory(history) {
  return Array.isArray(history)
    ? history.filter((m) => m && m.content).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }))
    : [];
}

/**
 * Stream an answer. `emit(ev)` receives:
 *   {type:'meta', mode, model?}   once, when a backend is chosen
 *   {type:'delta', text}          repeatedly, incremental content
 *   {type:'note', text}           optional, e.g. a fallback notice
 * `opts.abortSignal` (AbortSignal) stops an in-flight LLM call early.
 *
 * Eval hooks (all optional, none change the SSE events):
 *   opts.trace      object filled in as the question is answered: backend, route, retrieval, ragBlock…
 *   opts.retrieval  { mode, weight, semMin, k } forwarded to retrieve()
 *   opts.evalMode   no embedding writes; semantic failures, retrieval failures and LLM failures
 *                   throw instead of silently falling back to a weaker path
 */
async function askStream(userId, message, history, emit, opts = {}) {
  // opts.backend overrides AI_BACKEND for one call (demo sandboxes are pinned to 'rules' so
  // anonymous visitors can't run up a paid or local model)
  const backend = String(opts.backend || process.env.AI_BACKEND || 'rules').toLowerCase();
  const summary = A.buildSummary(userId);
  const systemBase = `${SYSTEM_PROMPT}\n\n--- USER DATA SUMMARY ---\n${summary.text}`;
  const hist = normalizeHistory(history);
  const ctx = { trace: opts.trace || null, retrieval: opts.retrieval || {}, evalMode: !!opts.evalMode, anthropic: opts.anthropic || null };
  if (ctx.trace) Object.assign(ctx.trace, { configuredBackend: backend, defaultMonth: A.defaultMonth(userId), retrievalOpts: ctx.retrieval });
  const failEval = (why) => { if (ctx.evalMode) throw new Error(`evalMode: ${why}`); };

  let produced = false;
  const track = (ev) => { if (ev.type === 'delta') produced = true; emit(ev); };

  const runLLM = async (fn, mode, model) => {
    emit({ type: 'meta', mode, model });
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    if (opts.abortSignal) opts.abortSignal.addEventListener('abort', onAbort);
    try {
      await fn(userId, systemBase, message, hist, track, ctl, ctx);
      return 'ok';
    } catch (e) {
      if (opts.abortSignal && opts.abortSignal.aborted) return 'aborted';
      if (produced) { emit({ type: 'note', text: 'Response was cut short.' }); return 'partial'; }
      return e.message || 'unknown error';
    } finally {
      if (opts.abortSignal) opts.abortSignal.removeEventListener('abort', onAbort);
    }
  };

  if (backend === 'ollama') {
    const r = await runLLM(streamOllama, 'ollama', process.env.OLLAMA_MODEL || 'llama3.1:8b');
    if (r === 'ok' || r === 'partial' || r === 'aborted') return;
    failEval(`ollama backend failed (${r})`);
    if (ctx.trace) Object.assign(ctx.trace, { fallbackFrom: 'ollama', fallbackReason: r });
    emit({ type: 'meta', mode: 'rules' });
    emit({ type: 'note', text: `Local model unreachable (${r}). Showing built-in analysis.` });
  } else if (backend === 'anthropic') {
    if (!(ctx.anthropic && ctx.anthropic.apiKey) && !process.env.ANTHROPIC_API_KEY) {
      failEval('AI_BACKEND=anthropic but ANTHROPIC_API_KEY is not set');
      if (ctx.trace) Object.assign(ctx.trace, { fallbackFrom: 'anthropic', fallbackReason: 'no API key' });
      emit({ type: 'meta', mode: 'rules' });
      emit({ type: 'note', text: 'No ANTHROPIC_API_KEY set. Showing built-in analysis.' });
    } else {
      const r = await runLLM(streamAnthropic, 'anthropic', (ctx.anthropic && ctx.anthropic.model) || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5');
      if (r === 'ok' || r === 'partial' || r === 'aborted') return;
      failEval(`anthropic backend failed (${r})`);
      if (ctx.trace) Object.assign(ctx.trace, { fallbackFrom: 'anthropic', fallbackReason: r });
      emit({ type: 'meta', mode: 'rules' });
      emit({ type: 'note', text: `Claude API error (${r}). Showing built-in analysis.` });
    }
  } else {
    emit({ type: 'meta', mode: 'rules' });
  }

  // rules backend (default or fallback) — deterministic, sent whole
  emit({ type: 'delta', text: await viaRules(userId, summary, message, ctx) });
}

// Non-streaming convenience wrapper (kept for tests and any internal caller).
// Always returns `trace`: what was configured, which handler answered, and (when the
// question went through retrieval) the retrieved ids, per-row scores, filters and counts.
// `opts` takes the same eval hooks as askStream (retrieval, evalMode); trace is created here.
async function ask(userId, message, history = [], opts = {}) {
  let reply = '';
  let mode = 'rules';
  let model;
  let note;
  const trace = { question: message };
  const t0 = Date.now();
  await askStream(userId, message, history, (ev) => {
    if (ev.type === 'meta') { mode = ev.mode; model = ev.model; }
    else if (ev.type === 'delta') reply += ev.text;
    else if (ev.type === 'note') note = ev.text;
  }, { ...opts, trace });
  trace.backend = mode;
  trace.model = model ?? null;
  trace.elapsedMs = Date.now() - t0;
  return { reply, mode, model, note, trace };
}

module.exports = { ask, askStream, SYSTEM_PROMPT, buildSummary: A.buildSummary };
