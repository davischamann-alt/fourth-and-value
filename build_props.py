"""Builds site/data/props.json for the website's Props tab: projections for this week's player
props (passing yards and TDs, rushing yards, receiving yards, receptions) from ESPN box scores.
No API key needed. Run by the GitHub job, or by hand:

    python build_props.py

Each projection is the player's per-game average this season, adjusted for rushing yards, passing
TDs and receptions by half of how much the opponent's defense allows compared with an average FBS
defense. Tested on weeks 4-8 of 2026: weighting recent games more, or adjusting passing and
receiving yards for the defense, made projections slightly worse, so neither is used.
Visitors enter the line from their sportsbook and the page turns the projection into an over/under
chance. The projections are not tested against real prop lines (free historical prop lines don't
exist); evaluate() measures how close they come to what players actually did."""
import datetime as dt
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

import sources
from build_site import clean

ROOT = Path(__file__).parent
BOX = ROOT / "data" / "box"          # one small file per finished game (git-ignored, cached by the job)
OUT = ROOT / "site" / "data" / "props.json"
MARKETS = {  # stat key: (label, games that count toward the average, minimum per-game volume, spread floor)
    "pass_yds": ("Passing yards", lambda g: g.pass_att >= 10, ("pass_att", 15), 45.0),
    "pass_td": ("Passing TDs", lambda g: g.pass_att >= 10, ("pass_att", 15), None),   # Poisson on the page
    "rush_yds": ("Rushing yards", lambda g: g.rush_att >= 4, ("rush_att", 8), 22.0),
    "rec_yds": ("Receiving yards", lambda g: g.rec >= 1, ("rec", 3), 20.0),
    "rec": ("Receptions", lambda g: g.rec >= 1, ("rec", 3), 1.6),
}
# which defensive stat adjusts each market (what the opponent allows per game)
DEFENSE = {"pass_yds": "pass_yds", "pass_td": "pass_td", "rush_yds": "rush_yds", "rec_yds": "pass_yds", "rec": "rec"}
# ESPN drops connections when hit too hard: retry with backoff, a few requests at a time
HTTP = requests.Session()
HTTP.mount("https://", HTTPAdapter(max_retries=Retry(total=5, connect=5, read=5, backoff_factor=1.5,
                                                     status_forcelist=(429, 500, 502, 503, 504))))
# how much of a defense's difference from average to use, by market (0 = ignore the defense); half
# strength helped rushing yards slightly in testing, while adjusting yards through the air hurt
SHRINK = {"pass_yds": 0.0, "pass_td": 0.5, "rush_yds": 0.5, "rec_yds": 0.0, "rec": 0.5}
RECENT_WEIGHT = 1   # recent games weighted the same as the rest: weighting them more tested worse


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def box_rows(gid):
    """Passing, rushing and receiving lines for every player in one finished game (cached on disk)."""
    f = BOX / f"{gid}.json"
    if f.exists():
        return json.loads(f.read_text())
    r = HTTP.get(sources.SUMMARY, params={"event": gid}, timeout=30)
    r.raise_for_status()
    rows = {}
    for team in r.json().get("boxscore", {}).get("players", []):
        tid = team["team"]["id"]
        for cat in team.get("statistics", []):
            keys = cat.get("keys", [])
            for a in cat.get("athletes", []):
                p = rows.setdefault(a["athlete"]["id"], {"pid": a["athlete"]["id"], "name": a["athlete"]["displayName"], "team_id": tid})
                vals = dict(zip(keys, a.get("stats", [])))
                if cat["name"] == "passing":
                    c, att = (vals.get("completions/passingAttempts", "0/0") + "/0").split("/")[:2]
                    p.update(pass_cmp=num(c), pass_att=num(att), pass_yds=num(vals.get("passingYards")),
                             pass_td=num(vals.get("passingTouchdowns")))
                elif cat["name"] == "rushing":
                    p.update(rush_att=num(vals.get("rushingAttempts")), rush_yds=num(vals.get("rushingYards")),
                             rush_td=num(vals.get("rushingTouchdowns")))
                elif cat["name"] == "receiving":
                    p.update(rec=num(vals.get("receptions")), rec_yds=num(vals.get("receivingYards")),
                             rec_td=num(vals.get("receivingTouchdowns")))
    out = list(rows.values())
    BOX.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(out))
    return out


def game_logs(games):
    """One row per player per finished game, with the opponent."""
    with ThreadPoolExecutor(4) as pool:
        boxes = dict(zip(games.id, pool.map(box_rows, games.id)))
    rows = []
    for g in games.itertuples():
        for p in boxes[g.id]:
            home = p["team_id"] == g.home_id
            rows.append({**p, "game_id": g.id, "week": g.week, "start": g.start,
                         "opp_id": g.away_id if home else g.home_id, "team": g.home if home else g.away})
    cols = ["pass_cmp", "pass_att", "pass_yds", "pass_td", "rush_att", "rush_yds", "rush_td", "rec", "rec_yds", "rec_td"]
    df = pd.DataFrame(rows)
    df[cols] = df.reindex(columns=cols).fillna(0.0)
    return df.sort_values("start")


def defense_factors(logs, fbs_ids):
    """For each team and stat: what its defense allows per game relative to the FBS average, as a
    fraction (+0.2 = allows 20% more). Positive means a soft defense, so opponents project higher."""
    per_game = logs.groupby(["opp_id", "game_id"])[["pass_yds", "pass_td", "rush_yds", "rec"]].sum().reset_index()
    allowed = per_game.groupby("opp_id")[["pass_yds", "pass_td", "rush_yds", "rec"]].mean()
    avg = allowed.loc[allowed.index.isin(fbs_ids)].mean()
    raw = allowed / avg - 1
    # columns are defensive stats; each market's shrink is applied where the market reads it
    return raw  # the shrink is applied per market in factor()


def factor(raw, team_id, market):
    """Multiplier for a market against this defense: 1 + shrink x (allowed / average - 1)."""
    if team_id not in raw.index:
        return 1.0
    return 1 + SHRINK[market] * float(raw.at[team_id, DEFENSE[market]])


def project(hist, market, factor):
    """(projection, spread, games used, recent values) for one player and market, or None if he
    doesn't have the role (enough games with real volume)."""
    label, counts, (vol_col, vol_min), floor = MARKETS[market]
    games = hist[hist.apply(counts, axis=1)]
    if len(games) < 3 or games[vol_col].mean() < vol_min:
        return None
    vals = games[market].to_numpy()
    w = np.ones(len(vals)); w[-3:] = RECENT_WEIGHT
    base = float(np.average(vals, weights=w))
    proj = base * factor
    sd = None if floor is None else max(float(np.std(vals, ddof=1)), floor)
    return proj, sd, len(vals), [float(v) for v in vals[-5:]]


def evaluate(logs, factors_by_week):
    """Walk-forward check: project each player's game from earlier weeks only, and compare the
    typical miss with a plain season average."""
    out = {}
    for m in MARKETS:
        errs_m, errs_avg = [], []
        for w in sorted(logs.week.unique()):
            if w < 4:
                continue
            past, now = logs[logs.week < w], logs[logs.week == w]
            fac = factors_by_week[w]
            label, counts, (vol_col, vol_min), _ = MARKETS[m]
            for row in now[now.apply(counts, axis=1)].itertuples():
                hist = past[past.pid == row.pid]
                p = project(hist, m, factor(fac, row.opp_id, m))
                if p is None:
                    continue
                games = hist[hist.apply(counts, axis=1)]
                errs_m.append(abs(p[0] - getattr(row, m)))
                errs_avg.append(abs(games[m].mean() - getattr(row, m)))
        if errs_m:
            out[m] = {"label": MARKETS[m][0], "n": len(errs_m), "mae_model": float(np.mean(errs_m)), "mae_season_avg": float(np.mean(errs_avg))}
    return out


def main():
    now = dt.datetime.now(dt.timezone.utc)
    season = sources.season_of(now.date())
    games = sources.season_games(season)
    logs = game_logs(games)
    fbs = {i for i, _ in sources.espn_fpi(season).items()}
    factors = defense_factors(logs, fbs)

    upcoming, info = sources.week_scoreboard()
    upcoming = upcoming[upcoming.state == "pre"]
    players, slate = [], []
    for g in upcoming.itertuples():
        slate.append({"id": g.id, "kickoff": g.kickoff, "home": g.home, "away": g.away, "home_id": g.home_id, "away_id": g.away_id,
                      "line": g.line, "total": g.total})
        for team_id, opp_id, opp, home in ((g.home_id, g.away_id, g.away, True), (g.away_id, g.home_id, g.home, False)):
            roster = logs[logs.team_id == team_id]
            # players who appeared in either of the team's last two games (skips the injured and the departed)
            recent_games = roster.drop_duplicates("game_id").tail(2).game_id
            for pid in roster[roster.game_id.isin(recent_games)].pid.unique():
                hist = roster[roster.pid == pid]
                markets = {}
                for m in MARKETS:
                    f = factor(factors, opp_id, m)
                    p = project(hist, m, f)
                    if p:
                        markets[m] = {"proj": round(p[0], 1), "sd": None if p[1] is None else round(p[1], 1),
                                      "n": p[2], "last": p[3], "def": round(float(f), 3)}
                if markets:
                    players.append({"pid": pid, "name": hist.name.iloc[-1], "team": hist.team.iloc[-1], "team_id": team_id,
                                    "opp": opp, "opp_id": opp_id, "home": home, "game_id": g.id, "markets": markets})

    # accuracy check uses defenses known before each week
    factors_by_week = {w: defense_factors(logs[logs.week < w], fbs) for w in sorted(logs.week.unique()) if w >= 4}
    accuracy = evaluate(logs, factors_by_week)
    OUT.write_text(json.dumps(clean({
        "updated": now.isoformat(), "season": season, "week": info.get("week"), "games": slate,
        "markets": {k: v[0] for k, v in MARKETS.items()}, "players": players, "accuracy": accuracy,
    }), separators=(",", ":")))
    print(f"wrote site/data/props.json: {len(players)} players in {len(slate)} games")
    for m, a in accuracy.items():
        print(f"  {a['label']}: typical miss {a['mae_model']:.1f} vs season average {a['mae_season_avg']:.1f} ({a['n']} player-games)")


if __name__ == "__main__":
    main()
