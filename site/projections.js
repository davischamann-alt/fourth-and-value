"use strict";
// The projection math, and nothing else: no page, no saved settings. app.js calls these, and
// check_parity.py runs this same file under Node to make sure it still agrees with model.py.
// Change a formula here and in model.py together; the check fails the site build if they drift.

/** Projected home margin from every source, or null where a source can't make one (model.projections).
 *  h, a: the home and away teams' rows from data/ratings.json (or undefined); model: data/model.json. */
function spreadProjections(h, a, { neutral, line, hfa, model }) {
  const bump = neutral ? 0 : hfa;
  const points = h && a && h.ppg != null && a.ppg != null ? (h.ppg + a.papg) - (a.ppg + h.papg) + bump : null;
  const fpi = h && a && h.fpi != null && a.fpi != null ? h.fpi - a.fpi + bump : null;
  // an opponent-adjusted per-play rating turned into points (model.efficiency_margin)
  const matchup = (scale, off, def) => (scale && h && a && h[off] != null && a[off] != null
    ? scale * ((h[off] + a[def]) - (a[off] + h[def])) + bump : null);
  const efficiency = matchup(model?.eff_scale, "off_eff", "def_eff");   // EPA per play
  const success = matchup(model?.sr_scale, "off_sr", "def_sr");         // success rate
  const both = [fpi, efficiency, success].filter((x) => x != null);     // Blend: whichever of the three exist
  const blend = both.length ? both.reduce((s, x) => s + x, 0) / both.length : null;
  const w = model?.anchor?.weights;
  // Market-anchored starts from the line being bet, as tested
  const anchored = w && points != null && fpi != null && line != null
    ? w.const - w.line * line + w.fpi * fpi + w.points * points : null;
  return { points, fpi, efficiency, success, blend, anchored };
}

/** Projected total points from each totals source (record.log_totals). avg: the league's average
 *  points per team per game, as model.project computes it. */
function totalProjectionsFor(h, a, { total, avg, model }) {
  if (!h || !a || h.ppg == null || a.ppg == null) return { points: null, anchored: null };
  const points = h.ppg + a.papg + a.ppg + h.papg - 2 * avg;
  const w = model?.anchor?.total_weights;
  const anchored = w && total != null ? w.const + w.total * total + w.points * points : null;
  return { points, anchored };
}

/** The league average the totals use: (mean ppg + mean papg) / 2 over teams that have played. */
function leagueAverage(teams) {
  const played = teams.filter((t) => t.ppg != null);
  return played.reduce((s, t) => s + t.ppg + t.papg, 0) / (2 * played.length || 1);
}

if (typeof module !== "undefined") module.exports = { spreadProjections, totalProjectionsFor, leagueAverage };
