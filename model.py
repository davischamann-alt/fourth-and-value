import math

import numpy as np
import pandas as pd

# Home-field advantage in points, used everywhere (app, website builder, forward test). Raised from
# 2.5 to 3.0 on Oct 25, 2026: at 2.5 the projections underrated home teams in the 2023-2026
# backtest (see "Model changes" in the README).
HFA = 3.0

# An "opening line" more than this far from the closing line is treated as missing in the backtest.
# Those are almost always look-ahead lines posted weeks before the game, which nobody could bet with
# this season's information, and they made big edges look far better than they are (Oct 25, 2026;
# see "Model changes" in the README).
MAX_OPEN_MOVE = 7.0


def load_ratings(path):
    return pd.read_csv(path).set_index("team")


def project(home, away, r, neutral=False, hfa=HFA):
    """Expected (home_pts, away_pts) from each side's scoring vs the other's defense."""
    if home not in r.index or away not in r.index:
        return None
    avg = (r["ppg"].mean() + r["papg"].mean()) / 2
    h, a = r.loc[home], r.loc[away]
    bump = 0 if neutral else hfa / 2
    return (h["ppg"] + a["papg"] - avg + bump, a["ppg"] + h["papg"] - avg - bump)


def fpi_margin(home, away, r, neutral=False, hfa=HFA):
    """Projected home margin from ESPN FPI (points vs an average team on a neutral field)."""
    if "fpi" not in r.columns or home not in r.index or away not in r.index:
        return None
    h, a = r.at[home, "fpi"], r.at[away, "fpi"]
    if pd.isna(h) or pd.isna(a):
        return None
    return h - a + (0 if neutral else hfa)


def fit_ratings(games, ridge=2.0):
    """Opponent-adjusted scoring. games: (home, away, home_pts, away_pts, neutral) tuples.
    Fits pts = avg + off[team] + dfn[opp] +/- hfa/2 by ridge least squares, so a team that
    put up 40 on a bad defense counts for less than 40 on a good one. Returns
    (DataFrame of team, ppg, papg, games on the raw points scale, fitted home-field edge)."""
    teams = sorted({t for g in games for t in g[:2]})
    ix, n = {t: i for i, t in enumerate(teams)}, len(teams)
    X, y = np.zeros((2 * len(games), 2 * n + 2)), np.zeros(2 * len(games))
    for k, (h, a, hs, as_, neu) in enumerate(games):
        for j, (me, op, pts, side) in enumerate(((h, a, hs, 0.5), (a, h, as_, -0.5))):
            row = 2 * k + j
            X[row, [0, 1 + ix[me], 1 + n + ix[op]]] = 1
            X[row, -1] = 0 if neu else side
            y[row] = pts
    pen = np.sqrt(ridge) * np.eye(2 * n + 2)[1:-1]  # shrink team terms toward average, not avg/hfa
    coef = np.linalg.lstsq(np.vstack([X, pen]), np.concatenate([y, np.zeros(2 * n)]), rcond=None)[0]
    cnt = pd.Series([t for g in games for t in g[:2]]).value_counts()
    df = pd.DataFrame({"team": teams, "ppg": coef[0] + coef[1:1 + n], "papg": coef[0] + coef[1 + n:-1]})
    df["games"] = df["team"].map(cnt)
    return df, coef[-1]


def cover_prob(margin, home_line, sigma=14.0):
    """P(home covers). margin = home - away; home_line is negative when home is favored."""
    z = (margin + home_line) / sigma
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def live_cover_prob(cur_margin, proj_margin, home_line, secs_left, sigma=14.0):
    """P(home covers) mid-game: current margin plus the model's projection for the time left."""
    x = cur_margin + home_line
    if secs_left <= 0:
        return 1.0 if x > 0 else 0.0 if x < 0 else 0.5
    f = min(secs_left / 3600, 1.0)
    z = (x + proj_margin * f) / (sigma * math.sqrt(f))
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def pool_fcs(games, fbs=None):
    """Rename non-FBS teams to "FCS" so they share one rating. FCS opponents mostly have one or
    two games, too few to rate on their own (shrinking each one toward average credits FBS
    blowouts to home field). fbs: set of FBS names, else guessed from games played."""
    if fbs is None:
        cnt = pd.Series([t for g in games for t in g[:2]]).value_counts()
        fbs = set(cnt[cnt >= max(1, (cnt.max() + 1) // 2)].index)
    return [tuple(t if t in fbs else "FCS" for t in g[:2]) + tuple(g[2:]) for g in games]


def walk_forward(games, lines, fpi_by_week, fbs, hfa=HFA, start_week=3, eff=None):
    """Predict each week using only what was known before it: points and efficiency ratings fit
    on earlier games, and the FPI snapshot from the previous week. games: DataFrame of completed
    games (id, week, home, away, home_id, away_id, home_pts, away_pts, neutral);
    lines: {id: (closing home line, opening home line[, closing total, opening total])};
    fpi_by_week: {week: {team id: fpi}}; eff: (efficiency rows, FBS team ids) as
    sources.efficiency_rows returns, or None. Returns one row per FBS-vs-FBS game with a line;
    eff_diff is the efficiency matchup (see efficiency_diff), turned into points by add_efficiency."""
    rows = []
    for w in sorted(games.loc[games.week >= start_week, "week"].unique()):
        train = games[games.week < w]
        fit = list(train[["home", "away", "home_pts", "away_pts", "neutral"]].itertuples(index=False, name=None))
        r = fit_ratings(pool_fcs(fit, fbs))[0].set_index("team")
        er = None if eff is None else fit_efficiency(eff[0][eff[0].week < w], eff[1])
        fpi = fpi_by_week.get(w - 1, {})
        for g in games[games.week == w].itertuples():
            line, open_line, total, open_tot = (tuple(lines.get(g.id, ())) + (None,) * 4)[:4]
            if g.home not in fbs or g.away not in fbs or line is None or pd.isna(line):
                continue
            p = project(g.home, g.away, r, g.neutral, hfa)
            pts = None if p is None else p[0] - p[1]
            f = None
            if g.home_id in fpi and g.away_id in fpi:
                f = fpi[g.home_id] - fpi[g.away_id] + (0 if g.neutral else hfa)
            if pts is None or f is None:
                continue
            if open_line is not None and not pd.isna(open_line) and abs(open_line - line) >= MAX_OPEN_MOVE:
                open_line = None  # look-ahead line, not a real opener
            if total is None or pd.isna(total):
                total = open_tot = None
            elif open_tot is not None and not pd.isna(open_tot) and abs(open_tot - total) >= MAX_OPEN_MOVE:
                open_tot = None
            rows.append(dict(id=g.id, week=w, game=f"{g.away} @ {g.home}", line=line, open_line=open_line,
                             neutral=bool(g.neutral), final_margin=g.home_pts - g.away_pts, points=pts, fpi=f,
                             eff_diff=None if er is None else efficiency_diff(str(g.home_id), str(g.away_id), er),
                             total=total, open_total=open_tot, final_total=g.home_pts + g.away_pts,
                             points_total=p[0] + p[1]))
    return pd.DataFrame(rows)


ANCHOR_FEATURES = ["const", "line", "fpi", "points"]


def fit_anchor(res):
    """Weights for the market-anchored projection: final margin regressed on the opening line
    (as a home margin), FPI and adjusted points, by least squares on backtest rows. The line
    does most of the work; the ratings only shift it where they disagree."""
    d = res.dropna(subset=["open_line", "fpi", "points"])
    X = np.column_stack([np.ones(len(d)), -d["open_line"], d["fpi"], d["points"]])
    return dict(zip(ANCHOR_FEATURES, np.linalg.lstsq(X, d["final_margin"], rcond=None)[0].round(4)))


def anchored_margin(w, home_line, fpi, pts):
    """Projected home margin from fit_anchor weights; home_line is the (opening) home spread."""
    return w["const"] - w["line"] * home_line + w["fpi"] * fpi + w["points"] * pts


def projections(home, away, r, neutral, hfa, line, anchor_weights, eff_scale=None):
    """Projected home margin from every source, None where a source can't make one. The same
    math as projections() in site/app.js. Market-anchored starts from the line being bet (the
    current line, or the pregame line once a game has started): it was tested by starting from
    the opening line and grading against that same line, and starting from an older line than
    the one being bet would count the line's own movement as edge. Blend averages FPI and
    Efficiency (it was FPI and adjusted points before October 29, 2026)."""
    p = project(home, away, r, neutral, hfa)
    pts = None if p is None else p[0] - p[1]
    fpi = fpi_margin(home, away, r, neutral, hfa)
    eff = None
    if eff_scale and "off_eff" in r.columns and home in r.index and away in r.index:
        h, a = r.loc[home], r.loc[away]
        if not pd.isna(h["off_eff"]) and not pd.isna(a["off_eff"]):
            diff = (h["off_eff"] + a["def_eff"]) - (a["off_eff"] + h["def_eff"])
            eff = float(efficiency_margin(diff, neutral, eff_scale, hfa))
    both = [m for m in (fpi, eff) if m is not None]
    base = line
    anchored = None
    if anchor_weights and pts is not None and fpi is not None and base is not None and not pd.isna(base):
        anchored = anchored_margin(anchor_weights, base, fpi, pts)
    return {"points": pts, "fpi": fpi, "efficiency": eff, "blend": sum(both) / len(both) if both else None,
            "anchored": anchored}


def add_anchored(res, first_train_season=2023):
    """Adds an "anchored" column, each season predicted with weights fit only on earlier seasons
    in res (from first_train_season on). Seasons with no earlier season to learn from get NaN."""
    res = res.copy()
    res["anchored"] = np.nan
    for s in sorted(res["season"].unique()):
        train = res[(res["season"] < s) & (res["season"] >= first_train_season)]
        if train["open_line"].notna().sum() < 200:
            continue
        w, m = fit_anchor(train), res["season"] == s
        res.loc[m, "anchored"] = anchored_margin(w, res.loc[m, "open_line"].fillna(res.loc[m, "line"]),
                                                 res.loc[m, "fpi"], res.loc[m, "points"])
    return res


def score_backtest(res, min_edge=0.0, against="close"):
    """Per-source against-the-spread record and accuracy. against="open" grades picks made at the
    opening line and adds closing line value (CLV): how far the line moved toward the pick by
    kickoff. Sharp bettors aim for positive CLV, which shows edge long before win rates do.
    Picks with edge below min_edge are skipped. RMSE vs result is the right value for the
    margin std dev setting."""
    col_line = "open_line" if against == "open" else "line"
    res = res.dropna(subset=[col_line])
    out = []
    sources = [("Adjusted points", "points"), ("ESPN FPI", "fpi")]
    sources += [(n, c) for n, c in (("Efficiency", "efficiency"), ("Blend", "blend"), ("Market-anchored", "anchored"))
                if c in res.columns and res[c].notna().any()]
    for name, col in sources:
        edge = res[col] + res[col_line]  # NaN for games a source has no projection for: never picked
        pick = res[edge.abs() >= min_edge]
        side = np.sign(edge[pick.index])
        ats = (pick["final_margin"] + pick[col_line]) * side
        w, l = int((ats > 0).sum()), int((ats < 0).sum())
        err = res[col] - res["final_margin"]
        row = dict(source=name, picks=w + l, wins=w, losses=l, pushes=int((ats == 0).sum()),
                   hit_rate=w / (w + l) if w + l else None,
                   mae_vs_result=err.abs().mean(), rmse_vs_result=np.sqrt((err ** 2).mean()),
                   mae_vs_line=edge.abs().mean())
        if against == "open":
            # home line falling (home more favored) is movement toward a home pick
            clv = (pick["open_line"] - pick["line"]) * side
            moved = clv[clv != 0]
            row.update(avg_clv=clv.mean(), clv_beat_rate=(moved > 0).mean() if len(moved) else None)
        out.append(row)
    err = -res[col_line] - res["final_margin"]
    out.append(dict(source=("Opening" if against == "open" else "Closing") + " line (baseline)",
                    mae_vs_result=err.abs().mean(), rmse_vs_result=np.sqrt((err ** 2).mean()), mae_vs_line=0.0))
    return pd.DataFrame(out).set_index("source")


# ---------- Efficiency (EPA per play) ----------
# Points are noisy: a defensive touchdown or a garbage-time score counts the same as a long drive.
# Expected points added (EPA) per play measures how well each offense and defense actually moved
# the ball, and CollegeFootballData publishes it per game with garbage time left out. Added
# October 29, 2026, replacing adjusted points in Blend: in 2024-2026, Blend picked a little better
# with it (every game: 54.4% vs 53.3% at the opening line, 52.2% vs 50.1% at the closing line)
# with the same accuracy. On its own it misses by more than FPI, so it isn't the default.
EFF_RIDGE = 4.0  # how hard ratings are pulled toward average early in the season; 4 tested best of 1-16


def fit_efficiency(rows, fbs, ridge=EFF_RIDGE):
    """Opponent-adjusted efficiency. rows: one per team per game (team, opp ESPN ids as strings;
    off: the team's EPA per play; loc: +0.5 home, -0.5 away, 0 neutral). Fits
    off = avg + off_eff[team] + def_eff[opp] + h*loc by ridge least squares, the same way as
    fit_ratings, so moving the ball on a good defense counts for more. Non-FBS teams share one
    rating. Returns {team id: (off_eff, def_eff)}: EPA per play above average on offense, and
    allowed above average on defense (lower is better)."""
    if rows.empty:
        return {}
    team = rows["team"].where(rows["team"].isin(fbs), "FCS")
    opp = rows["opp"].where(rows["opp"].isin(fbs), "FCS")
    teams = sorted(set(team) | set(opp))
    ix, n = {t: i for i, t in enumerate(teams)}, len(teams)
    X = np.zeros((len(rows), 2 * n + 2))
    X[:, 0], X[:, -1] = 1, rows["loc"].to_numpy()
    X[np.arange(len(rows)), 1 + team.map(ix).to_numpy()] = 1
    X[np.arange(len(rows)), 1 + n + opp.map(ix).to_numpy()] = 1
    pen = np.sqrt(ridge) * np.eye(2 * n + 2)[1:-1]
    coef = np.linalg.lstsq(np.vstack([X, pen]), np.concatenate([rows["off"].to_numpy(), np.zeros(2 * n)]), rcond=None)[0]
    return {t: (coef[1 + i], coef[1 + n + i]) for t, i in ix.items() if t != "FCS"}


def efficiency_diff(home_id, away_id, ratings):
    """Home minus away EPA per play expected in this matchup, or None if either isn't rated."""
    if home_id not in ratings or away_id not in ratings:
        return None
    (oh, dh), (oa, da) = ratings[home_id], ratings[away_id]
    return (oh + da) - (oa + dh)


def efficiency_margin(diff, neutral, scale, hfa=HFA):
    """Projected home margin: points per unit of EPA-per-play difference (learned), plus HFA."""
    return scale * diff + np.where(neutral, 0.0, hfa)


def fit_eff_scale(res, hfa=HFA):
    """Points of margin per unit of efficiency difference, by least squares on backtest rows."""
    d = res.dropna(subset=["eff_diff"])
    y = d["final_margin"] - np.where(d["neutral"], 0, hfa)
    return round(float(np.dot(d["eff_diff"], y) / np.dot(d["eff_diff"], d["eff_diff"])), 2)


def add_efficiency(res, first_train_season=2023, hfa=HFA):
    """Adds "efficiency" (each season scaled with a fit on earlier seasons only, from
    first_train_season on) and "blend" (the average of FPI and Efficiency). Seasons with no
    earlier season to learn from get NaN for both."""
    res = res.copy()
    res["efficiency"] = res["blend"] = np.nan
    if "eff_diff" not in res.columns:
        return res
    res["eff_diff"] = res["eff_diff"].astype(float)
    for s in sorted(res["season"].unique()):
        train = res[(res["season"] < s) & (res["season"] >= first_train_season)]
        if train["eff_diff"].notna().sum() < 200:
            continue
        m = res["season"] == s
        res.loc[m, "efficiency"] = efficiency_margin(res.loc[m, "eff_diff"], res.loc[m, "neutral"].to_numpy(),
                                                     fit_eff_scale(train, hfa), hfa)
        res.loc[m, "blend"] = (res.loc[m, "fpi"] + res.loc[m, "efficiency"]) / 2
    return res


# ---------- Totals (over/under) ----------
# Same approach as spreads: the market's total is the starting point, and adjusted points (each
# offense against the other's defense) shifts it. FPI doesn't project scoring, so it isn't used.
TOTAL_FEATURES = ["const", "total", "points"]


def fit_total_anchor(res):
    """Weights for the market-anchored total: final total regressed on the opening total and the
    adjusted-points total, by least squares on backtest rows."""
    d = res.dropna(subset=["open_total", "points_total"])
    X = np.column_stack([np.ones(len(d)), d["open_total"], d["points_total"]])
    return dict(zip(TOTAL_FEATURES, np.linalg.lstsq(X, d["final_total"], rcond=None)[0].round(4)))


def anchored_total(w, total, pts_total):
    return w["const"] + w["total"] * total + w["points"] * pts_total


def add_total_anchored(res, first_train_season=2023):
    """Adds an "anchored_total" column, each season predicted with weights fit on earlier seasons."""
    res = res.copy()
    res["anchored_total"] = np.nan
    for s in sorted(res["season"].unique()):
        train = res[(res["season"] < s) & (res["season"] >= first_train_season)]
        if train["open_total"].notna().sum() < 200:
            continue
        w, m = fit_total_anchor(train), res["season"] == s
        res.loc[m, "anchored_total"] = anchored_total(w, res.loc[m, "open_total"].fillna(res.loc[m, "total"]),
                                                      res.loc[m, "points_total"])
    return res


def score_totals(res, min_edge=0.0, against="close"):
    """Over/under record per totals source, like score_backtest. CLV here is how far the total
    moved toward the pick between the open and kickoff (up for an over, down for an under)."""
    col = "open_total" if against == "open" else "total"
    res = res.dropna(subset=[col])
    out = []
    for name, src in (("Adjusted points", "points_total"), ("Market-anchored", "anchored_total")):
        if src not in res.columns or res[src].isna().all():
            continue
        edge = res[src] - res[col]  # positive: over
        pick = res[edge.abs() >= min_edge]
        side = np.sign(edge[pick.index])
        ou = (pick["final_total"] - pick[col]) * side
        w, l = int((ou > 0).sum()), int((ou < 0).sum())
        err = res[src] - res["final_total"]
        row = dict(source=name, picks=w + l, wins=w, losses=l, pushes=int((ou == 0).sum()),
                   hit_rate=w / (w + l) if w + l else None,
                   mae_vs_result=err.abs().mean(), rmse_vs_result=np.sqrt((err ** 2).mean()),
                   mae_vs_line=edge.abs().mean())
        if against == "open":
            clv = (pick["total"] - pick["open_total"]) * side
            moved = clv[clv != 0]
            row.update(avg_clv=clv.mean(), clv_beat_rate=(moved > 0).mean() if len(moved) else None)
        out.append(row)
    err = res[col] - res["final_total"]
    out.append(dict(source=("Opening" if against == "open" else "Closing") + " total (baseline)",
                    mae_vs_result=err.abs().mean(), rmse_vs_result=np.sqrt((err ** 2).mean()), mae_vs_line=0.0))
    return pd.DataFrame(out).set_index("source")
