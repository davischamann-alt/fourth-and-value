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
import io
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

import sources
from build_site import clean
from model import QB_ESTABLISHED, QB_OUT_POINTS
from record import weeks_to_check

ROOT = Path(__file__).parent
BOX = ROOT / "data" / "box"          # one small file per finished game (git-ignored, cached by the job)
OUT = ROOT / "site" / "data" / "props.json"
QB_OUT = ROOT / "site" / "data" / "qb.json"   # QB watch: likely quarterback changes, for game cards
QB_RECENT = 3       # flag a new starter for this many games; after that the ratings have caught up
# Quarterbacks listed on the official availability reports (Power 4 conference games), entered by hand:
# the reports come through an app with no public feed. See "QB availability" in the README.
QB_STATUS = ROOT / "data" / "qb_status.csv"
QB_STATUS_LOG = ROOT / "data" / "live" / "qb_status_log.csv"   # when each status was first seen, for the forward test
QB_STATUSES = ("out", "doubtful", "questionable", "available")  # available clears an earlier listing
# The quarterback placeholders in force (qb_adjust), committed with the pick log: record.py runs before
# this script and in the Sunday job that doesn't run it at all, and has to log picks with the same
# adjustments the site shows.
QB_ADJUST = ROOT / "data" / "live" / "qb_adjust.json"
MARKETS = {  # stat key: (label, games that count toward the average, minimum per-game volume, spread floor)
    "pass_yds": ("Passing yards", lambda g: g.pass_att >= 10, ("pass_att", 15), 45.0),
    "pass_td": ("Passing TDs", lambda g: g.pass_att >= 10, ("pass_att", 15), None),   # Poisson on the page
    "rush_yds": ("Rushing yards", lambda g: g.rush_att >= 4, ("rush_att", 8), 22.0),
    "rec_yds": ("Receiving yards", lambda g: g.rec >= 1, ("rec", 3), 20.0),
    "rec": ("Receptions", lambda g: g.rec >= 1, ("rec", 3), 1.6),
}
# which defensive stat adjusts each market (what the opponent allows per game)
DEFENSE = {"pass_yds": "pass_yds", "pass_td": "pass_td", "rush_yds": "rush_yds", "rec_yds": "pass_yds", "rec": "rec"}
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
    r = sources.HTTP.get(sources.SUMMARY, params={"event": gid}, timeout=30)
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


def lead_passers(logs):
    """The player who led each team's games in pass attempts, oldest first."""
    qb = logs[logs.pass_att >= 5].sort_values(["start", "pass_att"])
    return qb.groupby(["team_id", "game_id"]).tail(1).sort_values("start")


def usual_starter(g):
    """pid of whoever led the most of a team's games in passing (a tie goes to the more recent)."""
    counts = g.groupby("pid").size()
    return g[g.pid.isin(counts[counts == counts.max()].index)].pid.iloc[-1]


def starter_share(g, starter):
    """(share of the team's games the usual starter led before the current run of games someone else
    led, how many games that run is). g: the team's lead passers, oldest first. A starter who led
    every game until he went out has a share of 1; QB_ESTABLISHED is the cutoff for the placeholder."""
    away = int((g.pid.iloc[::-1] != starter).cumprod().sum())
    before = len(g) - away
    return (float((g.pid == starter).sum() / before) if before else 0.0), away


def norm_name(name):
    words = "".join(c for c in str(name).lower() if c.isalnum() or c.isspace()).split()
    return " ".join(w for w in words if w not in ("jr", "sr", "ii", "iii", "iv"))


def qb_listed(upcoming, logs, now):
    """({team id: [listing, ...]}, {team id: cleared}) for quarterbacks in data/qb_status.csv whose
    team plays an upcoming game. A row applies to the team's first game kicking off within 8 days
    after its date, and the last row for a player and game wins. starter: whether the listed player
    is the team's usual starter (None when the team has too few games to say); established: he is,
    and he led at least QB_ESTABLISHED of its games before going out (see qb_adjust). cleared: the
    team's starter listed available (its usual starter, or whoever led its last game: the QB watch
    can't tell a backup from a first-stringer back from injury), which cancels a placeholder the
    QB watch would have made."""
    if not QB_STATUS.exists():
        return {}, {}
    text = "".join(line for line in QB_STATUS.read_text().splitlines(keepends=True) if not line.lstrip().startswith("#"))
    rows = pd.read_csv(io.StringIO(text), dtype=str).fillna("")
    lead = lead_passers(logs)
    out, cleared = {}, {}
    for r in rows.itertuples():
        status = r.status.strip().lower()
        try:
            day = pd.Timestamp(r.date.strip(), tz="UTC")
        except ValueError:
            print(f"qb_status.csv: skipped a row with a bad date: {r.date!r}")
            continue
        if status not in QB_STATUSES:
            print(f"qb_status.csv: skipped {r.player} ({r.team}): status must be one of {', '.join(QB_STATUSES)}")
            continue
        team = r.team.strip().lower()
        kick = pd.to_datetime(upcoming.kickoff, utc=True)
        games = upcoming[((upcoming.home.str.lower() == team) | (upcoming.away.str.lower() == team))
                         & (kick >= day) & (kick < day + pd.Timedelta(days=8))]
        if games.empty:
            if day > pd.Timestamp(now) - pd.Timedelta(days=8):
                print(f"qb_status.csv: no upcoming game for {r.team!r} after {r.date} (check the spelling against the site)")
            continue
        g = games.sort_values("kickoff").iloc[0]
        tid = g.home_id if g.home.lower() == team else g.away_id
        passers = lead[lead.team_id == tid]
        usual = usual_starter(passers) if len(passers) >= 2 else None
        starter = None if usual is None else norm_name(passers[passers.pid == usual].name.iloc[-1]) == norm_name(r.player)
        share = starter_share(passers, usual)[0] if starter else None
        # the team's quarterback as far as anyone can tell: its usual starter, or whoever led its last game
        plays = bool(starter or (len(passers) and norm_name(passers.name.iloc[-1]) == norm_name(r.player)))
        mine = out.setdefault(tid, {})
        row = dict(team=g.home if tid == g.home_id else g.away, player=r.player.strip(), status=status, game_id=g.id,
                   kickoff=g.kickoff, date=r.date.strip(), source=r.source.strip(), starter=starter,
                   share=None if share is None else round(share, 3), established=bool(starter and share >= QB_ESTABLISHED))
        if status == "available":
            mine.pop(norm_name(r.player), None)
            if plays:
                cleared.setdefault(tid, {})[norm_name(r.player)] = row
        else:
            mine[norm_name(r.player)] = row
            cleared.get(tid, {}).pop(norm_name(r.player), None)  # a later listing takes his "available" back
    return ({tid: list(players.values()) for tid, players in out.items() if players},
            {tid: next(iter(players.values())) for tid, players in cleared.items() if players})


def log_qb_listed(listed, now):
    """Appends each listing the first time it's seen, so the forward test can check these games later."""
    cols = ["seen_at", "game_id", "kickoff", "team", "player", "status", "starter", "report_date"]
    log = pd.read_csv(QB_STATUS_LOG, dtype=str) if QB_STATUS_LOG.exists() else pd.DataFrame(columns=cols)
    seen = set(zip(log.game_id, log.team, log.player, log.status))
    new = [dict(seen_at=now.strftime("%Y-%m-%dT%H:%MZ"), game_id=f["game_id"], kickoff=f["kickoff"], team=f["team"],
                player=f["player"], status=f["status"], starter=f["starter"], report_date=f["date"])
           for team in listed.values() for f in team if (f["game_id"], f["team"], f["player"], f["status"]) not in seen]
    if new:
        pd.concat([log, pd.DataFrame(new, columns=cols)], ignore_index=True).to_csv(QB_STATUS_LOG, index=False)
    return len(new)


def qb_watch(logs):
    """{team id: flag} for teams whose quarterback situation just changed, from who led each game in
    pass attempts. ESPN doesn't publish college injury reports, so this is the next best signal:
    the ratings are built mostly from the usual starter's games, and a new starter can be much
    better or worse. Two kinds:
      change: someone other than the season's usual starter led the team's last game (for up to
              QB_RECENT games in a row, after which the ratings reflect the new starter)
      back:   the usual starter led the last game after someone else led the one before it"""
    lead = lead_passers(logs)
    out = {}
    for tid, g in lead.groupby("team_id"):
        if len(g) < 3:
            continue
        counts = g.groupby("pid").size()
        starter = usual_starter(g)
        name = lambda pid: g[g.pid == pid].name.iloc[-1]
        last, prev = g.iloc[-1], g.iloc[-2]
        streak = int((g.pid.iloc[::-1] != last.pid).cumsum().eq(0).sum())
        share = starter_share(g, starter)[0]
        common = dict(team=last.team, qb=last["name"], att=int(last.pass_att), week=int(last.week),
                      starter=name(starter), starter_games=int(counts[starter]), games=len(g),
                      share=round(share, 3), established=bool(share >= QB_ESTABLISHED))
        if last.pid != starter and streak <= QB_RECENT:
            out[str(tid)] = dict(kind="change", streak=streak, **common,
                                 note=f"{last['name']} led {last.team}'s passing in the last "
                                      f"{'game' if streak == 1 else f'{streak} games'}; "
                                      f"{name(starter)} led it in {counts[starter]} of {len(g)} games. The ratings mostly "
                                      f"reflect {name(starter)}'s games.")
        elif last.pid == starter and prev.pid != starter:
            missed = int((g.pid.iloc[-2::-1] != starter).cumprod().sum())
            others = g.pid.iloc[-1 - missed:-1].unique()
            who = name(others[0]) if len(others) == 1 else "backups"
            out[str(tid)] = dict(kind="back", streak=missed, **common,
                                 note=f"{last['name']} is back as {last.team}'s leading passer after "
                                      f"{who} led the {'previous game' if missed == 1 else f'previous {missed} games'}.")
    return out


def next_games(weeks):
    """{team id: id of the team's next game that hasn't finished}, from this week's and next week's
    scoreboards (record.weeks_to_check). The QB watch describes a team's latest game, so its
    placeholder belongs to the game after that one and no other."""
    games = pd.concat([g for _, g in weeks], ignore_index=True)
    out = {}
    for g in games[games.state != "post"].sort_values("kickoff").itertuples():
        for tid in (g.home_id, g.away_id):
            out.setdefault(str(tid), g.id)
    return out


def qb_adjust(flags, listed, cleared, nxt):
    """{team id: placeholder} for teams whose established starter is out for their next game: the
    points model.projections takes off that team's side (model.QB_OUT_POINTS). Two ways in:
      listed: the usual starter is listed out or doubtful on an availability report (qb_status.csv)
      change: a backup led the team's last game (the QB watch), for that one game. Later games get
              nothing: by then the ratings and the line have seen the backup, and in 2023-2026 those
              teams did about as projected (219 games, -0.5 points against FPI, +0.0 against the
              opening line). The team's starter listed available cancels it (qb_listed).
    Either way the starter has to be established (QB_ESTABLISHED): where quarterbacks were rotating,
    one of them sitting cost nothing. Each entry names the game it applies to. Setting
    model.QB_OUT_POINTS to 0 turns the placeholder off."""
    out = {}
    if not QB_OUT_POINTS:
        return out
    for tid, rows in listed.items():
        f = next((f for f in rows if f["established"] and f["status"] in ("out", "doubtful")), None)
        if f:
            out[str(tid)] = dict(game_id=f["game_id"], team=f["team"], points=QB_OUT_POINTS, why="listed", player=f["player"],
                                 note=f"{f['player']} is listed {f['status']} on the {f['date']} availability report.")
    for tid, f in flags.items():
        gid = nxt.get(str(tid))
        if str(tid) in out or f["kind"] != "change" or f["streak"] != 1 or not f["established"] or gid is None:
            continue
        if cleared.get(tid, {}).get("game_id") == gid:
            continue  # its starter is listed available for this game
        out[str(tid)] = dict(game_id=gid, team=f["team"], points=QB_OUT_POINTS, why="change", player=f["starter"],
                             note=f"{f['qb']} led {f['team']}'s passing in its last game in place of {f['starter']}.")
    return out


def keep_adjustments(now):
    """When this run can't build the QB watch (ESPN down), publish the placeholders already in force
    with nothing else, so the site's projections still match the picks record.py logs with them."""
    if QB_OUT.exists() or not QB_ADJUST.exists():
        return
    QB_OUT.write_text(json.dumps({"updated": now.isoformat(), "teams": {}, "listed": {}, "cleared": {},
                                  "adjust": json.loads(QB_ADJUST.read_text()), "kept": True}, indent=1))
    print("kept the quarterback placeholders from the last run")


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
    games = sources.season_games(season, postseason=True)  # bowl and playoff box scores count too
    logs = game_logs(games)
    fbs = {i for i, _ in sources.espn_fpi(season).items()}
    factors = defense_factors(logs, fbs)

    weeks = weeks_to_check()  # this week, and next week for the QB watch: its lines open on Sunday
    info, upcoming = weeks[0]
    upcoming = upcoming[upcoming.state == "pre"]
    players, slate = [], []
    for g in upcoming.itertuples():
        slate.append({"id": g.id, "kickoff": g.kickoff, "home": g.home, "away": g.away, "home_id": g.home_id, "away_id": g.away_id,
                      "line": g.line, "total": g.total,
                      # ESPN lists a game whose time isn't set at midnight Eastern, with the status TBD
                      "tbd": str(g.status).strip().upper() == "TBD"})
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
    qb = qb_watch(logs)
    listed, cleared = qb_listed(upcoming, logs, now)
    adjust = qb_adjust(qb, listed, cleared, next_games(weeks))
    QB_OUT.write_text(json.dumps(clean({"updated": now.isoformat(), "teams": qb, "listed": listed, "cleared": cleared,
                                        "adjust": adjust}), indent=1))
    # no timestamp in this one: it's committed, and should only change when a placeholder does
    QB_ADJUST.parent.mkdir(parents=True, exist_ok=True)
    QB_ADJUST.write_text(json.dumps(clean(adjust), indent=1, sort_keys=True) + "\n")
    print(f"wrote site/data/qb.json: {sum(f['kind'] == 'change' for f in qb.values())} QB changes, "
          f"{sum(f['kind'] == 'back' for f in qb.values())} starters back, {sum(map(len, listed.values()))} QBs listed on availability reports "
          f"({log_qb_listed(listed, now)} new), {len(adjust)} quarterback placeholders "
          f"({sum(a['why'] == 'listed' for a in adjust.values())} from reports)")
    for m, a in accuracy.items():
        print(f"  {a['label']}: typical miss {a['mae_model']:.1f} vs season average {a['mae_season_avg']:.1f} ({a['n']} player-games)")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        keep_adjustments(dt.datetime.now(dt.timezone.utc))
        raise
