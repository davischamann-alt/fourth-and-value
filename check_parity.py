"""Checks that the website's projection math (site/projections.js) still agrees with model.py.
Run by the GitHub job before the site is published, or by hand (needs Node):

    python check_parity.py

The same formulas live in Python (the forward test and the backtest) and in JavaScript (the
site). If someone changes one and not the other, the site would show picks the forward test
never logged. This builds a few hundred matchups from the site's own data files
(site/data/ratings.json and model.json), projects each one both ways for every spread and totals
source, and exits with an error if any number differs by more than 0.01 points."""
import json
import subprocess
import sys
from pathlib import Path

import pandas as pd

from model import anchored_total, project, projections

SITE = Path(__file__).parent / "site"
TOLERANCE = 0.01
NODE = """
const fs = require("fs");
const P = require(process.argv[1]);
const ratings = JSON.parse(fs.readFileSync(process.argv[2])), model = JSON.parse(fs.readFileSync(process.argv[3]));
const cases = JSON.parse(fs.readFileSync(0));
const byName = Object.fromEntries(ratings.teams.map((t) => [t.team, t]));
const avg = P.leagueAverage(ratings.teams);
console.log(JSON.stringify(cases.map((c) => ({
  spread: P.spreadProjections(byName[c.home], byName[c.away], { neutral: c.neutral, line: c.line, hfa: model.hfa, model }),
  total: P.totalProjectionsFor(byName[c.home], byName[c.away], { total: c.total, avg, model }),
}))));
"""


def cases(teams):
    """Every team at home against the next few teams in the list: neutral and home sites, lines on
    and off, and teams with missing ratings, so each branch of the math is covered."""
    out = []
    for i, home in enumerate(teams):
        for k in (1, 7, 31):
            away = teams[(i + k) % len(teams)]
            n = len(out)
            out.append(dict(home=home, away=away, neutral=n % 4 == 0, line=None if n % 9 == 0 else (n % 41) - 20.5,
                            total=None if n % 11 == 0 else 38.5 + n % 35))
    return out


def python_side(case, r, model):
    a = model.get("anchor") or {}
    line, total = case["line"], case["total"]
    spread = projections(case["home"], case["away"], r, case["neutral"], model["hfa"], line, a.get("weights"),
                         model.get("eff_scale"), model.get("sr_scale"))
    p = project(case["home"], case["away"], r, case["neutral"], model["hfa"])
    pts = None if p is None else p[0] + p[1]
    w = a.get("total_weights")
    return dict(spread=spread, total=dict(points=pts, anchored=anchored_total(w, total, pts) if w and pts is not None and total is not None else None))


def main():
    ratings, model = json.loads((SITE / "data" / "ratings.json").read_text()), json.loads((SITE / "data" / "model.json").read_text())
    r = pd.DataFrame(ratings["teams"]).set_index("team")
    todo = cases(list(r.index))
    node = subprocess.run(["node", "-e", NODE, str(SITE / "projections.js"), str(SITE / "data" / "ratings.json"),
                           str(SITE / "data" / "model.json")], input=json.dumps(todo), capture_output=True, text=True)
    if node.returncode:
        sys.exit(f"Couldn't run the site's math under Node:\n{node.stderr}")
    bad, compared = [], 0
    for case, js in zip(todo, json.loads(node.stdout)):
        py = python_side(case, r, model)
        for market in ("spread", "total"):
            for src, a in py[market].items():
                b = js[market].get(src)
                a = None if a is None or pd.isna(a) else float(a)
                compared += 1
                if (a is None) != (b is None) or (a is not None and abs(a - b) > TOLERANCE):
                    bad.append(f"{case['away']} @ {case['home']} ({market}, {src}): Python {a}, site {b}")
    if bad:
        sys.exit(f"{len(bad)} of {compared} projections differ between model.py and site/projections.js:\n  " + "\n  ".join(bad[:15]))
    made = sum(v is not None for c in todo for v in python_side(c, r, model)["spread"].values())
    print(f"Python and the site agree on all {compared} projections across {len(todo)} matchups ({made} spread projections made, the rest correctly empty)")


if __name__ == "__main__":
    main()
