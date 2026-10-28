"use strict";
// Props tab: this week's player projections (data/props.json, built by build_props.py). Visitors
// enter the line from their sportsbook; the page turns the projection into an over/under chance.
// Nothing here is tested against real prop lines, and the page says so.

const PROP_ORDER = ["pass_yds", "pass_td", "rush_yds", "rec_yds", "rec"];
const PROP_SHORT = { pass_yds: "Pass yds", pass_td: "Pass TDs", rush_yds: "Rush yds", rec_yds: "Rec yds", rec: "Receptions" };
const PROP_LEAN = 0.03;   // lean only when the chance beats break-even by 3+ points (untested, so stay modest)
const propState = { data: null, market: store.get("propMarket", "pass_yds"), game: "all", q: "" };

const breakEven = (odds) => (odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100));

function poissonOver(lambda, line) {
  // P(X > line) for whole-number counts, e.g. passing TDs over 1.5 means 2 or more
  let cdf = 0, term = Math.exp(-lambda);
  for (let k = 0; k <= Math.floor(line); k++) { cdf += term; term *= lambda / (k + 1); }
  return 1 - cdf;
}

function overChance(m, market, line) {
  if (market === "pass_td") return poissonOver(m.proj, line);
  return 1 - normCdf((line - m.proj) / m.sd);
}

const propKey = (p, market) => `prop.${propState.data?.season}.${propState.data?.week}.${p.pid}.${market}`;

function propVerdict(p, market) {
  const m = p.markets[market], saved = store.get(propKey(p, market), null);
  if (!saved || saved.line == null || saved.line === "") return null;
  const line = parseFloat(saved.line), odds = parseFloat(saved.odds) || -110;
  if (!Number.isFinite(line)) return null;
  const over = overChance(m, market, line), under = 1 - over;
  const need = breakEven(odds);
  const side = over >= under ? "over" : "under", p_ = Math.max(over, under);
  const hits = m.last.filter((v) => (side === "over" ? v > line : v < line)).length;
  return { line, odds, over, under, side, lean: p_ - need >= PROP_LEAN, need, hits, of: m.last.length };
}

function defenseNote(p, market) {
  const f = p.markets[market].def;
  if (!f || Math.abs(f - 1) < 0.02) return "";
  const what = { pass_td: "passing TDs", rush_yds: "rushing yards", rec: "catches" }[market];
  const pct_ = Math.round(Math.abs(f - 1) * 200);  // the projection uses half of the defense's difference
  return `${esc(p.opp)}'s defense allows about ${pct_}% ${f > 1 ? "more" : "fewer"} ${what} than average (half of that is in the projection).`;
}

function propCard(p) {
  const market = propState.market, m = p.markets[market];
  const g = propState.data.games.find((x) => x.id === p.game_id);
  const when = g ? new Date(g.kickoff).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";
  const saved = store.get(propKey(p, market), {}) || {};
  const v = propVerdict(p, market);
  const unit = market === "pass_td" ? "" : market === "rec" ? "" : " yds";
  const fmtV = (x) => (market === "pass_td" || market === "rec" ? x.toFixed(0) : x.toFixed(0));
  const result = v ? `<div class="pp-result ${v.lean ? "pp-lean" : ""}">
      <div class="pp-odds"><span>Over ${pct(v.over)}</span><span>Under ${pct(v.under)}</span></div>
      <div class="bar"><i style="width:${(100 * v.over).toFixed(0)}%"></i></div>
      <div class="pp-verdict">${v.lean
        ? `<span class="badge lean">Leans ${v.side} · ${pct(Math.max(v.over, v.under))}</span>`
        : `<span class="badge pass">No edge</span>`}
        <span class="note">Need ${pct(v.need)} at ${v.odds > 0 ? "+" : ""}${v.odds}. Went ${v.side} ${v.line} in ${v.hits} of his last ${v.of}.</span></div>
    </div>` : `<p class="note pp-hint">Enter your book's line to see the over/under chance.</p>`;
  return `<article class="card pp-card" data-pid="${esc(p.pid)}">
    <div class="pp-head">
      <img src="${LOGO(p.team_id)}" alt="" loading="lazy">
      <div><div class="pp-name">${esc(p.name)}</div>
        <div class="note">${esc(p.team)} ${p.home ? "vs" : "@"} ${esc(p.opp)} · ${esc(when)}</div></div>
    </div>
    <div class="pp-proj"><span class="k">Projection</span><span class="pp-num">${m.proj.toFixed(market === "pass_td" || market === "rec" ? 1 : 0)}${unit}</span>
      <span class="note">${PROP_SHORT[market]}, ${m.n} games</span></div>
    <div class="pp-last"><span class="k">Last ${m.last.length}</span>${m.last.map((x) =>
      `<span class="pp-chip${v ? (x > v.line ? " over" : x < v.line ? " under" : "") : ""}">${fmtV(x)}</span>`).join("")}</div>
    ${defenseNote(p, market) ? `<p class="note pp-def">${defenseNote(p, market)}</p>` : ""}
    <div class="pp-inputs">
      <label class="field"><span>Your line</span><input type="number" step="0.5" inputmode="decimal" data-line value="${esc(saved.line ?? "")}" placeholder="e.g. ${market === "pass_td" ? "1.5" : market === "rec" ? "4.5" : (Math.round(m.proj / 5) * 5 - 0.5).toFixed(1)}"></label>
      <label class="field"><span>Odds</span><input type="number" step="5" inputmode="numeric" data-odds value="${esc(saved.odds ?? "")}" placeholder="-110"></label>
    </div>
    ${result}
  </article>`;
}

function renderProps() {
  const d = propState.data;
  if (!d) { $("#props-list").innerHTML = `<div class="card note">Props aren't available right now.</div>`; return; }
  const market = propState.market, q = propState.q.trim().toLowerCase();
  let list = d.players.filter((p) => p.markets[market] && (propState.game === "all" || p.game_id === propState.game)
    && (!q || `${p.name} ${p.team} ${p.opp}`.toLowerCase().includes(q)));
  list.sort((a, b) => b.markets[market].proj - a.markets[market].proj);
  const shown = list.slice(0, propState.limit || 60);
  $("#props-count").textContent = `${list.length} player${list.length === 1 ? "" : "s"}`;
  $("#props-list").innerHTML = shown.length
    ? `<div class="pp-grid">${shown.map(propCard).join("")}</div>` +
      (list.length > shown.length ? `<button class="primary pp-more" type="button" data-more>Show ${Math.min(60, list.length - shown.length)} more</button>` : "")
    : `<div class="card note">No players match. Try another game or stat.</div>`;
}

function renderPropsIntro() {
  const d = propState.data;
  if (!d) return;
  const a = d.accuracy || {};
  $("#props-accuracy").innerHTML = PROP_ORDER.filter((m) => a[m]).map((m) =>
    `<tr><td class="l">${esc(a[m].label)}</td><td>${a[m].mae_model.toFixed(1)}</td><td>${a[m].mae_season_avg.toFixed(1)}</td><td>${a[m].n}</td></tr>`).join("");
  $("#props-updated").textContent = `Updated ${new Date(d.updated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · week ${d.week}`;
  const games = [...d.games].sort((x, y) => x.kickoff.localeCompare(y.kickoff));
  $("#props-game").innerHTML = `<option value="all">All games (${games.length})</option>` + games.map((g) =>
    `<option value="${esc(g.id)}">${esc(new Date(g.kickoff).toLocaleDateString(undefined, { weekday: "short" }))} · ${esc(g.away)} @ ${esc(g.home)}</option>`).join("");
}

function bindProps() {
  $$("#props-market button").forEach((b) => {
    b.classList.toggle("on", b.dataset.v === propState.market);
    b.addEventListener("click", () => {
      $$("#props-market button").forEach((x) => x.classList.toggle("on", x === b));
      propState.market = b.dataset.v; propState.limit = 60; store.set("propMarket", propState.market); renderProps();
    });
  });
  $("#props-game").addEventListener("change", (e) => { propState.game = e.target.value; propState.limit = 60; renderProps(); });
  $("#props-search").addEventListener("input", (e) => { propState.q = e.target.value; propState.limit = 60; renderProps(); });
  $("#props-list").addEventListener("click", (e) => {
    if (e.target.closest("[data-more]")) { propState.limit = (propState.limit || 60) + 60; renderProps(); }
  });
  // save the line as it's typed; redraw only that card so the cursor stays put
  $("#props-list").addEventListener("change", (e) => {
    const card = e.target.closest(".pp-card"); if (!card) return;
    const p = propState.data.players.find((x) => x.pid === card.dataset.pid);
    store.set(propKey(p, propState.market), { line: card.querySelector("[data-line]").value, odds: card.querySelector("[data-odds]").value });
    card.outerHTML = propCard(p);
  });
  getJSON("data/props.json").then((d) => { propState.data = d; renderPropsIntro(); renderProps(); })
    .catch(() => { propState.data = null; renderProps(); });
}

bindProps();
