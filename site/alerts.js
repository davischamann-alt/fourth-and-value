"use strict";
// Alerts panel: how to subscribe (feed, ntfy phone notifications, Discord) and the latest alerts.
// data/alerts.json is written by alerts.py in the GitHub job every two hours.

const ALERT_ICON = { pick: "Spread", total: "Total", key: "Line move" };

function alertAgo(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60e3);
  if (m < 60) return `${Math.max(m, 1)} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} hr ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderAlerts(d) {
  const feed = d?.feed || new URL("alerts.xml", location.href).href;
  const topic = d?.ntfy_topic;
  $("#alerts-ways").innerHTML = `
    <div class="al-way"><b>On your phone</b>${topic
      ? `<span>Install the free <a href="https://ntfy.sh" target="_blank" rel="noopener">ntfy</a> app (iPhone or Android), tap
         <b>+</b>, and subscribe to <code>${esc(topic)}</code>. Or open <a href="https://ntfy.sh/${encodeURIComponent(topic)}" target="_blank" rel="noopener">ntfy.sh/${esc(topic)}</a>
         in a browser and allow notifications.</span>`
      : `<span class="note">Not set up yet. The site's owner can turn on free phone notifications (see "Alerts" in the README).</span>`}</div>
    <div class="al-way"><b>In a feed reader</b><span>Add this address to any RSS reader (Feedly, Inoreader, NetNewsWire, Slack's RSS app…):</span>
      <span class="al-copy"><input readonly value="${esc(feed)}" aria-label="Feed address"><button type="button" class="primary" data-copy-feed>Copy</button></span></div>
    ${d?.discord ? `<div class="al-way"><b>On Discord</b><span>Alerts are also posted to the project's Discord channel.</span></div>` : ""}`;
  const items = d?.items || [];
  $("#alerts-list").innerHTML = items.length
    ? `<ul class="al-list">${items.map((a) => `<li>
        <span class="al-kind al-${esc(a.kind)}">${esc(ALERT_ICON[a.kind] || "Alert")}</span>
        <a href="#game/${esc(a.game_id)}" data-close-alerts><b>${esc(a.title)}</b></a>
        <span class="note">${esc(alertAgo(a.at))}</span>
        <p>${esc(a.text)}</p></li>`).join("")}</ul>`
    : `<p class="note">No alerts yet. They appear when new lines open, usually Sunday for the next week's games.</p>`;
}

function bindAlerts() {
  const dlg = $("#alerts-dlg");
  $("#alerts-btn").addEventListener("click", () => {
    dlg.showModal();
    getJSON("data/alerts.json").then(renderAlerts).catch(() => renderAlerts(null));
  });
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg || e.target.closest("[data-close-alerts]")) dlg.close();  // backdrop click or opening a game
    const copy = e.target.closest("[data-copy-feed]");
    if (copy) {
      const input = copy.previousElementSibling;
      navigator.clipboard?.writeText(input.value).then(() => { copy.textContent = "Copied"; setTimeout(() => (copy.textContent = "Copy"), 1500); })
        .catch(() => input.select());
    }
  });
}

bindAlerts();
