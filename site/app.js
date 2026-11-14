"use strict";

// ---------- Settings and storage ----------

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/college-football";
/** Team logos, resized by ESPN's image server: the originals are 500 pixels and about 40 KB each, and the
 *  site shows them at 20-52 pixels (all of a week's games came to 5.5 MB; this is about 0.4 MB). On a
 *  dark background it uses ESPN's dark-mode versions, where navy and black logos (Akron's) turn light. */
const isDark = () => (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
const LOGO = (id, px = 96) =>
  `https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa/${isDark() ? "500-dark" : "500"}/${encodeURIComponent(id)}.png&w=${px}&h=${px}`;
/** After the theme changes: every logo on the page switches to the version for the new background. */
function swapLogos() {
  const v = isDark() ? "/ncaa/500-dark/" : "/ncaa/500/";
  $$('img[src*="/teamlogos/ncaa/"]').forEach((img) => (img.src = img.src.replace(/\/ncaa\/500(-dark)?\//, v)));
}
const STRONG = 3, LEAN = 1.5;          // edge thresholds in points
const CHECK = 5;                       // bigger gaps usually mean the market knows something (injury, QB change)
const CLOSE = 4;                       // a live game this close to the spread could flip on a field goal
const BREAKEVEN = 0.524;               // hit rate needed at -110
const CUSHION = 0.01;                  // Go for it: the best number on offer beats its break-even by at least a point
const ODDS_MAX_AGE = 12 * 3600e3;      // line-shopping quotes older than this don't decide labels
// Hit rate gained per point the line moves toward a pick between the logged line and kickoff. Measured
// in the 2023-2026 backtest (opening vs closing results); it turns line movement into an estimated
// hit rate long before wins and losses can say anything.
const CLV_PER_POINT = { spread: 0.03, total: 0.025 };
const SOURCE_LABEL = { blend: "Blend", fpi: "ESPN FPI", efficiency: "Efficiency", success: "Success rate", anchored: "Market-anchored", points: "Adjusted points" };
// Blend is the default for spreads: in the 2024-2026 backtest it beat Market-anchored at both the opening and closing line
const SPREAD_SOURCES = ["blend", "fpi", "efficiency", "success", "anchored", "points"];
const TIER_LABEL = { check: "Check the news", strong: "Go for it", lean: "Lean", pass: "Punt" };  // fourth-down calls
/** Edge size to label, before prices: under 1.5 is Punt and 5+ is Check the news (in the cleaned
 *  2023-2026 backtest it did no better than 3-5, and a gap that big usually means the model is missing
 *  news the market has). Between them, withValue() decides Go for it or Lean from the best price on offer. */
const tierOf = (edge) => { const e = Math.abs(edge); return e >= CHECK ? "check" : e >= STRONG ? "strong" : e >= LEAN ? "lean" : "pass"; };
/** A team's quarterback situation just changed (data/qb.json, from box scores), or null. */
const qbChange = (g) => (g.state === "post" ? null  // flags describe the latest games, not past ones
  : [g.home, g.away].map((t) => state.qb?.[t.id]).find((f) => f?.kind === "change") || null);
/** A QB change is shown as a tag and a note but no longer changes a pick's label (it did from
 *  October 29 to November 10, 2026, on a 57-game sample from 2026). Over 2023-2026 box scores,
 *  Blend's 1.5+ edges in those games went 54% at the opening line against 57% in the rest, and
 *  53% against 53% at the close. Since November 14, 2026 it can change the projection instead:
 *  see qbAdjust. */
/** The quarterback placeholder on a team for this game, or null: {points, why, player, note} from
 *  data/qb.json "adjust" (build_props.qb_adjust decides who gets one). An established starter is out:
 *  listed out or doubtful on a report (why "listed"), or a backup led the team's last game (why
 *  "change", that one game only). points come off the team's side of every spread projection. It's
 *  tied to one game by id, so it never applies to another week or to the Ratings tab's what-ifs. */
const qbAdjust = (g, t) => { const a = t && state.qbAdjust?.[t.id]; return a && g.id != null && String(a.game_id) === String(g.id) ? a : null; };
/** Points the placeholders add to the home margin (the qb argument of spreadProjections). */
const qbShift = (g) => (qbAdjust(g, g.away)?.points || 0) - (qbAdjust(g, g.home)?.points || 0);
/** How much of a placeholder a projection takes: all of it, or for Market-anchored only its ratings' share
 *  (about a third), since the line it starts from already has the market's view of the quarterback. */
const qbShare = (src) => { const w = state.model?.anchor?.weights; return src === "anchored" ? (w ? w.fpi + w.points : 0) : 1; };
const fmtPts = (x) => String(+x.toFixed(1));
/** [{team, a, points}] for the teams in this game with a placeholder: points is what it takes off that
 *  team in the projection named (2 for Blend, about 0.7 for Market-anchored). */
const qbEffects = (g, src = state.source) => [g.away, g.home].map((t) => ({ team: t, a: qbAdjust(g, t) }))
  .filter((x) => x.a).map((x) => ({ ...x, points: x.a.points * qbShare(src) }));
/** "2 points off Iowa" for each placeholder, for notes. */
const qbEffectTxt = (g, src = state.source) => qbEffects(g, src).map((x) => `${fmtPts(x.points)} ${x.points === 1 ? "point" : "points"} off ${x.team.name}`).join(" and ");
/** A bowl outside the College Football Playoff. In 2023-2025 those went badly for every projection
 *  (FPI 42% at the opening line, 95 picks; Blend 47%): opt-outs, transfers and coaching changes
 *  aren't in the ratings. Playoff games did fine, so they keep their normal labels. */
const isBowl = (g) => !!g.postseason && !/playoff|cfp/i.test(g.note || "");
const BOWL_NOTE = "Bowl game: opt-outs, transfers and coaching changes aren't in the model, and in 2023-2025 bowls outside the playoff its picks went 42-47% at the opening line. Check who's playing.";
/** Quarterbacks on the official availability reports for this game (data/qb.json "listed", entered by
 *  hand from the Power 4 conferences' reports), for one team: [{player, status, starter, ...}]. */
const qbListed = (g, t) => (g.state === "pre" && t ? (state.qbListed?.[t.id] || []).filter((f) => f.game_id === g.id) : []);
/** The team's usual starter listed Out or Doubtful, or null. In 2023-2026, a team whose starting QB sat
 *  unexpectedly covered 43% at the opening line (317 games), and the model's picks on it went 16-20. */
const qbOut = (g, t) => qbListed(g, t).find((f) => f.starter !== false && (f.status === "out" || f.status === "doubtful")) || null;
const QB_OUT_NOTE = (f, placeholder) => `${f.player} (${f.team}'s usual starter) is listed ${f.status} on the ${f.date} availability report. In 2023-2026, teams whose starting quarterback sat unexpectedly covered 43% at the opening line${placeholder ? `, and picks on them lost more than they won even after the ${placeholder} this projection takes off` : ""}.`;
/** team: the picked team, for spread picks; picks against a team with its starter out did fine, so only picks on it change. */
const gameTier = (g, edge, team) => { const t = tierOf(edge); return t !== "pass" && (isBowl(g) || qbOut(g, team)) ? "check" : t; };
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
  source: store.get("source", "blend"),
  totalSource: store.get("totalSource", "anchored"),  // totals: Market-anchored or Adjusted points
  sort: store.get("sort", "time"),
  search: "",
  settings: store.get("settings", { hfa: null, sigma: null, theme: "auto" }),
  timer: null,
  changelog: [],        // changelog.json: dated model changes
  qb: null,             // qb.json: {team id: QB change flag}
  qbListed: null,       // qb.json: {team id: [QBs on the availability reports]}
  qbAdjust: null,       // qb.json: {team id: quarterback placeholder for one game}
  qbCleared: null,      // qb.json: {team id: starter listed available, which cancels a placeholder}
  odds: null,           // odds.json: {game id: best and middle numbers across sportsbooks}
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
// Market-anchored was the default until November 10, 2026. It was saved as a choice even for people
// who never picked it, so move them to the new default once; picking it again afterward sticks.
if (store.get("defaults", 0) < 2) {
  if (state.source === "anchored") { state.source = "blend"; store.set("source", "blend"); }
  store.set("defaults", 2);
}

const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

const hfa = () => state.settings.hfa ?? state.model?.hfa ?? 3.0;  // model.HFA, normally from data/model.json
const sigma = (market = state.market) => market === "total"
  ? state.model?.sigma_total?.[state.totalSource] || 16
  : state.settings.sigma || state.model?.sigma?.[state.source] || 15.5;

/** How much of a projection's gap to the line to believe when turning it into a cover chance
 *  (model.fit_shrink, in data/model.json): gaps read at face value were far too confident. */
const shrink = (market, src) => state.model?.shrink?.[market]?.[src] ?? 1;

/** Projected home margin for one game from every source, or null where a source can't make one.
 *  The math is in projections.js, which check_parity.py compares with model.py. */
function projections(g) {
  const r = state.ratings?.byId || {};
  return spreadProjections(r[g.home.id], r[g.away.id], { neutral: g.neutral, line: g.line, hfa: hfa(), model: state.model, qb: qbShift(g) });
}

/** Projected total points from each totals source (same math as record.log_totals). */
function totalProjections(g) {
  const r = state.ratings?.byId || {};
  return totalProjectionsFor(r[g.home.id], r[g.away.id], { total: g.total, avg: state.ratings?.avg, model: state.model });
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
  const believed = -line + shrink("spread", state.source) * (margin + line);  // the margin the cover chance uses
  const homeProb = normCdf((believed + line) / s);
  const homePick = homeProb >= 0.5;
  const left = secsLeft(g), cur = g.home.score - g.away.score, x = cur + line;
  let live;
  if (g.state === "pre") live = null;
  else if (left <= 0) live = x > 0 ? 1 : x < 0 ? 0 : 0.5;
  else { const f = Math.min(left / 3600, 1); live = normCdf((x + believed * f) / (s * Math.sqrt(f))); }
  const edge = Math.abs(margin + line);
  return withValue(g, {
    margin, line, edge,
    tier: gameTier(g, edge, homePick ? g.home : g.away),
    side: homePick ? "home" : "away",
    team: homePick ? g.home : g.away,
    pickLine: homePick ? line : -line,
    pre: homePick ? homeProb : 1 - homeProb,
    live: live == null ? null : homePick ? live : 1 - live,
  });
}

function evaluateTotal(g) {
  const proj = totalProjections(g)[state.totalSource], line = g.total;
  if (proj == null || line == null) return { total: true, margin: proj, reason: whyNoPick(g, proj, line, "total") };
  const s = sigma("total");
  const believed = line + shrink("total", state.totalSource) * (proj - line);
  const overProb = 1 - normCdf((line - believed) / s);
  const over = overProb >= 0.5;
  const left = secsLeft(g), cur = g.home.score + g.away.score;
  let live = null;
  if (g.state !== "pre") {
    // points already scored, plus the projection for the time left; an over that's already past the line has won
    if (cur > line) live = 1;
    else if (left <= 0) live = cur < line ? 0 : 0.5;
    else { const f = Math.min(left / 3600, 1); live = 1 - normCdf((line - cur - believed * f) / (s * Math.sqrt(f))); }
  }
  const edge = Math.abs(proj - line);
  // an over in a windy game is betting against a drop the market usually makes by kickoff
  const windy = over && weatherOf(g)?.windy;
  const tier = windy && tierOf(edge) !== "pass" ? "check" : gameTier(g, edge);
  return withValue(g, {
    total: true, margin: proj, line, edge, tier, side: over ? "over" : "under", team: null, pickLine: line,
    pre: over ? overProb : 1 - overProb, live: live == null ? null : over ? live : 1 - live,
  });
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
    rank: x.curatedRank?.current && x.curatedRank.current < 26 ? x.curatedRank.current : null,
    record: x.records?.[0]?.summary || "",
    score: parseInt(x.score || 0, 10),
    winner: x.winner,
  });
  const g = {
    id: e.id, date: e.date, tbd: c.timeValid === false, home: team(t.home), away: team(t.away),
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
  // the search narrows the counts on the filter buttons too, so a count never promises games the list hides
  const found = state.games.filter((g) => !q || `${g.home.name} ${g.away.name} ${g.home.abbr} ${g.away.abbr}`.toLowerCase().includes(q));
  const all = found.map((g) => evaluate(g));
  let rows = found.map((g, i) => ({ g, ev: all[i] }));
  rows = rows.filter(({ g, ev }) => {
    if (state.filter === "edge") return ev.edge >= LEAN;
    if (state.filter === "strong") return ev.tier === "strong";
    if (state.filter === "open") return atOpen(g, ev);
    if (state.filter === "live") return g.state === "in";
    if (state.filter === "close") return isClose(g);
    return true;
  });
  if (state.filter === "close") rows.sort((a, b) => Math.abs(spreadGap(a.g)) - Math.abs(spreadGap(b.g)));  // tightest first
  else if (state.sort === "edge") rows.sort((a, b) => (b.ev.edge ?? -1) - (a.ev.edge ?? -1));
  else rows.sort((a, b) => kickSort(a.g) - kickSort(b.g) || (b.ev.edge ?? -1) - (a.ev.edge ?? -1));

  const counts = {
    all: found.length, edge: all.filter((e) => e.edge >= LEAN).length,
    strong: all.filter((e) => e.tier === "strong").length, open: found.filter((g, i) => atOpen(g, all[i])).length,
    live: found.filter((g) => g.state === "in").length, close: found.filter(isClose).length,
  };
  $$("[data-count]").forEach((el) => (el.textContent = state.games.length ? counts[el.dataset.count] : ""));
  $('#filter [data-filter="live"]').classList.toggle("is-live", counts.live > 0);
  $('#filter [data-filter="close"]').classList.toggle("is-live", counts.close > 0);
  $("#games-summary").textContent = state.games.length ? `${state.market === "total" ? "Over/under" : "Cover"} chances are scaled to how often picks have won` : "";

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
      : q ? noMatch(q, found.length)
      : state.filter === "open" ? "No edges of 1.5+ are still at their opening number. Lines for next week usually post on Sunday." : "No games match these filters."}</div>`;
    return;
  }
  const tracked = new Set(store.get("picks", []).map((p) => p.id));
  const byDay = state.sort === "time";
  const cards = (list) => {
    if (!byDay) return `<div class="grid">${list.map(({ g, ev }) => card(g, ev, tracked.has(trackKey(g)))).join("")}</div>`;
    let html = "", day = "";
    for (const { g, ev } of list) {
      const d = kickDay(g, { weekday: "long", month: "short", day: "numeric" });
      if (d !== day) { html += (day ? "</div>" : "") + `<h2 class="day-head">${esc(d)}</h2><div class="grid">`; day = d; }
      html += card(g, ev, tracked.has(trackKey(g)));
    }
    return html + (day ? "</div>" : "");
  };
  // Games still to play (and live ones) come first; finished games fold away at the bottom, latest first,
  // and stay open once you open them. With nothing left to play (a past week), they're simply shown.
  const ahead = rows.filter(({ g }) => g.state !== "post"), done = rows.filter(({ g }) => g.state === "post");
  if (byDay) done.reverse();
  const open = !ahead.length || store.get("finalsOpen", false);
  box.innerHTML = cards(ahead) + (done.length ? `<details class="finals"${open ? " open" : ""}${ahead.length ? "" : " data-auto"}>
      <summary><h2 class="day-head">Final · ${done.length} game${done.length === 1 ? "" : "s"}<span class="finals-act" aria-hidden="true"></span></h2></summary>
      ${cards(done)}</details>` : "");
}

/** Empty list with a search: say whether the search or the filter is hiding the games. */
function noMatch(q, n) {
  if (!n) return `No games this week match "${esc(q)}". <button class="link" type="button" data-clear-search>Clear the search</button>`;
  const label = $(`#filter [data-filter="${state.filter}"]`)?.querySelector(".lbl").textContent.replace(/\s+/g, " ").trim();
  const on = ["live", "close"].includes(state.filter) ? "" : ` on the ${state.market === "total" ? "total" : "spread"}`;
  return `${n} game${n === 1 ? " matches" : "s match"} "${esc(q)}", but ${n === 1 ? "it isn't" : "none are"} <b>${esc(label)}</b>${on}.
    <button class="link" type="button" data-show-all>Show ${n === 1 ? "it" : "them"}</button> ·
    <button class="link" type="button" data-clear-search>Clear the search</button>`;
}

function teamRow(t, g, picked) {
  const showScore = g.state !== "pre";
  const lost = g.state === "post" && t.winner === false;
  return `<div class="team${lost ? " lost" : ""}${picked ? " picked" : ""}">
    <img src="${LOGO(t.id)}" alt="" loading="lazy">
    <span class="name">${t.rank ? `<span class="rank">${t.rank}</span>` : ""}${esc(t.name)}<span class="rec">${esc(t.record)}</span></span>
    ${picked ? `<span class="pick-tag">Pick</span>` : ""}
    ${showScore ? `<span class="score">${t.score}</span>` : ""}
  </div>`;
}

/** Kickoffs. ESPN puts a game whose time isn't set yet at midnight Eastern (timeValid false, status TBD):
 *  its day is read in Eastern time, so it's the right day anywhere, it sorts last on that day, and its
 *  time says TBD instead of 12:00 AM. */
const ET = "America/New_York";
const kickDay = (g, opts) => new Date(g.date).toLocaleDateString(undefined, g.tbd ? { ...opts, timeZone: ET } : opts);
const kickTime = (g) => (g.tbd ? "Time TBD" : new Date(g.date).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
const kickSort = (g) => Date.parse(g.date) + (g.tbd ? 86399e3 : 0);

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

/** Line shopping (data/odds.json, from The Odds API): the best number on offer for a pick across US
 *  sportsbooks, or null. better: how many points better it is than the line shown here (ESPN's).
 *  Books aren't named. */
function bestNumber(g, ev) {
  const o = g.state === "pre" && ev?.line != null ? state.odds?.[g.id] : null;
  if (!o) return null;
  // a best quote far from the middle of the books is a feed error or a stale line (odds.MAX_OFF)
  const raw = ev.total ? (ev.side === "over" ? o.over_best : o.under_best) : ev.side === "home" ? o.home_best : o.away_best;
  const mid = ev.total ? o.total_mid : o.spread_mid;
  if (raw != null && mid != null && Math.abs(raw - mid) > 1.5) return null;
  let line, price, better, label;
  if (ev.total) {
    [line, price] = ev.side === "over" ? [o.over_best, o.over_price] : [o.under_best, o.under_price];
    if (line == null) return null;
    better = ev.side === "over" ? ev.line - line : line - ev.line;
    label = `${ev.side === "over" ? "Over" : "Under"} ${line}`;
  } else {
    const home = ev.side === "home";
    [line, price] = home ? [o.home_best, o.home_price] : [o.away_best == null ? null : -o.away_best, o.away_price];
    if (line == null) return null;
    better = line - ev.pickLine;  // a bigger number on your own side is better
    label = `${ev.team.abbr} ${fmtLine(line)}`;
  }
  return { line, price, better, label, books: o.books, mid: ev.total ? o.total_mid : o.spread_mid };
}
const shopNote = (b) => `Best number: ${b.label} (${b.price > 0 ? "+" : ""}${b.price}) across ${b.books} sportsbook${b.books === 1 ? "" : "s"}` +
  (b.better > 0 ? `, ${b.better} point${b.better === 1 ? "" : "s"} better than the line shown here.` : b.better < 0 ? `. The line shown here is better than any of them.` : `, the same as the line shown here.`);

/** Break-even hit rate at American odds: -110 needs 52.4%, -120 needs 54.5%, +100 needs 50%. */
const breakEven = (price) => (price < 0 ? -price / (100 - price) : 100 / (100 + price));
const fmtPrice = (p) => (p > 0 ? "+" : "") + p;
/** The pick at a number this many points better than the line shown: "BALL +2", "Over 50.5". */
const numberLabel = (ev, x) => (ev.total ? `${ev.side === "over" ? "Over" : "Under"} ${ev.side === "over" ? ev.line - x : ev.line + x}`
  : `${ev.team.abbr} ${fmtLine(ev.pickLine + x)}`);

/** Whether a pregame pick is worth a bet: its chance at the best line and price on offer (line shopping)
 *  against that price's break-even, or, without fresh quotes, at the line shown and the usual -110. Each
 *  point better than the line shown adds CLV_PER_POINT of hit rate, the backtest's value of a point of
 *  line. need: how many points better than the line shown it takes at -110, in half points. */
function valueOf(g, ev) {
  const k = CLV_PER_POINT[ev.total ? "total" : "spread"], at110 = breakEven(-110) + CUSHION;
  let need = 0;
  while (ev.pre + k * need < at110 && need < 10) need += 0.5;
  const fresh = state.oddsAt && Date.now() - Date.parse(state.oddsAt) < ODDS_MAX_AGE;
  const shop = fresh ? bestNumber(g, ev) : null;
  const b = shop || { line: ev.total ? ev.line : ev.pickLine, price: -110, better: 0, label: numberLabel(ev, 0), books: 0 };
  // bar: the chance that price needs to be worth a bet, the yellow line on the card's chance bar. Compared at
  // the tenth of a percent the card shows, so Go for it is always a bar visibly past the line.
  const p = Math.min(ev.pre + k * b.better, 0.99), be = breakEven(b.price), bar = be + CUSHION;
  const clears = Math.round(1000 * p) > Math.round(1000 * bar);
  return { need, target: numberLabel(ev, need), best: { ...b, p, be, bar, clears, shop: !!shop } };
}

/** Go for it or Lean, for picks between Punt and Check the news: Go for it when the best number on offer
 *  beats its break-even by a point. Once a game starts there's no price left to judge it by: Lean. */
function withValue(g, ev) {
  if (g.state === "pre") ev.value = valueOf(g, ev);
  if (ev.tier === "strong" || ev.tier === "lean") ev.tier = ev.value?.best.clears ? "strong" : "lean";
  return ev;
}

/** The pick box's word on price: where the pick is worth a bet, or the number it needs. */
function valueNote(ev) {
  const v = ev.value, b = v.best, hit = ev.total ? "hit" : "cover";
  if (b.clears) {
    return b.shop ? `Best number: ${b.label} (${fmtPrice(b.price)}) across ${b.books} sportsbooks. About ${pct(b.p, 1)} to ${hit} there, past the ${pct(b.bar, 1)} that price needs (break-even plus a point).`
      : `About ${pct(b.p, 1)} to ${hit} at the line shown, past the ${pct(b.bar, 1)} that -110 needs (break-even plus a point).`;
  }
  return `Worth a bet at ${v.target} or better at -110` + (b.shop ? `; the best of ${b.books} sportsbooks is ${b.label} (${fmtPrice(b.price)}), which needs ${pct(b.bar, 1)}.` : ".");
}

/** The "Model pick" box shared by game cards and the game detail view. */
function pickBox(g, ev, { tierTxt } = {}) {
  const st = pickStatus(g, ev);
  const chip = st.state === "pre"
    ? `<span class="badge ${ev.tier}">${tierTxt[ev.tier]} · ${ev.edge.toFixed(1)}</span>`
    : `<span class="pick-chip">${esc(st.chip)}</span>`;
  const icon = ev.total
    ? `<span class="ou-icon" aria-hidden="true">${ev.side === "over" ? "▲" : "▼"}</span>`
    : `<img src="${LOGO(ev.team.id)}" alt="" loading="lazy">`;
  const wx = ev.total && weatherOf(g);
  const windTxt = wx?.windy ? `${windNote(wx)}${ev.side === "over" ? ", so this over is fighting the market." : ": the market usually moves it toward the under."}` : "";
  const bowl = g.state === "pre" && isBowl(g) && ev.tier === "check";
  const out = !ev.total && ev.tier === "check" && qbOut(g, ev.team);
  // Go for it and Lean say where the pick is worth a bet; Check the news just where the best number is
  const priced = st.state === "pre" && (ev.tier === "strong" || ev.tier === "lean") && ev.value;
  const shop = st.state === "pre" && ev.tier === "check" && ev.value?.best.shop ? ev.value.best : null;
  const outAdj = out && qbAdjust(g, ev.team);
  const note = st.text || (out ? `QB ${out.status}: ${QB_OUT_NOTE(out, outAdj ? `${fmtPts(outAdj.points * qbShare(ev.src || state.source))} points` : "")}`
    : bowl ? BOWL_NOTE : windTxt || moveNote(g, ev));
  return `<div class="pickbox pb-${st.state}">
    <div class="pickbox-top"><span class="pickbox-label">Model pick${ev.total ? " · total" : ""}</span>${chip}</div>
    <div class="pickbox-main">${icon}<span class="pick">${esc(pickName(ev))}</span></div>
    ${note ? `<div class="pickbox-note${st.text ? "" : " pickbox-move"}">${esc(note)}</div>` : ""}
    ${priced ? `<div class="pickbox-note pickbox-shop${ev.value.best.clears ? " is-better" : ""}">${esc(valueNote(ev))}</div>` : ""}
    ${shop ? `<div class="pickbox-note pickbox-shop${shop.better > 0 ? " is-better" : ""}">${esc(shopNote(shop))}</div>` : ""}
  </div>`;
}

function card(g, ev, isTracked) {
  const time = g.state === "pre" ? kickTime(g) : g.status;
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
    // pregame, the bar is the chance at the best number on offer, and its yellow line the chance that price
    // needs to be worth a bet (break-even plus a point): Go for it is a bar past the line. One decimal, since
    // a few tenths decide it.
    const b = g.state === "pre" ? ev.value?.best : null;
    const p = b ? b.p : ev.live ?? ev.pre;
    const done = g.state === "post";
    // finished games drop the bar (it only said 100% or 0%) and keep the pregame chance as context
    const prob = done
      ? `<div class="prob"><div class="row"><span>${ev.total ? "Chance" : "Cover chance"} before kickoff</span><b>${pct(ev.pre)}</b></div></div>`
      : `<div class="prob">
          <div class="row"><span>${g.state !== "pre" ? `Live chance the pick ${hits}` : b?.shop ? `Chance at ${esc(b.label)} (${fmtPrice(b.price)})` : `Chance the pick ${hits}`}</span><b>${pct(p, b ? 1 : 0)}</b></div>
          <div class="bar"${b ? ` style="--line:${(100 * b.bar).toFixed(1)}%"` : ""}><i style="width:${(100 * p).toFixed(1)}%"></i></div>
          ${g.state === "in" ? `<div class="row"><span>Before kickoff</span><b>${pct(ev.pre)}</b></div>` : ""}
        </div>`;
    body = pickBox(g, ev, { tierTxt: TIER_LABEL }) + prob;
    // a quarterback placeholder in the spread projection: say so next to the number it changed
    const qbFx = ev.total ? [] : qbEffects(g);
    const qbTxt = qbFx.length ? `<span class="open" title="${esc(qbFx.map((x) => `${x.a.note} The projection takes ${fmtPts(x.points)} off ${x.team.name} as a placeholder.`).join(" "))}"> incl. ${qbFx.map((x) => `${esc(x.team.abbr)} QB −${fmtPts(x.points)}`).join(", ")}</span>` : "";
    body += `
      <div class="lines" style="margin-bottom:0"><div><span class="k">Model</span><span class="v">${modelTxt}</span>${qbTxt}</div>
        <div><span class="k">Edge</span><span class="v">${ev.edge.toFixed(1)} pts</span></div></div>`;
  }
  const canTrack = g.state === "pre" && ev.margin != null && ev.line != null;
  return `<article class="card game${ev.tier === "strong" ? " strong" : ""}" data-game="${esc(g.id)}" tabindex="0"
    aria-label="${esc(`${g.away.name} at ${g.home.name}: open game details`)}">
    <div class="game-top"><span class="${statusCls}">${esc(time)}</span>${isClose(g)
      ? `<span class="close-tag" title="The score is within ${CLOSE} points of the spread">Close · ${Math.abs(spreadGap(g)) === 0 ? "on the number" : `${Math.abs(spreadGap(g))} from the spread`}</span>` : ""}${g.state === "pre" && qbChange(g) ? `<span class="qb-tag" title="${esc(qbChange(g).note + (qbEffects(g).some((x) => x.a.why === "change") ? ` The projections take ${qbEffectTxt(g, "blend")} for it.` : ""))}">QB change</span>` : ""}${[g.away, g.home].flatMap((t) => qbListed(g, t).filter((f) => f.starter !== false)
      .map((f) => `<span class="qb-tag" title="${esc(`${f.player} is listed ${f.status} on the ${f.date} availability report`)}">${esc(t.abbr)} QB ${esc(f.status)}</span>`)).join("")}${weatherOf(g)?.windy
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
    side: ev.side, line: ev.line, edge: +ev.edge.toFixed(1), prob: +ev.pre.toFixed(3), call: ev.tier,
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
  // the label when the pick was tracked; picks tracked before November 11, 2026 have none, and Go for it then meant a 3-5 point edge
  const strong = done.filter((p) => (p.call ? p.call === "strong" : p.edge >= STRONG && p.edge < CHECK));
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

/** Saves rows (the first one the header) as a CSV file. */
function downloadCSV(name, rows) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

// My picks live in this browser's storage; a CSV moves them to another phone or computer
const PICK_COLS = ["id", "game_id", "market", "date", "season", "week", "seasontype", "game", "pick", "side", "line", "edge",
  "prob", "call", "source", "result", "finalMargin"];
const PICK_NUMS = new Set(["season", "line", "edge", "prob", "finalMargin"]);

/** Picks from a CSV made by Download as CSV, skipping any already tracked here (by game and market). */
function importPicks(text) {
  const [head = [], ...rows] = parseCSV(text);
  const idx = head.map((h) => h.trim());
  const have = new Set(store.get("picks", []).map((p) => p.id));
  const added = rows.map((r) => Object.fromEntries(PICK_COLS.flatMap((c) => {
    const v = (r[idx.indexOf(c)] ?? "").trim();
    if (!v) return c === "result" || c === "finalMargin" ? [[c, null]] : [];
    return [[c, PICK_NUMS.has(c) ? Number(v) : v]];
  }))).filter((p) => p.id && p.game_id && p.date && p.pick && Number.isFinite(p.line) && Number.isFinite(p.edge) && !have.has(p.id));
  store.set("picks", [...store.get("picks", []), ...added]);
  return added.length;
}

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

let recAgainst = "close", recEdge = "0", recMarket = "spread";  // the closing line first: it's the number anyone can get

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
    [`${tot ? "Total" : "Line"} moved toward the pick`, pct(moved?.clv_beat_rate), `${moved?.name}, 3+ pt edges. Most of that move comes within hours of the open, often before the ${line} can be bet.`],
  ].map(([h, big, p]) => `<div class="card"><h4>${h}</h4><div class="big">${big}</div><p>${esc(p)}</p></div>`).join("");

  const t = r.tables[`${recAgainst}_${recEdge}`] || [];
  const clv = recAgainst === "open";
  $("#record-table").innerHTML = `<tr><th>Projection</th><th>Picks</th><th>Record</th><th>Hit rate</th><th>Typical miss</th>${clv ? `<th>${tot ? "Total" : "Line"} moved our way</th>` : ""}</tr>` +
    t.map((x) => /baseline/.test(x.name)
      ? `<tr><td class="l note">${esc(x.name.replace(" (baseline)", ""))} itself</td><td></td><td></td><td></td><td>${x.rmse_vs_result?.toFixed(1)}</td>${clv ? "<td></td>" : ""}</tr>`
      : `<tr><td class="l">${esc(x.name)}</td><td>${x.picks ?? 0}</td><td>${x.wins ?? 0}-${x.losses ?? 0}</td>
        <td class="${x.hit_rate >= BREAKEVEN ? "good" : "bad"}">${withMoe(x.hit_rate, n(x))}</td><td>${x.rmse_vs_result?.toFixed(1)}</td>
        ${clv ? `<td>${pct(x.clv_beat_rate)}</td>` : ""}</tr>`).join("");
  const seasons = (recAgainst === "close" && r.by_season_close) || r.by_season;
  $("#season-head").textContent = `By season (${seasons === r.by_season ? "opening" : "closing"} ${line}, every game)`;

  const names = (r.tables.open_0 || []).map((x) => x.name).filter((n) => !/baseline/.test(n));
  $("#season-table").innerHTML = `<tr><th>Season</th><th>Games</th>${names.map((n) => `<th>${esc(n)}</th>`).join("")}</tr>` +
    seasons.map((s) => `<tr><td class="l">${s.season}</td><td>${s.games}</td>${names.map((n) =>
      `<td class="${s[n] == null ? "" : s[n] >= BREAKEVEN ? "good" : "bad"}">${s[n] == null ? "—" : pct(s[n], 1)}</td>`).join("")}</tr>`).join("");
}

// ---------- Live results (forward test) ----------

let liveSource = "blend", liveTier = "all";  // every game: the most finished picks

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
  if (tot && !["anchored", "points"].includes(liveSource)) liveSource = "anchored";
  $$("#live-source button").forEach((x) => x.classList.toggle("on", x.dataset.v === liveSource));
  $("#live-recent-head").textContent = tot ? "Recent Market-anchored over/unders (edge 1.5+)" : "Recent Blend picks (edge 1.5+)";
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
  if (!s || !s.picks) {  // a projection added after the log started has nothing yet
    $("#live-verdict").innerHTML = `<div class="card verdict"><h4>${esc(SOURCE_LABEL[liveSource] || "This projection")}</h4><div class="big">No picks yet</div>
      <p>This projection's picks are logged starting with the next lines that open.</p></div>`;
    $("#live-stats").innerHTML = "";
    return;
  }
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
  // phones: the game and date move under the pick, which wraps, so the edge, move and result fit without swiping
  $("#live-table").innerHTML = `<tr><th class="sm-hide">Kickoff</th><th class="l sm-hide">Game</th><th class="l">Pick</th><th>Edge</th><th><span class="hide-sm">${tot ? "Total" : "Line"} moved</span><span class="show-sm">Moved</span></th><th class="l">Result</th></tr>` +
    (L.recent.length ? L.recent.map((p) => {
      const day = esc(new Date(p.kickoff).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
      return `<tr>
      <td class="sm-hide">${day}</td>
      <td class="l sm-hide">${esc(p.game)}</td><td class="l wrap-sm"><b>${tot ? `${p.side === "over" ? "Over" : "Under"} ${p.line}` : `${esc(p.team)} ${fmtLine(p.line)}`}</b><span class="sm-sub">${esc(p.game)} · ${day}</span></td>
      <td><span class="badge ${p.tier}">${p.edge.toFixed(1)}</span></td>
      <td class="${p.clv > 0 ? "good" : p.clv < 0 ? "bad" : ""}">${p.clv == null ? "—" : (p.clv > 0 ? "+" : "") + p.clv}</td>
      <td class="l">${p.result ? res[p.result] : `<span class="note">Pending</span>`}</td></tr>`;
    }).join("")
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
    : SPREAD_SOURCES.map((k) => [k, (k === "blend" ? "★ " : "") + SOURCE_LABEL[k]]);
  const sel = $("#source");
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  // a remembered choice that isn't offered (any more) falls back to the default
  for (const [key, ok, dflt] of [["source", SPREAD_SOURCES, "blend"], ["totalSource", ["anchored", "points"], "anchored"]]) {
    if (!ok.includes(state[key])) { state[key] = dflt; store.set(key, dflt); }
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
  swapLogos();
}

async function refresh(index = state.weekIndex) {
  try {
    await loadWeek(index);
    const at = placeOf();  // a refresh while reading the list keeps the same game on screen
    renderAll();
    if (at.card) goTo(at);
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

// ---------- Keeping your place ----------

let view = null, viewFrom = null;  // the view on screen ("games", "game", "props", ...) and the one before it
const places = {};                 // each view's last place, from placeOf()
const headerBottom = () => $(".top").getBoundingClientRect().bottom;

/** Where the reader is: the scroll offset and, once they've scrolled into the games list, the game card at
 *  the top of the screen. A list that changed in the meantime (new scores, finished games folding away)
 *  can then still come back to the same game. */
function placeOf() {
  const at = { y: scrollY };
  if (!$("#tab-games").hidden && $("#games").getBoundingClientRect().top < headerBottom()) {
    const c = $$("#games article[data-game]").find((x) => x.getBoundingClientRect().bottom > headerBottom() + 4);
    if (c) at.card = { id: c.dataset.game, top: c.getBoundingClientRect().top };
  }
  return at;
}

/** Back to a place from placeOf(); the top of the page if there isn't one. */
function goTo(at) {
  const c = at?.card && $(`#games article[data-game="${at.card.id}"]`);
  const r = c?.getBoundingClientRect();
  scrollTo(0, r?.height ? scrollY + r.top - at.card.top : at?.y || 0);
}

/** Tables wider than the screen: "wide" keeps the first column in view while swiping, and "more" fades
 *  the right edge while there's more to swipe to. */
function markScrollers() {
  for (const w of $$(".table-wrap, .gd-shop-wrap")) {
    const extra = w.scrollWidth - w.clientWidth;
    w.classList.toggle("wide", extra > 4);
    w.classList.toggle("more", extra - w.scrollLeft > 4);
  }
}

function bind() {
  // Every view keeps its own place: switch tabs, or go Back from a game, and you return to where you
  // were; tap the tab you're already on to go to the top. The browser's own scroll restoring is off,
  // because all the views share one page and it can only guess.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const showTab = () => {
    const h = location.hash.slice(1);
    const game = h.startsWith("game/") ? h.slice(5) : null;  // #game/<id>: game detail view (game.js)
    const name = game ? "game" : $(`.tabs button[data-tab="${h}"]`) ? h : "games";
    if (view && view !== "game") places[view] = placeOf();  // hashchange comes before anything on screen changes
    viewFrom = view; view = name;
    $$(".tabs button").forEach((x) => x.setAttribute("aria-selected", x.dataset.tab === (game ? "games" : name)));
    $(".tabs button[aria-selected=true]")?.scrollIntoView({ block: "nearest", inline: "nearest" });  // phones: keep it visible
    $$(".tab").forEach((s) => (s.hidden = s.id !== "tab-" + name));
    if (!game) goTo(places[name]);  // a game always opens at its top (showGame)
    if (name === "picks") gradeOldPicks();
    if (typeof showGame === "function") { if (game) showGame(game); else leaveGame(); }
  };
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => {
    if (view === b.dataset.tab) scrollTo({ top: 0, behavior: "smooth" });
    else location.hash = b.dataset.tab;
  }));
  window.addEventListener("hashchange", showTab);
  showTab();

  document.addEventListener("scroll", (e) => { if (e.target.classList?.contains("table-wrap") || e.target.classList?.contains("gd-shop-wrap")) markScrollers(); }, true);
  addEventListener("resize", markScrollers);
  document.fonts?.ready.then(markScrollers);  // the web fonts change how wide every table is
  new MutationObserver(markScrollers)  // after anything in the page is redrawn, shown or opened
    .observe($("main"), { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "open"] });
  // "Match my device": follow the phone or computer when it switches between light and dark
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (state.settings.theme === "auto") swapLogos(); });

  const guide = $("#guide");
  $("#guide-btn").addEventListener("click", () => guide.showModal());
  guide.addEventListener("click", (e) => { if (e.target === guide) guide.close(); });  // a click outside the panel

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
  $("#games").addEventListener("click", (e) => {  // the buttons in the "no games match" message
    const fold = e.target.closest(".finals > summary")?.parentElement;  // the click lands before it opens or closes
    if (fold) { if (!("auto" in fold.dataset)) store.set("finalsOpen", !fold.open); return; }
    if (e.target.closest("[data-show-all]")) setFilter("all");
    else if (e.target.closest("[data-clear-search]")) { state.search = $("#search").value = ""; }
    else return;
    renderGames();
  });

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
  $("#picks-export").addEventListener("click", () =>
    downloadCSV("picks.csv", [PICK_COLS, ...store.get("picks", []).map((p) => PICK_COLS.map((c) => p[c] ?? ""))]));
  $("#picks-import").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    importPicks(await f.text());
    e.target.value = ""; gradeOldPicks(); renderAll();
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
  $("#bets-export").addEventListener("click", () =>
    downloadCSV("bets.csv", [BET_COLS, ...store.get("bets", []).map((b) => BET_COLS.map((c) => b[c] ?? ""))]));
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
  const [ratings, model, record, live, changelog, qb, weather, odds] = await Promise.all(
    ["ratings", "model", "track_record", "live", "changelog", "qb", "weather", "odds"].map((n) => getJSON(`data/${n}.json`).catch(() => null)));
  state.odds = odds?.games || null;
  state.oddsAt = odds?.updated || null;
  state.qb = qb?.teams || null;
  state.qbListed = qb?.listed || null;
  state.qbAdjust = qb?.adjust || null;
  state.qbCleared = qb?.cleared || null;
  state.weather = weather?.games || null;
  if (ratings) {
    const avg = leagueAverage(ratings.teams);  // model.project's avg
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
