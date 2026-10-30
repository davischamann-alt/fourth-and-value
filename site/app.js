"use strict";

// ---------- Settings and storage ----------

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/college-football";
const LOGO = (id) => `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;
const STRONG = 3, LEAN = 1.5;          // edge thresholds in points
const CHECK = 5;                       // bigger gaps usually mean the market knows something (injury, QB change)
const CLOSE = 4;                       // a live game this close to the spread could flip on a field goal
const BREAKEVEN = 0.524;               // hit rate needed at -110
// Hit rate gained per point the line moves toward a pick between the logged line and kickoff. Measured
// in the 2023-2026 backtest (opening vs closing results); it turns line movement into an estimated
// hit rate long before wins and losses can say anything.
const CLV_PER_POINT = { spread: 0.03, total: 0.025 };
const SOURCE_LABEL = { anchored: "Market-anchored", fpi: "ESPN FPI", efficiency: "Efficiency", blend: "Blend", points: "Adjusted points" };
const SPREAD_SOURCES = ["anchored", "fpi", "efficiency", "blend", "points"];
const TIER_LABEL = { check: "Check the news", strong: "Go for it", lean: "Lean", pass: "Punt" };  // fourth-down calls
/** Edge size to label. 5+ points isn't "more value": in the cleaned 2023-2026 backtest it did no
 *  better than 3-5, and a gap that big usually means the model is missing news the market has. */
const tierOf = (edge) => { const e = Math.abs(edge); return e >= CHECK ? "check" : e >= STRONG ? "strong" : e >= LEAN ? "lean" : "pass"; };
/** A team's quarterback situation just changed (data/qb.json, from box scores), or null. */
const qbChange = (g) => (g.state === "post" ? null  // flags describe the latest games, not past ones
  : [g.home, g.away].map((t) => state.qb?.[t.id]).find((f) => f?.kind === "change") || null);
/** Edge label for a game: a just-changed quarterback turns any Lean or Go for it into Check the
 *  news. In 2026, the model's picks went 39% at the opening line in those games (56 picks) and
 *  55% in the rest: the market knows about the new starter, and the season-long ratings don't. */
/** A bowl outside the College Football Playoff. In 2023-2025 those went badly for every projection
 *  (FPI 42% at the opening line, 95 picks; Blend 47%): opt-outs, transfers and coaching changes
 *  aren't in the ratings. Playoff games did fine, so they keep their normal labels. */
const isBowl = (g) => !!g.postseason && !/playoff|cfp/i.test(g.note || "");
const BOWL_NOTE = "Bowl game: opt-outs, transfers and coaching changes aren't in the model, and in 2023-2025 bowls outside the playoff its picks went 42-47% at the opening line. Check who's playing.";
const gameTier = (g, edge) => { const t = tierOf(edge); return t !== "pass" && (qbChange(g) || isBowl(g)) ? "check" : t; };
/** Kickoff forecast (data/weather.json), or null. windy: 12+ mph over the first three hours. */
const weatherOf = (g) => (g.state === "pre" ? state.weather?.[g.id] || null : null);
const windNote = (w) => `Wind about ${w.wind} mph at kickoff (gusts to ${w.gust}). In 2023-2026, totals in games this windy fell about 1.8 points between the open and kickoff`;

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem("cfb." + key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("cfb." + key, JSON.stringify(value)); } catch { /* private mode: keep going */ }
  },
};

const state = {
  ratings: null,        // {byId, list, updated, season}
  model: null,          // {hfa, anchor, sigma}
  record: null,         // track_record.json
  live: null,           // live.json: the forward test (record.py)
  calendar: [],         // [{label, detail, week, seasontype, start, end}]
  weekIndex: -1,
  currentIndex: -1,     // this week in ESPN's calendar
  next: null,           // next week's games, for the opening-lines notice
  season: null,
  games: [],
  filter: "all",
  market: store.get("market", "spread"),  // "spread" or "total" (over/under)
  source: store.get("source", "anchored"),
  totalSource: store.get("totalSource", "anchored"),  // totals: Market-anchored or Adjusted points
  sort: store.get("sort", "time"),
  search: "",
  settings: store.get("settings", { hfa: null, sigma: null, theme: "auto" }),
  timer: null,
  changelog: [],        // changelog.json: dated model changes
  qb: null,             // qb.json: {team id: QB change flag}
  weather: null,        // weather.json: {game id: kickoff forecast}
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtLine = (x) => (x == null ? "—" : x === 0 ? "PK" : (x > 0 ? "+" : "") + x);
const pct = (x, digits = 0) => (x == null ? "—" : (100 * x).toFixed(digits) + "%");
const num = (x) => {
  if (x == null || x === "") return null;
  const s = String(x).trim().toUpperCase();
  if (s === "PK" || s === "EVEN") return 0;
  const v = parseFloat(s.replace(/^[OU]/, ""));
  return Number.isFinite(v) ? v : null;
};

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

// ---------- Model (same math as model.py) ----------

function erf(x) {
  // Abramowitz and Stegun 7.1.26, accurate to about 1e-7
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

const hfa = () => state.settings.hfa ?? state.model?.hfa ?? 3.0;  // model.HFA, normally from data/model.json
const sigma = (market = state.market) => market === "total"
  ? state.model?.sigma_total?.[state.totalSource] || 16
  : state.settings.sigma || state.model?.sigma?.[state.source] || 15.5;

/** Projected home margin for one game from every source, or null where a source can't make one. */
function projections(g) {
  const r = state.ratings?.byId || {};
  const h = r[g.home.id], a = r[g.away.id];
  const bump = g.neutral ? 0 : hfa();
  const points = h && a && h.ppg != null && a.ppg != null ? (h.ppg + a.papg) - (a.ppg + h.papg) + bump : null;
  const fpi = h && a && h.fpi != null && a.fpi != null ? h.fpi - a.fpi + bump : null;
  // EPA per play this matchup should produce, in points (model.efficiency_margin)
  const es = state.model?.eff_scale;
  const efficiency = es && h && a && h.off_eff != null && a.off_eff != null
    ? es * ((h.off_eff + a.def_eff) - (a.off_eff + h.def_eff)) + bump : null;
  const both = [fpi, efficiency].filter((x) => x != null);  // Blend: FPI and Efficiency (adjusted points before Oct 30, 2026)
  const blend = both.length ? both.reduce((s, x) => s + x, 0) / both.length : null;
  const w = state.model?.anchor?.weights;
  const base = g.line;  // start from the line being bet, as tested (see model.projections)
  const anchored = w && points != null && fpi != null && base != null
    ? w.const - w.line * base + w.fpi * fpi + w.points * points : null;
  return { points, fpi, efficiency, blend, anchored };
}

/** Projected total points from each totals source (same math as record.log_totals). */
function totalProjections(g) {
  const r = state.ratings?.byId || {};
  const h = r[g.home.id], a = r[g.away.id];
  if (!h || !a || h.ppg == null || a.ppg == null) return { points: null, anchored: null };
  const points = h.ppg + a.papg + a.ppg + h.papg - 2 * state.ratings.avg;
  const w = state.model?.anchor?.total_weights;
  const anchored = w && g.total != null ? w.const + w.total * g.total + w.points * points : null;
  return { points, anchored };
}

/** How far a live game is from the spread: home margin + home line (0 = right on the number). */
function spreadGap(g) {
  return g.state === "in" && g.line != null ? g.home.score - g.away.score + g.line : null;
}
const isClose = (g) => { const x = spreadGap(g); return x != null && Math.abs(x) <= CLOSE; };

function secsLeft(g) {
  if (g.state === "pre") return 3600;
  if (g.state === "post") return 0;
  return g.period > 4 ? 120 : (4 - g.period) * 900 + g.clock;
}

/** Everything the card needs about the model's view of a game: its spread pick, or its over/under
 *  pick when market is "total". */
function evaluate(g, market = state.market) {
  if (market === "total") return evaluateTotal(g);
  const margin = projections(g)[state.source];
  const line = g.line;
  if (margin == null || line == null) return { margin, reason: whyNoPick(g, margin, line) };
  const s = sigma("spread");
  const homeProb = normCdf((margin + line) / s);
  const homePick = homeProb >= 0.5;
  const left = secsLeft(g), cur = g.home.score - g.away.score, x = cur + line;
  let live;
  if (g.state === "pre") live = null;
  else if (left <= 0) live = x > 0 ? 1 : x < 0 ? 0 : 0.5;
  else { const f = Math.min(left / 3600, 1); live = normCdf((x + margin * f) / (s * Math.sqrt(f))); }
  const edge = Math.abs(margin + line);
  return {
    margin, line, edge,
    tier: gameTier(g, edge),
    side: homePick ? "home" : "away",
    team: homePick ? g.home : g.away,
    pickLine: homePick ? line : -line,
    pre: homePick ? homeProb : 1 - homeProb,
    live: live == null ? null : homePick ? live : 1 - live,
  };
}

function evaluateTotal(g) {
  const proj = totalProjections(g)[state.totalSource], line = g.total;
  if (proj == null || line == null) return { total: true, margin: proj, reason: whyNoPick(g, proj, line, "total") };
  const s = sigma("total");
  const overProb = 1 - normCdf((line - proj) / s);
  const over = overProb >= 0.5;
  const left = secsLeft(g), cur = g.home.score + g.away.score;
  let live = null;
  if (g.state !== "pre") {
    // points already scored, plus the projection for the time left; an over that's already past the line has won
    if (cur > line) live = 1;
    else if (left <= 0) live = cur < line ? 0 : 0.5;
    else { const f = Math.min(left / 3600, 1); live = 1 - normCdf((line - cur - proj * f) / (s * Math.sqrt(f))); }
  }
  const edge = Math.abs(proj - line);
  // an over in a windy game is betting against a drop the market usually makes by kickoff
  const windy = over && weatherOf(g)?.windy;
  const tier = windy && tierOf(edge) !== "pass" ? "check" : gameTier(g, edge);
  return {
    total: true, margin: proj, line, edge, tier, side: over ? "over" : "under", team: null, pickLine: line,
    pre: over ? overProb : 1 - overProb, live: live == null ? null : over ? live : 1 - live,
  };
}

function whyNoPick(g, margin, line, market = "spread") {
  const r = state.ratings?.byId || {};
  const missing = [g.home, g.away].filter((t) => !r[t.id]).map((t) => t.name);
  if (missing.length) return `No rating for ${missing.join(" and ")} (usually an FCS team)`;
  const what = market === "total" ? "total" : "line";
  if (line == null) return g.state === "pre" ? `No ${what} posted yet` : `No pregame ${what} available`;
  const src = market === "total" ? state.totalSource : state.source;
  const trained = market === "total" ? state.model?.anchor?.total_weights : state.model?.anchor;
  if (margin == null && src === "anchored" && !trained) return "Market-anchored isn't trained yet";
  return "Not enough data for this projection";
}

/** Pregame: has the number moved toward the pick since it opened? The model tested best at the
 *  opening number, so a line that's already moved its way has less value left. */
function lineMove(g, ev) {
  const open = ev.total ? g.openTotal : g.openLine;
  // an "opener" 7+ points away is usually a look-ahead number, not a real one (model.MAX_OPEN_MOVE)
  if (open == null || ev.line == null || Math.abs(ev.line - open) >= 7) return null;
  // a home pick gains when the home line drops; an over gains when the total rises
  return ev.total ? (ev.line - open) * (ev.side === "over" ? 1 : -1) : (open - ev.line) * (ev.side === "home" ? 1 : -1);
}
const atOpen = (g, ev) => g.state === "pre" && ev.edge >= LEAN && lineMove(g, ev) != null && Math.abs(lineMove(g, ev)) <= 0.5;

function moveNote(g, ev) {
  const m = lineMove(g, ev);
  if (g.state !== "pre" || m == null) return "";
  const open = ev.total ? g.openTotal : g.openLine;
  const from = ev.total ? String(open) : lineWord(ev.side === "home" ? open : -open);
  if (m === 0) return "Still at its opening number, where the model tested best.";
  return m > 0
    ? `Moved ${pts(m)} toward this pick since it opened at ${from}, so some of the value is gone.`
    : `Moved ${pts(m)} away from this pick since it opened at ${from}: a better number, unless the market knows something.`;
}

// ---------- ESPN data ----------

function parseEvent(e) {
  const c = e.competitions[0];
  const t = Object.fromEntries(c.competitors.map((x) => [x.homeAway, x]));
  const team = (x) => ({
    id: x.team.id,
    name: x.team.location || x.team.shortDisplayName,
    abbr: x.team.abbreviation,
    logo: x.team.logo || LOGO(x.team.id),
    rank: x.curatedRank?.current && x.curatedRank.current < 26 ? x.curatedRank.current : null,
    record: x.records?.[0]?.summary || "",
    score: parseInt(x.score || 0, 10),
    winner: x.winner,
  });
  const g = {
    id: e.id, date: e.date, home: team(t.home), away: team(t.away),
    state: c.status.type.state, status: c.status.type.shortDetail,
    period: c.status.period || 0, clock: parseFloat(c.status.clock || 0),
    neutral: !!c.neutralSite, tv: c.broadcasts?.[0]?.names?.join(", ") || "",
    note: c.notes?.[0]?.headline || "", postseason: e.season?.type === 3,  // bowl or playoff name; conference title games too
    line: null, openLine: null, total: null, openTotal: null,
  };
  const o = c.odds?.[0];
  if (o) Object.assign(g, parseOdds(o, g.home.abbr));
  // Remember the pregame line: once a game starts ESPN drops it from the scoreboard
  const saved = store.get("line." + g.id, null);
  if (g.state === "pre" && g.line != null) store.set("line." + g.id, { line: g.line, open: g.openLine, total: g.total, openTotal: g.openTotal });
  else if (saved) { g.line ??= saved.line; g.openLine ??= saved.open; g.total ??= saved.total; g.openTotal ??= saved.openTotal ?? null; }
  return g;
}

function parseOdds(o, homeAbbr) {
  let line = num(o.spread);
  if (line == null && o.details) {
    const d = o.details.trim();
    if (d.toUpperCase() === "EVEN") line = 0;
    else { const i = d.lastIndexOf(" "); const v = num(d.slice(i + 1)); if (v != null) line = d.slice(0, i) === homeAbbr ? v : -v; }
  }
  return { line, openLine: num(o.pointSpread?.home?.open?.line), total: num(o.overUnder), openTotal: num(o.total?.over?.open?.line) };
}

/** Started games with no saved pregame line: ESPN's game summary still has it. */
async function fillMissingLines(games) {
  const todo = games.filter((g) => g.state !== "pre" && g.line == null).slice(0, 40);
  await Promise.all(todo.map(async (g) => {
    try {
      const pc = (await getJSON(`${ESPN}/summary?event=${g.id}`)).pickcenter?.[0];
      if (!pc || pc.spread == null) return;
      g.line = num(pc.spread); g.openLine = num(pc.pointSpread?.home?.open?.line); g.total = num(pc.overUnder);
      g.openTotal = num(pc.total?.over?.open?.line);
      store.set("line." + g.id, { line: g.line, open: g.openLine, total: g.total, openTotal: g.openTotal });
    } catch { /* leave the game without a line */ }
  }));
}

async function loadWeek(index) {
  const params = new URLSearchParams({ groups: 80, limit: 300 });
  if (index >= 0 && state.calendar[index]) {
    const w = state.calendar[index];
    params.set("dates", state.season); params.set("seasontype", w.seasontype); params.set("week", w.week);
  }
  const data = await getJSON(`${ESPN}/scoreboard?${params}`);
  if (!state.calendar.length) {
    state.season = data.season?.year;
    state.calendar = (data.leagues?.[0]?.calendar || [])
      .filter((c) => c.value === "2" || c.value === "3")
      .flatMap((c) => (c.entries || []).map((x) => ({
        label: x.label, detail: x.detail, week: x.value, seasontype: c.value, start: x.startDate, end: x.endDate })));
    state.weekIndex = state.calendar.findIndex((w) => String(w.week) === String(data.week?.number)
      && String(w.seasontype) === String(data.season?.type));
    state.currentIndex = state.weekIndex;
  }
  const games = (data.events || []).map(parseEvent);
  await fillMissingLines(games);
  state.games = games;
  gradePicks(games);
}

// ---------- Games tab ----------

/** After the national championship: ESPN's calendar has run out, and there are no games to show. */
const offseason = () => { const last = state.calendar.at(-1); return !!last && Date.now() > Date.parse(last.end); };

function renderWeekbar() {
  const w = state.calendar[state.weekIndex];
  $("#week-name").textContent = w ? w.label : "This week";
  $("#week-dates").textContent = w?.detail || "";
  $("#week-prev").disabled = state.weekIndex <= 0;
  $("#week-next").disabled = state.weekIndex < 0 || state.weekIndex >= state.calendar.length - 1;
}

function renderGames() {
  const q = state.search.trim().toLowerCase();
  let rows = state.games.map((g) => ({ g, ev: evaluate(g) }));
  rows = rows.filter(({ g, ev }) => {
    if (q && !`${g.home.name} ${g.away.name} ${g.home.abbr} ${g.away.abbr}`.toLowerCase().includes(q)) return false;
    if (state.filter === "edge") return ev.edge >= LEAN;
    if (state.filter === "strong") return ev.tier === "strong";
    if (state.filter === "open") return atOpen(g, ev);
    if (state.filter === "live") return g.state === "in";
    if (state.filter === "close") return isClose(g);
    return true;
  });
  if (state.filter === "close") rows.sort((a, b) => Math.abs(spreadGap(a.g)) - Math.abs(spreadGap(b.g)));  // tightest first
  else if (state.sort === "edge") rows.sort((a, b) => (b.ev.edge ?? -1) - (a.ev.edge ?? -1));
  else rows.sort((a, b) => a.g.date.localeCompare(b.g.date) || (b.ev.edge ?? -1) - (a.ev.edge ?? -1));

  const all = state.games.map((g) => evaluate(g));
  const counts = {
    all: state.games.length, edge: all.filter((e) => e.edge >= LEAN).length,
    strong: all.filter((e) => e.tier === "strong").length, open: state.games.filter((g, i) => atOpen(g, all[i])).length,
    live: state.games.filter((g) => g.state === "in").length, close: state.games.filter(isClose).length,
  };
  $$("[data-count]").forEach((el) => (el.textContent = state.games.length ? counts[el.dataset.count] : ""));
  $('#filter [data-filter="live"]').classList.toggle("is-live", counts.live > 0);
  $('#filter [data-filter="close"]').classList.toggle("is-live", counts.close > 0);
  $("#games-summary").textContent = state.games.length ? `${state.market === "total" ? "Over/under" : "Cover"} chances use a ${sigma()}-point std dev` : "";

  const box = $("#games");
  if (!state.games.length && offseason()) {
    box.innerHTML = `<div class="card offseason"><h3>That's the ${state.season} season</h3>
      <p>The last game has been played. The ratings, the pick log and the <a href="#record">track record</a> stay up, and the
        forward test starts again when ${state.season + 1} lines are posted in August. Turn on <b>alerts</b> (🔔 at the top) to hear when the
        first edges show up.</p></div>`;
    return;
  }
  if (!rows.length) {
    box.innerHTML = `<div class="card nopick">${!state.games.length ? "No games this week." : state.filter === "close" ? `No live games within ${CLOSE} points of the spread right now.`
      : state.filter === "open" ? "No edges of 1.5+ are still at their opening number. Lines for next week usually post on Sunday." : "No games match these filters."}</div>`;
    return;
  }
  const tracked = new Set(store.get("picks", []).map((p) => p.id));
  let html = "", day = "";
  const byDay = state.sort === "time";
  for (const { g, ev } of rows) {
    const d = new Date(g.date).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    if (byDay && d !== day) { html += (day ? "</div>" : "") + `<h2 class="day-head">${esc(d)}</h2><div class="grid">`; day = d; }
    html += card(g, ev, tracked.has(trackKey(g)));
  }
  box.innerHTML = byDay ? html + "</div>" : `<div class="grid">${html}</div>`;
}

function teamRow(t, g, picked) {
  const showScore = g.state !== "pre";
  const lost = g.state === "post" && t.winner === false;
  return `<div class="team${lost ? " lost" : ""}${picked ? " picked" : ""}">
    <img src="${esc(t.logo)}" alt="" loading="lazy">
    <span class="name">${t.rank ? `<span class="rank">${t.rank}</span>` : ""}${esc(t.name)}<span class="rec">${esc(t.record)}</span></span>
    ${picked ? `<span class="pick-tag">Pick</span>` : ""}
    ${showScore ? `<span class="score">${t.score}</span>` : ""}
  </div>`;
}

const pts = (x) => { const v = Math.abs(x); return `${v % 1 ? v.toFixed(1) : v} point${v === 1 ? "" : "s"}`; };
const lineWord = (l) => (l === 0 ? "a pick'em" : fmtLine(l).replace("-", "−"));

/** Where the model's pick stands: "pre", "covering"/"behind" during a game, or "win"/"loss"/"push"
 *  when final, with a plain-English sentence. ev comes from evaluate(). */
function pickStatus(g, ev) {
  if (ev.total) return totalStatus(g, ev);
  const t = ev.team, line = ev.pickLine;
  const diff = (ev.side === "home" ? 1 : -1) * (g.home.score - g.away.score);  // the picked team's margin
  const by = diff + line;                                                       // margin against the spread
  const lead = diff > 0 ? `${t.name} ${g.state === "post" ? "won" : "leads"} by ${diff}`
    : diff < 0 ? `${t.name} ${g.state === "post" ? "lost" : "trails"} by ${-diff}` : g.state === "post" ? `${t.name} tied` : "Tied";
  if (g.state === "pre") return { state: "pre", text: "" };
  if (g.state === "in") {
    return by > 0 ? { state: "covering", chip: "Covering now", text: `${lead}, covering ${lineWord(line)} by ${pts(by)}.` }
      : by < 0 ? { state: "behind", chip: "Not covering yet", text: `${lead}, ${pts(by)} short of covering ${lineWord(line)}.` }
      : { state: "behind", chip: "On the number", text: `${lead}: exactly on the line right now.` };
  }
  return by > 0 ? { state: "win", chip: "✓ Covered", text: `${lead}, covering ${lineWord(line)} by ${pts(by)}.` }
    : by < 0 ? { state: "loss", chip: "✗ Missed", text: `${lead}, missing ${lineWord(line)} by ${pts(by)}.` }
    : { state: "push", chip: "Push", text: `${lead}: landed exactly on the line, so bets are refunded.` };
}

/** Over/under version of pickStatus: points scored so far against the total. */
function totalStatus(g, ev) {
  const cur = g.home.score + g.away.score, line = ev.line, over = ev.side === "over";
  const by = (cur - line) * (over ? 1 : -1);
  if (g.state === "pre") return { state: "pre", text: "" };
  if (g.state === "in") {
    if (cur > line) return over ? { state: "win", chip: "✓ Over hit", text: `${cur} points already, past ${line}: the over has won.` }
      : { state: "loss", chip: "✗ Gone over", text: `${cur} points already, past ${line}: the under can't win now.` };
    return over ? { state: "behind", chip: "Not over yet", text: `${cur} points so far, ${pts(line - cur)} short of ${line}.` }
      : { state: "covering", chip: "Under so far", text: `${cur} points so far, ${pts(line - cur)} under ${line} with time left.` };
  }
  return by > 0 ? { state: "win", chip: "✓ Hit", text: `Final total ${cur}, ${over ? "over" : "under"} ${line} by ${pts(by)}.` }
    : by < 0 ? { state: "loss", chip: "✗ Missed", text: `Final total ${cur}, ${over ? "under" : "over"} ${line} by ${pts(by)}.` }
    : { state: "push", chip: "Push", text: `Final total ${cur}: landed exactly on ${line}, so bets are refunded.` };
}

const pickName = (ev) => (ev.total ? `${ev.side === "over" ? "Over" : "Under"} ${ev.line}` : `${ev.team.name} ${lineWord(ev.pickLine)}`);

/** The "Model pick" box shared by game cards and the game detail view. */
function pickBox(g, ev, { tierTxt } = {}) {
  const st = pickStatus(g, ev);
  const chip = st.state === "pre"
    ? `<span class="badge ${ev.tier}">${tierTxt[ev.tier]} · ${ev.edge.toFixed(1)}</span>`
    : `<span class="pick-chip">${esc(st.chip)}</span>`;
  const icon = ev.total
    ? `<span class="ou-icon" aria-hidden="true">${ev.side === "over" ? "▲" : "▼"}</span>`
    : `<img src="${esc(ev.team.logo)}" alt="" loading="lazy">`;
  const qb = g.state === "pre" && qbChange(g), wx = ev.total && weatherOf(g);
  const windTxt = wx?.windy ? `${windNote(wx)}${ev.side === "over" ? ", so this over is fighting the market." : ": the market usually moves it toward the under."}` : "";
  const bowl = g.state === "pre" && isBowl(g) && ev.tier === "check";
  const note = st.text || (qb ? `QB change: ${qb.note}` : bowl ? BOWL_NOTE : windTxt || moveNote(g, ev));
  return `<div class="pickbox pb-${st.state}">
    <div class="pickbox-top"><span class="pickbox-label">Model pick${ev.total ? " · total" : ""}</span>${chip}</div>
    <div class="pickbox-main">${icon}<span class="pick">${esc(pickName(ev))}</span></div>
    ${note ? `<div class="pickbox-note${st.text ? "" : " pickbox-move"}">${esc(note)}</div>` : ""}
  </div>`;
}

function card(g, ev, isTracked) {
  const time = g.state === "pre"
    ? new Date(g.date).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : g.status;
  const statusCls = g.state === "in" ? "status live" : "status";
  const moved = g.openLine != null && g.line != null && g.openLine !== g.line
    ? `<span class="open"> opened ${fmtLine(g.openLine)}</span>` : "";
  const movedTotal = g.openTotal != null && g.total != null && g.openTotal !== g.total
    ? `<span class="open"> opened ${g.openTotal}</span>` : "";
  const homeLine = g.line == null ? "—" : `${esc(g.home.abbr)} ${fmtLine(g.line)}`;
  let body;
  if (ev.margin == null || ev.line == null) {
    body = `<div class="nopick">${esc(ev.reason)}</div>`;
  } else {
    const fav = ev.margin >= 0 ? g.home : g.away;
    const modelTxt = ev.total ? `${ev.margin.toFixed(1)} pts`
      : Math.abs(ev.margin) < 0.05 ? "Even" : `${esc(fav.abbr)} by ${Math.abs(ev.margin).toFixed(1)}`;
    const hits = ev.total ? "hits" : "covers";
    const p = ev.live ?? ev.pre;
    const done = g.state === "post";
    // finished games drop the bar (it only said 100% or 0%) and keep the pregame chance as context
    const prob = done
      ? `<div class="prob"><div class="row"><span>${ev.total ? "Chance" : "Cover chance"} before kickoff</span><b>${pct(ev.pre)}</b></div></div>`
      : `<div class="prob">
          <div class="row"><span>${g.state === "pre" ? `Chance the pick ${hits}` : `Live chance the pick ${hits}`}</span><b>${pct(p)}</b></div>
          <div class="bar"><i style="width:${(100 * p).toFixed(0)}%"></i></div>
          ${g.state === "in" ? `<div class="row"><span>Before kickoff</span><b>${pct(ev.pre)}</b></div>` : ""}
        </div>`;
    body = pickBox(g, ev, { tierTxt: TIER_LABEL }) + prob;
    body += `
      <div class="lines" style="margin-bottom:0"><div><span class="k">Model</span><span class="v">${modelTxt}</span></div>
        <div><span class="k">Edge</span><span class="v">${ev.edge.toFixed(1)} pts</span></div></div>`;
  }
  const canTrack = g.state === "pre" && ev.margin != null && ev.line != null;
  return `<article class="card game${ev.tier === "strong" ? " strong" : ""}" data-game="${esc(g.id)}" tabindex="0"
    aria-label="${esc(`${g.away.name} at ${g.home.name}: open game details`)}">
    <div class="game-top"><span class="${statusCls}">${esc(time)}</span>${isClose(g)
      ? `<span class="close-tag" title="The score is within ${CLOSE} points of the spread">Close · ${Math.abs(spreadGap(g)) === 0 ? "on the number" : `${Math.abs(spreadGap(g))} from the spread`}</span>` : ""}${g.state === "pre" && qbChange(g) ? `<span class="qb-tag" title="${esc(qbChange(g).note)}">QB change</span>` : ""}${weatherOf(g)?.windy
      ? `<span class="qb-tag wind-tag" title="${esc(windNote(weatherOf(g)))}.">Wind ${weatherOf(g).wind} mph</span>` : ""}<span>${esc(g.tv)}${g.neutral ? " · Neutral site" : ""}</span></div>
    ${g.note ? `<div class="game-note">${esc(g.note)}</div>` : ""}
    ${teamRow(g.away, g, ev.side === "away")}${teamRow(g.home, g, ev.side === "home")}
    <div class="lines">
      <div><span class="k">Line</span><span class="v">${homeLine}</span>${moved}</div>
      <div><span class="k">Total</span><span class="v">${g.total ?? "—"}</span>${movedTotal}</div>
    </div>
    ${body}
    <div class="game-foot">
      <span>${g.away.abbr} @ ${g.home.abbr}</span>
      <button class="track${isTracked ? " on" : ""}" data-track="${esc(trackKey(g))}" ${canTrack || isTracked ? "" : "disabled"}>
        ${isTracked ? "★ Tracked" : "☆ Track pick"}</button>
    </div>
  </article>`;
}

/** Tracked picks are keyed by game id, plus ":total" for an over/under, so a game can have both. */
const trackKey = (g) => (state.market === "total" ? `${g.id}:total` : g.id);
const gameIdOf = (p) => p.game_id ?? p.id;

function toggleTrack(key) {
  const picks = store.get("picks", []);
  const i = picks.findIndex((p) => p.id === key);
  if (i >= 0) { picks.splice(i, 1); store.set("picks", picks); return renderAll(); }
  const [id, kind] = key.split(":");
  const g = state.games.find((x) => x.id === id);
  const ev = g && evaluate(g, kind === "total" ? "total" : "spread");
  if (!g || g.state !== "pre" || !ev || ev.margin == null || ev.line == null) return;
  const w = state.calendar[state.weekIndex];
  picks.push({
    id: key, game_id: id, market: ev.total ? "total" : "spread", date: g.date, season: state.season, week: w?.week,
    seasontype: w?.seasontype, game: `${g.away.name} @ ${g.home.name}`,
    pick: ev.total ? pickName(ev) : `${ev.team.name} ${fmtLine(ev.pickLine)}`,
    side: ev.side, line: ev.line, edge: +ev.edge.toFixed(1), prob: +ev.pre.toFixed(3),
    source: ev.total ? state.totalSource : state.source, result: null, finalMargin: null,
  });
  store.set("picks", picks);
  renderAll();
}

// ---------- My picks ----------

function gradeOne(p, g) {
  if (!g || g.state !== "post" || p.result) return false;
  const m = g.home.score - g.away.score, t = g.home.score + g.away.score;
  const x = p.market === "total" ? (t - p.line) * (p.side === "over" ? 1 : -1) : (m + p.line) * (p.side === "home" ? 1 : -1);
  p.finalMargin = m; p.finalTotal = t; p.result = x > 0 ? "W" : x < 0 ? "L" : "P";
  return true;
}

function gradePicks(games) {
  const picks = store.get("picks", []);
  const byId = Object.fromEntries(games.map((g) => [g.id, g]));
  if (picks.some((p) => gradeOne(p, byId[gameIdOf(p)]))) store.set("picks", picks);
}

/** Grade picks from other weeks by loading each of those weeks once. */
async function gradeOldPicks() {
  const picks = store.get("picks", []);
  const weeks = new Map();
  for (const p of picks) {
    if (!p.result && new Date(p.date) < Date.now() - 4 * 3600e3 && p.week)
      weeks.set(`${p.season}-${p.seasontype}-${p.week}`, p);
  }
  let changed = false;
  for (const p of weeks.values()) {
    try {
      const d = await getJSON(`${ESPN}/scoreboard?groups=80&limit=300&dates=${p.season}&seasontype=${p.seasontype}&week=${p.week}`);
      const byId = Object.fromEntries((d.events || []).map((e) => [e.id, parseEvent(e)]));
      for (const q of picks) changed = gradeOne(q, byId[gameIdOf(q)]) || changed;
    } catch { /* try again next visit */ }
  }
  if (changed) { store.set("picks", picks); renderPicks(); }
}

function renderPicks() {
  const picks = store.get("picks", []).slice().sort((a, b) => b.date.localeCompare(a.date));
  const done = picks.filter((p) => p.result === "W" || p.result === "L");
  const wins = done.filter((p) => p.result === "W").length;
  const strong = done.filter((p) => p.edge >= STRONG);
  const sw = strong.filter((p) => p.result === "W").length;
  $("#pick-stats").innerHTML = [
    ["Tracked picks", picks.length],
    ["Record", `${wins}-${done.length - wins}${picks.some((p) => p.result === "P") ? `-${picks.filter((p) => p.result === "P").length}` : ""}`],
    ["Hit rate", done.length ? pct(wins / done.length, 1) : "—"],
    ["Go-for-it picks", strong.length ? `${sw}-${strong.length - sw}` : "—"],
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
  const res = { W: `<span class="badge win">Won</span>`, L: `<span class="badge loss">Lost</span>`, P: `<span class="badge pass">Push</span>` };
  $("#picks-table").innerHTML = `<tr><th>Game</th><th class="l">Pick</th><th>Edge</th><th>Chance</th><th class="l">Projection</th><th class="l">Result</th><th></th></tr>` +
    (picks.length ? picks.map((p) => `<tr>
      <td class="l">${esc(new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }))} · ${esc(p.game)}</td>
      <td class="l"><b>${esc(p.pick)}</b></td><td>${p.edge.toFixed(1)}</td><td>${pct(p.prob)}</td>
      <td class="l">${esc(SOURCE_LABEL[p.source] || p.source)}${p.market === "total" ? " · total" : ""}</td>
      <td class="l">${p.result ? res[p.result] : `<span class="note">Pending</span>`}</td>
      <td><button data-unpick="${esc(p.id)}" title="Remove">✕</button></td></tr>`).join("")
      : `<tr><td colspan="7" class="empty">No tracked picks yet. Use ☆ Track pick on the Games tab.</td></tr>`);
}

// ---------- Bets ----------

const BET_COLS = ["date", "game", "side", "line", "odds", "stake", "result"];

function profit(b) {
  const stake = +b.stake || 0, odds = +b.odds || -110;
  if (b.result === "W") return stake * (odds < 0 ? 100 / -odds : odds / 100);
  return b.result === "L" ? -stake : 0;
}

function renderBets() {
  const bets = store.get("bets", []);
  const graded = bets.filter((b) => b.result);
  const net = graded.reduce((s, b) => s + profit(b), 0);
  const staked = graded.reduce((s, b) => s + (+b.stake || 0), 0);
  const wins = graded.filter((b) => b.result === "W").length, losses = graded.filter((b) => b.result === "L").length;
  $("#bet-stats").innerHTML = [
    ["Bets", bets.length], ["Record", `${wins}-${losses}`],
    ["Net profit", `${net >= 0 ? "+" : "−"}$${Math.abs(net).toFixed(2)}`],
    ["ROI", staked ? `${net >= 0 ? "+" : ""}${(100 * net / staked).toFixed(1)}%` : "—"],
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
  $("#bets-table").innerHTML = `<tr><th>Date</th><th class="l">Game</th><th class="l">Side</th><th>Line</th><th>Odds</th><th>Stake</th><th class="l">Result</th><th>Profit</th><th></th></tr>` +
    (bets.length ? bets.map((b, i) => `<tr>
      <td class="l">${esc(b.date)}</td><td class="l">${esc(b.game)}</td><td class="l">${esc(b.side)}</td>
      <td>${b.line === "" || b.line == null ? "—" : fmtLine(+b.line)}</td><td>${esc(b.odds || -110)}</td><td>$${(+b.stake).toFixed(2)}</td>
      <td class="l"><select data-bet="${i}"><option value="">Pending</option>${["W", "L", "Push"].map((r) =>
        `<option value="${r}" ${b.result === r ? "selected" : ""}>${{ W: "Won", L: "Lost", Push: "Push" }[r]}</option>`).join("")}</select></td>
      <td class="${profit(b) > 0 ? "good" : profit(b) < 0 ? "bad" : ""}">${b.result ? (profit(b) >= 0 ? "+" : "−") + "$" + Math.abs(profit(b)).toFixed(2) : "—"}</td>
      <td><button data-delbet="${i}" title="Delete">✕</button></td></tr>`).join("")
      : `<tr><td colspan="9" class="empty">No bets yet. Add one above.</td></tr>`);
}

function csvCell(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

// ---------- Ratings ----------

let ratingSort = { key: "fpi", dir: -1 };

function renderRatings() {
  const list = state.ratings?.list || [];
  const q = $("#rating-search").value.trim().toLowerCase();
  const fpiRank = new Map([...list].filter((t) => t.fpi != null).sort((a, b) => b.fpi - a.fpi).map((t, i) => [t.team, i + 1]));
  const rows = list.filter((t) => !q || t.team.toLowerCase().includes(q))
    .map((t) => ({ ...t, net: t.ppg == null ? null : t.ppg - t.papg, rank: fpiRank.get(t.team) }));
  const k = ratingSort.key, d = ratingSort.dir;
  rows.sort((a, b) => (typeof a[k] === "string" ? a[k].localeCompare(b[k]) : ((a[k] ?? -1e9) - (b[k] ?? -1e9))) * d);
  const cols = [["rank", "#", "Rank by FPI"], ["team", "Team", "Team name"],
    ["fpi", "FPI", "Points better (+) or worse (−) than an average FBS team on a neutral field"],
    ["ppg", "Offense", "Points scored per game vs an average defense, adjusted for opponents (higher is better)"],
    ["papg", "Defense", "Points allowed per game vs an average offense, adjusted for opponents (lower is better)"],
    ["net", "Net", "Offense minus defense: points per game better than an average opponent"],
    ["off_eff", "Off EPA", "Expected points added per play on offense vs an average defense, adjusted for opponents (higher is better)"],
    ["def_eff", "Def EPA", "Expected points added per play allowed vs an average offense, adjusted for opponents (lower is better)"],
    ["games", "Games", "Games played against FBS teams this season"]];
  const epa = (x) => (x == null ? "—" : (x > 0 ? "+" : "") + x.toFixed(2));
  $("#ratings-table").innerHTML = `<tr>${cols.map(([c, l, tip]) => `<th data-sort="${c}" title="${esc(tip)}" class="${c === "team" ? "l" : ""}">${l}${k === c ? (d > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr>` +
    rows.map((t) => `<tr><td>${t.rank ?? ""}</td><td class="l"><img src="${LOGO(t.id)}" alt="" loading="lazy">${esc(t.team)}</td>
      <td>${t.fpi?.toFixed(1) ?? "—"}</td><td>${t.ppg?.toFixed(1) ?? "—"}</td><td>${t.papg?.toFixed(1) ?? "—"}</td>
      <td class="${t.net == null ? "" : t.net > 0 ? "good" : "bad"}">${t.net == null ? "—" : (t.net > 0 ? "+" : "") + t.net.toFixed(1)}</td>
      <td>${epa(t.off_eff)}</td><td>${epa(t.def_eff)}</td><td>${t.games}</td></tr>`).join("");
  $("#ratings-summary").textContent = state.ratings
    ? `${list.length} FBS teams · updated ${new Date(state.ratings.updated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
    : "";
}

// ---------- Track record ----------

let recAgainst = "open", recEdge = "0", recMarket = "spread";

/** 95% margin of error on a hit rate from n picks (using 50%, the widest case). */
const moe = (n) => (n ? 1.96 * Math.sqrt(0.25 / n) : null);
const withMoe = (rate, n) => (rate == null ? "—" : `${pct(rate, 1)}<small class="moe"> ±${(100 * moe(n)).toFixed(1)}</small>`);

function renderRecord() {
  const r = recMarket === "total" ? state.record?.totals : state.record;
  if (!r) { $("#record-headline").innerHTML = `<div class="card">Track record isn't available yet.</div>`; return; }
  const tot = recMarket === "total", line = tot ? "total" : "line";
  const rows = (key) => (r.tables[key] || []).filter((x) => !/baseline/.test(x.name));
  // headline cards only feature results with enough picks to mean something
  const MIN_PICKS = 200;
  const best = (key) => rows(key).filter((x) => x.picks >= MIN_PICKS).sort((a, b) => b.hit_rate - a.hit_rate)[0];
  const open3 = best("open_3"), close0 = best("close_0"), open0 = best("open_0");
  const moved = rows("open_3").filter((x) => x.clv_beat_rate != null && x.picks >= MIN_PICKS).sort((a, b) => b.clv_beat_rate - a.clv_beat_rate)[0];
  const n = (x) => (x ? x.wins + x.losses : 0);
  $("#record-headline").innerHTML = [
    [`Betting at the closing ${line}`, close0 && close0.hit_rate >= BREAKEVEN ? withMoe(close0.hit_rate, n(close0)) : "No edge",
      `Best source: ${close0?.name} at ${pct(close0?.hit_rate, 1)}. Break-even is 52.4%. The final ${line} is very hard to beat.`],
    [`Opening ${line}, every game`, withMoe(open0?.hit_rate, n(open0)),
      `${open0?.name}, ${open0?.wins}-${open0?.losses}. ${open0?.hit_rate >= BREAKEVEN ? "Just above" : open0?.hit_rate >= 0.51 ? "Just below" : "Below"} break-even.`],
    [`Opening ${line}, 3+ pt edges`, withMoe(open3?.hit_rate, n(open3)), `${open3?.name}, ${open3?.wins}-${open3?.losses}. ${open3?.hit_rate >= BREAKEVEN
      ? "Barely above break-even; the edge is real but small." : "Below break-even: no reliable edge here yet."}`],
    [`${tot ? "Total" : "Line"} moved toward the pick`, pct(moved?.clv_beat_rate), `${moved?.name}, 3+ pt edges. Lines moving your way is the best sign of a real edge.`],
  ].map(([h, big, p]) => `<div class="card"><h4>${h}</h4><div class="big">${big}</div><p>${esc(p)}</p></div>`).join("");

  const t = r.tables[`${recAgainst}_${recEdge}`] || [];
  const clv = recAgainst === "open";
  $("#record-table").innerHTML = `<tr><th>Projection</th><th>Picks</th><th>Record</th><th>Hit rate</th><th>Typical miss</th>${clv ? `<th>${tot ? "Total" : "Line"} moved our way</th>` : ""}</tr>` +
    t.map((x) => /baseline/.test(x.name)
      ? `<tr><td class="l note">${esc(x.name.replace(" (baseline)", ""))} itself</td><td></td><td></td><td></td><td>${x.rmse_vs_result?.toFixed(1)}</td>${clv ? "<td></td>" : ""}</tr>`
      : `<tr><td class="l">${esc(x.name)}</td><td>${x.picks ?? 0}</td><td>${x.wins ?? 0}-${x.losses ?? 0}</td>
        <td class="${x.hit_rate >= BREAKEVEN ? "good" : "bad"}">${withMoe(x.hit_rate, n(x))}</td><td>${x.rmse_vs_result?.toFixed(1)}</td>
        ${clv ? `<td>${pct(x.clv_beat_rate)}</td>` : ""}</tr>`).join("");
  $("#season-head").textContent = `By season (opening ${line}, every game)`;

  const names = (r.tables.open_0 || []).map((x) => x.name).filter((n) => !/baseline/.test(n));
  $("#season-table").innerHTML = `<tr><th>Season</th><th>Games</th>${names.map((n) => `<th>${esc(n)}</th>`).join("")}</tr>` +
    r.by_season.map((s) => `<tr><td class="l">${s.season}</td><td>${s.games}</td>${names.map((n) =>
      `<td class="${s[n] == null ? "" : s[n] >= BREAKEVEN ? "good" : "bad"}">${s[n] == null ? "—" : pct(s[n], 1)}</td>`).join("")}</tr>`).join("");
}

// ---------- Live results (forward test) ----------

let liveSource = "anchored", liveTier = "all";  // every game: the most finished picks

/** Link to the pick log's history on GitHub, which shows when each pick was committed. */
function proofLink() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const repo = location.pathname.split("/").filter(Boolean)[0];
  return m && repo ? `https://github.com/${m[1]}/${repo}/commits/main/data/live/picks.csv` : null;
}

/** Estimated long-run hit rate from line movement: 50% (the closing line is about a coin flip) plus
 *  CLV_PER_POINT for every point the line moved toward the picks on average, with a 95% margin of
 *  error from how much the moves vary. Null until there are enough graded picks to say anything. */
function clvEstimate(s, market) {
  if (s.avg_clv == null || s.clv_sd == null || s.clv_n < 8) return null;
  const k = CLV_PER_POINT[market];
  return { rate: 0.5 + k * s.avg_clv, moe: 1.96 * k * s.clv_sd / Math.sqrt(s.clv_n) };
}

// position on the verdict bar, which runs from 40% to 65%
const vpos = (x) => Math.max(0, Math.min(100, (100 * (x - 0.4)) / 0.25));

function liveVerdict(s, market) {
  const est = clvEstimate(s, market), what = market === "total" ? "total" : "line";
  const n = s.at_logged.wins + s.at_logged.losses;
  if (!est) {
    return `<div class="card verdict"><h4>Expected hit rate, from how the ${what} moved</h4><div class="big">Too early</div>
      <p>Fewer than 8 finished picks. The estimate appears once there are enough to measure.</p></div>`;
  }
  const lo = est.rate - est.moe, hi = est.rate + est.moe;
  const call = lo > BREAKEVEN ? "Above the 52.4% break-even even at the low end: the strongest sign of a real edge."
    : hi < BREAKEVEN ? "Below the 52.4% break-even even at the high end. The market moves toward these picks, but not far enough to profit."
    : "The range includes the 52.4% break-even, so it's too close to call yet.";
  const beat = s.moved_n ? ` toward these picks in ${pct(s.clv_beat_rate)} of the ${s.moved_n} games where it moved,` : "";
  const per = (100 * CLV_PER_POINT[market]).toFixed(1).replace(/\.0$/, "");
  return `<div class="card verdict">
    <h4>Expected hit rate, from how the ${what} moved</h4>
    <div class="big">${pct(est.rate, 1)}<small class="moe"> ±${(100 * est.moe).toFixed(1)}</small></div>
    <div class="vbar" role="img" aria-label="Estimate ${pct(est.rate, 1)}, likely range ${pct(lo, 1)} to ${pct(hi, 1)}, break-even 52.4%">
      <i style="left:${vpos(lo)}%;width:${vpos(hi) - vpos(lo)}%"></i><b style="left:${vpos(est.rate)}%"></b>
      <em style="left:${vpos(BREAKEVEN)}%"></em><span style="left:${vpos(0.5)}%">50%</span><span class="be" style="left:${vpos(BREAKEVEN)}%">52.4%</span></div>
    <p><b>${esc(call)}</b> Between the moment each pick was logged and kickoff, the ${what} moved${beat} by
      ${s.avg_clv >= 0 ? "+" : ""}${s.avg_clv.toFixed(2)} points on average. In the 2023-2026 backtest, each point the ${what} moved
      toward a pick was worth about ${per} points of hit rate.</p>
    <p class="note">Why this instead of the record: with ${n} finished pick${n === 1 ? "" : "s"}, the win-loss record's margin of error is
      ±${(100 * moe(n)).toFixed(0)} points, so it's still mostly luck. Line moves vary much less from game to game, so they say more,
      sooner. It's an estimate: it assumes the closing ${what} is about a coin flip, as it was in the backtest.</p>
  </div>`;
}

function renderLive() {
  const tot = recMarket === "total", market = tot ? "total" : "spread";
  const L = tot ? state.live?.totals : state.live;
  $$("#live-source [data-spread-only]").forEach((b) => (b.hidden = tot));
  if (tot && !["anchored", "points"].includes(liveSource)) {
    liveSource = "anchored";
    $$("#live-source button").forEach((x) => x.classList.toggle("on", x.dataset.v === liveSource));
  }
  $("#live-recent-head").textContent = `Recent Market-anchored ${tot ? "over/unders" : "picks"} (edge 1.5+)`;
  if (!L || !L.games) {
    $("#live-intro").textContent = tot ? "No over/under picks recorded yet. They start appearing once totals are posted."
      : "No live picks recorded yet. They start appearing once lines are posted.";
    $("#live-verdict").innerHTML = ""; $("#live-stats").innerHTML = ""; $("#live-table").innerHTML = "";
    return;
  }
  const since = new Date(L.since).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  const proof = proofLink();
  $("#live-intro").innerHTML = `Since ${esc(since)}, every game's ${tot ? "over/under pick has been saved the first time its total" : "pick has been saved the first time its line"} appeared, at that number,
    and never changed afterward (${L.games} games so far). This is the real test: unlike the backtest below, these picks were made
    before anyone knew the results.${proof ? ` <a href="${proof}" target="_blank" rel="noopener">See when each pick was recorded</a>.` : ""}`;
  const s = L.summary.find((x) => x.key === liveSource && x.tier === liveTier);
  const rec = (r) => `${r.wins}-${r.losses}${r.pushes ? "-" + r.pushes : ""}`;
  const n = s.at_logged.wins + s.at_logged.losses;
  const beat = s.moved_n ? Math.round(s.clv_beat_rate * s.moved_n) : 0;
  $("#live-verdict").innerHTML = liveVerdict(s, market);
  $("#live-stats").innerHTML = [
    [`${tot ? "Total" : "Line"} moved our way`, pct(s.clv_beat_rate), s.moved_n ? `${beat} of ${s.moved_n} moves · ±${(100 * moe(s.moved_n)).toFixed(0)}` : "No moves yet"],
    ["Average move", s.avg_clv == null ? "—" : `${s.avg_clv >= 0 ? "+" : ""}${s.avg_clv.toFixed(2)}`, "points per pick, logged to kickoff"],
    [`Record at the ${tot ? "total" : "line"} we logged`, rec(s.at_logged), n ? `${pct(s.at_logged.hit_rate, 1)} ±${(100 * moe(n)).toFixed(0)} · at the close ${rec(s.at_close)}` : "No games finished yet"],
    ["Picks", s.picks, `${s.pending} still to play`],
  ].map(([k, v, sub]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="k">${esc(sub)}</div></div>`).join("");
  const res = { W: `<span class="badge win">Won</span>`, L: `<span class="badge loss">Lost</span>`, P: `<span class="badge pass">Push</span>` };
  $("#live-table").innerHTML = `<tr><th>Kickoff</th><th class="l">Game</th><th class="l">Pick</th><th>Edge</th><th>${tot ? "Total" : "Line"} moved</th><th class="l">Result</th></tr>` +
    (L.recent.length ? L.recent.map((p) => `<tr>
      <td>${esc(new Date(p.kickoff).toLocaleDateString(undefined, { month: "short", day: "numeric" }))}</td>
      <td class="l">${esc(p.game)}</td><td class="l"><b>${tot ? `${p.side === "over" ? "Over" : "Under"} ${p.line}` : `${esc(p.team)} ${fmtLine(p.line)}`}</b></td>
      <td><span class="badge ${p.tier}">${p.edge.toFixed(1)}</span></td>
      <td class="${p.clv > 0 ? "good" : p.clv < 0 ? "bad" : ""}">${p.clv == null ? "—" : (p.clv > 0 ? "+" : "") + p.clv}</td>
      <td class="l">${p.result ? res[p.result] : `<span class="note">Pending</span>`}</td></tr>`).join("")
      : `<tr><td colspan="6" class="empty">No picks with an edge yet.</td></tr>`);
}

// ---------- Model changes ----------

/** Track record keeps the full, dated history; the Games tab shows the newest change for two
 *  weeks, until the visitor dismisses it. Entries live in data/changelog.json. */
function renderChangelog() {
  const log = [...(state.changelog || [])].filter((c) => c.type === "model").sort((a, b) => b.date.localeCompare(a.date));
  const day = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  $("#changelog").innerHTML = log.length ? log.map((c) => `<div class="card change">
      <div class="change-date">${esc(day(c.date))}</div><h4>${esc(c.title)}</h4>
      <dl class="gd-dl"><dt>Why</dt><dd>${esc(c.why)}</dd><dt>Effect</dt><dd>${esc(c.effect)}</dd>
      <dt>Pick log</dt><dd>${esc(c.forward_test)}</dd></dl></div>`).join("")
    : `<p class="note">No changes since the forward test started.</p>`;
  const latest = log[0];
  const fresh = latest && Date.now() - Date.parse(latest.date) < 14 * 864e5;
  if (!fresh || store.get("noticeSeen", "") === latest.date) { $("#model-notice").innerHTML = ""; return; }
  $("#model-notice").innerHTML = `<div class="notice" role="status">
      <span class="notice-tag">Model update · ${esc(day(latest.date))}</span>
      <span>${esc(latest.title)}. <a href="#updates" data-to-changelog>What changed and why</a></span>
      <button class="notice-x" type="button" aria-label="Dismiss" data-dismiss-notice>✕</button></div>`;
  $("[data-dismiss-notice]").addEventListener("click", () => { store.set("noticeSeen", latest.date); renderChangelog(); });
}

// ---------- Wiring ----------

function renderAll() { renderWeekbar(); renderGames(); renderPicks(); renderBets(); }

/** The Projection dropdown lists what can project the chosen market: FPI doesn't project scoring. */
function renderSourceSelect() {
  const opts = state.market === "total"
    ? [["anchored", "★ Market-anchored"], ["points", "Adjusted points"]]
    : SPREAD_SOURCES.map((k) => [k, (k === "anchored" ? "★ " : "") + SOURCE_LABEL[k]]);
  const sel = $("#source");
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  // a remembered choice that isn't offered (any more) falls back to the default
  for (const [key, ok] of [["source", SPREAD_SOURCES], ["totalSource", ["anchored", "points"]]]) {
    if (!ok.includes(state[key])) { state[key] = "anchored"; store.set(key, "anchored"); }
  }
  sel.value = state.market === "total" ? state.totalSource : state.source;
  $$("#market button").forEach((b) => b.classList.toggle("on", b.dataset.v === state.market));
}

function setFilter(f) {
  state.filter = f;
  $$("#filter button").forEach((x) => x.classList.toggle("on", x.dataset.filter === f));
}

/** Once next week's lines are posted (usually Sunday), say so while the current week is on screen:
 *  the model tested best at the opening number, before the market moves. */
async function checkNextWeek() {
  const box = $("#open-notice"), cur = state.currentIndex, nxt = state.calendar[cur + 1];
  if (cur < 0 || !nxt || state.weekIndex !== cur) { box.innerHTML = ""; return; }
  const key = `${state.season}-${nxt.seasontype}-${nxt.week}`;
  if (store.get("openSeen", "") === key) { box.innerHTML = ""; return; }
  try {
    if (state.next?.key !== key || Date.now() - state.next.at > 30 * 60e3) {
      const d = await getJSON(`${ESPN}/scoreboard?groups=80&limit=300&dates=${state.season}&seasontype=${nxt.seasontype}&week=${nxt.week}`);
      state.next = { key, at: Date.now(), games: (d.events || []).map(parseEvent) };
    }
  } catch { return; }  // try again on the next refresh
  const tot = state.market === "total";
  const posted = state.next.games.filter((g) => g.state === "pre" && (tot ? g.total : g.line) != null);
  if (!posted.length || state.weekIndex !== cur) { box.innerHTML = ""; return; }
  const evs = posted.map((g) => evaluate(g));
  const fresh = posted.filter((g, i) => atOpen(g, evs[i])).length;
  box.innerHTML = `<div class="notice notice-open" role="status">
      <span class="notice-tag">${tot ? "Totals" : "Lines"} are up · ${esc(nxt.label)}</span>
      <span>${posted.length} game${posted.length === 1 ? " has" : "s have"} ${tot ? "a total" : "a line"}. ${fresh
        ? `<b>${fresh}</b> ${fresh === 1 ? "edge is" : "edges are"} still at the opening number, where the model tested best.
          <button class="link" type="button" data-next-week>See ${fresh === 1 ? "it" : "them"} ›</button>`
        : `No edges are at their opening number right now; the model tested best there.
          <button class="link" type="button" data-next-week>See the week ›</button>`}</span>
      <button class="notice-x" type="button" aria-label="Dismiss" data-dismiss-open>✕</button></div>`;
  $("[data-dismiss-open]").addEventListener("click", () => { store.set("openSeen", key); box.innerHTML = ""; });
  $("[data-next-week]").addEventListener("click", () => {
    setFilter(fresh ? "open" : "all");
    state.weekIndex = cur + 1; box.innerHTML = ""; refresh(state.weekIndex);
  });
}

function applyTheme() {
  const t = state.settings.theme;
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

async function refresh(index = state.weekIndex) {
  try {
    await loadWeek(index);
    renderAll();
    checkNextWeek();
    $("#updated").textContent = `Scores updated ${new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` +
      (state.ratings ? ` · ratings ${new Date(state.ratings.updated).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "");
  } catch (e) {
    $("#games").innerHTML = `<div class="card error">Couldn't load games from ESPN (${esc(e.message)}). Check your connection and try again.</div>`;
  }
  clearTimeout(state.timer);
  // Live games refresh every 30 seconds; otherwise every 5 minutes
  state.timer = setTimeout(() => refresh(), state.games.some((g) => g.state === "in") ? 30e3 : 300e3);
}

function bind() {
  const showTab = () => {
    const h = location.hash.slice(1);
    const game = h.startsWith("game/") ? h.slice(5) : null;  // #game/<id>: game detail view (game.js)
    const name = game ? "game" : $(`.tabs button[data-tab="${h}"]`) ? h : "games";
    $$(".tabs button").forEach((x) => x.setAttribute("aria-selected", x.dataset.tab === (game ? "games" : name)));
    $(".tabs button[aria-selected=true]")?.scrollIntoView({ block: "nearest", inline: "nearest" });  // phones: keep it visible
    $$(".tab").forEach((s) => (s.hidden = s.id !== "tab-" + name));
    if (name === "picks") gradeOldPicks();
    if (typeof showGame === "function") { if (game) showGame(game); else leaveGame(); }
  };
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => { location.hash = b.dataset.tab; }));
  window.addEventListener("hashchange", showTab);
  showTab();

  $("#week-prev").addEventListener("click", () => { if (state.weekIndex > 0) refresh(--state.weekIndex); });
  $("#week-next").addEventListener("click", () => { if (state.weekIndex < state.calendar.length - 1) refresh(++state.weekIndex); });

  renderSourceSelect();
  const src = $("#source");
  src.addEventListener("change", () => {
    if (state.market === "total") { state.totalSource = src.value; store.set("totalSource", src.value); }
    else { state.source = src.value; store.set("source", src.value); }
    renderGames();
  });
  $$("#market button").forEach((b) => b.addEventListener("click", () => {
    state.market = b.dataset.v; store.set("market", state.market);
    renderSourceSelect(); renderGames(); checkNextWeek();
  }));
  const sort = $("#sort"); sort.value = state.sort;
  sort.addEventListener("change", () => { state.sort = sort.value; store.set("sort", state.sort); renderGames(); });
  $("#search").addEventListener("input", (e) => { state.search = e.target.value; renderGames(); });
  $$("#filter button").forEach((b) => b.addEventListener("click", () => { setFilter(b.dataset.filter); renderGames(); }));

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-track],[data-unpick],[data-delbet],th[data-sort]");
    if (!t) {
      const card = e.target.closest("article.game[data-game]");
      if (card && !e.target.closest("a,button")) location.hash = `game/${card.dataset.game}`;
      return;
    }
    if (t.dataset.track) toggleTrack(t.dataset.track);
    else if (t.dataset.unpick) { store.set("picks", store.get("picks", []).filter((p) => p.id !== t.dataset.unpick)); renderAll(); }
    else if (t.dataset.delbet) { const b = store.get("bets", []); b.splice(+t.dataset.delbet, 1); store.set("bets", b); renderBets(); }
    else { const k = t.dataset.sort; ratingSort = { key: k, dir: ratingSort.key === k ? -ratingSort.dir : k === "team" ? 1 : -1 }; renderRatings(); }
  });
  document.addEventListener("keydown", (e) => {
    const card = e.target.closest?.("article.game[data-game]");
    if (card && e.target === card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); location.hash = `game/${card.dataset.game}`; }
  });
  $("#bets-table").addEventListener("change", (e) => {
    const i = e.target.dataset.bet; if (i == null) return;
    const b = store.get("bets", []); b[+i].result = e.target.value || null; store.set("bets", b); renderBets();
  });
  $("#picks-clear").addEventListener("click", () => {
    if (confirm("Remove all tracked picks from this browser?")) { store.set("picks", []); renderAll(); }
  });

  const form = $("#bet-form");
  const today = () => new Date().toLocaleDateString("en-CA");  // YYYY-MM-DD in local time
  form.date.value = today();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(form)); b.result = null;
    store.set("bets", [...store.get("bets", []), b]);
    form.reset(); form.date.value = today();
    renderBets();
  });
  $("#bets-export").addEventListener("click", () => {
    const rows = [BET_COLS, ...store.get("bets", []).map((b) => BET_COLS.map((c) => b[c] ?? ""))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" }));
    a.download = "bets.csv"; a.click(); URL.revokeObjectURL(a.href);
  });
  $("#bets-import").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const [head, ...rows] = parseCSV(await f.text());
    const idx = head.map((h) => h.trim().toLowerCase());
    const imported = rows.map((r) => Object.fromEntries(BET_COLS.map((c) => [c, r[idx.indexOf(c)] ?? ""])))
      .map((b) => ({ ...b, result: b.result || null }));
    store.set("bets", [...store.get("bets", []), ...imported]);
    e.target.value = ""; renderBets();
  });

  $("#rating-search").addEventListener("input", renderRatings);
  for (const [id, setter, render] of [["#rec-against", (v) => (recAgainst = v), renderRecord],
    ["#rec-edge", (v) => (recEdge = v), renderRecord], ["#live-source", (v) => (liveSource = v), renderLive],
    ["#live-tier", (v) => (liveTier = v), renderLive],
    ["#rec-market", (v) => (recMarket = v), () => { renderLive(); renderRecord(); }]]) {
    $$(`${id} button`).forEach((b) => b.addEventListener("click", () => {
      $$(`${id} button`).forEach((x) => x.classList.toggle("on", x === b)); setter(b.dataset.v); render();
    }));
  }

  const dlg = $("#settings");
  $("#settings-btn").addEventListener("click", () => {
    $("#set-hfa").value = hfa(); $("#set-sigma").value = state.settings.sigma ?? ""; $("#set-theme").value = state.settings.theme;
    dlg.showModal();
  });
  dlg.addEventListener("close", () => {
    const h = parseFloat($("#set-hfa").value), s = parseFloat($("#set-sigma").value);
    state.settings = { hfa: Number.isFinite(h) ? h : null, sigma: Number.isFinite(s) ? s : null, theme: $("#set-theme").value };
    store.set("settings", state.settings); applyTheme(); renderGames();
  });
}

async function init() {
  applyTheme();
  bind();
  const [ratings, model, record, live, changelog, qb, weather] = await Promise.all(
    ["ratings", "model", "track_record", "live", "changelog", "qb", "weather"].map((n) => getJSON(`data/${n}.json`).catch(() => null)));
  state.qb = qb?.teams || null;
  state.weather = weather?.games || null;
  if (ratings) {
    const played = ratings.teams.filter((t) => t.ppg != null);
    const avg = played.reduce((s, t) => s + t.ppg + t.papg, 0) / (2 * played.length || 1);  // model.project's avg
    state.ratings = { ...ratings, avg, list: ratings.teams, byId: Object.fromEntries(ratings.teams.map((t) => [String(t.id), t])) };
  }
  state.model = model;
  state.record = record;
  state.live = live;
  state.changelog = changelog || [];
  renderChangelog();
  renderRatings();
  renderRecord();
  renderLive();
  await refresh(-1);
}

// game.js waits on this before drawing a game detail view
const appReady = init();
