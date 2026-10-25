"use strict";
// Ratings tab helpers: a worked example in the "How to read" guide, and the Compare two teams tool.
// Both use projections() and evaluate()'s thresholds from app.js, so they match the game cards.

const say = (home, away, m) => (Math.abs(m) < 0.05 ? "a toss-up" : `${(m >= 0 ? home : away).team} by ${Math.abs(m).toFixed(1)}`);

function ranked() {
  return [...(state.ratings?.list || [])].filter((t) => t.fpi != null).sort((a, b) => b.fpi - a.fpi);
}

/** "If #2 played at #1" using today's numbers, so the formulas in the guide are concrete. */
function renderRatingsExample() {
  const r = ranked();
  $$("[data-hfa]").forEach((el) => (el.textContent = hfa()));
  if (r.length < 2) { $("#rt-example").textContent = ""; return; }
  const [home, away] = r, h = hfa();
  const f = home.fpi - away.fpi + h;
  const p = (home.ppg + away.papg) - (away.ppg + home.papg) + h;
  $("#rt-example").innerHTML = `<b>Example with today's numbers:</b> if #2 ${esc(away.team)} played at #1 ${esc(home.team)},
    FPI says <b>${esc(say(home, away, f))}</b> (${home.fpi.toFixed(1)} − ${away.fpi.toFixed(1)} + ${h}), and adjusted points says
    <b>${esc(say(home, away, p))}</b> ((${home.ppg.toFixed(1)} + ${away.papg.toFixed(1)}) − (${away.ppg.toFixed(1)} + ${home.papg.toFixed(1)}) + ${h}).`;
}

function renderCompare() {
  const byId = state.ratings?.byId || {};
  const home = byId[$("#cmp-home").value], away = byId[$("#cmp-away").value];
  const out = $("#cmp-out");
  if (!home || !away) { out.innerHTML = ""; return; }
  if (home === away) { out.innerHTML = `<p class="note">Pick two different teams.</p>`; return; }
  const neutral = $("#cmp-site .on")?.dataset.v === "neutral";
  const raw = $("#cmp-line").value.trim();
  const line = raw === "" ? null : parseFloat(raw);
  const g = { home: { id: String(home.id), name: home.team }, away: { id: String(away.id), name: away.team }, neutral, line: Number.isFinite(line) ? line : null };
  const proj = projections(g);
  const rows = ["fpi", "points", "blend", "anchored"].map((src) => {
    const m = proj[src];
    if (m == null) return `<tr><td class="l">${esc(SOURCE_LABEL[src])}</td><td colspan="2" class="l note">${src === "anchored" ? "Enter the line to see it" : "—"}</td></tr>`;
    let pick = "";
    if (g.line != null) {
      const edge = m + g.line, homeSide = edge >= 0, t = homeSide ? home : away;
      const tier = tierOf(edge);
      pick = `<td class="l"><b>${esc(t.team)} ${fmtLine(homeSide ? g.line : -g.line)}</b>
        <span class="badge ${tier}">${TIER_LABEL[tier]} · ${Math.abs(edge).toFixed(1)}</span></td>`;
    }
    return `<tr><td class="l">${esc(SOURCE_LABEL[src])}${src === state.source ? " ★" : ""}</td><td class="l">${esc(say(home, away, m))}</td>${pick}</tr>`;
  }).join("");
  const s = state.model?.sigma?.fpi || 15.5;
  const win = proj.fpi == null ? null : normCdf(proj.fpi / s);
  out.innerHTML = `<div class="table-wrap"><table class="data">
      <tr><th>Projection</th><th class="l">Predicts</th>${g.line != null ? `<th class="l">Pick and edge</th>` : ""}</tr>${rows}
    </table></div>
    ${win == null ? "" : `<p class="note">Win chance by FPI: ${esc(home.team)} ${pct(win)} · ${esc(away.team)} ${pct(1 - win)}.
      ${g.line == null ? "Enter the home team's line (negative if they're favored) to see which side each projection would pick." : ""}</p>`}`;
}

function bindRatingsHelp() {
  const fill = () => {
    const teams = [...(state.ratings?.list || [])].sort((a, b) => a.team.localeCompare(b.team));
    const opts = teams.map((t) => `<option value="${esc(t.id)}">${esc(t.team)}</option>`).join("");
    $("#cmp-home").innerHTML = opts; $("#cmp-away").innerHTML = opts;
    const r = ranked();
    if (r.length >= 2) { $("#cmp-home").value = r[0].id; $("#cmp-away").value = r[1].id; }
    renderRatingsExample(); renderCompare();
  };
  ["#cmp-home", "#cmp-away"].forEach((id) => $(id).addEventListener("change", renderCompare));
  $("#cmp-line").addEventListener("input", renderCompare);
  $$("#cmp-site button").forEach((b) => b.addEventListener("click", () => {
    $$("#cmp-site button").forEach((x) => x.classList.toggle("on", x === b)); renderCompare();
  }));
  $("#settings").addEventListener("close", () => { renderRatingsExample(); renderCompare(); });  // home-field setting may change
  // the guide starts open on a first visit, then stays however the visitor last left it
  const guide = $("#rt-guide");
  guide.open = store.get("ratingsGuideOpen", true);
  guide.addEventListener("toggle", () => store.set("ratingsGuideOpen", guide.open));
  appReady.then(fill).catch(() => {});
}

bindRatingsHelp();
