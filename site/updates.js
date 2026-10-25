"use strict";
// Updates tab: the full change log (data/changelog.json) plus a feedback form that opens a
// pre-filled GitHub issue, and the open issues already raised. Nothing is sent from this site;
// posting happens on GitHub, which needs a free account.

const REPO = "davischamann-alt/fourth-and-value";
const TYPE_LABEL = { model: "Model", feature: "New", design: "Design", fix: "Fix", data: "Data" };
const FEEDBACK = {
  suggestion: { template: "suggestion.yml", prefix: "Suggestion: " },
  wrong: { template: "problem.yml", prefix: "Problem: ", kind: "A pick, line, score or rating looks wrong" },
  broken: { template: "problem.yml", prefix: "Problem: ", kind: "Something on the site doesn't work" },
  confusing: { template: "problem.yml", prefix: "Problem: ", kind: "Something is confusing or hard to read" },
};
let updatesFilter = "all";

function renderUpdates() {
  const log = [...(state.changelog || [])].sort((a, b) => b.date.localeCompare(a.date));
  const keep = { all: () => true, model: (c) => c.type === "model", site: (c) => ["feature", "design"].includes(c.type),
    fixes: (c) => ["fix", "data"].includes(c.type) }[updatesFilter];
  const shown = log.filter(keep);
  const day = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric", year: "numeric" });
  let html = "", last = "";
  for (const c of shown) {
    if (c.date !== last) { html += `${last ? "</div>" : ""}<h2 class="day-head">${esc(day(c.date))}</h2><div class="up-list">`; last = c.date; }
    const details = c.why ? `<dl class="gd-dl up-dl"><dt>Why</dt><dd>${esc(c.why)}</dd><dt>Effect</dt><dd>${esc(c.effect)}</dd>
      <dt>Pick log</dt><dd>${esc(c.forward_test)}</dd></dl>` : "";
    html += `<article class="card up up-${esc(c.type)}"><span class="up-type">${esc(TYPE_LABEL[c.type] || c.type)}</span>
      <h3>${esc(c.title)}</h3><p>${esc(c.summary)}</p>${details}</article>`;
  }
  $("#updates-list").innerHTML = shown.length ? html + "</div>" : `<p class="note">Nothing here yet.</p>`;
  const models = log.filter((c) => c.type === "model").length;
  $("#updates-summary").textContent = `${log.length} updates since October 2, 2026 · ${models} changed how picks are made`;
}

function issueUrl() {
  const f = FEEDBACK[$("#fb-type").value];
  const title = $("#fb-title").value.trim(), details = $("#fb-details").value.trim();
  const page = $("#fb-page").value.trim();
  const p = new URLSearchParams({ template: f.template, title: f.prefix + (title || "") });
  if (details) p.set("details", details);
  if (f.kind) p.set("kind", f.kind);
  if (page && !$("#fb-page-row").hidden) p.set("page", page);  // the page field is hidden for suggestions
  return `https://github.com/${REPO}/issues/new?${p}`;
}

async function loadOpenFeedback() {
  const box = $("#fb-open");
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/issues?state=open&per_page=12&sort=updated`,
      { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error(r.status === 403 ? "GitHub is limiting requests right now" : `${r.status}`);
    const items = (await r.json()).filter((i) => !i.pull_request);
    box.innerHTML = items.length ? items.map((i) => `<a class="fb-item" href="${esc(i.html_url)}" target="_blank" rel="noopener">
        <span class="fb-title">${esc(i.title)}</span>
        <span class="fb-meta">${i.labels.map((l) => `<span class="fb-label fb-${esc(l.name)}">${esc(l.name)}</span>`).join("")}
          #${i.number} · ${esc(new Date(i.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }))}
          ${i.comments ? ` · ${i.comments} comment${i.comments === 1 ? "" : "s"}` : ""}</span></a>`).join("")
      : `<p class="note">No open suggestions yet. Be the first.</p>`;
  } catch (e) {
    box.innerHTML = `<p class="note">Couldn't load open suggestions (${esc(e.message)}).
      <a href="https://github.com/${REPO}/issues" target="_blank" rel="noopener">See them on GitHub</a>.</p>`;
  }
}

function bindUpdates() {
  $$("#updates-filter button").forEach((b) => b.addEventListener("click", () => {
    $$("#updates-filter button").forEach((x) => x.classList.toggle("on", x === b));
    updatesFilter = b.dataset.v; renderUpdates();
  }));
  const form = $("#fb-form");
  const sync = () => { $("#fb-page-row").hidden = $("#fb-type").value === "suggestion"; };
  $("#fb-type").addEventListener("change", sync); sync();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!$("#fb-details").value.trim()) { $("#fb-details").focus(); return; }
    window.open(issueUrl(), "_blank", "noopener");
  });
}

bindUpdates();
appReady.then(() => { renderUpdates(); loadOpenFeedback(); }).catch(() => {});
