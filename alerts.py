"""Alerts: after record.py logs lines and picks, finds what's new since the last run and sends it.
Run by the GitHub job every two hours, right after record.py, or by hand:

    python alerts.py

What counts as an alert (the site's default projections: Blend for spreads, Market-anchored for totals):
  - a new spread or over/under pick with an edge of 1.5+, logged when the line first appears
  - a line moving through, onto or off 3 or 7, the most common winning margins, on a game with such
    a spread pick
  - a quarterback listed out or doubtful on an availability report (data/qb_status.csv), when he's the
    usual starter of a team with such a spread pick: the pick becomes Check the news

Where alerts go:
  - always: the site's feed (site/alerts.xml, for any RSS reader) and site/data/alerts.json (the
    Alerts panel on the website)
  - phone notifications through the free ntfy app, when the NTFY_TOPIC repository variable is set
  - a Discord channel, when the DISCORD_WEBHOOK_URL repository secret is set

data/live/alerts.json remembers what's been sent, so nothing is sent twice. The first run (with no
such file) only records what already exists, instead of sending every pick on the board at once."""
import datetime as dt
import functools
import json
import math
import os
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

import pandas as pd
import requests

import sources

LIVE = sources.DATA / "live"
STATE = LIVE / "alerts.json"
SITE = sources.DATA.parent / "site"
FEED, SITE_JSON = SITE / "alerts.xml", SITE / "data" / "alerts.json"
QB = SITE / "data" / "qb.json"   # QB changes, written by build_props.py just before this runs
MODEL = SITE / "data" / "model.json"   # the site's cover-chance settings (std devs and shrink), from build_site.py
LEAN, STRONG, CHECK = 1.5, 3.0, 5.0
# Worth a bet, as on the site (valueOf in site/app.js): a chance at least a point above the -110 break-even,
# where each point of better line adds CLV_PER_POINT of hit rate
BREAKEVEN, CUSHION = 110 / 210, 0.01
CLV_PER_POINT = {"spread": 0.03, "total": 0.025}
SPREAD_SOURCE = "blend"   # the site's default spread projection (Market-anchored until November 10, 2026)
KEY_NUMBERS = (3, 7)
KEEP = 200          # alerts kept in the history (the feed shows the newest 50)
ET = ZoneInfo("America/New_York")


def site_url():
    """The website's address: from the repository the GitHub job runs in, else the project's own."""
    owner, _, repo = os.environ.get("GITHUB_REPOSITORY", "davischamann-alt/fourth-and-value").partition("/")
    return f"https://{owner}.github.io/{repo}/"


def tier_label(edge):
    """The headline word. On the site, Go for it or Lean depends on the best price on offer at the moment,
    which an alert sent once can't follow, so a new pick is a New pick, with the number to look for."""
    return "Check the news" if edge >= CHECK else "New pick"


@functools.cache
def model_settings():
    try:
        return json.loads(MODEL.read_text())
    except (OSError, ValueError):
        return None


def points_needed(edge, market, src):
    """How many points better than the logged number a pick needs at -110 to be worth a bet, in half
    points: the site's cover chance at that edge (evaluate in site/app.js), plus CLV_PER_POINT a point.
    None without the site's settings."""
    m = model_settings()
    try:
        s = (m["sigma_total"] if market == "total" else m["sigma"])[src]
        p = 0.5 * (1 + math.erf(m["shrink"][market][src] * edge / s / math.sqrt(2)))
    except (TypeError, KeyError):
        return None
    need = 0.0
    while p + CLV_PER_POINT[market] * need < BREAKEVEN + CUSHION and need < 10:
        need += 0.5
    return need


def worth_note(need, number):
    """number(x): the pick at x points better than logged, as text."""
    if need is None:
        return ""
    return (f" Worth a bet at {number(need)} or better at -110; the site shows the best number on offer."
            if need else " Worth a bet at this number at -110.")


def fmt_line(x):
    return "PK" if x == 0 else f"{x:+g}"


def kickoff(ts, tbd=False):
    """tbd: ESPN hasn't set the time; it lists the game at midnight Eastern, which isn't a kickoff."""
    t = pd.Timestamp(ts).tz_convert(ET)
    return t.strftime("%a %b %-d") + (", time TBD" if tbd else t.strftime(", %-I:%M %p ET"))


def tbd_games():
    """Ids of this week's and next week's games whose kickoff time ESPN hasn't set (status TBD), or an
    empty set if ESPN can't be reached: those alerts just show midnight, as before."""
    try:
        games, info = sources.week_scoreboard()
        weeks, key, cal = [games], (info["seasontype"], info["week"]), info["calendar"]
        if key in cal and cal.index(key) + 1 < len(cal):
            st, wk = cal[cal.index(key) + 1]
            weeks.append(sources.week_scoreboard(info["season"], st, wk)[0])
        g = pd.concat(weeks, ignore_index=True)
        return set(g[g.status.astype(str).str.strip().str.upper() == "TBD"].id.astype(str))
    except (requests.RequestException, KeyError, ValueError) as e:
        print(f"Couldn't check for TBD kickoffs: {type(e).__name__}")
        return set()


def upcoming(df, now):
    return df[pd.to_datetime(df.kickoff, utc=True) > now]


def qb_changes():
    """{team name: QB change note} from qb.json, or {} if it isn't there."""
    try:
        teams = json.loads(QB.read_text())["teams"].values()
    except (OSError, ValueError, KeyError):
        return {}
    return {t["team"]: t["note"] for t in teams if t["kind"] == "change"}


def qb_out():
    """{(game id, team name): listing} for usual starters listed out or doubtful on an availability
    report (entered in data/qb_status.csv; build_props.py matches them to games), as on the site."""
    try:
        listed = json.loads(QB.read_text()).get("listed", {}).values()
    except (OSError, ValueError):
        return {}
    return {(f["game_id"], f["team"]): f for team in listed for f in team
            if f.get("starter") is not False and f["status"] in ("out", "doubtful")}


def bowl_games(picks, now):
    """Ids of upcoming bowls outside the playoff (labeled Check the news, as on the site), from the
    names ESPN gives postseason games. Only looked up when there are postseason picks."""
    post = upcoming(picks[picks.seasontype == 3], now)
    if post.empty:
        return set()
    games, _ = sources.week_scoreboard(int(post.season.iloc[0]), 3, 1)  # ESPN's "Bowls" week lists every postseason game
    return set(games[~games.note.fillna("").str.contains("playoff|cfp", case=False)].id)


def new_pick_alerts(picks, totals, now, qb=None, bowls=(), qb_listed=None, tbd=()):
    """{key: alert} for every lean-or-better pick by the default projections (Blend for spreads,
    Market-anchored for totals) on a game that hasn't started. A
    bowl outside the playoff is labeled Check the news, as on the site (a just-changed quarterback
    is noted but keeps its label), and so is a spread pick on a team whose starter is listed out or doubtful. When
    that listing comes after the pick, it gets an alert of its own."""
    qb, qb_listed = qb or {}, qb_listed or {}
    out = {}

    def label(p, team=None):
        if listed := qb_listed.get((p.id, team)):
            return "Check the news", f" {listed['player']}, {team}'s usual starter, is listed {listed['status']} on the {listed['date']} availability report."
        note = qb.get(p.home) or qb.get(p.away)
        if note:  # context only: over 2023-2026 these games did about as well as the rest
            return tier_label(p.edge), f" QB change: {note}"
        if p.id in bowls:
            return "Check the news", " Bowl game: opt-outs and coaching changes aren't in the model, so check who's playing."
        return tier_label(p.edge), ""

    for p in upcoming(picks[(picks.source == SPREAD_SOURCE) & (picks.edge >= LEAN)], now).itertuples():
        team, line = (p.home, p.line_logged) if p.side == "home" else (p.away, -p.line_logged)
        tier, note = label(p, team)
        worth = worth_note(points_needed(p.edge, "spread", SPREAD_SOURCE), lambda x: f"{team} {fmt_line(line + x)}")
        out[f"pick:{p.id}"] = dict(
            kind="pick", game_id=p.id, title=f"{tier}: {team} {fmt_line(line)}",
            text=f"{p.away} @ {p.home}, {kickoff(p.kickoff, p.id in tbd)}. Blend takes {team} {fmt_line(line)}, "
                 f"a {p.edge:.1f}-point edge, logged when the line first appeared.{note}{worth}")
        if listed := qb_listed.get((p.id, team)):  # keyed by status, so a downgrade from doubtful to out alerts again
            out[f"qb:{p.id}:{team}:{listed['status']}"] = dict(
                kind="qb", game_id=p.id, title=f"Check the news: {team} QB {listed['status']}",
                text=f"{listed['player']}, {team}'s usual starter, is listed {listed['status']} for {p.away} @ {p.home} "
                     f"({kickoff(p.kickoff, p.id in tbd)}). Blend's pick on {team} {fmt_line(line)} is now Check the news: in "
                     f"2023-2026, teams whose starting quarterback sat unexpectedly covered 43% at the opening line.")
    for p in upcoming(totals[(totals.source == "anchored") & (totals.edge >= LEAN)], now).itertuples():
        tier, note = label(p)
        sign = -1 if p.side == "over" else 1  # a lower total is better for an over
        worth = worth_note(points_needed(p.edge, "total", "anchored"), lambda x: f"{p.side.title()} {p.total_logged + sign * x:g}")
        out[f"total:{p.id}"] = dict(
            kind="total", game_id=p.id, title=f"{tier}: {p.side.title()} {p.total_logged:g}",
            text=f"{p.away} @ {p.home}, {kickoff(p.kickoff, p.id in tbd)}. Market-anchored takes the {p.side} {p.total_logged:g} "
                 f"(projects {p.proj:.1f}), a {p.edge:.1f}-point edge, logged when the total first appeared.{note}{worth}")
    return out


def crossed(a, b):
    """The key number a line move from a to b went through, onto or off of, or None."""
    lo, hi = min(a, b), max(a, b)
    for k in sorted({s * k for k in KEY_NUMBERS for s in (1, -1)}, key=abs, reverse=True):
        if a != b and lo <= k <= hi:
            return k
    return None


def through(a, b, k):
    return f"onto {abs(k)}" if b == k else f"off {abs(k)}" if a == k else f"through {abs(k)}"


def key_number_alerts(lines, picks, now, tbd=()):
    """{key: alert} for line moves through 3 or 7 on upcoming games with a lean-or-better pick."""
    out = {}
    chosen = upcoming(picks[(picks.source == SPREAD_SOURCE) & (picks.edge >= LEAN)], now).set_index("id")
    for gid, h in lines[lines.id.isin(chosen.index)].groupby("id"):
        p = chosen.loc[gid]
        prev = None
        for r in h.itertuples():
            k = None if prev is None else crossed(prev, r.line)
            if k is not None:
                home_pick = p.side == "home"
                team = p.home if home_pick else p.away
                toward = (prev - r.line) * (1 if home_pick else -1) > 0
                show = (lambda x: f"{p.home} {fmt_line(x)}")
                out[f"key:{gid}:{r.seen_at}"] = dict(
                    kind="key", game_id=gid, title=f"Line {through(prev, r.line, k)}: {p.away} @ {p.home}",
                    text=f"The line moved from {show(prev)} to {show(r.line)}, {through(prev, r.line, k)}, "
                         f"{'toward' if toward else 'away from'} the model's pick ({team}). {kickoff(p.kickoff, gid in tbd)}.")
            prev = r.line
    return out


def feed(items, url, now):
    """Atom feed of the newest alerts."""
    entries = "".join(f"""
  <entry>
    <id>tag:fourth-and-value,{a['at'][:10]}:{escape(a['key'])}</id>
    <title>{escape(a['title'])}</title>
    <updated>{a['at']}</updated>
    <link href="{escape(url)}#game/{escape(str(a['game_id']))}"/>
    <summary>{escape(a['text'])}</summary>
  </entry>""" for a in items[:50])
    return f"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Fourth &amp; Value alerts</title>
  <subtitle>New edges when lines open, and line moves through 3 or 7</subtitle>
  <id>{escape(url)}alerts.xml</id>
  <link rel="self" href="{escape(url)}alerts.xml"/>
  <link href="{escape(url)}"/>
  <updated>{items[0]['at'] if items else now}</updated>{entries}
</feed>
"""


def message(new):
    """One notification per run: a count in the title, a line per alert in the body."""
    picks = sum(a["kind"] != "key" for a in new)
    moves = len(new) - picks
    title = " and ".join(x for x in (f"{picks} new edge{'s' * (picks != 1)}" if picks else "",
                                     f"{moves} key-number move{'s' * (moves != 1)}" if moves else "") if x)
    lines = [f"{a['title']} ({a['text'].split(',')[0]})" if a["kind"] != "key" else a["text"] for a in new[:15]]
    if len(new) > 15:
        lines.append(f"…and {len(new) - 15} more on the site")
    return title, "\n".join(lines)


def send(new, url):
    title, body = message(new)
    if topic := os.environ.get("NTFY_TOPIC", "").strip():
        r = requests.post(f"https://ntfy.sh/{topic}", data=body.encode(), timeout=20,
                          headers={"Title": title, "Click": url, "Tags": "football"})
        print(f"ntfy: {r.status_code}")
    if hook := os.environ.get("DISCORD_WEBHOOK_URL", "").strip():
        r = requests.post(hook, json={"content": f"**{title}**\n{body}\n<{url}>"[:2000]}, timeout=20)
        print(f"Discord: {r.status_code}")


def main():
    now = pd.Timestamp.now(tz="UTC")
    at = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    url = os.environ.get("SITE_URL") or site_url()
    load = lambda f: pd.read_csv(LIVE / f, dtype={"id": str}) if (LIVE / f).exists() else None
    picks, totals, lines = load("picks.csv"), load("total_picks.csv"), load("line_history.csv")
    if picks is None or lines is None:
        print("No pick log yet: nothing to alert")
        return
    if totals is None:
        totals = pd.DataFrame(columns=["source", "edge", "kickoff", "id", "side", "total_logged", "proj", "home", "away"])

    tbd = tbd_games()
    found = (new_pick_alerts(picks, totals, now, qb_changes(), bowl_games(picks, now), qb_out(), tbd)
             | key_number_alerts(lines, picks, now, tbd))
    first = not STATE.exists()
    state = json.loads(STATE.read_text()) if not first else {"sent": [], "items": []}
    sent = set(state["sent"])
    new = [dict(key=k, at=at, **a) for k, a in found.items() if k not in sent]
    if first:
        print(f"First run: recorded {len(new)} existing alerts without sending them")
    elif new:
        state["items"] = (new + state["items"])[:KEEP]
        try:
            send(new, url)
        except requests.RequestException as e:  # the feed still has them
            print(f"Couldn't send notifications: {e}")
    state["sent"] = sorted(sent | {a["key"] for a in new})
    STATE.write_text(json.dumps(state, indent=1))

    FEED.write_text(feed(state["items"], url, at))
    SITE_JSON.write_text(json.dumps({"updated": at, "feed": f"{url}alerts.xml",
                                     "ntfy_topic": os.environ.get("NTFY_TOPIC", "").strip() or None,
                                     "discord": bool(os.environ.get("DISCORD_WEBHOOK_URL", "").strip()),
                                     "items": state["items"][:30]}, indent=1))
    print(f"{0 if first else len(new)} new alerts; {len(state['items'])} in the history")


if __name__ == "__main__":
    main()
