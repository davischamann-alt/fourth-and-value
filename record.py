"""Forward test: records lines and the model's picks before kickoff, then grades them. Run by the
GitHub job every two hours, or by hand:

    python record.py

Writes these files:
  data/live/line_history.csv  every line change seen, with the time it was seen
  data/live/picks.csv         each game's pick from every source, logged the first time the game
                              has a line and never changed after; closing line and result are
                              filled in later
  data/live/total_picks.csv   the same for over/unders, logged the first time a game has a total
  site/data/live.json         the summary the website's Track record tab shows
  site/data/game_log.json     each recent game's line history and logged picks, for the website's
                              game detail view

Because the job commits these files to git each run, the repository history proves every pick
was recorded before its game started."""
import datetime as dt
import json

import pandas as pd

import sources
from build_site import clean
from model import HFA, anchored_total, project, projections

LIVE = sources.DATA / "live"
LINES, PICKS, TOTALS = LIVE / "line_history.csv", LIVE / "picks.csv", LIVE / "total_picks.csv"
SITE_LIVE = sources.DATA.parent / "site" / "data" / "live.json"
SITE_GAMES = sources.DATA.parent / "site" / "data" / "game_log.json"
STRONG, LEAN = 3.0, 1.5
SOURCES = {"anchored": "Market-anchored", "fpi": "ESPN FPI", "efficiency": "Efficiency", "blend": "Blend",
           "points": "Adjusted points"}
TOTAL_SOURCES = {"anchored": "Market-anchored", "points": "Adjusted points"}  # FPI doesn't project scoring
LINE_COLS = ["seen_at", "id", "season", "week", "kickoff", "home", "away", "line", "open_line", "total"]
# columns up to "tier" are written once when a pick is logged and never edited
PICK_COLS = ["logged_at", "id", "season", "seasontype", "week", "kickoff", "home", "away", "neutral", "source",
             "margin", "line_logged", "open_line", "edge", "side", "tier",
             "close_line", "final_margin", "result_logged", "result_close", "clv"]
# the same for over/unders: proj is the projected total, side is "over" or "under"
TOTAL_COLS = ["logged_at", "id", "season", "seasontype", "week", "kickoff", "home", "away", "neutral", "source",
              "proj", "total_logged", "open_total", "edge", "side", "tier",
              "close_total", "final_total", "result_logged", "result_close", "clv"]


def load(path, cols):
    return pd.read_csv(path, dtype={"id": str}) if path.exists() else pd.DataFrame(columns=cols)


def weeks_to_check():
    """The current week, plus the next one so Sunday's opening lines for it are caught."""
    games, info = sources.week_scoreboard()
    out = [(info, games)]
    key = (info["seasontype"], info["week"])
    if key in info["calendar"] and info["calendar"].index(key) + 1 < len(info["calendar"]):
        st, wk = info["calendar"][info["calendar"].index(key) + 1]
        nxt, ninfo = sources.week_scoreboard(info["season"], st, wk)
        # ESPN's "Bowls" week also lists every playoff game, and so does its "CFP" week: keep each once
        out.append((ninfo, nxt[~nxt.id.isin(games.id)]))
    return out


def record_lines(weeks, now):
    hist = load(LINES, LINE_COLS)
    last = hist.drop_duplicates("id", keep="last").set_index("id")
    new = []
    for info, games in weeks:
        for g in games[(games.state == "pre") & games.line.notna()].itertuples():
            prev = last.loc[g.id] if g.id in last.index else None
            if prev is not None and prev["line"] == g.line and (prev["total"] == g.total or
                                                                (pd.isna(prev["total"]) and pd.isna(g.total))):
                continue
            new.append(dict(seen_at=now, id=g.id, season=info["season"], week=info["week"], kickoff=g.kickoff,
                            home=g.home, away=g.away, line=g.line, open_line=g.open_line, total=g.total))
    if new:
        pd.concat([hist, pd.DataFrame(new, columns=LINE_COLS)], ignore_index=True).to_csv(LINES, index=False)
    return len(new)


def log_picks(weeks, picks, ratings, weights, now, eff_scale=None):
    """Logs every source's pick for games seen with a line for the first time."""
    have = set(picks["id"])
    new = []
    for info, games in weeks:
        for g in games[(games.state == "pre") & games.line.notna()].itertuples():
            if g.id in have:
                continue
            proj = projections(g.home, g.away, ratings, g.neutral, HFA, g.line, weights, eff_scale)
            for src, m in proj.items():
                if m is None:
                    continue
                edge = m + g.line
                new.append(dict(logged_at=now, id=g.id, season=info["season"], seasontype=info["seasontype"],
                                week=info["week"], kickoff=g.kickoff, home=g.home, away=g.away, neutral=g.neutral,
                                source=src, margin=round(m, 2), line_logged=g.line, open_line=g.open_line,
                                edge=round(abs(edge), 2), side="home" if edge >= 0 else "away",
                                tier=tier_of(abs(edge))))
    return pd.concat([picks, pd.DataFrame(new, columns=PICK_COLS)], ignore_index=True), len({p["id"] for p in new})


def tier_of(edge):
    return "strong" if edge >= STRONG else "lean" if edge >= LEAN else "small"


def log_totals(weeks, totals, ratings, weights, now):
    """Logs every totals source's over/under pick for games seen with a total for the first time."""
    have = set(totals["id"])
    new = []
    for info, games in weeks:
        for g in games[(games.state == "pre") & games.total.notna()].itertuples():
            if g.id in have or (p := project(g.home, g.away, ratings, g.neutral, HFA)) is None:
                continue
            pts = p[0] + p[1]
            proj = {"points": pts, "anchored": anchored_total(weights, g.total, pts) if weights else None}
            for src, t in proj.items():
                if t is None:
                    continue
                edge = t - g.total
                new.append(dict(logged_at=now, id=g.id, season=info["season"], seasontype=info["seasontype"],
                                week=info["week"], kickoff=g.kickoff, home=g.home, away=g.away, neutral=g.neutral,
                                source=src, proj=round(t, 2), total_logged=g.total, open_total=g.open_total,
                                edge=round(abs(edge), 2), side="over" if edge >= 0 else "under", tier=tier_of(abs(edge))))
    return pd.concat([totals, pd.DataFrame(new, columns=TOTAL_COLS)], ignore_index=True), len({p["id"] for p in new})


def ats(margin, line, side):
    x = (margin + line) * (1 if side == "home" else -1)
    return "W" if x > 0 else "L" if x < 0 else "P"


def final_scores(weeks, *logs):
    """{id: (home score, away score)} for finished games: this week's and next week's, plus earlier
    weeks with games in the logs that aren't graded yet."""
    finals = {}
    for _, games in weeks:
        finals.update({g.id: (g.home_score, g.away_score) for g in games[games.state == "post"].itertuples()})
    todo = pd.concat([d[d.result_logged.isna() & ~d.id.isin(finals)] for d in logs])
    todo = todo[pd.to_datetime(todo.kickoff, utc=True) < pd.Timestamp.now(tz="UTC") - pd.Timedelta(hours=3)]
    for (season, st, wk), _ in todo.groupby(["season", "seasontype", "week"]):
        games, _ = sources.week_scoreboard(int(season), int(st), int(wk))
        finals.update({g.id: (g.home_score, g.away_score) for g in games[games.state == "post"].itertuples()})
    return finals


def update_picks(picks, scores):
    """Closing line (last line seen before kickoff) and results for finished games."""
    lines = load(LINES, LINE_COLS).drop_duplicates("id", keep="last").set_index("id")["line"]
    finals = {k: h - a for k, (h, a) in scores.items()}
    for i, p in picks.iterrows():
        if pd.isna(p.result_logged) and p.id in lines.index:
            picks.at[i, "close_line"] = lines[p.id]
        if pd.isna(p.result_logged) and p.id in finals:
            fm, close = finals[p.id], picks.at[i, "close_line"]
            picks.at[i, "final_margin"] = fm
            picks.at[i, "result_logged"] = ats(fm, p.line_logged, p.side)
            if pd.notna(close):
                picks.at[i, "result_close"] = ats(fm, close, p.side)
                picks.at[i, "clv"] = (p.line_logged - close) * (1 if p.side == "home" else -1)
    return picks


def over_under(final, total, side):
    x = (final - total) * (1 if side == "over" else -1)
    return "W" if x > 0 else "L" if x < 0 else "P"


def update_totals(totals, scores):
    """Closing total (last total seen before kickoff) and results for finished games."""
    hist = load(LINES, LINE_COLS).dropna(subset=["total"])
    close = hist.drop_duplicates("id", keep="last").set_index("id")["total"]
    for i, p in totals.iterrows():
        if pd.notna(p.result_logged):
            continue
        if p.id in close.index:
            totals.at[i, "close_total"] = close[p.id]
        if p.id in scores:
            final, c = sum(scores[p.id]), totals.at[i, "close_total"]
            totals.at[i, "final_total"] = final
            totals.at[i, "result_logged"] = over_under(final, p.total_logged, p.side)
            if pd.notna(c):
                totals.at[i, "result_close"] = over_under(final, c, p.side)
                totals.at[i, "clv"] = (c - p.total_logged) * (1 if p.side == "over" else -1)
    return totals


def summary_rows(picks, names):
    """Record and line movement per source and edge tier. clv_sd and clv_n give the site the
    margin of error on the average line move."""
    def record(d, col):
        w, l, pu = (d[col] == "W").sum(), (d[col] == "L").sum(), (d[col] == "P").sum()
        return dict(wins=int(w), losses=int(l), pushes=int(pu), hit_rate=float(w / (w + l)) if w + l else None)

    rows = []
    for src, name in names.items():
        for tier, label in (("all", "Every game"), ("lean", "Edge 1.5+"), ("strong", "Edge 3+")):
            d = picks[picks.source == src]
            if tier == "lean":
                d = d[d.tier.isin(["lean", "strong"])]
            elif tier == "strong":
                d = d[d.tier == "strong"]
            done = d[d.result_logged.notna()]
            moved = done.clv.dropna()
            moved = moved[moved != 0]
            clv = done.clv.dropna()
            rows.append(dict(source=name, key=src, tier=tier, label=label, picks=len(d), pending=int(len(d) - len(done)),
                             at_logged=record(done, "result_logged"), at_close=record(done, "result_close"),
                             avg_clv=float(clv.mean()) if len(clv) else None,
                             clv_sd=float(clv.std()) if len(clv) > 1 else None, clv_n=len(clv), moved_n=len(moved),
                             clv_beat_rate=float((moved > 0).mean()) if len(moved) else None))
    return rows


def summary(picks, totals, now):
    rows = summary_rows(picks, SOURCES)
    anchored = picks[(picks.source == "anchored") & picks.tier.isin(["lean", "strong"])].sort_values("kickoff", ascending=False)
    recent = [dict(id=p.id, kickoff=p.kickoff, game=f"{p.away} @ {p.home}", side=p.side, team=p.home if p.side == "home" else p.away,
                   line=p.line_logged if p.side == "home" else -p.line_logged, edge=p.edge, tier=p.tier,
                   logged_at=p.logged_at, result=None if pd.isna(p.result_logged) else p.result_logged,
                   clv=None if pd.isna(p.clv) else float(p.clv))
              for p in anchored.head(60).itertuples()]
    t = totals[(totals.source == "anchored") & totals.tier.isin(["lean", "strong"])].sort_values("kickoff", ascending=False)
    recent_totals = [dict(id=p.id, kickoff=p.kickoff, game=f"{p.away} @ {p.home}", side=p.side, line=p.total_logged,
                          proj=p.proj, edge=p.edge, tier=p.tier, logged_at=p.logged_at,
                          result=None if pd.isna(p.result_logged) else p.result_logged,
                          clv=None if pd.isna(p.clv) else float(p.clv))
                     for p in t.head(60).itertuples()]
    return dict(updated=now, since=picks.logged_at.min() if len(picks) else None, games=int(picks.id.nunique()),
                summary=rows, recent=recent,
                totals=dict(since=totals.logged_at.min() if len(totals) else None, games=int(totals.id.nunique()),
                            summary=summary_rows(totals, TOTAL_SOURCES), recent=recent_totals))


def game_log(picks, totals, days=21):
    """{game id: line history and logged picks} for games from the last few weeks and upcoming ones."""
    cutoff = pd.Timestamp.now(tz="UTC") - pd.Timedelta(days=days)
    hist = load(LINES, LINE_COLS)
    hist = hist[pd.to_datetime(hist.kickoff, utc=True) >= cutoff]
    out = {gid: {"lines": [[r.seen_at, r.line, None if pd.isna(r.total) else r.total] for r in g.itertuples()]}
           for gid, g in hist.groupby("id")}
    recent = picks[pd.to_datetime(picks.kickoff, utc=True) >= cutoff]
    for gid, g in recent.groupby("id"):
        first = g.iloc[0]
        out.setdefault(gid, {"lines": []})["logged"] = dict(
            at=first.logged_at, line=first.line_logged, close=None if pd.isna(first.close_line) else first.close_line,
            final_margin=None if pd.isna(first.final_margin) else first.final_margin,
            picks={p.source: dict(margin=p.margin, edge=p.edge, side=p.side, tier=p.tier,
                                  result=None if pd.isna(p.result_logged) else p.result_logged,
                                  clv=None if pd.isna(p.clv) else p.clv) for p in g.itertuples()})
    for gid, g in totals[pd.to_datetime(totals.kickoff, utc=True) >= cutoff].groupby("id"):
        first = g.iloc[0]
        out.setdefault(gid, {"lines": []})["totals"] = dict(
            at=first.logged_at, total=first.total_logged, close=None if pd.isna(first.close_total) else first.close_total,
            final=None if pd.isna(first.final_total) else first.final_total,
            picks={p.source: dict(proj=p.proj, edge=p.edge, side=p.side, tier=p.tier,
                                  result=None if pd.isna(p.result_logged) else p.result_logged,
                                  clv=None if pd.isna(p.clv) else p.clv) for p in g.itertuples()})
    return out


def main():
    LIVE.mkdir(parents=True, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    weeks = weeks_to_check()
    n_lines = record_lines(weeks, now)

    picks = load(PICKS, PICK_COLS).astype({c: object for c in ("result_logged", "result_close")})
    ratings, _, _ = sources.season_ratings(weeks[0][0]["season"])
    ratings = ratings.set_index("team")
    anchor = json.loads(sources.ANCHOR.read_text()) if sources.ANCHOR.exists() else {}
    picks, n_new = log_picks(weeks, picks, ratings, anchor.get("weights"), now, anchor.get("eff_scale"))
    totals = load(TOTALS, TOTAL_COLS).astype({c: object for c in ("result_logged", "result_close")})
    totals, n_tot = log_totals(weeks, totals, ratings, anchor.get("total_weights"), now)
    scores = final_scores(weeks, picks, totals)
    picks = update_picks(picks, scores)
    totals = update_totals(totals, scores)
    picks.to_csv(PICKS, index=False)
    totals.to_csv(TOTALS, index=False)

    SITE_LIVE.write_text(json.dumps(clean(summary(picks, totals, now)), indent=1))
    SITE_GAMES.write_text(json.dumps(clean(game_log(picks, totals)), separators=(",", ":")))
    graded = picks.drop_duplicates("id").result_logged.notna().sum()
    print(f"{n_lines} line changes, {n_new} new games logged, {graded} of {picks.id.nunique()} games graded; "
          f"totals: {n_tot} new games logged, {totals.drop_duplicates('id').result_logged.notna().sum()} graded")


if __name__ == "__main__":
    main()
