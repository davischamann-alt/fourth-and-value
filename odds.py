"""Line shopping: the best spread and total available across US sportsbooks for this week's and next
week's games, from The Odds API (the-odds-api.com). Run by the GitHub job, or by hand:

    python odds.py

Needs the ODDS_API_KEY environment variable (a repository secret in the job); without it this does
nothing. The free plan allows 500 credits a month and one call here costs 2 (spreads and totals,
US books), so calls are rationed: every 30 minutes on Sundays from noon to 11 p.m. Eastern, when
lines open and move fastest, and every 8 hours otherwise. That's about 370 credits a month. It
also stops early when the plan's remaining credits run low.

Writes:
  data/live/best_lines.json  the latest numbers per game, with when they were fetched (committed
                             by the job, so the next run knows when the last call was)
  data/live/odds_history.csv one row per game each time its numbers change: a timestamped record
                             of the market that ESPN's single "opening line" can't give
  site/data/odds.json        what the website shows

Sportsbooks aren't named, on the site or in these files: only the best number, the middle
(median) number and how many books were quoted. Whether the free plan allows showing books by
name hasn't been confirmed."""
import datetime as dt
import difflib
import json
import os
import statistics
import unicodedata
from zoneinfo import ZoneInfo

import pandas as pd
import requests

import sources

LIVE = sources.DATA / "live"
STATE = LIVE / "best_lines.json"
HISTORY = LIVE / "odds_history.csv"
SITE = sources.DATA.parent / "site" / "data" / "odds.json"
API = "https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/odds"
ET = ZoneInfo("America/New_York")
WORST_PRICE = -125      # a better number at a much worse price isn't a better bet: skip those quotes
RESERVE = 20            # stop calling when the month's remaining credits fall to this
HIST_COLS = ["seen_at", "id", "home", "away", "books", "spread_mid", "home_best", "away_best", "total_mid", "over_best", "under_best"]
# names The Odds API spells differently from ESPN (both sides are normalized first)
ALIASES = {"appalachian state": "app state", "umass": "massachusetts", "connecticut": "uconn", "louisiana monroe": "ul monroe",
           "southern mississippi": "southern miss", "florida international": "fiu", "miami ohio": "miami oh",
           "texas san antonio": "utsa", "central florida": "ucf", "southern methodist": "smu", "brigham young": "byu",
           "nevada las vegas": "unlv", "texas el paso": "utep", "sam houston state": "sam houston", "louisiana lafayette": "louisiana"}


def due(last, now):
    """Is it time for another call? Every 30 minutes on Sundays noon-11 p.m. Eastern, else every 8 hours."""
    if last is None:
        return True
    local = now.astimezone(ET)
    gap = dt.timedelta(minutes=25) if local.weekday() == 6 and 12 <= local.hour < 23 else dt.timedelta(hours=7, minutes=45)
    return now - last >= gap


def norm(name):
    s = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode().lower()
    s = " ".join("".join(c if c.isalnum() or c.isspace() else " " for c in s.replace("'", "")).split())
    for a, b in ALIASES.items():
        if s == a or s.startswith(a + " "):
            s = b + s[len(a):]
    return s


def same_team(odds_name, espn_name):
    return difflib.SequenceMatcher(None, norm(odds_name), norm(espn_name)).ratio()


def match(event, games):
    """(ESPN game row, flipped) for an Odds API event, or (None, False). flipped: the feed lists home
    and away the other way round (it happens at neutral sites)."""
    kick = pd.Timestamp(event["commence_time"])
    best = (0.0, None, False)
    for g in games.itertuples():
        if abs((pd.Timestamp(g.kickoff) - kick).total_seconds()) > 36 * 3600:  # ESPN's times can be placeholders
            continue
        for flipped, (h, a) in ((False, (event["home_team"], event["away_team"])), (True, (event["away_team"], event["home_team"]))):
            lo = min(same_team(h, g.home_full), same_team(a, g.away_full))
            if lo > best[0]:
                best = (lo, g, flipped)
    return (best[1], best[2]) if best[0] >= 0.8 else (None, False)


def best_numbers(event, flipped):
    """The best and middle numbers across books, all as ESPN's home spread / total. home_best is the
    highest home spread on offer (best for a home bettor), away_best the lowest (best for the away
    side); over_best is the lowest total and under_best the highest."""
    home = event["away_team"] if flipped else event["home_team"]
    spreads, overs, unders = [], [], []
    for b in event.get("bookmakers", []):
        for m in b.get("markets", []):
            for o in m.get("outcomes", []):
                if o.get("point") is None or o.get("price") is None:
                    continue
                if m["key"] == "spreads":
                    # every outcome is that team's own spread; the away team's is minus the home spread
                    spreads.append((o["point"] if o["name"] == home else -o["point"], o["name"] == home, o["price"]))
                elif m["key"] == "totals":
                    (overs if o["name"] == "Over" else unders).append((o["point"], o["price"]))
    ok = lambda price: price >= WORST_PRICE
    home_q = [(p, price) for p, is_home, price in spreads if is_home and ok(price)]
    away_q = [(p, price) for p, is_home, price in spreads if not is_home and ok(price)]
    out = dict(books=len(event.get("bookmakers", [])))
    if home_q and away_q:
        hb, ab = max(home_q), min(away_q, key=lambda q: (q[0], -q[1]))
        out.update(spread_mid=statistics.median(p for p, _ in home_q), home_best=hb[0], home_price=hb[1],
                   away_best=ab[0], away_price=ab[1])
    overs, unders = [q for q in overs if ok(q[1])], [q for q in unders if ok(q[1])]
    if overs and unders:
        ob, ub = min(overs, key=lambda q: (q[0], -q[1])), max(unders)
        out.update(total_mid=statistics.median(p for p, _ in overs), over_best=ob[0], over_price=ob[1],
                   under_best=ub[0], under_price=ub[1])
    return out


def upcoming_games():
    """This week's and next week's games that haven't started, with ESPN's full team names."""
    games, info = sources.week_scoreboard()
    weeks = [games]
    key = (info["seasontype"], info["week"])
    if key in info["calendar"] and info["calendar"].index(key) + 1 < len(info["calendar"]):
        st, wk = info["calendar"][info["calendar"].index(key) + 1]
        weeks.append(sources.week_scoreboard(info["season"], st, wk)[0])
    g = pd.concat(weeks, ignore_index=True).drop_duplicates("id")
    g = g[g.state == "pre"].copy()
    r = sources.HTTP.get(sources.ESPN.rsplit("/", 1)[0] + "/teams", params={"groups": 80, "limit": 1000}, timeout=30)
    r.raise_for_status()
    full = {t["team"]["id"]: t["team"]["displayName"] for t in r.json()["sports"][0]["leagues"][0]["teams"]}
    g["home_full"] = g.home_id.map(full).fillna(g.home)
    g["away_full"] = g.away_id.map(full).fillna(g.away)
    return g


def collect(events, games):
    """{ESPN game id: numbers} for every event that matches an upcoming game, and the unmatched names."""
    out, missed = {}, []
    for e in events:
        g, flipped = match(e, games)
        if g is None:
            missed.append(f"{e['away_team']} @ {e['home_team']}")
            continue
        n = best_numbers(e, flipped)
        if "home_best" in n or "over_best" in n:
            out[g.id] = dict(home=g.home, away=g.away, **n)
    return out, missed


def log_history(games, old, at):
    """Appends a row for each game whose numbers changed since the last fetch."""
    keys = HIST_COLS[4:]
    rows = [dict(seen_at=at, id=gid, home=n["home"], away=n["away"], **{k: n.get(k) for k in keys})
            for gid, n in games.items() if any(n.get(k) != (old.get(gid) or {}).get(k) for k in keys)]
    if rows:
        hist = pd.read_csv(HISTORY, dtype={"id": str}) if HISTORY.exists() else pd.DataFrame(columns=HIST_COLS)
        pd.concat([hist, pd.DataFrame(rows, columns=HIST_COLS)], ignore_index=True).to_csv(HISTORY, index=False)
    return len(rows)


def publish(state):
    SITE.write_text(json.dumps({"updated": state.get("fetched_at"), "games": state.get("games", {})}, separators=(",", ":")))


def main():
    now = dt.datetime.now(dt.timezone.utc)
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    key = os.environ.get("ODDS_API_KEY", "").strip()
    last = dt.datetime.fromisoformat(state["fetched_at"]) if state.get("fetched_at") else None
    if not key:
        print("No ODDS_API_KEY: line shopping is off")
    elif not due(last, now):
        print(f"Line shopping: last fetched {last:%a %H:%M} UTC, not due yet")
    elif state.get("remaining") is not None and state["remaining"] <= RESERVE and last and last.month == now.month:
        print(f"Line shopping: only {state['remaining']} credits left this month, waiting for the reset")
    else:
        games = upcoming_games()
        if games.empty:
            print("Line shopping: no upcoming games")
        else:
            try:
                r = requests.get(API, timeout=60, params=dict(apiKey=key, regions="us", markets="spreads,totals", oddsFormat="american"))
            except requests.RequestException as ex:  # the error's text includes the URL, which carries the key
                print(f"Line shopping: couldn't reach The Odds API ({type(ex).__name__})")
                publish(state)
                return
            if r.status_code != 200:  # never print the URL: it carries the key
                print(f"Line shopping: The Odds API answered {r.status_code}: {r.text[:200]}")
            else:
                found, missed = collect(r.json(), games)
                at = now.strftime("%Y-%m-%dT%H:%M:%SZ")
                changed = log_history(found, state.get("games", {}), at)
                remaining = r.headers.get("x-requests-remaining")
                state = dict(fetched_at=now.isoformat(), remaining=int(float(remaining)) if remaining else None, games=found)
                LIVE.mkdir(parents=True, exist_ok=True)
                STATE.write_text(json.dumps(state, indent=1))
                print(f"Line shopping: {len(found)} games matched, {changed} changed, {state['remaining']} credits left this month")
                if missed:
                    print(f"  not matched to an upcoming game ({len(missed)}): {'; '.join(missed[:12])}")
    # publish whatever we have, even when no call was made: the site file isn't kept between runs
    publish(state)


if __name__ == "__main__":
    main()
