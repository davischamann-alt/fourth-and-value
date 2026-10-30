"""Data downloads shared by the Streamlit app and the website builder: ESPN scores, lines and FPI,
and past seasons from CollegeFootballData. Nothing here depends on Streamlit."""
import datetime as dt
import json
import os
import re
import tomllib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from model import fit_efficiency, fit_ratings, pool_fcs, walk_forward

DATA = Path(__file__).parent / "data"
RATINGS = DATA / "team_ratings.csv"
CLOSING = DATA / "closing_lines.csv"
ANCHOR = DATA / "anchor_weights.json"
CFBD_DIR = DATA / "cfbd"
SECRETS = Path(__file__).parent / ".streamlit" / "secrets.toml"
CFBD = "https://api.collegefootballdata.com"
# sportsbooks to take lines from, in order of preference (CFBD's provider names)
BOOKS = ["DraftKings", "ESPN Bet", "Bovada", "William Hill (New Jersey)", "consensus"]
ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard"
FPI = "https://site.web.api.espn.com/apis/fitt/v3/sports/football/college-football/powerindex"
FPI_WEEKLY = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football"
SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary"
# ESPN drops connections when hit with many requests at once: retry with backoff, a few at a time
HTTP = requests.Session()
HTTP.mount("https://", HTTPAdapter(max_retries=Retry(total=5, connect=5, read=5, backoff_factor=1.5,
                                                     status_forcelist=(429, 500, 502, 503, 504))))


def num(x):
    try:
        return 0.0 if str(x).upper() in ("PK", "EVEN") else float(str(x).lstrip("ou"))
    except ValueError:
        return None


def open_total(o):
    """Opening over/under from an ESPN odds or pickcenter entry ("o52.5"), or None."""
    return num(o.get("total", {}).get("over", {}).get("open", {}).get("line", ""))


def parse_odds(odds, home_abbr):
    """(home line, home opening line, total, opening total). Prefers the numeric fields and falls
    back to parsing the "ABBR -7.5" details text."""
    if not odds:
        return None, None, None, None
    o = odds[0]
    line = num(o["spread"]) if o.get("spread") is not None else None
    if line is None:
        d = o.get("details", "")
        if d.upper() == "EVEN":
            line = 0.0
        elif " " in d and (v := num(d.rsplit(" ", 1)[1])) is not None:
            line = v if d.rsplit(" ", 1)[0] == home_abbr else -v
    open_line = num(o.get("pointSpread", {}).get("home", {}).get("open", {}).get("line", ""))
    return line, open_line, num(o["overUnder"]) if o.get("overUnder") is not None else None, open_total(o)


def espn_events(**params):
    r = requests.get(ESPN, params={"groups": 80, "limit": 300, **params}, timeout=20)
    r.raise_for_status()
    return r.json().get("events", [])


def season_of(d):
    return d.year if d.month >= 7 else d.year - 1


def season_games(season, postseason=False):
    """This season's completed games, fetched week by week: ESPN's date-range queries currently
    fail, but week + season year works. August (Week 0) games get week 0. postseason: also the
    bowls and the College Football Playoff, as week 17 (for ratings, not the backtest)."""
    rows, seen = [], set()

    def done(ev):
        return ev["competitions"][0]["status"]["type"]["state"] == "post"

    def add(events, week):
        for ev in events:
            if ev["id"] in seen or not done(ev):
                continue
            seen.add(ev["id"])
            c = ev["competitions"][0]
            t = {x["homeAway"]: x for x in c["competitors"]}
            rows.append(dict(id=ev["id"], week=week, start=ev["date"], home=t["home"]["team"]["location"],
                             away=t["away"]["team"]["location"], home_id=t["home"]["team"]["id"],
                             away_id=t["away"]["team"]["id"], home_pts=int(t["home"].get("score") or 0),
                             away_pts=int(t["away"].get("score") or 0), neutral=c.get("neutralSite", False)))

    add(espn_events(dates=f"{season}08"), 0)
    for w in range(1, 17):
        evs = espn_events(dates=season, seasontype=2, week=w)
        add(evs, w)
        if w > 1 and not any(done(e) for e in evs):
            break
    if postseason:
        add(espn_events(dates=season, seasontype=3, week=1), 17)  # ESPN's "Bowls" week holds every postseason game
    return pd.DataFrame(rows, columns=["id", "week", "start", "home", "away", "home_id", "away_id",
                                       "home_pts", "away_pts", "neutral"])


def team_names(games):
    return dict(zip(games.home_id, games.home)) | dict(zip(games.away_id, games.away))


def espn_team_names():
    """{ESPN team id: location name} for every college team ESPN lists."""
    r = requests.get(ESPN.rsplit("/", 1)[0] + "/teams", params={"groups": 80, "limit": 1000}, timeout=20)
    r.raise_for_status()
    return {t["team"]["id"]: t["team"]["location"] for t in r.json()["sports"][0]["leagues"][0]["teams"]}


def season_ratings(season):
    """Opponent-adjusted points scored/allowed per game from this season's completed games
    (postseason included), plus ESPN FPI and Efficiency. Teams that haven't played yet, like
    everyone before week 1, get FPI alone (ESPN's preseason FPI), so week 1 still has projections.
    Returns (ratings, fitted home-field edge, FPI error or None)."""
    games = season_games(season, postseason=True)
    try:
        fpi, fpi_err = espn_fpi(season), None
    except Exception as ex:
        fpi, fpi_err = {}, str(ex)
    if games.empty and not fpi:
        return pd.DataFrame(columns=["team", "ppg", "papg", "games", "fpi", "id"]), None, fpi_err
    names = team_names(games)
    if any(i not in names for i in fpi):
        names = espn_team_names() | names
    fbs = {names[i] for i in fpi if i in names} or None  # FPI covers exactly the FBS teams
    if games.empty:
        df, fitted_hfa = pd.DataFrame(columns=["team", "ppg", "papg", "games"]), None
    else:
        fit = list(games[["home", "away", "home_pts", "away_pts", "neutral"]].itertuples(index=False, name=None))
        df, fitted_hfa = fit_ratings(pool_fcs(fit, fbs))
        df = df[df["team"] != "FCS"]
    unplayed = [names[i] for i in fpi if i in names and names[i] not in set(df["team"])]
    if unplayed:
        df = pd.concat([df, pd.DataFrame({"team": unplayed, "games": 0})], ignore_index=True)
    df["fpi"] = df["team"].map({names[i]: v for i, v in fpi.items() if i in names})
    df["id"] = df["team"].map({n: i for i, n in names.items()})
    df = df.round(2)
    try:
        eff = efficiency_rows(season, current=True)
    except Exception as ex:  # efficiency is optional: keep the other ratings
        eff = None
        print(f"No efficiency ratings: {ex}")
    if eff is not None:
        er = fit_efficiency(*eff)
        df["off_eff"] = df["id"].map(lambda i: er[i][0] if i in er else None).astype(float).round(3)
        df["def_eff"] = df["id"].map(lambda i: er[i][1] if i in er else None).astype(float).round(3)
    return df, fitted_hfa, fpi_err


def espn_fpi(season):
    """ESPN Football Power Index by ESPN team id: expected margin vs an average FBS team on a
    neutral field. Built from efficiency stats plus preseason priors, so it's steadier early on."""
    r = requests.get(FPI, params={"season": season, "limit": 200}, timeout=20)
    r.raise_for_status()
    out = {}
    for t in r.json().get("teams", []):
        cat = next((c for c in t.get("categories", []) if c.get("name") == "fpi"), None)
        if cat and cat.get("values"):
            out[t["team"]["id"]] = cat["values"][0]
    return out


def weekly_fpi(season, week):
    """(time taken, {team id: fpi}) for ESPN's FPI snapshot for `week`, or None if there isn't one."""
    url = f"{FPI_WEEKLY}/seasons/{season}/types/2/weeks/{week}/powerindex"
    r = requests.get(url, params={"limit": 200}, timeout=30)
    r.raise_for_status()
    items = r.json().get("items", [])
    if not items:
        return None
    out = {}
    for it in items:
        tid = re.search(r"/teams/(\d+)", it["team"]["$ref"]).group(1)
        v = next((p["value"] for p in it.get("predictives", []) if p["name"] == "fpi"), None)
        if v is not None:
            out[tid] = v
    return pd.Timestamp(items[0]["lastUpdated"]), out


def fpi_before_weeks(season, games, max_age_days=10):
    """{week - 1: fpi} as walk_forward expects: for each week, the newest snapshot taken before
    that week's first game. Picking by timestamp matters for past seasons, where ESPN has
    overwritten some weekly snapshots months later. Weeks whose newest earlier snapshot is
    stale get no FPI, so their games are left out rather than graded with old ratings."""
    snaps = [x for w in range(1, 17) if (x := weekly_fpi(season, w))]
    out = {}
    for w, first in games.groupby("week")["start"].min().items():
        first = pd.Timestamp(first)
        before = [x for x in snaps if x[0] < first]
        if before:
            ts, vals = max(before, key=lambda x: x[0])
            if first - ts <= pd.Timedelta(days=max_age_days):
                out[w - 1] = vals
    return out, (max(snaps, key=lambda x: x[0])[1] if snaps else {})


def pregame_line(gid):
    """(home closing line, home opening line, closing total, opening total) from ESPN's game
    summary, which keeps the pregame lines after the game."""
    r = HTTP.get(SUMMARY, params={"event": gid}, timeout=20)
    r.raise_for_status()
    pc = r.json().get("pickcenter") or []
    if not pc or pc[0].get("spread") is None:
        return gid, None, None, None, None
    o = pc[0]
    open_line = num(o.get("pointSpread", {}).get("home", {}).get("open", {}).get("line", ""))
    return (gid, num(o["spread"]), open_line, num(o["overUnder"]) if o.get("overUnder") is not None else None,
            open_total(o))


def closing_lines(ids):
    """{id: (closing line, opening line, closing total, opening total)} for finished games, cached
    in data/closing_lines.csv so each game is fetched once. A cache from before opening lines and
    totals were saved is refetched."""
    cols = ["id", "line", "open", "total", "open_total"]
    have = pd.read_csv(CLOSING, dtype={"id": str}) if CLOSING.exists() else pd.DataFrame(columns=cols)
    if "open_total" not in have.columns:
        have = pd.DataFrame(columns=cols)
    todo = sorted(set(ids) - set(have["id"]))
    if todo:
        with ThreadPoolExecutor(4) as pool:
            got = pd.DataFrame(pool.map(pregame_line, todo), columns=cols)
        have = pd.concat([have, got], ignore_index=True)
        have.to_csv(CLOSING, index=False)
    return dict(zip(have["id"], zip(have["line"], have["open"], have["total"], have["open_total"])))


def season_backtest(season, hfa, today):
    """Walk-forward results for every FBS game in a season (see model.walk_forward). The current
    season comes from ESPN; past seasons' games and lines come from CollegeFootballData."""
    if season == season_of(dt.date.fromisoformat(today)):
        games = season_games(season)
        fpi_by_week, latest = fpi_before_weeks(season, games)
        names = team_names(games)
        fbs = {names[i] for i in latest if i in names}  # FPI covers exactly the FBS teams
        both = games[games.home.isin(fbs) & games.away.isin(fbs) & (games.week >= 3)]
        lines = closing_lines(both["id"])
    else:
        games, lines, fbs = cfbd_season(season)
        fpi_by_week = fpi_before_weeks(season, games)[0]
    eff = efficiency_rows(season, current=season == season_of(dt.date.fromisoformat(today)))
    res = walk_forward(games, lines, fpi_by_week, fbs, hfa, eff=eff)
    return res.assign(season=season)


def cfbd_key():
    """CollegeFootballData key from the CFBD_API_KEY environment variable or .streamlit/secrets.toml."""
    if key := os.environ.get("CFBD_API_KEY", ""):
        return key
    try:
        return tomllib.loads(SECRETS.read_text()).get("CFBD_API_KEY", "")
    except (OSError, tomllib.TOMLDecodeError):
        return ""


def cfbd(path, max_age_hours=None, **params):
    """GET from CollegeFootballData, saved under data/cfbd/ so a finished season is only
    downloaded once (the free plan allows 1,000 calls a month). max_age_hours: for a season still
    being played, download again once per that many hours (the saved file's name says which
    period it's from, so this works the same after the GitHub job restores its cache)."""
    name = path.strip("/").replace("/", "_")
    stem = base = f"{name}_{'_'.join(f'{k}{v}' for k, v in sorted(params.items()))}"
    if max_age_hours:
        stem = f"{base}_t{int(dt.datetime.now(dt.timezone.utc).timestamp() // (max_age_hours * 3600))}"
        for old in CFBD_DIR.glob(f"{base}_t*.json"):
            if old.stem != stem:
                old.unlink()  # an earlier period's copy
    f = CFBD_DIR / f"{stem}.json"
    if f.exists():
        return json.loads(f.read_text())
    r = requests.get(CFBD + path, params=params, headers={"Authorization": f"Bearer {cfbd_key()}"}, timeout=60)
    if r.status_code == 401:
        raise RuntimeError("CollegeFootballData rejected the API key. Check .streamlit/secrets.toml.")
    r.raise_for_status()
    CFBD_DIR.mkdir(exist_ok=True)
    f.write_text(r.text)
    return r.json()


def cfbd_season(season):
    """(games, {id: (closing line, opening line, closing total, opening total)}, FBS team names)
    for a finished regular season.
    CFBD uses ESPN's team and game ids, so ESPN's FPI lines up by id."""
    raw = cfbd("/games", year=season, seasonType="regular")
    games = pd.DataFrame([dict(id=str(g["id"]), week=g["week"], start=g["startDate"], home=g["homeTeam"],
                               away=g["awayTeam"], home_id=str(g["homeId"]), away_id=str(g["awayId"]),
                               home_pts=g["homePoints"], away_pts=g["awayPoints"], neutral=g["neutralSite"])
                          for g in raw if g.get("completed") and g.get("homePoints") is not None])
    fbs = {g[f"{s}Team"] for g in raw for s in ("home", "away") if g.get(f"{s}Classification") == "fbs"}
    lines = {}
    for g in cfbd("/lines", year=season, seasonType="regular"):
        books = {b["provider"]: b for b in g.get("lines", []) if b.get("spread") is not None}
        # prefer a book that also has the opening line
        pick = next((books[p] for p in BOOKS if p in books and books[p].get("spreadOpen") is not None),
                    next((books[p] for p in BOOKS if p in books), next(iter(books.values()), None)))
        # totals can come from a different book: prefer one that has the opening total
        tots = [b for b in g.get("lines", []) if b.get("overUnder") is not None]
        tot = next((b for p in BOOKS for b in tots if b["provider"] == p and b.get("overUnderOpen") is not None),
                   next((b for p in BOOKS for b in tots if b["provider"] == p), tots[0] if tots else {}))
        if pick:
            lines[str(g["id"])] = (pick["spread"], pick.get("spreadOpen"), tot.get("overUnder"), tot.get("overUnderOpen"))
    return games, lines, fbs


def efficiency_rows(season, current=False):
    """(rows, FBS team ids) for fit_efficiency: each team's EPA per play in each regular-season
    game, garbage time excluded, from CollegeFootballData, keyed by ESPN team id. Needs a
    CollegeFootballData key; returns None without one. current: the season is still being
    played, so refresh once a day (2 calls a day, well within the free plan)."""
    if not cfbd_key():
        return None
    age = 24 if current else None
    games = cfbd("/games", age, year=season, seasonType="regular")
    ids = {g[f"{s}Team"]: str(g[f"{s}Id"]) for g in games for s in ("home", "away")}
    info = {str(g["id"]): g for g in games}
    fbs = {str(g[f"{s}Id"]) for g in games for s in ("home", "away") if g.get(f"{s}Classification") == "fbs"}
    rows = []
    for r in cfbd("/ppa/games", age, year=season, seasonType="regular", excludeGarbageTime="true"):
        g, off = info.get(str(r["gameId"])), (r.get("offense") or {}).get("overall")
        if g is None or off is None or r["team"] not in ids or r["opponent"] not in ids:
            continue
        loc = 0.0 if g["neutralSite"] else 0.5 if r["team"] == g["homeTeam"] else -0.5
        rows.append(dict(week=r["week"], team=ids[r["team"]], opp=ids[r["opponent"]], off=off, loc=loc))
    return pd.DataFrame(rows, columns=["week", "team", "opp", "off", "loc"]), fbs


def parse_events(events):
    """One row per game from ESPN scoreboard events."""
    rows = []
    for e in events:
        c = e["competitions"][0]
        t = {x["homeAway"]: x for x in c["competitors"]}
        h, a = t["home"], t["away"]
        line, open_line, total, open_tot = parse_odds(c.get("odds") or [], h["team"].get("abbreviation"))
        rows.append(dict(
            id=e["id"], kickoff=e["date"], home=h["team"]["location"], away=a["team"]["location"],
            home_id=h["team"]["id"], away_id=a["team"]["id"],
            home_score=int(h.get("score") or 0), away_score=int(a.get("score") or 0),
            status=c["status"]["type"]["shortDetail"], state=c["status"]["type"]["state"],
            neutral=c.get("neutralSite", False), line=line, open_line=open_line, total=total, open_total=open_tot,
            note=(c.get("notes") or [{}])[0].get("headline"),
            period=c["status"].get("period", 0), clock=float(c["status"].get("clock") or 0)))
    return pd.DataFrame(rows, columns=["id", "kickoff", "home", "away", "home_id", "away_id", "home_score",
                                       "away_score", "status", "state", "neutral", "line", "open_line", "total",
                                       "open_total", "note", "period", "clock"])


def scoreboard(date_str):
    r = requests.get(ESPN, params={"dates": date_str, "groups": 80, "limit": 200}, timeout=10)
    r.raise_for_status()
    return parse_events(r.json().get("events", []))


def week_scoreboard(season=None, seasontype=None, week=None):
    """(games, info) for one week; with no arguments, ESPN's current week. info has the season,
    season type and week of the games returned, plus ESPN's calendar of weeks."""
    params = {"groups": 80, "limit": 300}
    if week is not None:
        params.update(dates=season, seasontype=seasontype, week=week)
    r = requests.get(ESPN, params=params, timeout=20)
    r.raise_for_status()
    j = r.json()
    cal = [(int(c["value"]), int(x["value"])) for c in j.get("leagues", [{}])[0].get("calendar", [])
           if c.get("value") in ("2", "3") for x in c.get("entries", [])]
    info = dict(season=j["season"]["year"], seasontype=j["season"]["type"], week=j.get("week", {}).get("number"),
                calendar=cal)
    return parse_events(j.get("events", [])), info
