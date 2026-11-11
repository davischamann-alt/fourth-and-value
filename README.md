# Fourth & Value

**Only go for it when the numbers say so.**

> **New name, new address (October 24, 2026).** This project used to be called **CFB Edge**, in a repository named `NCAAF-Spread-Projection`. It's now **Fourth & Value**:
>
> - **Website:** [davischamann-alt.github.io/fourth-and-value](https://davischamann-alt.github.io/fourth-and-value/). The old address, `davischamann-alt.github.io/NCAAF-Spread-Projection`, no longer works, so update any bookmarks or links you've shared.
> - **Repository:** [github.com/davischamann-alt/fourth-and-value](https://github.com/davischamann-alt/fourth-and-value). Old repository links redirect here automatically.
> - **If you cloned the old repository,** point your copy at the new one with `git remote set-url origin https://github.com/davischamann-alt/fourth-and-value.git`.
>
> Nothing else changed: the model, the data and the forward-test pick log carried over as they were.

College football spread projections, compared with the Vegas betting line. Fourth & Value shows which side its model would pick, how likely that pick is to cover before and during the game, and how well its picks have done, including a public log of picks recorded before kickoff.

It's free. Scores, lines and ESPN's team ratings come from ESPN's public data. Testing past seasons is optional and uses a free key from CollegeFootballData.com.

**Two ways to use it:**

| | **Website** | **App on your computer** |
| --- | --- | --- |
| Where | **[davischamann-alt.github.io/fourth-and-value](https://davischamann-alt.github.io/fourth-and-value/)** | Runs in your browser from your own computer |
| Setup | None: open the link on any phone or computer | About 10 minutes ([Install and run it](#install-and-run-it)) |
| Games, picks, live cover chances | ✅ | ✅ |
| Ratings | Updated automatically every morning | Click **Auto-fill** to update |
| Your picks and bets | Saved in that browser | Saved as files on your computer |
| Run new backtests | Shows the latest results | ✅ Run any seasons and settings |

> **This is an analysis tool, not betting advice.** Testing on past seasons found no source that beats the final (closing) line. The only possible edge showed up against opening lines, and it isn't proven yet. See [What the testing found](#what-the-testing-found).

**Contents**

1. [What it does](#what-it-does) and [the website](#the-website)
2. [Terms you'll see](#terms-youll-see)
3. [Install and run it](#install-and-run-it)
4. [Using it on game day](#using-it-on-game-day)
5. [The four tabs](#the-four-tabs)
6. [Sidebar settings](#sidebar-settings)
7. [Testing on past seasons](#testing-on-past-seasons)
8. [What the testing found](#what-the-testing-found)
9. [The forward test](#the-forward-test)
10. [How the model works](#how-the-model-works) and [model changes](#model-changes)
11. [Publishing the website](#publishing-the-website)
12. [Files](#files)
13. [Troubleshooting](#troubleshooting)
14. [Limitations](#limitations)
15. [Ideas for later](#ideas-for-later)

---

## What it does

- **Predicts every game's margin** (how many points the home team wins or loses by), using one of four methods you choose.
- **Compares that prediction with the betting line** and picks the side it thinks will cover.
- **Gives a cover chance before the game** and a live one that updates with the score and clock.
- **Logs and grades your picks** automatically when games end.
- **Tracks your bets,** with profit and return on investment.
- **Tests itself on past seasons,** predicting each week with only the information available at the time.

### The website

Open **[davischamann-alt.github.io/fourth-and-value](https://davischamann-alt.github.io/fourth-and-value/)**. It works on phones, and you can add it to your home screen from the browser's Share menu.

- **Games:** one week at a time (use ‹ › to change weeks), grouped by day, with games still to play first and finished games folded into a **Final** section at the bottom (latest first). Each game card shows the line and where it opened, the model's pick, an edge badge labeled like a fourth-down call, and the cover chance, which updates live during games. **Punt** is an edge under 1.5 points, meaning no bet, and **Check the news** a gap of 5+, which is more likely missing information than extra value. In between, the price decides: **Go for it** when the best line and price across the sportsbooks ([Line shopping](#line-shopping)) gives the pick a chance at least a point above that price's break-even, and **Lean** when none does yet, with the number to look for ("worth a bet at +2 or better at -110"). Before kickoff the chance bar shows the chance at the best number on offer, and its yellow line what that price needs: a bar past the line is Go for it. Filter to go-for-it edges, live games, or **close** games (live and within 4 points of the spread, sorted tightest first), sort by biggest edge, or search for a team. The **?** next to the search explains every part of a card. Going back from a game returns you to the same spot in the list, each tab keeps its own place, and tapping the tab you're on jumps to the top.
  - **Spread / Total:** switches every card between the pick against the spread and the **over/under** pick against the total (see [What the testing found](#what-the-testing-found) for how totals tested).
  - **Check the news, automatically:** a Lean or Go for it turns into **Check the news** when the model is likely missing something: the picked team's starting quarterback is listed out or doubtful on an official availability report, it's a bowl game outside the College Football Playoff, or it's an over pick with 12+ mph of wind in the forecast (a **Wind** tag). The pick box says why. A **QB change** tag (someone other than the usual starter led the team's last game) is shown for context but no longer changes the label. See [What the testing found](#what-the-testing-found).
  - **At open:** edges of 1.5+ where the line is still within half a point of its opening number, where the model tested best. Each pregame pick box also says how far the line has moved toward or away from the pick since it opened.
  - **Opening lines notice:** once next week's lines are posted (usually Sunday), a notice at the top says how many edges are still at the opening number, with a link straight to them.
- **Game details:** tap any game card for the full breakdown. Each game has its own link (like `#game/401858274`) that you can share.
  - **Why this pick:** what all five projections say, and whether they agree. A split is a reason to punt.
  - **Over/under:** both totals projections, the model's over or under pick, and its forward-test entry.
  - **Line movement:** a chart of the line through the week, from the forward test's two-hourly recordings.
  - **Matchup:** FPI rank and adjusted offense and defense, ESPN's season stats (or game stats once it starts), and each team's last five results.
  - **A second opinion:** ESPN's matchup predictor next to the model's win chance.
  - **Conditions:** venue, field surface, and the weather forecast when ESPN has one.
  - **Forward test:** when the pick was recorded, at what line, and how it graded.
  - **Live and finished games:** ESPN's play-by-play win chance and each team's leaders, updating every 30 seconds while the game is on.
  - **Quarterbacks and injuries:** any recent quarterback change for either team, from box scores (who led each game in pass attempts). ESPN doesn't publish injury reports for college football, so other injuries aren't included; check team news yourself.
  - **Over/under weather:** the forecast at kickoff (wind, gusts, temperature, chance of rain) for outdoor games this week and next.
- **Props:** projections for this week's players in five stats: passing yards, passing TDs, rushing yards, receiving yards and receptions. Enter the line and odds from your sportsbook, and the page shows the over/under chance, how often the player cleared that line in his last five games, and a lean when the chance beats break-even by 3+ points. Each projection is the player's per-game average this season (from ESPN box scores), nudged by half of how much the opponent's defense allows for rushing yards, passing TDs and receptions. In a week-by-week check on 2026, that matched or slightly beat a plain season average; weighting recent games more did worse. **They're untested against real prop lines**, because free historical prop lines don't exist, and books know about injuries and depth charts that the model doesn't. `build_props.py` builds them as part of the GitHub job, and box scores are cached in `data/box/`.
- **Ratings:** every FBS team's FPI, adjusted offense and defense, and offensive and defensive EPA per play (efficiency), sortable and searchable, with a **How to read the ratings** guide (what each column means and how the projections use it) and a **Compare two teams** tool: pick any matchup, home or neutral, and optionally enter the betting line to see each projection's pick and edge.
- **My picks:** tap **☆ Track pick** on a game before kickoff, and it's graded automatically when the game ends.
- **Bets:** log bets and see your record, profit and ROI, and download or import them as CSV.
- **Track record:** live results of picks recorded before kickoff ([The forward test](#the-forward-test)), led by the **expected hit rate from line movement**, then the backtest results in plain language. Every hit rate shows its margin of error (±). A switch at the top flips between spreads and totals.
- **Updates:** every improvement to the project, newest first, with model changes dated and explained. Filter by model, site, or fixes and data.
- **Suggestions and problem reports:** the form on the Updates tab opens a pre-filled post in the repo's [GitHub Issues](https://github.com/davischamann-alt/fourth-and-value/issues), labeled `suggestion` or `problem`, so feedback is tracked in the open. Posting needs a free GitHub account; nothing is sent from the site itself. The Updates tab also lists the suggestions that are still open.
- **🔔 Alerts:** the bell at the top. Get told when the model finds an edge of 1.5+ as soon as a line opens, or when a line moves through 3 or 7 on a game it has a pick for: in any RSS reader, as phone notifications through the free ntfy app, or in Discord. The panel also lists the latest alerts. See [Alerts](#alerts).
- **⚙︎ Settings:** home-field advantage, std dev (it uses the tested value for each projection automatically) and light or dark theme.

Picks and bets are saved only in the browser you use, so they don't follow you between devices; use **Download as CSV** to move bets. The page gets scores and lines straight from ESPN while you have it open, and a GitHub job refreshes the ratings and track record every morning ([Publishing the website](#publishing-the-website)).

---

## Terms you'll see

| Term | Meaning |
| --- | --- |
| **Spread / line** | The betting line, shown from the home team's side. **-7** means the home team is favored by 7, and **+3** means it's a 3-point underdog. |
| **Cover** | Win against the spread. A 7-point favorite covers by winning by more than 7. Winning by exactly 7 is a **push**, and the bet is refunded. |
| **Projected margin** | The dashboard's prediction of home score minus away score. **+10** means the home team by 10. |
| **Edge** | How far the projection is from the line, in points. Bigger means the model disagrees with Vegas more. |
| **Opening line** | The first line a sportsbook posts, usually the Sunday before the game. It's the easiest line to beat. |
| **Closing line** | The final line at kickoff, after all the betting has moved it. It's the hardest line to beat. |
| **CLV (closing line value)** | How far the line moved toward your pick between open and kickoff. Lines that keep moving your way are the standard sign of a real edge. |
| **Total (over/under)** | The sportsbook's line on combined points. An **over** bet wins if both teams together score more; an **under** wins if they score fewer. |
| **EPA (expected points added)** | How much each play changed a team's expected points, based on down, distance and field position. EPA per play measures how well an offense moves the ball (or a defense stops it) without the noise of turnovers returned for touchdowns or garbage-time scores. |
| **Margin of error (±)** | How far a hit rate could be from the truth by luck alone (95% of the time). After 50 picks it's about ±14 points; after 2,000 about ±2. |
| **Hit rate** | The share of picks that covered. At standard -110 odds, you need **52.4%** to break even. |
| **FPI** | ESPN's Football Power Index: how many points better or worse a team is than an average FBS team on a neutral field. |
| **FBS / FCS** | The top two divisions of college football. The dashboard rates FBS teams; FCS opponents share a single rating. |

---

## Install and run it

You need about 10 minutes and an internet connection. No programming is required: you'll copy and paste a few commands.

### 1. Install Python (one time)

- **Mac:** open **Terminal** (press `Cmd + Space` and type "Terminal"), then run `python3 --version`. If it prints `Python 3.11` or higher, skip ahead. Otherwise, download the installer from [python.org/downloads](https://www.python.org/downloads/) and run it.
- **Windows:** download the installer from [python.org/downloads](https://www.python.org/downloads/). On the first screen of the installer, tick **"Add python.exe to PATH"**. Then open **Command Prompt** (press the Windows key and type "cmd").

### 2. Get the code (one time)

**Option A, no tools needed:** on the [GitHub page](https://github.com/davischamann-alt/fourth-and-value), click the green **Code** button, then **Download ZIP**. Unzip it into your **Downloads** folder, and rename the folder to `fourth-and-value` if it has a different name (GitHub usually adds `-main`).

**Option B, with git:**

```bash
cd ~/Downloads
git clone https://github.com/davischamann-alt/fourth-and-value.git
```

### 3. Set it up (one time)

Run these one at a time in Terminal or Command Prompt. They create a private Python environment for the dashboard and install the three libraries it uses (Streamlit, pandas and requests).

**Mac:**

```bash
cd ~/Downloads/fourth-and-value
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

**Windows:**

```bat
cd %USERPROFILE%\Downloads\fourth-and-value
py -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### 4. Start the dashboard (every time)

**Mac:**

```bash
cd ~/Downloads/fourth-and-value
source venv/bin/activate
streamlit run app.py
```

**Windows:**

```bat
cd %USERPROFILE%\Downloads\fourth-and-value
venv\Scripts\activate
streamlit run app.py
```

Your browser opens the dashboard at **http://localhost:8501**. Leave the Terminal window open while you use it. To stop it, click the Terminal window and press `Ctrl + C`.

The first time Streamlit runs, it may ask for an email address. You can press **Enter** to skip that. Notes suggesting a newer `pip` or installing `watchdog` are safe to ignore.

---

## Using it on game day

1. **Refresh the ratings once a week.** On the **Team ratings** tab, click **⚡ Auto-fill from ESPN results**. It takes about a minute and updates every FBS team from the season's results. The download comes with ratings already filled in, but they go stale as the season goes on.
2. **Open the dashboard before kickoff.** It saves each game's pregame line the first time it sees it, and the live cover chance is measured against that line. After kickoff, ESPN stops listing odds for that game.
3. **Choose a projection source** in the sidebar. If you're unsure, use **ESPN FPI** or **Market-anchored**; see [What the testing found](#what-the-testing-found).
4. **Read the board.** Each game shows its line, projected margin, edge, the pick and its cover chance. If a game has no pick, the **Note** column says why.
5. **Log your picks** (optional). Click **📌 Log these pregame picks to history** before the games start, and they're graded automatically after the games finish.

---

## The four tabs

### Today's games

One row per game on the date chosen in the sidebar. It refreshes every 30 seconds.

| Column | What it shows |
| --- | --- |
| Game, Status, Score | Matchup (away @ home), game clock and score |
| Home line | The current line, or the saved pregame line once the game has started |
| Open | The opening line; compare it with Home line to see how the line has moved |
| Total | The over/under for total points |
| Proj margin | The model's predicted home margin |
| Edge (pts) | How far the projection is from the line |
| Pick | The side the model picks, with its line |
| Pregame % | The chance the pick covers, before the game |
| Live cover % | The same chance, updated with the score and time left |
| Note | Why a game has no pick (for example, a team missing from the ratings or no line yet) |

### Team ratings

A table with one row per team, which you can edit:

- **ppg / papg:** points scored and allowed per game, adjusted for opponent strength.
- **fpi:** ESPN's power rating.
- **games:** games played.

**⚡ Auto-fill from ESPN results** rebuilds the table from this season's games. Team names have to match the names ESPN uses (for example `Ohio State`, `Miami`). If you edit the table by hand, click **Save ratings**.

### Bet tracker

Record each bet: date, game, side, line, odds, stake and result (`W`, `L` or `Push`). Blank odds count as -110. Click **Save bets** to keep them. The tab shows the number of graded bets, net profit and ROI. Bets are stored only on your computer.

### Backtest

Two sections:

1. **Your logged picks:** your logged picks, graded, with hit rates by confidence level (50–54%, 55–59% and so on) and by projection source.
2. **Season backtest:** tests every projection source on whole seasons. See [Testing on past seasons](#testing-on-past-seasons).

---

## Sidebar settings

| Setting | What it does | Default |
| --- | --- | --- |
| **Date** | Which day's games to show | Today |
| **Margin std dev** | How spread out game results are around the projection; this drives the cover percentages | 14. Testing suggests about 15.5 for FPI, Market-anchored and Blend, and 16.5 for Adjusted points. |
| **Home-field advantage** | Points given to the home team (none at neutral sites) | 3.0 (was 2.5 before October 25, 2026; see [Model changes](#model-changes)) |
| **Projection source** | Which prediction method to use (see below) | Blend |
| **Refresh now** | Reloads all data right away | — |
| **Auto-refresh every 30s** | Keeps the scoreboard updating on its own | On |

**Projection sources:**

- **Adjusted points:** built from each team's points scored and allowed, adjusted for who they played.
- **ESPN FPI:** built from ESPN's power ratings.
- **Efficiency:** built from each team's EPA per play on offense and defense, adjusted for opponents. Needs a CollegeFootballData key.
- **Success rate:** built from the share of plays each offense wins (a play succeeds when it gains enough to stay on schedule), adjusted for opponents. It's steadier than EPA, which a few long plays can swing. Needs a CollegeFootballData key.
- **Blend** (the website's default): the average of FPI, Efficiency and Success rate. It was FPI and adjusted points before October 29, 2026, and FPI and Efficiency until November 10, 2026. Without a CollegeFootballData key, it's FPI alone.
- **Market-anchored:** starts from the current betting line and shifts it toward what FPI and the points ratings say. It stays closest to the betting line, so it shows the fewest and smallest edges. It was the website's default until November 10, 2026, when testing showed it was the weakest projection ([Model changes](#model-changes)). It only works once the season backtest has been run on past seasons, which saves the weights it uses (`data/anchor_weights.json`). Those saved weights are included in the download, so it works right away.

---

## Testing on past seasons

On the **Backtest** tab, choose **Seasons** and click **▶ Run season backtest**. For each week from week 3 on, it predicts the games using only what was known before that week, then grades the picks.

- **The current season** works right away, using ESPN data.
- **Past seasons (2021 on)** need a free CollegeFootballData key. Set it up once:
  1. Get a key at [collegefootballdata.com/key](https://collegefootballdata.com/key). It arrives by email.
  2. In the project folder, create a folder named `.streamlit`, and inside it a text file named `secrets.toml` containing:
     ```toml
     CFBD_API_KEY = "paste-your-key-here"
     ```
  3. In the dashboard, click **Refresh now**.

  Keep the key private. The file is set to be left out of git, so it won't be uploaded to GitHub. Each past season uses two API calls the first time and is then saved in `data/cfbd/`; the free plan allows 1,000 calls a month.

**Reading the results:**

- **Grade against:**
  - **Opening line:** picks made when lines are first posted. This view adds **CLV** columns showing how often the line moved toward the pick.
  - **Closing line:** the final line at kickoff, which is the tougher test.
- **Only bet when edge is at least:** counts only picks where the model disagrees with the line by at least this many points.
- **hit_rate:** the share of picks that covered. Compare it with 52.4%.
- **RMSE vs result:** the typical miss in points. Use it for the **Margin std dev** setting.
- **line (baseline):** how close the line itself came to the final scores, for comparison.
- **Market-anchored** predicts each season using only weights learned from earlier seasons you selected, so the first season you select has no Market-anchored picks.

2021 and 2022 have only a few usable weeks each, because ESPN overwrote most of those seasons' weekly FPI ratings later. 2023 onward is the most reliable.

---

## What the testing found

These results are from 2023–2026 (through week 8 of 2026), about 2,300 games, with home-field advantage at 3.0. Opening lines that moved 7+ points before kickoff are excluded: they're look-ahead lines posted weeks early that nobody could bet with that season's information (see [Model changes](#model-changes)). Market-anchored is graded from 2024 on, because 2023 was its training data.

| Picks made at the… | Result |
| --- | --- |
| **Closing line** | No projection beats it: about 50–51% for every one, below break-even. |
| **Opening line, every game** | About 53% for every projection, just above the 52.4% break-even. |
| **Opening line, edge 3+ points** | ESPN FPI 53.7% (826 picks), Adjusted points 53.7%, Efficiency 54.9%, Blend 54.6%. Market-anchored 62.1%, but on only 29 picks. |
| **Opening line, edge 5+ points** | No better than 3–5 point edges (ESPN FPI 52.6%). That's why the site labels them **Check the news** instead of Go for it. |
| **Line movement** | After the open, lines moved toward the model's picks about 62–72% of the time. |

**The opening-line results overstate what you can bet** (found November 10, 2026). Lines moved about 1 point toward Blend's picks after the opener, and that move is where the 55% comes from. But in the live log (weeks 9–11 of 2026), about 0.7 of that point had already happened by the time the line first showed up on ESPN, and almost none (+0.02) came after. In the 169 games in both the backtest and the live log, the same picks did 3–5 points worse graded at the first line the job saw than at the opener. The closing line is the number anyone can get, and there every projection is between 50% and 53%. In 62% of those picks the line was still at its opener when first seen, so the job now checks every 30 minutes on Sundays, when most lines post.

**Choosing the default** (November 10, 2026). 2024–2026, about 1,750 games, each rating scaled using earlier seasons only:

| Projection | Opening line, edge 1.5+ | By season | Closing line, edge 1.5+ |
| --- | --- | --- | --- |
| Market-anchored (the old default) | 51.1% (325 picks) | 59%, 51%, 47% | about 50% |
| Blend, old (FPI + Efficiency) | 55.7% (1,256) | 57%, 55%, 55% | 51.6% |
| **Blend, new (FPI + Efficiency + Success rate)** | **55.9%** (1,303) | 57%, 55%, 56% | **52.3%** |
| Success rate alone | 54.1% | 55%, 54%, 54% | 52.2% |

Market-anchored's formula is fit to the average margin, so the line gets most of the weight and its edges come mostly from a built-in lean, not from the ratings: the same flaw found in its totals version. Also tested the same way, and not used because they added nothing or hurt: Elo, last season's SP+, the talent composite, explosiveness, and rushing and passing EPA separately. Splitting picks by favorite or underdog, home or away, week of the season, spread size, or whether the ratings agree found nothing that held up across seasons. Blend's edges of 1.5+ cover about 70% of games, and bigger edges did no better than smaller ones, so treat the labels as a filter for "the model disagrees", not as a ranking.

**Totals (over/unders)**, graded the same way, about 2,300 games:

| Picks made at the… | Result |
| --- | --- |
| **Closing total** | 51–52% for both totals projections: no edge. |
| **Opening total, every game** | Adjusted points 52.1% (2,272 picks), Market-anchored 51.8%: right around break-even. |
| **Opening total, big disagreements** | When adjusted points and the opening total were 5+ points apart, siding with the ratings won in every season 2022–2026: 53.7% (820 picks), and 56.2% at 7+ points (436 picks). Overs and unders both won. Market-anchored's 1.5+ edges (a 7.5-point disagreement) went 54.5% (363 picks). |
| **Total movement** | Totals moved toward the Adjusted points picks 55–61% of the time, but by only about +0.4 points on average, which isn't enough to profit. |

Totals are shown because they're part of every game and the forward test now records them, not because they've proven to make money. The model doesn't know the weather, which moves totals more than spreads.

**Efficiency (EPA per play)**, added October 29, 2026. These are 2024–2026 games, since 2023 was used to learn how many points one unit of EPA is worth:

| On the same 2024–2026 games | Opening line, every game | Opening line, 3+ edges | Closing line, every game | Typical miss |
| --- | --- | --- | --- | --- |
| ESPN FPI | 53.5% | 54.7% | 51.2% | 15.3 |
| Efficiency | **54.8%** | 54.9% | 51.7% | 16.6 |
| Blend, old (FPI + adjusted points) | 53.3% | 54.7% | 50.1% | 15.6 |
| Blend, new (FPI + Efficiency) | 54.4% | 54.6% | **52.2%** | 15.6 |

The new Blend picked a little better than the old one in most of these columns, at the same accuracy, so Efficiency replaced adjusted points in it. It isn't better every season (2025 dipped), and it doesn't beat the closing line, so treat it as a small improvement, not a breakthrough. Also tested and **not** used: starting each season from last season's efficiency (it made the picks worse), and adding efficiency to Market-anchored (no change). In 2022, a season none of this was tuned on, Efficiency alone was only 51.7% at the opening line on 3+ edges.

**Situations the model can't see** (added October 29, 2026). Each one is now labeled **Check the news** instead of Lean or Go for it:

| Situation | What happened | Games |
| --- | --- | --- |
| ~~A team just changed quarterbacks~~ (someone other than the usual starter led its last game in pass attempts). **Dropped November 10, 2026.** | The 2026 sample (57 games) showed 39–45% at the opening line. With box scores for 2023–2026, Blend's 1.5+ edges in these games went 54% at the opening line against 57% in the rest, and 53% against 53% at the closing line. 2024 ran the other way from 2026, and the flag covered 23% of all games. It's now a tag for context, not a label change. | 545 flagged games of 2,323 |
| **A bowl outside the College Football Playoff** | 2023–2025, at the opening line: FPI 42.1%, Efficiency and Blend 47.4%. Playoff games went 60–68%, so they keep their normal labels. | 109 bowls, 25 playoff games |
| **An over with 12+ mph of wind at kickoff** | 2023–2026: totals in those games fell about 1.8 points from the open to kickoff (0.35 in calm games), and overs went 47.7% against the opening total. The closing total prices the wind; the opening total doesn't fully. Rain and cold showed no reliable effect. | 176 windy games |

The quarterback and bowl samples are small, but they point the way you'd expect: the market knows about the new starter or the opt-outs, and the ratings don't.

**Missing players** (added November 6, 2026). ESPN box scores for 2023–2026 (about 2,250 backtest games) show who sat out: each team's usual starting quarterback, lead running back and top two receivers, from its earlier games. Results are points relative to the line, from the affected team's side:

| Situation | Games | Line move, open to close | Result vs the opening line | Covered at the opening line |
| --- | --- | --- | --- | --- |
| **Starting QB out, after playing the week before** | 317 | −0.85 | −1.6 (±1.6) | **43%** |
| Starting QB out again (missed the week before too) | 354 | −0.17 | +0.8 | 51% |
| Lead running back or receivers (15%+ of the team's yards) out | 342 | −0.14 | −0.2 | 50% |

Only a quarterback sitting out unexpectedly mattered, and only an availability report can say so before kickoff: by the second game the market and the ratings have adjusted. Market-anchored's picks on such a team went 16-20, and picks against it went 29-18, so only picks *on* that team are relabeled ([QB availability](#qb-availability)). Running backs and receivers showed nothing, so they aren't used. Some of these were benchings, not injuries; box scores can't tell the difference.

**What this means:**

- **The Vegas closing line is more accurate than any of these projections.** Betting near kickoff shows no edge.
- **The opening-line edge is real but small:** about 53–54%, barely above break-even and within what luck alone could produce. Lines moving toward the picks is the most encouraging sign.
- **Huge disagreements with the market aren't extra value.** A 5+ point gap usually means the market knows something the model can't see, such as injuries, which ESPN doesn't publish for college football.
- **Adjusted points adds little on top of FPI**, and Market-anchored mostly follows the line.
- **The forward test is the real judge.** Picks recorded before kickoff from week 9 on are the cleanest test.


---

## The forward test

The backtest replays past seasons, and some of its biases can't be fully ruled out (see the caveats above). The forward test can't have those biases: it records picks **before** the games are played.

Every two hours, the GitHub job runs `record.py`, which:

1. **Records lines:** saves each game's line whenever it changes, with the time, to `data/live/line_history.csv`. This builds a record of how lines move through the week.
2. **Logs picks:** the first time a game has a line, saves every projection's pick at that line to `data/live/picks.csv`. Those columns are never changed afterward. The job checks every two hours, and every 30 minutes on Sunday afternoons and evenings (Eastern), when most lines open. Even so, about half of lines have already moved from ESPN's listed opener by the time they first appear.
3. **Logs over/unders:** the same for totals, the first time a game has a total, in `data/live/total_picks.csv` (started October 29, 2026).
4. **Grades picks:** after kickoff, fills in the closing line, the result at the logged line, the result at the closing line and the CLV (how far the line moved toward the pick).
5. **Commits** the files to the repository. Git history then shows exactly when each pick was recorded, which proves it was made before the game.

The website's **Track record** tab shows the results by projection and edge size, with a link to that history. It leads with the **expected hit rate from line movement**, not the win-loss record, because the record needs hundreds of picks before it means much (after 50 picks its margin of error is about ±14 points). Line moves settle much faster: in the 2023–2026 backtest, every point the line moved toward a pick was worth about 3 points of hit rate (2.5 for totals). So the estimate is 50% plus that much for the average move, with its own margin of error. It assumes the closing line is about a coin flip, as it was in the backtest. To beat the 52.4% break-even, the line has to move about +0.8 points toward the picks on average.

The log started on October 21, 2026, partway through week 8, so some of that week's games were logged after their lines had already moved. Everything from week 9 on is logged close to the open.

---

## How the model works

**Adjusted points ratings.** Every completed game this season is fitted at once: a team's points scored = league average + its offense rating + its opponent's defense rating ± home field. That way 40 points against a strong defense counts for more than 40 against a weak one. Teams with few games are pulled toward average (ridge regression), and all FCS opponents share one rating. `ppg` and `papg` are those ratings on the normal points scale.

**Efficiency ratings.** The same kind of fit, on EPA per play instead of points: a team's EPA per play in a game = average + its offense rating + its opponent's defense rating ± home field, using every regular-season game so far with garbage time left out (from CollegeFootballData). `off_eff` and `def_eff` are those ratings, in EPA per play above average. The 67.5 turns a difference in EPA per play into points of margin; it's learned from 2023–2025.

**Projected margin**, by source:

```
Adjusted points:  (home.ppg + away.papg) - (away.ppg + home.papg) + HFA
ESPN FPI:         home.fpi - away.fpi + HFA
Efficiency:       67.5 x [(home.off_eff + away.def_eff) - (away.off_eff + home.def_eff)] + HFA
Success rate:     163 x [(home.off_sr + away.def_sr) - (away.off_sr + home.def_sr)] + HFA
Blend:            average of FPI, Efficiency and Success rate
Market-anchored:  const + w_line x (-home line) + w_fpi x FPI margin + w_pts x points margin
```

There's no home-field advantage (HFA) at neutral sites. Market-anchored starts from the line you'd be betting: the current line, or the pregame line once a game has started. In the backtest it started from the opening line and was graded against that same line. Starting from an older line than the one being bet would count the line's own movement as edge. The weights are learned by regression on past seasons. Learned from 2023–2025 (look-ahead opening lines excluded), they come out to about 0.73 × line, 0.21 × FPI and 0.12 × adjusted points.

**Projected total** (over/unders), by source. FPI doesn't project scoring, so it isn't used:

```
Adjusted points:  (home.ppg + away.papg) + (away.ppg + home.papg) - 2 x league average
Market-anchored:  betting total + 0.2 x (adjusted points total - betting total)
```

Market-anchored moves the total a fifth of the way toward adjusted points, so the ratings have to disagree with the market by 7.5 points for a Lean and 15 for a Go for it. It always picks the same side as Adjusted points; it only says the edge is smaller. The 0.2 is fixed, not learned by regression (see the November 1, 2026 row under Model changes for why). The over/under chance uses a 16-point std dev (16.5 for Adjusted points).

**Pregame cover chance.** The final margin is treated as a bell curve with spread equal to the **Margin std dev** setting (sigma). On the website, only part of the projection's gap to the line is believed (`shrink`, about 0.2 for Blend):

```
edge           = | projected margin + home line |
P(home covers) = NormalCDF( shrink x (projected margin + home line) / sigma )
```

Read at face value, the gap was far too confident: Blend gaps of 10+ points showed about an 80% chance and won 47–59% in 2024–2026. `shrink` is the share that makes the chances match how often picks covered, fit by maximum likelihood over the opening and closing lines together (`model.fit_shrink`; each projection gets its own, 0.09–0.20 for spreads and 0.11–0.20 for totals). With it, a 5-point Blend edge shows about 52.5% and almost nothing shows above 55%, which is what the backtest supports. The edge and the labels still use the full gap: no range of edge sizes reliably beat another, so the labels say how much the model disagrees, not how likely the pick is to win. The desktop app still shows the unscaled chance.

**Live cover chance.** During a game, the expected final margin is the current margin plus the share of the projection still to be played, and the uncertainty shrinks as time runs out:

```
expected final margin = current margin + projected margin x (time left / 60 min)
live sigma            = sigma x sqrt(time left / 60 min)
```

Finished games show 100% or 0% (50% for a push). Overtime counts as about two minutes left.

**Avoiding look-ahead in the backtest.** Each week's ratings use only earlier games. FPI comes from the newest ESPN snapshot taken before that week's first game, and weeks with no snapshot from the previous 10 days are skipped, because ESPN overwrote some old snapshots with later data.

---

## Model changes

Any change to how picks are made is logged here and on the website (a notice on the Games tab for two weeks, a permanent dated list on the **Track record** tab, and the full project history on the **Updates** tab), so anyone reading the numbers knows what produced them. Changes never touch picks already in the forward-test log; each pick's `logged_at` time shows which version made it.

| Date | Change | Why | Effect |
| --- | --- | --- | --- |
| November 11, 2026 | **Go for it follows the price:** between Punt (under 1.5) and Check the news (5+), a pick is Go for it only when the best line and price across the sportsbooks beats its break-even by a point, and Lean otherwise, with the number to look for. The chance bar shows the chance at that best number | Since cover chances were scaled to results, every Go for it pick (3–5 point edges) showed 52% or less, below the 52.4% break-even marked on its own bar: the label said bet while the number said don't | This week, 4 of 30 labeled spread picks are Go for it instead of 15, and no total; most get there through a better price at one book. The pick log is unchanged: it records edges, not labels |
| November 10, 2026 | **Cover chances scaled to results; QB change no longer changes labels:** cover and over/under chances now believe only part of a projection's gap to the line (about 20% for Blend), and a QB change is a tag for context instead of turning picks into Check the news | The chances were far too confident: Blend gaps of 10+ points showed about 80% and won 47–59% in 2024–2026. The QB change label came from 57 games in 2026 (39%); over 2023–2026 box scores, Blend's picks in those games went 54% at the opening line against 57% in the rest, and 53% against 53% at the close. | Displayed chances drop to about 50–55%. Projections, edges, labels by edge size, and the pick log don't change. About a quarter of games lose the automatic Check the news label; the label for a starting QB listed out on an availability report stays (43% over 317 games). |
| November 10, 2026 | **Blend is the default, with Success rate added:** a sixth projection from opponent-adjusted success rate; Blend now averages FPI, Efficiency and Success rate and replaces Market-anchored as the default for spreads. The job checks lines every 30 minutes on Sundays, and the Track record tab leads with closing-line results. | Market-anchored was the weakest projection: 51.1% on 1.5+ edges at the opening line in 2024–2026 (47% in 2026), against 55.9% for the new Blend, and about 50% against 52.3% at the closing line. The live record was 17-30 on its 1.5+ edges. Most of the opening-line edge also disappears within hours of the open, so the job needs to see lines sooner. | Blend flags many more games (about 70% have a 1.5+ edge) and bigger edges did no better than smaller ones. Expect about 52% at late lines and up to 55% at true openers; no free data tested (Elo, SP+, talent, explosiveness) improved on that. Totals still default to Market-anchored. Logged picks are unchanged: Blend picks logged before this date averaged two ratings, and each projection keeps its own row in the log. |
| November 6, 2026 | **Starting QB listed out or doubtful:** a spread pick on a team whose usual starter is listed out or doubtful on an official availability report is labeled Check the news | In 2023–2026, a team whose starting quarterback sat after playing the week before covered 43% at the opening line (317 games), and Market-anchored's picks on such a team went 16-20. The opening line doesn't know yet, and only the reports can say before kickoff. | Labels only, and only for picks on that team; picks against it went 29-18 and keep their label. Statuses are entered by hand for Power 4 conference games, which covered 39% of these cases in 2023–2025. The pick log is unchanged; statuses are logged in data/live/qb_status_log.csv. |
| November 1, 2026 | **Market-anchored totals now follow the ratings:** total + 0.2 × (adjusted points total − total), replacing a regression on the final total | The regression chased the average score, which a few shootouts pull up, so it learned "low totals go over" and gave the ratings a weight of only 0.09. 96% of its 1.5+ edges were overs, and in 2026 they went 56-55. Over/unders are graded on which side of the number the game lands, and there the ratings carry the signal. | In 2024–2026, 1.5+ edges at the opening total went 56.2% (131-102) instead of 53.8%, on about 7 games a week instead of 15, with 64% overs instead of 96%. Graded at the closing total it's 52.5%, so the opening number matters. The 0.2 was chosen after looking at these seasons, so the backtest flatters it a little. Totals picks logged before this date used the old formula. |
| October 29, 2026 | **Check the news for QB changes, bowls and windy overs:** Lean and Go for it picks in those games are labeled Check the news instead | The model went 39% after quarterback changes in 2026 and 42–47% in non-playoff bowls in 2023–2025, and opening totals don't fully price wind. | Labels only: projections, edges and the forward-test log are unchanged. |
| October 29, 2026 | **Efficiency added:** a fifth projection from opponent-adjusted EPA per play, and **Blend** now averages FPI and Efficiency instead of FPI and adjusted points | Points are a noisy measure of how good a team is. EPA per play, with garbage time left out, measures every play. | In 2024–2026, the new Blend picked a little better than the old one (every game at the opening line: 54.4% vs 53.3%; at the closing line: 52.2% vs 50.1%) with the same accuracy. Market-anchored and the default are unchanged. Blend picks logged before this date used adjusted points. |
| October 29, 2026 | **Totals added:** over/under projections (Market-anchored total and Adjusted points total), backtested and recorded in the forward test | Totals are part of every game, and the forward test can only judge them if they're recorded before kickoff. | No change to spread picks. Totals tested at about break-even (52% at the opening total), so they're presented as untested, not as an edge. |
| October 25, 2026 | **Backtest correction:** opening lines that moved 7+ points before kickoff (look-ahead lines, 63 of 2,323 games) are excluded | They made the biggest edges look like big winners, but nobody could have bet them with that season's information. | Opening-line results drop to about 53–54% on 3+ point edges (FPI: 55.7% → 53.8%). Closing-line results barely change. |
| October 25, 2026 | 5+ point edges labeled **Check the news** instead of Go for it; Market-anchored retrained on the corrected data | On clean data, 5+ edges did no better than 3–5 point ones, and a gap that big usually means missing information. | Market-anchored leans more on the line (0.57 → 0.73) and less on FPI (0.39 → 0.21). Logged picks are unchanged. |
| October 25, 2026 | Home-field advantage raised from **2.5** to **3.0** points; Market-anchored retrained | Week 8's picks leaned heavily toward road teams while home teams went 23–14 against the spread. A 2023–2026 check found the projections underrated home teams slightly at 2.5 (FPI by 0.4 points on average); at 3.0 the bias goes away. | Small: every projection moved by less than one percentage point in the backtest (FPI at the opening line: 53.3% → 54.0%). Forward-test picks logged before this date used 2.5 and are unchanged. |

**To log a future change:** add an entry at the top of `site/data/changelog.json`. Every entry has a `date`, `type` and `title`, plus a `summary`:
- `type` is `model` (changes how picks are made), `feature`, `design`, `fix` or `data`.
- `model` entries also need `why`, `effect` and `forward_test` (what it means for the pick log). Add a row to the table above, and change the setting in one place: the constant in `model.py` (for example `HFA`).

The newest `model` entry shows as a notice on the Games tab for two weeks.

**Feedback:** the site's suggestion form uses the issue forms in `.github/ISSUE_TEMPLATE/` (`suggestion.yml` and `problem.yml`). Field `id`s in those forms are filled in from the link the site builds, so keep them in sync with `site/updates.js` if you edit them.

---

## Alerts

`alerts.py` runs in the GitHub job right after `record.py`, every two hours (every 30 minutes on Sundays). It uses the default projections: Blend for spreads (Market-anchored until November 10, 2026) and Market-anchored for totals. It looks for:

- **New edges:** a spread or over/under pick with an edge of 1.5+, logged when the line first appears. The model tested best at the opening number, so these are worth seeing early. Each one says the number to look for ("worth a bet at +2 or better at -110"); it's titled **New pick** rather than Go for it or Lean, since on the site those follow the best price at the moment, which an alert sent once can't.
- **Key numbers:** on a game with such a spread pick, the line moving through, onto or off 3 or 7, the most common winning margins.
- **Quarterback listed out:** a team's usual starter listed out or doubtful on an availability report ([QB availability](#qb-availability)), when there's such a spread pick on that team. The pick becomes Check the news.

Each run sends at most one notification, listing everything new. Alerts always go to the site's feed and the Alerts panel (🔔). Phone notifications and Discord are optional, and only the repo owner can turn them on:

| Where | Setup (one time) |
| --- | --- |
| **Any RSS reader** | Nothing: subscribe to `https://davischamann-alt.github.io/fourth-and-value/alerts.xml`. |
| **Phones (ntfy)** | Pick a topic name that's hard to guess, since anyone who knows it can subscribe (or post to it), then save it as a repository variable: `gh variable set NTFY_TOPIC -R davischamann-alt/fourth-and-value --body "your-topic-name"`. Then install the free [ntfy](https://ntfy.sh) app and subscribe to that topic. The Alerts panel shows the topic so visitors can subscribe too. |
| **Discord** | In your Discord server: **Server Settings → Integrations → Webhooks → New Webhook**, pick the channel, and copy its URL. Save it as a secret: `gh secret set DISCORD_WEBHOOK_URL -R davischamann-alt/fourth-and-value` and paste the URL when asked. |

`data/live/alerts.json` remembers what's been sent, so nothing is sent twice. The first run only records what's already on the board, rather than sending it all at once.

---

## Line shopping

`odds.py` runs in the GitHub job and asks [The Odds API](https://the-odds-api.com) for every US sportsbook's college football spreads and totals. For each upcoming game it keeps the **best number on offer for each side**, the middle (median) number, and how many books were quoted. On the site, a pick's box says when a better number than ESPN's is available, and each game page has a small Line shopping table. Half a point is worth about as much as the model's whole edge, so this matters more than any change to the ratings.

- **Sportsbooks aren't named**, on the site or in the saved files, because it hasn't been confirmed that the free plan allows showing them. Quotes priced worse than -125 are left out: a better number at a much worse price isn't a better bet. So are quotes more than 1.5 points from the middle of the rest: in November 2026, three games each had one book showing the mirror image of the consensus (the favorite as the underdog), which would have looked like 2 points of value.
- **It decides Go for it.** A pick's chance at the best number is its chance at ESPN's line plus about 3% for each point better (2.5% for totals), the backtest's value of a point of line; Go for it needs that chance to beat the price's break-even by a point. The model's own edge is small, worth about half a point to a point, so most Go for it picks come from a better price or number at one book. Quotes older than 12 hours don't count.
- **Budget:** the free plan allows 500 credits a month and each call costs 2. `odds.py` rations itself: every 30 minutes on Sundays from noon to 11 p.m. Eastern, when lines open and move fastest, and every 8 hours otherwise, about 370 credits a month. It stops when 20 credits are left.
- **History:** every time a game's numbers change, a row goes into `data/live/odds_history.csv` with the time. Unlike ESPN's single "opening line", that's a timestamped record of what could actually be bet, which is what a fair backtest needs.
- **Setup** (repo owner, one time): get a free key at the-odds-api.com and save it as a secret: `gh secret set ODDS_API_KEY -R davischamann-alt/fourth-and-value`. Without the key this step does nothing and the rest of the site is unaffected.

---

## QB availability

The Power 4 conferences (ACC, Big 12, Big Ten, SEC) publish official availability reports for conference games, starting about three days before kickoff with a final one about two hours before. They're shown through a third-party app with no public data feed (access has been requested), so quarterbacks are entered by hand in `data/qb_status.csv`:

```
date,team,player,status,source
2026-11-05,Team Name,Player Name,doubtful,https://link-to-the-report
```

- **date:** the report's date. A row applies to the team's next game within 8 days.
- **team:** as the site spells it (the job prints a warning in its log when a name doesn't match a game).
- **status:** `out`, `doubtful`, `questionable`, or `available` to clear an earlier row for that player. The last row for a player and game wins.
- **source:** a link to the report (optional; shown on the game page).

Saving the file on `main` (on GitHub, or with a push) runs the job right away. A usual starter (whoever led the most of the team's games in passing) listed **out** or **doubtful** turns picks on that team into **Check the news** and sends an alert; picks against it keep their label, since they did fine in testing. Questionable quarterbacks and backups are shown on the game page only. Every listing is logged with the time it was first seen in `data/live/qb_status_log.csv`, so the forward test can check these games later. This only covers the cases the backtest found mattered ([Missing players](#what-the-testing-found)); a points adjustment can come once the log has enough games.

---

## Publishing the website

The website is the `site/` folder, published free by GitHub Pages. The job in `.github/workflows/site.yml` runs every two hours, whenever the site's code changes on `main`, and when you click **Run workflow** on the repo's **Actions** tab. Each run records lines and picks ([The forward test](#the-forward-test)) and commits them, then runs `build_site.py` to refresh `site/data/` (ratings, Market-anchored weights, recommended std dev and track record), and publishes the site.

Each run also builds the QB watch and player props (`build_props.py`), sends alerts (`alerts.py`) and fetches kickoff forecasts (`weather.py`).

**Sundays.** Next week's lines open on Sunday afternoon and move within hours, so a second, lighter job (`.github/workflows/lines.yml`) runs every 30 minutes from noon to 11 p.m. Eastern. It only records lines and picks, checks the sportsbooks and sends alerts, then commits; it finishes in about a minute. It doesn't publish, so the website catches up at the next two-hourly run.

**One set of formulas.** The projection math is written twice: in `model.py` for the forward test and the backtest, and in `site/projections.js` for the website (the desktop app calls `model.py`). Before every publish, `check_parity.py` projects a few hundred matchups both ways from the site's own data files and stops the publish if any number differs by more than 0.01 points. If you change a formula, change both files; run `python check_parity.py` to check (it needs Node).

**Bowls, the playoff and the offseason.** Bowl and playoff results count toward the ratings, the forward test logs postseason games like any others, and conference championships are regular-season week 15. After the national championship, the Games tab says the season is over. On July 1 the site switches to the new season: until games are played, every team is rated by ESPN's FPI alone, the season that just ended joins the backtest automatically, and Market-anchored is retrained with it.

Because the job commits to `main` every two hours, your copy falls behind quickly. Run `git pull` before you change anything, or your push will be rejected.

**One-time setup** (repo owner only):

1. On GitHub, open the repo's **Settings → Pages**, and under **Build and deployment → Source**, choose **GitHub Actions**.
2. Optional, to keep the multi-season track record current and to get the Efficiency projection: in **Settings → Secrets and variables → Actions**, add a repository secret named `CFBD_API_KEY` containing your CollegeFootballData key. Without it, the job still refreshes the other ratings every day and leaves the track record as it was last built. With it, the job uses about 2 CollegeFootballData calls a day (the free plan allows 1,000 a month).
3. Optional: phone or Discord alerts ([Alerts](#alerts)).
4. Optional: line shopping ([Line shopping](#line-shopping)).

To preview the website on your own computer, run `python build_site.py` once, then `python -m http.server 8600 --directory site`, and open **http://localhost:8600**.

---

## Files

```
fourth-and-value/
├── app.py                    # the computer app: screens and buttons (Streamlit)
├── sources.py                # data downloads from ESPN and CollegeFootballData
├── model.py                  # the math: ratings, projections, cover chances, backtest scoring
├── build_site.py             # builds the website's data files
├── record.py                 # forward test: records lines and picks, grades them
├── alerts.py                 # alerts: new edges and key-number line moves, to the feed, ntfy and Discord
├── weather.py                # kickoff forecasts for this week's games (Open-Meteo), for wind flags on totals
├── odds.py                   # line shopping: the best spread and total across sportsbooks (The Odds API)
├── check_parity.py           # checks that the site's projection math matches model.py (run before every publish)
├── build_props.py            # player prop projections for the Props tab, the QB watch (ESPN box scores) and QB availability
├── site/                     # the website: index.html, style.css, app.js, game.js (game details), props.js (Props tab), ratings.js, updates.js (Updates tab), alerts.js (Alerts panel), alerts.xml (feed), data/ (changelog.json is the change log)
├── .github/ISSUE_TEMPLATE/   # GitHub issue forms behind the site's suggestion form
├── .github/workflows/site.yml # the two-hourly job: records picks, rebuilds the site's data, checks the math, publishes
├── .github/workflows/lines.yml # Sundays, every 30 minutes: records lines and picks and sends alerts, without rebuilding the site
├── requirements.txt          # Python libraries to install
├── .streamlit/secrets.toml   # your CollegeFootballData key (you create it; never uploaded)
└── data/
    ├── team_ratings.csv      # team ratings (Auto-fill or edit by hand)
    ├── lines.csv             # pregame lines the dashboard has saved
    ├── closing_lines.csv     # this season's opening and closing lines and totals (backtest)
    ├── anchor_weights.json   # Market-anchored weights for spreads and totals (saved by the backtest)
    ├── qb_status.csv         # quarterbacks listed on the official availability reports (you edit it; see QB availability)
    ├── live/                 # forward test: line_history.csv, picks.csv, total_picks.csv, qb_status_log.csv, best_lines.json and odds_history.csv (line shopping), and alerts.json (what's been sent); written by the GitHub job
    ├── history.csv           # your logged picks (created when you log; kept private)
    ├── bets.csv              # your bets (created when you save; kept private)
    └── cfbd/                 # past seasons' data (downloaded; kept private)
```

"Kept private" means the file is listed in `.gitignore`, so git won't upload it to GitHub.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `streamlit: command not found` or `No module named streamlit` | You're outside the environment. Run the `source venv/bin/activate` (Mac) or `venv\Scripts\activate` (Windows) line from [step 4](#4-start-the-dashboard-every-time) first. |
| `python3: command not found` (Mac) or `'py' is not recognized` (Windows) | Python isn't installed, or on Windows "Add python.exe to PATH" wasn't ticked. Reinstall it from [python.org](https://www.python.org/downloads/). |
| Browser didn't open | Go to **http://localhost:8501** yourself. |
| "Couldn't load scores" | Check your internet connection and click **Refresh now**. ESPN's feed sometimes has short outages. |
| No games listed | Check the **Date** in the sidebar. |
| A game has no pick | Read its **Note**. Usually a team name doesn't match the ratings table (run **Auto-fill**) or there's no line yet. |
| Market-anchored shows no picks | `data/anchor_weights.json` is missing. Run the season backtest with at least one finished season from 2023 on. |
| "Past seasons need a free API key" | Create `.streamlit/secrets.toml` as described in [Testing on past seasons](#testing-on-past-seasons), then click **Refresh now**. |
| Website shows old ratings | Check the repo's **Actions** tab for a failed "Update and publish site" run, then click **Run workflow** to retry. |
| Website picks or bets disappeared | They live in that browser's storage. Private/incognito windows and clearing site data erase them; download bets as CSV to keep a copy. |
| "CollegeFootballData rejected the API key" | Check that the key in `secrets.toml` is complete, with no extra spaces, and inside the quotes. |

---

## Limitations

- **Scores and ratings only.** The model doesn't know about injuries, suspensions or motivation. It labels picks **Check the news** for starting quarterbacks listed out on the official reports (entered by hand, Power 4 conference games only), bowl games and windy totals, and tags likely quarterback changes (from box scores), but otherwise it can't see who's actually playing.
- **Unofficial data.** ESPN's feeds aren't official and could change or go down without notice.
- **Lines differ by sportsbook.** The line each pick is made and graded against comes from one book per game (DraftKings when available). Line shopping shows the best number elsewhere, but it's checked at most every 30 minutes, so confirm it at the book.
- **Small samples mislead.** A few weeks of results can look great or terrible by luck alone. Judge by hundreds of picks and by line movement.
- **No guarantees.** A high cover percentage is still not a sure thing.

---

## Ideas for later

### First-half lines

A **Full game / 1st half** switch on the Games tab, with Full game selected by default. The 1st half view would show each game's first-half line, the model's first-half projection and pick, and grade picks at halftime, with live "covering now" status during the first half.

**What we found (October 28, 2026):**
- **No free source has first-half lines** for college football. ESPN's odds feed and game summaries carry full-game lines only, and CollegeFootballData has none.
- **ESPN does have quarter-by-quarter scores** for every game, so first-half results can be graded for free, live and after the game.
- **Full-game lines translate predictably:** across 344 games this season, the first-half margin averaged about **0.59 × the full-game line** (a 10-point favorite led by about 6 at halftime). First halves are steadier, with a typical miss of 10.5 points versus 14.1 for full games, and **8.4% of first halves were tied**, so whole-number first-half lines push often.

**Two ways to build it:**
1. **Free:** show an *estimated* first-half line (0.59 × the full-game line, clearly labeled as an estimate), and let visitors type their book's real first-half line on any card to replace it. Since the estimate comes from the full-game line, the estimated pick mostly echoes the full-game pick; the real value comes when visitors enter actual lines.
2. **Paid (about $30/month, The Odds API):** real first-half spreads from sportsbooks, fetched by the GitHub job like the ratings. This would also let first-half picks go into the forward test, and the same subscription could fill in real player prop lines on the Props tab. Check the service's terms on displaying odds publicly first.
