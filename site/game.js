"use strict";
// Game detail view: opened by tapping a game card, at #game/<ESPN game id>. Combines ESPN's
// per-game summary feed with the site's own projections, ratings and forward-test log.

const GAME_STATS_SHOWN = ["Total Yards", "Passing", "Rushing", "Turnovers", "3rd down efficiency", "Possession"];
let gameTimer = null, gameLog = null;

async function loadGameLog() {
  try { gameLog = await getJSON("data/game_log.json"); } catch { gameLog = gameLog || {}; }
  return gameLog;
}

/** A game in the same shape as parseEvent() makes, from the summary feed (for games not on the board). */
function gameFromSummary(s) {
  const c = s.header.competitions[0];
  const t = Object.fromEntries(c.competitors.map((x) => [x.homeAway, x]));
  const team = (x) => ({
    id: x.team.id, name: x.team.location || x.team.displayName, abbr: x.team.abbreviation,
    rank: x.rank && x.rank < 26 ? x.rank : null,
    record: x.record?.find((r) => r.type === "total")?.summary || "", score: parseInt(x.score || 0, 10), winner: x.winner,
  });
  const g = {
    id: String(c.id), date: c.date, tbd: c.timeValid === false, home: team(t.home), away: team(t.away), state: c.status.type.state,
    status: c.status.type.shortDetail, period: c.status.period || 0, clock: parseFloat(c.status.clock || 0),
    neutral: !!c.neutralSite, tv: (c.broadcasts || []).map((b) => b.media?.shortName).filter(Boolean).join(", "),
    line: null, openLine: null, total: null, openTotal: null,
    note: s.header.gameNote || c.notes?.[0]?.headline || "", postseason: s.header.season?.type === 3,
  };
  const saved = store.get("line." + g.id, null);
  if (saved) Object.assign(g, { line: saved.line, openLine: saved.open, total: saved.total, openTotal: saved.openTotal ?? null });
  return g;
}

/** Every source's view of the game, using each source's own tested std dev. */
function allSources(g) {
  const proj = projections(g);
  return SPREAD_SOURCES.map((src) => {
    const m = proj[src];
    if (m == null || g.line == null) return { src, margin: m };
    const s = state.settings.sigma || state.model?.sigma?.[src] || 15.5;
    const edge = m + g.line, home = edge >= 0, homeProb = normCdf(shrink("spread", src) * edge / s);
    const r = withValue(g, {
      src, margin: m, edge: Math.abs(edge), side: home ? "home" : "away", team: home ? g.home : g.away,
      line: g.line, pickLine: home ? g.line : -g.line, pre: home ? homeProb : 1 - homeProb,
      tier: gameTier(g, edge, home ? g.home : g.away),
    });
    r.prob = r.value ? r.value.best.p : r.pre;  // pregame, at the best number on offer, as on the cards
    return r;
  });
}

/** Under a projections table: the numbers its chances were figured at, one per side, and what Go for it means. */
function pricedAt(g, rows) {
  if (g.state !== "pre") return "";
  const used = [...new Map(rows.filter((r) => r.value?.best.shop).map((r) => [r.side, r.value.best])).values()];
  return used.length
    ? `Chances are at the best number on offer for each side: ${used.map((b) => `${b.label} (${fmtPrice(b.price)})`).join(", ")}. Go for it means that number beats its break-even by a point.`
    : "Chances are at the line shown, at -110. Go for it means beating the 52.4% break-even by a point.";
}

const TIER_TXT = TIER_LABEL;
/** An edge badge, "Go for it · 4.1". In tables marked fit-sm, a phone shows just the number in the label's colors. */
const edgeBadge = (tier, edge) => `<span class="badge ${tier}"><span class="tier-word">${esc(TIER_TXT[tier])} · </span>${edge.toFixed(1)}</span>`;
const marginTxt = (g, m) => (Math.abs(m) < 0.05 ? "Even" : `${(m >= 0 ? g.home : g.away).abbr} by ${Math.abs(m).toFixed(1)}`);
const lineTxt = (g, line) => (line == null ? "—" : `${g.home.abbr} ${fmtLine(line)}`);

function headerCard(g, s) {
  const venue = s.gameInfo?.venue;
  const when = `${kickDay(g, { weekday: "short", month: "short", day: "numeric" })}, ${kickTime(g).replace("Time TBD", "time TBD")}`;
  const status = g.state === "pre" ? when : g.status;
  const ev = evaluate(g, "spread");  // the over/under has its own card below
  const hasPick = ev.margin != null && ev.line != null;
  const team = (t) => `<div class="gd-team${g.state === "post" && t.winner === false ? " lost" : ""}">
      <img src="${LOGO(t.id, 160)}" alt="">
      <div class="gd-name">${t.rank ? `<span class="rank">${t.rank}</span>` : ""}${esc(t.name)}${hasPick && ev.team === t ? ` <span class="pick-tag">Pick</span>` : ""}<span>${esc(t.record)}</span></div>
      ${g.state === "pre" ? "" : `<div class="gd-score">${t.score}</div>`}
    </div>`;
  return `<div class="card gd-head">
    <div class="game-top"><span class="${g.state === "in" ? "status live" : "status"}">${esc(status)}</span>
      <span>${esc(g.tv)}${g.neutral ? " · Neutral site" : ""}</span></div>
    ${g.note ? `<div class="game-note">${esc(g.note)}</div>` : ""}
    ${team(g.away)}<div class="gd-at">at</div>${team(g.home)}
    <div class="lines">
      <div><span class="k">Line</span><span class="v">${esc(lineTxt(g, g.line))}</span>
        ${g.openLine != null && g.openLine !== g.line ? `<span class="open"> opened ${fmtLine(g.openLine)}</span>` : ""}</div>
      <div><span class="k">Total</span><span class="v">${g.total ?? "—"}</span>
        ${g.openTotal != null && g.openTotal !== g.total ? `<span class="open"> opened ${g.openTotal}</span>` : ""}</div>
    </div>
    ${hasPick ? pickBox(g, ev, { tierTxt: TIER_LABEL }) : ""}
    ${venue ? `<p class="note">${esc(venue.fullName)}${venue.address?.city ? `, ${esc(venue.address.city)}${venue.address.state ? ", " + esc(venue.address.state) : ""}` : ""}</p>` : ""}
    ${g.state === "post" ? "" : `<p class="note gd-updated">Updated ${new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })} ·
      ${g.state === "in" ? "refreshes every 30 seconds" : "refreshes every 30 seconds from 15 minutes before kickoff"}</p>`}
  </div>`;
}

function pickCard(g) {
  const rows = allSources(g);
  const usable = rows.filter((r) => r.edge != null);
  if (!usable.length) {
    return `<div class="card"><h3>Why this pick</h3><p class="nopick">${esc(evaluate(g, "spread").reason || "No projection for this game.")}</p></div>`;
  }
  const chosen = rows.find((r) => r.src === state.source && r.edge != null) || usable[0];
  const same = usable.filter((r) => r.side === chosen.side).length;
  const verdict = same === usable.length
    ? `All ${usable.length} projections take <b>${esc(chosen.team.name)}</b>.`
    : `Projections split: ${same} take <b>${esc(chosen.team.name)}</b>, ${usable.length - same} take the other side. A split is a reason to punt.`;
  return `<div class="card"><h3>Why this pick</h3>
    <p>${verdict}</p>
    <div class="table-wrap"><table class="data fit-sm">
      <tr><th>Projection</th><th class="sm-hide">Model</th><th class="l">Pick</th><th>Edge</th><th>Cover</th></tr>
      ${rows.map((r) => `<tr class="${r.src === chosen.src ? "gd-chosen" : ""}">
        <td class="l">${esc(SOURCE_LABEL[r.src])}${r.src === state.source ? "&nbsp;★" : ""}${r.margin == null ? "" : `<span class="sm-sub">${esc(marginTxt(g, r.margin))}</span>`}</td>
        <td class="sm-hide">${r.margin == null ? "—" : esc(marginTxt(g, r.margin))}</td>
        <td class="l">${r.edge == null ? "—" : `<b>${esc(r.team.abbr)} ${fmtLine(r.pickLine)}</b>`}</td>
        <td>${r.edge == null ? "—" : edgeBadge(r.tier, r.edge)}</td>
        <td>${r.edge == null ? "—" : pct(r.prob, r.value ? 1 : 0)}</td></tr>`).join("")}
    </table></div>
    <p class="note">★ is the projection chosen on the Games tab. Each uses its own tested std dev for the cover chance. ${esc(pricedAt(g, usable))}
      ${g.state === "pre" ? "" : "These use today's ratings, which can include this game's own result. <b>Forward test</b> below shows the picks as they were recorded before kickoff."}</p>
    ${qbPlaceholderNote(g)}
  </div>`;
}

/** Under the projections table: the quarterback placeholder in these numbers, if there is one. */
function qbPlaceholderNote(g) {
  const fx = qbEffects(g, "blend");
  if (!fx.length) return "";
  const anchored = fx[0].a.points * qbShare("anchored");
  return `<p class="note"><b>Quarterback placeholder:</b> these projections take ${esc(qbEffectTxt(g, "blend"))}. ${fx.map((x) => esc(x.a.note)).join(" ")}
    Market-anchored takes about ${fmtPts(anchored)}, since the line it starts from already has the market's view. More under Quarterbacks and injuries below.</p>`;
}

/** Small SVG line chart. points: [[x, y]]; x in ms. */
function lineChart(points, { yFmt = (v) => v, height = 140, step = false, yMin, yMax, mid } = {}) {
  const W = 600, H = height, P = { l: 56, r: 12, t: 12, b: 24 };
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  let lo = yMin ?? Math.min(...ys), hi = yMax ?? Math.max(...ys);
  // give a nearly flat line some room, unless the caller fixed the range (e.g. 0-100%)
  if (yMin == null && yMax == null && hi - lo < 2) { const c = (hi + lo) / 2; lo = c - 1; hi = c + 1; }
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
  const X = (x) => P.l + ((x - x0) / Math.max(x1 - x0, 1)) * (W - P.l - P.r);
  const Y = (y) => P.t + ((hi - y) / (hi - lo)) * (H - P.t - P.b);
  let d = "";
  points.forEach(([x, y], i) => {
    if (i === 0) d += `M${X(x)},${Y(y)}`;
    else d += step ? `H${X(x)}V${Y(y)}` : `L${X(x)},${Y(y)}`;
  });
  const ticks = [hi, (hi + lo) / 2, lo];
  return `<svg class="gd-chart" viewBox="0 0 ${W} ${H}" role="img">
    ${ticks.map((t) => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/>
      <text x="${P.l - 8}" y="${Y(t) + 4}" text-anchor="end">${esc(yFmt(t))}</text>`).join("")}
    ${mid != null ? `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(mid)}" y2="${Y(mid)}" class="mid"/>` : ""}
    <path d="${d}" class="line"/>
    ${points.length < 40 ? points.map(([x, y]) => `<circle cx="${X(x)}" cy="${Y(y)}" r="4" class="dot"/>`).join("") : ""}
  </svg>`;
}

function lineCard(g, log) {
  const pts = (log?.lines || []).map(([t, l]) => [Date.parse(t), l]);
  if (g.openLine != null && (!pts.length || pts[0][1] !== g.openLine)) pts.unshift([pts.length ? pts[0][0] - 36e5 : Date.parse(g.date) - 6 * 864e5, g.openLine]);
  if (g.state === "pre" && g.line != null && (!pts.length || pts[pts.length - 1][1] !== g.line)) pts.push([Date.now(), g.line]);
  if (g.state === "pre" && pts.length) pts.push([Date.now(), pts[pts.length - 1][1]]);
  const first = pts[0]?.[1], last = pts[pts.length - 1]?.[1];
  let text = "No line history for this game yet.";
  if (first != null) {
    const moved = last - first;
    text = moved === 0
      ? `Opened at ${esc(lineTxt(g, first))} and hasn't moved.`
      : `Opened at ${esc(lineTxt(g, first))}, now ${esc(lineTxt(g, last))}: moved ${Math.abs(moved)} point${Math.abs(moved) === 1 ? "" : "s"} toward <b>${esc((moved < 0 ? g.home : g.away).name)}</b>.`;
  }
  const o = g.state === "pre" ? state.odds?.[g.id] : null;
  const ago = state.oddsAt ? Math.max(1, Math.round((Date.now() - Date.parse(state.oddsAt)) / 6e4)) : null;
  // one quote: the number, with its price on a small second line so the table fits a narrow card
  const quote = (label, price) => `${esc(label)}<span class="gd-price">${price > 0 ? "+" : ""}${price}</span>`;
  const shop = o ? `<h4 class="gd-h4">Line shopping</h4>
    <div class="gd-shop-wrap"><table class="data gd-shop">
      <tr><th class="l">${o.books} books</th><th>Middle</th><th colspan="2">Best on offer</th></tr>
      ${o.home_best == null ? "" : `<tr><td class="l">Spread</td><td>${esc(g.home.abbr)} ${fmtLine(o.spread_mid)}</td>
        <td>${quote(`${g.away.abbr} ${fmtLine(-o.away_best)}`, o.away_price)}</td>
        <td>${quote(`${g.home.abbr} ${fmtLine(o.home_best)}`, o.home_price)}</td></tr>`}
      ${o.over_best == null ? "" : `<tr><td class="l">Total</td><td>${o.total_mid}</td>
        <td>${quote(`Over ${o.over_best}`, o.over_price)}</td><td>${quote(`Under ${o.under_best}`, o.under_price)}</td></tr>`}
    </table></div>
    <p class="note">The best number for each side across ${o.books} US sportsbook${o.books === 1 ? "" : "s"}, with its price${ago == null ? ""
      : `, checked ${ago < 90 ? `${ago} min` : `${Math.round(ago / 60)} hr`} ago`}. Half a point is worth about as much as the model's
      whole edge, so it pays to look. Quotes priced worse than -125 are left out. Data: The Odds API.</p>` : "";
  return `<div class="card"><h3>Line movement</h3><p>${text}</p>
    ${pts.length > 1 ? lineChart(pts, { step: true, yFmt: (v) => `${g.home.abbr} ${fmtLine(Math.round(v * 2) / 2)}` }) : ""}
    <p class="note">Recorded by the forward test every two hours, and every 30 minutes on Sunday afternoons. A falling number means the
      market moved toward ${esc(g.home.name)}.</p>${shop}
  </div>`;
}

function matchupCard(g, s) {
  const r = state.ratings?.byId || {};
  const list = state.ratings?.list || [];
  const rank = (t) => { const v = r[t.id]?.fpi; return v == null ? null : list.filter((x) => x.fpi > v).length + 1; };
  // one comparison row; "better" highlights the stronger side when both have a number
  const row = (label, a, h, better) => {
    const good = (x, y) => (better && x != null && y != null && better(x, y) ? "good" : "");
    return `<tr><td class="${good(a.n, h.n)}">${a.v ?? "—"}</td><td class="gd-mid">${label}</td><td class="${good(h.n, a.n)}">${h.v ?? "—"}</td></tr>`;
  };
  const ra = r[g.away.id], rh = r[g.home.id];
  const fmt = (v) => (v == null ? null : v.toFixed(1));
  let rows = row("FPI (rank)", { v: ra?.fpi == null ? null : `${fmt(ra.fpi)} (#${rank(g.away)})`, n: ra?.fpi }, { v: rh?.fpi == null ? null : `${fmt(rh.fpi)} (#${rank(g.home)})`, n: rh?.fpi }, (x, y) => x > y)
    + row("Adj. offense", { v: fmt(ra?.ppg), n: ra?.ppg }, { v: fmt(rh?.ppg), n: rh?.ppg }, (x, y) => x > y)
    + row("Adj. defense", { v: fmt(ra?.papg), n: ra?.papg }, { v: fmt(rh?.papg), n: rh?.papg }, (x, y) => x < y);
  const box = Object.fromEntries((s.boxscore?.teams || []).map((t) => [t.team.id, Object.fromEntries((t.statistics || []).map((x) => [x.label, x.displayValue]))]));
  const labels = g.state === "pre" ? Object.keys(box[g.home.id] || {}) : GAME_STATS_SHOWN.filter((l) => box[g.home.id]?.[l] != null);
  if (labels.length) {
    rows += `<tr><th colspan="3" class="gd-sub">${g.state === "pre" ? "Season averages" : "This game"}</th></tr>`;
    rows += labels.map((l) => row(esc(l), { v: esc(box[g.away.id]?.[l]) }, { v: esc(box[g.home.id]?.[l]) })).join("");
  }
  const form = (s.lastFiveGames || []).map((t) => {
    const games = (t.events || []).map((e) => `<span class="gd-form ${e.gameResult === "W" ? "w" : e.gameResult === "L" ? "l" : ""}"
        title="${esc(`${e.gameResult} ${e.score} ${e.atVs} ${e.opponent?.displayName || ""}`)}">${esc(e.gameResult || "–")}</span>
        <span class="gd-form-opp">${esc(e.atVs === "@" ? "@" : "vs")} ${esc(e.opponent?.abbreviation || "")} ${esc(e.score || "")}</span>`).join("");
    return games ? `<div class="gd-form-row"><b>${esc(t.team?.abbreviation || "")}</b><div>${games}</div></div>` : "";
  }).join("");
  return `<div class="card"><h3>Matchup</h3>
    <div class="table-wrap"><table class="data gd-vs">
      <tr><th>${esc(g.away.abbr)}</th><th class="gd-mid"></th><th>${esc(g.home.abbr)}</th></tr>${rows}
    </table></div>
    ${form ? `<h4 class="gd-h4">Last five games</h4>${form}` : ""}
  </div>`;
}

function opinionCard(g, s) {
  const pr = s.predictor;
  const espnHome = pr?.homeTeam?.gameProjection != null ? parseFloat(pr.homeTeam.gameProjection) / 100 : null;
  const m = projections(g)[state.source];
  const sig = state.settings.sigma || state.model?.sigma?.[state.source] || 15.5;
  const modelHome = m == null ? null : normCdf(m / sig);
  if (espnHome == null && modelHome == null) return "";
  const bar = (label, p) => p == null ? "" : `<div class="gd-wp"><span>${label}</span>
      <div class="gd-wp-bar"><i style="width:${(100 * (1 - p)).toFixed(1)}%"></i></div>
      <span class="gd-wp-num">${esc(g.away.abbr)} ${pct(1 - p)} · ${esc(g.home.abbr)} ${pct(p)}</span></div>`;
  return `<div class="card"><h3>Win chance: a second opinion</h3>
    ${bar("ESPN's matchup predictor", espnHome)}${bar(`This model (${SOURCE_LABEL[state.source]})`, modelHome)}
    <p class="note">Chance to win the game outright, not to cover. When ESPN and the model disagree a lot, be careful with the pick.</p>
  </div>`;
}

function conditionsCard(g, s) {
  const gi = s.gameInfo || {}, espn = gi.weather, v = gi.venue;
  // Before kickoff: the site's own forecast (weather.json, the first three hours from Open-Meteo), the
  // same numbers the over/under card uses, so the page never shows two forecasts. ESPN's after that.
  const f = weatherOf(g);
  const items = [];
  if (v) items.push(["Venue", `${v.fullName}${v.grass === true ? " · grass" : v.grass === false ? " · artificial turf" : ""}`]);
  items.push(["Site", g.neutral ? "Neutral site: no home-field advantage" : `${g.home.name} at home`]);
  let gust = null, source = "";
  if (f?.dome) items.push(["Weather", "Indoors"]);
  else if (f) {
    gust = f.gust;
    items.push(["Temperature", `${f.temp}°F`], ["Wind", `${f.wind} mph, gusts to ${f.gust}`], ["Rain chance", `${f.rain}%`]);
    source = "Forecast for the first three hours of the game, from Open-Meteo.";
  } else if (espn) {
    gust = espn.gust ?? null;
    items.push(["Temperature", espn.temperature != null ? `${espn.temperature}°F` : "—"]);
    if (espn.gust != null) items.push(["Wind gusts", `${espn.gust} mph`]);
    if (espn.precipitation != null) items.push(["Rain chance", `${espn.precipitation}%`]);
    source = "Weather from ESPN.";
  } else if (g.state === "pre") items.push(["Weather", "No forecast yet (or played indoors)"]);
  if (gi.attendance) items.push(["Attendance", gi.attendance.toLocaleString()]);
  // before kickoff, wind follows the tested rule (12+ mph on average over the first three hours), as on the over/under card
  const wind = f && !f.dome ? (f.windy ? " Windy enough to matter in testing: see the over/under card." : "")
    : gust >= 20 ? " Strong wind tends to lower scoring and hurts passing teams most." : "";
  return `<div class="card"><h3>Conditions</h3><dl class="gd-dl">${items.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`).join("")}</dl>
    ${source || wind ? `<p class="note">${esc(source + wind)}</p>` : ""}</div>`;
}

function flowCard(g, s) {
  if (g.state === "pre") return "";
  const wp = (s.winprobability || []).map((p, i) => [i, p.homeWinPercentage]);
  const leaders = (s.leaders || []).map((t) => {
    const cats = (t.leaders || []).map((c) => c.leaders?.[0] ? `<tr><td class="l">${esc(c.displayName)}</td>
        <td class="l wrap-sm">${esc(c.leaders[0].athlete?.displayName || "")}</td><td class="l note wrap-sm">${esc(c.leaders[0].displayValue)}</td></tr>` : "").join("");
    return cats ? `<h4 class="gd-h4">${esc(t.team?.displayName || "")}</h4><div class="table-wrap"><table class="data fit-sm">${cats}</table></div>` : "";
  }).join("");
  return `<div class="card gd-wide"><h3>${g.state === "in" ? "Live" : "How it played out"}</h3>
    ${wp.length > 1 ? `<p class="note">ESPN's win chance for ${esc(g.home.name)}, play by play.</p>
      ${lineChart(wp, { yMin: 0, yMax: 1, mid: 0.5, yFmt: (v) => pct(v), height: 160 })}` : ""}
    ${leaders}
  </div>`;
}

/** The over/under: both totals projections, the model's pick, and its forward-test entry. */
function totalCard(g, log) {
  const ev = evaluate(g, "total");
  if (ev.margin == null || ev.line == null) {
    return `<div class="card"><h3>Over/under</h3><p class="nopick">${esc(ev.reason || "No total for this game.")}</p></div>`;
  }
  const proj = totalProjections(g), T = log?.totals;
  const split = proj.anchored != null && proj.points != null && (proj.anchored >= g.total) !== (proj.points >= g.total);
  const res = { W: `<span class="badge win">Won</span>`, L: `<span class="badge loss">Lost</span>`, P: `<span class="badge pass">Push</span>` };
  const picks = ["anchored", "points"].filter((k) => proj[k] != null).map((k) => {
    const edge = proj[k] - g.total, s = state.model?.sigma_total?.[k] || 16;
    const believed = shrink("total", k) * edge;
    const over = edge >= 0, p = over ? 1 - normCdf(-believed / s) : normCdf(-believed / s);
    // the same calls as the cards: a windy over says Check the news, and Go for it needs a price that beats break-even
    const windy = over && weatherOf(g)?.windy && tierOf(edge) !== "pass";
    const r = withValue(g, { k, total: true, edge: Math.abs(edge), side: over ? "over" : "under", line: g.total, pickLine: g.total,
      team: null, pre: p, tier: windy ? "check" : gameTier(g, edge) });
    r.prob = r.value ? r.value.best.p : r.pre;
    return r;
  });
  const rows = picks.map((r) => `<tr class="${r.k === state.totalSource ? "gd-chosen" : ""}"><td class="l">${esc(SOURCE_LABEL[r.k])}${r.k === state.totalSource ? "&nbsp;★" : ""}<span class="sm-sub">Projects ${proj[r.k].toFixed(1)}</span></td>
      <td class="sm-hide">${proj[r.k].toFixed(1)}</td><td class="l"><b>${r.side === "over" ? "Over" : "Under"} ${g.total}</b></td>
      <td>${edgeBadge(r.tier, r.edge)}</td><td>${pct(r.prob, r.value ? 1 : 0)}</td></tr>`).join("");
  const logged = T ? `<p>Forward test: recorded <b>${esc(new Date(T.at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</b>
      at <b>${T.total}</b>${T.close != null ? `, ${g.state === "pre" ? "latest" : "closed at"} ${T.close}` : ""}:
      ${["anchored", "points"].filter((k) => T.picks[k]).map((k) => {
        const p = T.picks[k];
        const clv = p.clv ?? (T.close != null ? (T.close - T.total) * (p.side === "over" ? 1 : -1) : null);
        return `${esc(SOURCE_LABEL[k])} took the <b>${p.side} ${T.total}</b>${clv ? ` (total moved ${clv > 0 ? "+" : ""}${clv} its way)` : ""}${p.result ? " " + res[p.result] : ""}`;
      }).join("; ")}.</p>`
    : `<p class="note">This game's over/under isn't in the pick log${g.state === "pre" ? " yet" : ""}.</p>`;
  return `<div class="card"><h3>Over/under</h3>
    ${pickBox(g, ev, { tierTxt: TIER_LABEL })}
    ${split ? `<p>The two projections split: one takes the over, the other the under. A split is a reason to punt.</p>` : ""}
    <div class="table-wrap"><table class="data fit-sm">
      <tr><th>Projection</th><th class="sm-hide">Total</th><th class="l">Pick</th><th>Edge</th><th>Chance</th></tr>${rows}
    </table></div>
    ${g.state === "pre" ? `<p class="note">${esc(pricedAt(g, picks))}</p>` : ""}
    ${logged}
    <p class="note">${(() => {
      const w = weatherOf(g);
      if (!w) return "The projections don't account for weather; see the conditions card.";
      if (w.dome) return "Indoors, so weather doesn't matter.";
      return `Forecast at kickoff: wind ${w.wind} mph (gusts to ${w.gust}), ${w.temp}°F, ${w.rain}% chance of rain. ` + (w.windy
        ? "In 2023-2026, totals in games with 12+ mph of wind fell about 1.8 points between the open and kickoff, and overs went 48% against the opening total, so over picks here say Check the news."
        : "Not windy enough to matter in testing; rain and cold showed no reliable effect.");
    })()}</p>
  </div>`;
}

function forwardCard(g, log) {
  const L = log?.logged;
  if (!L) return `<div class="card"><h3>Forward test</h3><p class="note">This game isn't in the pick log${g.state === "pre" ? " yet. It's recorded the first time its line appears" : " (it may be outside the last three weeks)"}.</p></div>`;
  const res = { W: `<span class="badge win">Won</span>`, L: `<span class="badge loss">Lost</span>`, P: `<span class="badge pass">Push</span>` };
  const at = new Date(L.at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const keys = SPREAD_SOURCES.filter((k) => L.picks[k]);
  const graded = keys.some((k) => L.picks[k].result);  // no Result column until there's a result to show
  return `<div class="card"><h3>Forward test</h3>
    <p>Recorded <b>${esc(at)}</b> at <b>${esc(lineTxt(g, L.line))}</b>${L.close != null ? `, ${g.state === "pre" ? "latest line" : "closed at"} ${esc(lineTxt(g, L.close))}` : ""}. These picks can't be changed after the fact${graded ? "" : "; they're graded when the game ends"}.${L.qb?.length
      ? ` They were recorded with a quarterback placeholder: ${esc(L.qb.map((q) => `${fmtPts(q.points)} points off ${q.team}`).join(" and "))}.`
      : g.state === "pre" && qbEffects(g).length ? " A quarterback placeholder was added after they were recorded, so the projections above differ from these." : ""}</p>
    <div class="table-wrap"><table class="data fit-sm">
      <tr><th>Projection</th><th class="l">Pick</th><th>Edge</th><th class="${graded ? "xs-hide" : ""}"><span class="hide-sm">Line moved</span><span class="show-sm">Moved</span></th>${graded ? `<th class="l">Result</th>` : ""}</tr>
      ${keys.map((k) => {
        const p = L.picks[k], team = p.side === "home" ? g.home : g.away;
        // until the game is graded, show movement so far from the logged line to the latest one
        const clv = p.clv ?? (L.close != null ? (L.line - L.close) * (p.side === "home" ? 1 : -1) : null);
        const cls = clv > 0 ? "good" : clv < 0 ? "bad" : "", moved = clv == null ? "—" : (clv > 0 ? "+" : "") + clv;
        // on a phone, a graded game has no room for both Moved and Result: the move goes under the pick
        return `<tr><td class="l">${esc(SOURCE_LABEL[k])}</td><td class="l"><b>${esc(team.abbr)} ${fmtLine(p.side === "home" ? L.line : -L.line)}</b>${graded
            ? `<span class="xs-sub">Moved <b class="${cls}">${moved}</b></span>` : ""}</td>
          <td><span class="badge ${tierOf(p.edge)}">${p.edge.toFixed(1)}</span></td>
          <td class="${cls}${graded ? " xs-hide" : ""}">${moved}</td>
          ${graded ? `<td class="l">${p.result ? res[p.result] : `<span class="note">Pending</span>`}</td>` : ""}</tr>`;
      }).join("")}
    </table></div></div>`;
}

/** Official availability reports. They come through an app with no public feed, so quarterbacks are entered by hand. */
const REPORTS = [["ACC", "https://theacc.com/sports/2025/8/28/availability-reporting-football.aspx"], ["Big 12", "https://big12sports.com/sports/2025/8/21/availability-reporting.aspx"],
  ["Big Ten", "https://bigten.org/"], ["SEC", "https://www.secsports.com/fbreports"]];
const STATUS_TXT = { out: "Out", doubtful: "Doubtful", questionable: "Questionable" };

/** Quarterbacks on the availability reports and the QB watch from box scores, what the model does about each,
 *  then the standing warning about injuries. */
function injuryCard(g) {
  const sides = [g.away, g.home];
  const listed = sides.flatMap((t) => qbListed(g, t));
  const adj = g.state === "post" ? [] : sides.map((t) => ({ t, a: qbAdjust(g, t) })).filter((x) => x.a);
  const offListed = adj.filter((x) => x.a.why === "listed");
  const reports = listed.length ? `<div class="gd-qb">${listed.map((f) => `<p><b>${esc(STATUS_TXT[f.status])}:</b> ${esc(f.player)}, ${esc(f.team)}
      (${f.starter === false ? "not the usual starter" : f.starter ? "usual starter" : "starter unknown"}), on the ${esc(f.date)} report${f.source
        ? ` · <a href="${esc(f.source)}" target="_blank" rel="noopener">source</a>` : ""}.</p>`).join("")}
      ${listed.some((f) => f.starter !== false && f.status !== "questionable") ? `<p class="note">In 2023-2026, teams whose starting quarterback sat
        unexpectedly covered 43% at the opening line (317 games), so picks on that team are labeled Check the news. Picks against it did fine.
        ${offListed.length ? `The projections also take ${esc(offListed.map((x) => `${fmtPts(x.a.points)} points off ${x.t.name}`).join(" and "))} (see below).` : ""}</p>` : ""}</div>` : "";
  const flags = g.state === "post" ? [] : sides.map((t) => ({ t, f: state.qb?.[t.id] })).filter((x) => x.f);
  // what the model does about each change: a placeholder, or the reason there isn't one
  const does = ({ t, f }) => {
    const a = qbAdjust(g, t), c = state.qbCleared?.[t.id];
    if (f.kind !== "change") return "";
    if (a) return ` <b>The projections take ${fmtPts(a.points)} points off ${esc(t.name)} for this game.</b>`;
    if (c && String(c.game_id) === String(g.id)) return ` Nothing is taken off: ${esc(c.player)} is listed available on the ${esc(c.date)} report.`;
    if (f.streak > 1) return " Nothing is taken off: by a second game with a new quarterback the ratings and the line have seen him, and those teams did about as projected in testing.";
    if (f.established === false) return ` Nothing is taken off: ${esc(t.name)} had been rotating quarterbacks, and in testing a change like that cost nothing.`;
    return "";
  };
  const cleared = g.state === "post" ? [] : sides.map((t) => state.qbCleared?.[t.id]).filter((c) => c && String(c.game_id) === String(g.id));
  const qb = flags.length ? `<div class="gd-qb">${flags.map((x) => `<p><b>${x.f.kind === "change" ? "QB change" : "Starter back"}:</b> ${esc(x.f.note)}${does(x)}</p>`).join("")}</div>` : "";
  const loose = cleared.filter((c) => !flags.some((x) => x.f.team === c.team)).map((c) => `<p><b>Available:</b> ${esc(c.player)}, ${esc(c.team)}, on the ${esc(c.date)} report.</p>`).join("");
  const why = adj.length ? `<p class="note"><b>About the placeholder.</b> The ratings come from games the usual starter played, so they overrate a team the week he's out.
      The ${fmtPts(adj[0].a.points)} points stand in for "a backup is playing"; they don't rate either quarterback. In 2023-2026, teams whose established starter sat did
      about 2 points worse than the ratings said (596 games), and the same in the first game after a backup took over (352). About a point was the offense scoring
      less and a point the opponent scoring more, so the over/under projections aren't changed. Season to season it ran from about 1 point (2023 to 2025) to
      between 3 and 5 (2026), so it's rough. It comes off when the starter is listed available on a report.</p>`
    : flags.some((x) => x.f.kind === "change") ? `<p class="note">A quarterback change moves the projections only in the first game after an established starter
      gives way (2 points off that team), or when he's listed out or doubtful on a report.</p>` : "";
  return injuryNote.replace("<h3>Not included: injuries</h3>", `<h3>Quarterbacks and injuries</h3>${reports}${qb}${loose ? `<div class="gd-qb">${loose}</div>` : ""}${why}`);
}

const injuryNote = `<div class="card gd-warn"><h3>Not included: injuries</h3>
  <p>The model doesn't know about injuries, with one exception: when an established starting quarterback is out, it takes 2 points off his team as a
  placeholder. It knows he's out when he's listed out or doubtful on an official report (entered by hand, Power 4 conference games only) or when a backup
  led the team's passing in its last game. It doesn't know how good the backup is, or about any other player. Check team news before betting, especially
  at quarterback, the model's biggest blind spot. Official reports: ${REPORTS.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${n}</a>`).join(" · ")}.</p></div>`;

async function renderGameDetail(id) {
  const box = $("#game-detail");
  try {
    const [s, log] = await Promise.all([getJSON(`${ESPN}/summary?event=${id}`), gameLog ? Promise.resolve(gameLog) : loadGameLog()]);
    if ($("#tab-game").hidden || location.hash !== `#game/${id}`) return;  // user navigated away
    // Score, clock and status come from the summary just fetched (the freshest copy); lines and
    // the rest come from the board when the game is on it
    const fresh = gameFromSummary(s), board = state.games.find((x) => x.id === id);
    const g = board ? { ...board, note: board.note || fresh.note, state: fresh.state, status: fresh.status, period: fresh.period, clock: fresh.clock,
      home: { ...board.home, score: fresh.home.score, winner: fresh.home.winner },
      away: { ...board.away, score: fresh.away.score, winner: fresh.away.winner } } : fresh;
    if (g.line == null) {
      const pc = s.pickcenter?.[0];
      if (pc?.spread != null) {
        Object.assign(g, { line: num(pc.spread), openLine: num(pc.pointSpread?.home?.open?.line), total: num(pc.overUnder),
          openTotal: num(pc.total?.over?.open?.line) });
      }
    }
    document.title = `${g.away.abbr} @ ${g.home.abbr} · Fourth & Value`;
    box.innerHTML = headerCard(g, s) + `<div class="gd-grid">${pickCard(g)}${totalCard(g, log[id])}${lineCard(g, log[id])}${matchupCard(g, s)}${opinionCard(g, s)}${conditionsCard(g, s)}${forwardCard(g, log[id])}${flowCard(g, s)}${injuryCard(g)}</div>`;
    // Live, or within 15 minutes of kickoff: every 30 seconds, like the board. Earlier: every
    // 5 minutes, for line moves. Finished: no more updates.
    clearTimeout(gameTimer);
    const soon = g.state === "pre" && Date.parse(g.date) - Date.now() < 15 * 60e3;
    if (g.state === "in" || soon) gameTimer = setTimeout(() => renderGameDetail(id), 30e3);
    else if (g.state === "pre") gameTimer = setTimeout(() => renderGameDetail(id), 300e3);
  } catch (e) {
    // keep a loaded page on screen through a brief network blip; just try again
    if (!box.querySelector(".gd-head")) {
      box.innerHTML = `<div class="card error">Couldn't load this game from ESPN (${esc(e.message)}). Check your connection; it will retry.</div>`;
    }
    clearTimeout(gameTimer);
    gameTimer = setTimeout(() => renderGameDetail(id), 30e3);
  }
}

async function showGame(id) {
  $("#game-detail").innerHTML = `<div class="card note">Loading game…</div>`;
  window.scrollTo(0, 0);  // a game always opens at its top; the list remembers where you were (app.js)
  try { await appReady; } catch { /* show what we can */ }
  renderGameDetail(id);
}

/** ‹ All games: back to the list, at the game you opened. When the list is the page before this one it's
 *  the browser's Back, so Back and Forward still make sense afterward; from an alert or a shared link
 *  (where Back would leave the site) it opens the list instead. */
function backToGames() {
  if (viewFrom === "games") history.back();
  else location.hash = "games";
}

function leaveGame() {
  clearTimeout(gameTimer);
  document.title = "Fourth & Value";
}

// The page may have been opened straight at #game/<id> before this file loaded
if (location.hash.startsWith("#game/")) showGame(location.hash.slice(6));
