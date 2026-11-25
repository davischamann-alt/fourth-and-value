"""Records NFL lines for a possible NFL version of the site in 2027. Nothing on the site uses them yet.
Free sources keep only closing lines for past NFL seasons, so an NFL backtest can't be graded at the
opening line. This builds that record from now on: every line and total seen before kickoff, with the
time it was seen, and each game's final score. Run by the GitHub job every two hours (and every 30
minutes on Sunday afternoons and evenings, when next week's lines post), or by hand:

    python nfl_lines.py

Writes, in data/live/nfl/ (committed by the job, so git history shows when each line was seen):
  line_history.csv  a row the first time a game has a line or total, and again whenever either
                    changes, until kickoff (like the college data/live/line_history.csv)
  results.csv       each finished game's final score, once
No picks are made or logged: there's no NFL model yet. See "An NFL version" in the README."""
import datetime as dt
from pathlib import Path

import pandas as pd

from sources import HTTP, parse_odds

SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
LIVE = Path(__file__).parent / "data" / "live" / "nfl"
LINES, RESULTS = LIVE / "line_history.csv", LIVE / "results.csv"
LINE_COLS = ["seen_at", "id", "season", "seasontype", "week", "kickoff", "home", "away", "home_id", "away_id",
             "line", "open_line", "total", "open_total"]
RESULT_COLS = ["seen_at", "id", "season", "seasontype", "week", "kickoff", "home", "away", "home_id", "away_id",
               "home_score", "away_score"]
SEASON_TYPES = ("2", "3")   # regular season and playoffs; preseason games aren't worth modeling


def scoreboard(season=None, seasontype=None, week=None):
    """(games, info) for one NFL week from ESPN; with no arguments, ESPN's current week. home and away
    are full team names ("Los Angeles Rams"): city names repeat in the NFL (two in New York, two in
    Los Angeles). line is the home team's spread, negative when it's favored, as in college."""
    params = {"limit": 100}
    if week is not None:
        params.update(dates=season, seasontype=seasontype, week=week)
    r = HTTP.get(SCOREBOARD, params=params, timeout=30)
    r.raise_for_status()
    j = r.json()
    cal = [(int(c["value"]), int(x["value"])) for c in j.get("leagues", [{}])[0].get("calendar", [])
           if c.get("value") in SEASON_TYPES for x in c.get("entries", [])]
    info = dict(season=int(j["season"]["year"]), seasontype=int(j["season"]["type"]),
                week=(j.get("week") or {}).get("number"), calendar=cal)
    rows = []
    for e in j.get("events", []):
        c = e["competitions"][0]
        t = {x["homeAway"]: x for x in c["competitors"]}
        h, a = t["home"], t["away"]
        line, open_line, total, open_total = parse_odds(c.get("odds") or [], h["team"].get("abbreviation"))
        rows.append(dict(id=str(e["id"]), kickoff=e["date"], state=c["status"]["type"]["state"],
                         season=info["season"], seasontype=int(seasontype or info["seasontype"]),
                         week=int(week if week is not None else info["week"] or 0),
                         home=h["team"]["displayName"], away=a["team"]["displayName"],
                         home_id=str(h["team"]["id"]), away_id=str(a["team"]["id"]),
                         home_score=int(h.get("score") or 0), away_score=int(a.get("score") or 0),
                         line=line, open_line=open_line, total=total, open_total=open_total))
    return pd.DataFrame(rows), info


def weeks_to_check():
    """Games from last week (to catch finals the job missed), this week and next week (whose lines post
    on Sunday). Outside the season, ESPN's current week is preseason or the offseason, so the first
    regular-season week stands in for this week: NFL week 1 lines are posted months ahead."""
    games, info = scoreboard()
    cal, key = info["calendar"], (info["seasontype"], info["week"])
    if key in cal:
        i = cal.index(key)
        out = [games]
    else:
        i = 0
        out = []
    for j in (i - 1, i + 1) if key in cal else (0, 1):
        if 0 <= j < len(cal):
            st, wk = cal[j]
            try:
                out.append(scoreboard(info["season"], st, wk)[0])
            except Exception as ex:  # one week failing shouldn't lose the others
                print(f"NFL lines: couldn't load {('week', 'playoff round')[st == 3]} {wk}: {type(ex).__name__}")
    games = pd.concat([g for g in out if len(g)], ignore_index=True) if any(len(g) for g in out) else pd.DataFrame()
    return games.drop_duplicates("id") if len(games) else games


def load(path, cols):
    return pd.read_csv(path, dtype={"id": str, "home_id": str, "away_id": str}) if path.exists() else pd.DataFrame(columns=cols)


def same(a, b):
    return (pd.isna(a) and pd.isna(b)) or a == b


def record_lines(games, now):
    """Appends a row for each game before kickoff whose line or total is new or has changed."""
    hist = load(LINES, LINE_COLS)
    last = hist.drop_duplicates("id", keep="last").set_index("id") if len(hist) else hist
    new = []
    for g in games.itertuples():
        if g.state != "pre" or (pd.isna(g.line) and pd.isna(g.total)):
            continue
        if g.id in last.index and same(last.at[g.id, "line"], g.line) and same(last.at[g.id, "total"], g.total):
            continue
        new.append({c: (now if c == "seen_at" else getattr(g, c)) for c in LINE_COLS})
    if new:
        pd.concat([hist, pd.DataFrame(new, columns=LINE_COLS)], ignore_index=True).to_csv(LINES, index=False)
    return len(new)


def record_results(games, now):
    """Appends each newly finished game's final score, for games whose lines are in line_history.csv
    (the results are there to grade those lines; older games are in free data already)."""
    done = load(RESULTS, RESULT_COLS)
    have, logged = set(done.id), set(load(LINES, LINE_COLS).id)
    new = [{c: (now if c == "seen_at" else getattr(g, c)) for c in RESULT_COLS}
           for g in games.itertuples() if g.state == "post" and g.id in logged and g.id not in have]
    if new:
        pd.concat([done, pd.DataFrame(new, columns=RESULT_COLS)], ignore_index=True).to_csv(RESULTS, index=False)
    return len(new)


def main():
    LIVE.mkdir(parents=True, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    games = weeks_to_check()
    if games.empty:
        print("NFL lines: no games found")
        return
    n_lines, n_final = record_lines(games, now), record_results(games, now)
    pre = games[games.state == "pre"]
    print(f"NFL lines: {n_lines} line changes, {n_final} new finals; {len(games)} games checked, "
          f"{int(pre.line.notna().sum())} of {len(pre)} upcoming have a line")


if __name__ == "__main__":
    main()
