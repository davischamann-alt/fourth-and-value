"""Builds site/data/weather.json: the forecast at kickoff for this week's and next week's games, so
the site can flag windy games on over/under picks. Run by the GitHub job, or by hand:

    python weather.py

Stadium locations and domes come from CollegeFootballData (needs the key; one call for venues, and
this season's games are already downloaded daily for the Efficiency ratings). Forecasts come from
Open-Meteo, which is free and needs no key. Each game gets the average wind, the strongest gust,
the chance of rain and the temperature over its first three hours.

Why wind: in 2023-2026, totals in games with 12+ mph of wind at kickoff fell about 1.8 points
between the opening and closing number (0.35 in calm games), and overs went 47.7% against the
opening total. The closing total prices the wind; the opening total doesn't fully. Rain and cold
showed no reliable effect, so they're shown but not used."""
import datetime as dt
import json

import pandas as pd

import sources

OUT = sources.DATA.parent / "site" / "data" / "weather.json"
FORECAST = "https://api.open-meteo.com/v1/forecast"
WINDY = 12.0   # mph, average over the first three hours


def upcoming_games():
    """Games that haven't started in this week and next, as record.py checks them."""
    games, info = sources.week_scoreboard()
    weeks = [games]
    key = (info["seasontype"], info["week"])
    if key in info["calendar"] and info["calendar"].index(key) + 1 < len(info["calendar"]):
        st, wk = info["calendar"][info["calendar"].index(key) + 1]
        weeks.append(sources.week_scoreboard(info["season"], st, wk)[0])
    g = pd.concat(weeks, ignore_index=True).drop_duplicates("id")  # playoff games appear in two postseason weeks
    return g[g.state == "pre"], info["season"]


def venues(season):
    """{game id: (latitude, longitude, dome)} from CollegeFootballData."""
    where = {v["id"]: v for v in sources.cfbd("/venues")}
    out = {}
    for st in ("regular", "postseason"):
        for g in sources.cfbd("/games", 24, year=season, seasonType=st):
            v = where.get(g.get("venueId"))
            if v and v.get("latitude") is not None:
                out[str(g["id"])] = (v["latitude"], v["longitude"], bool(v.get("dome")))
    return out


def forecast(points):
    """Hourly forecasts for [(latitude, longitude)], several places per request."""
    out = []
    for i in range(0, len(points), 50):
        chunk = points[i:i + 50]
        r = sources.HTTP.get(FORECAST, timeout=60, params=dict(
            latitude=",".join(str(p[0]) for p in chunk), longitude=",".join(str(p[1]) for p in chunk),
            hourly="wind_speed_10m,wind_gusts_10m,precipitation_probability,temperature_2m",
            wind_speed_unit="mph", temperature_unit="fahrenheit", timezone="GMT", forecast_days=16))
        r.raise_for_status()
        j = r.json()
        out += j if isinstance(j, list) else [j]
    return out


def at_kickoff(hourly, kickoff):
    """Weather over the game's first three hours, or None if the forecast doesn't reach it."""
    t = pd.to_datetime(hourly["time"], utc=True)
    start = pd.Timestamp(kickoff).tz_convert("UTC").floor("h")
    m = (t >= start) & (t < start + pd.Timedelta(hours=3))
    if not m.any():
        return None
    col = lambda k: pd.Series(hourly[k], dtype=float)[m]
    wind = col("wind_speed_10m").mean()
    if pd.isna(wind):
        return None
    return dict(wind=round(wind), gust=round(col("wind_gusts_10m").max()), rain=round(col("precipitation_probability").max()),
                temp=round(col("temperature_2m").mean()), windy=bool(wind >= WINDY))


def main():
    now = dt.datetime.now(dt.timezone.utc)
    if not sources.cfbd_key():
        print("No CollegeFootballData key: no stadium locations, so no weather")
        return
    games, season = upcoming_games()
    where = venues(season)
    out, outdoor = {}, []
    for g in games.itertuples():
        if g.id not in where:
            continue
        lat, lon, dome = where[g.id]
        if dome:
            out[g.id] = dict(dome=True)
        else:
            outdoor.append((g.id, g.kickoff, lat, lon))
    for (gid, kickoff, _, _), f in zip(outdoor, forecast([(lat, lon) for _, _, lat, lon in outdoor])):
        if w := at_kickoff(f["hourly"], kickoff):
            out[gid] = w
    OUT.write_text(json.dumps({"updated": now.isoformat(), "windy_mph": WINDY, "games": out}, indent=1))
    print(f"wrote site/data/weather.json: {len(out)} games, {sum(w.get('windy', False) for w in out.values())} windy")


if __name__ == "__main__":
    main()
