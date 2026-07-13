# 🏆 TeamCup

A simple web app for amateur team-sport tournaments — think "Strava for amateur
team sports." You can **create tournaments, add teams, and automatically
generate the group + knockout schedule**, then enter scores and watch the
bracket advance to a champion.

Built with a beginner-friendly stack: **Node.js + Express** (server) and
**SQLite** (a database that lives in one file), with plain **HTML, CSS, and
JavaScript** for the pages — no build step, nothing to compile.

---

## What it does

- See a list of **tournaments** (name, sport, date, time, location).
- **Create a tournament** from a form — name, sport, date/time, a **location
  name** with an optional **Google Maps link** (the page shows just the name as
  a clickable link), and an optional **description** (rules, what to bring…)
  shown under the tournament details. Then **add teams** one at a time; you can
  **rename a team** anytime on the Manage-teams page.
- **Generate the schedule automatically** based on the number of teams:
  - **2–3 teams** → one group, round robin (no knockout — the table winner wins).
  - **4–5 teams** → one group, then semifinals (top 4: 1v4, 2v3) and a final.
  - **6+ teams** → two groups split evenly, then semifinals (top 2 of each:
    A1 v B2, B1 v A2) and a final.
- **Enter match scores** inline. You can also **drag fixtures** (or use ▲▼) to
  reorder them; the scheduler already spaces games so teams rest 1–2 matches.
  Standings update live, and the semifinals / final fill in automatically once
  the previous round is decided — ending in a 🏆 champion.
- **Football only:** click a match to open its **detail page**, which has a
  **visual pitch** (both teams in a 1‑2‑2 — tap a name to edit it, tap a circle
  to **add a player photo**) plus an editable **squad list** below it: the first
  5 are the starters (on the pitch), you can **add substitutes**, **drag** (or
  ▲▼) a player into the top 5 to put them on the field, and **rate each player
  1–10** (anyone with the link can rate — the app shows the average, and you can
  change your rating). It also has a **match timer**, an ordered **goal list**
  with scorer/team/**minute** (the score updates from the goals), **Man of the
  Match voting** (one vote per device, no login, leader highlighted — and you
  can change your vote), and a **Match Photos** link. The football tournament page also
  shows a **Top Scorers** ranking (top 5, expandable). Basketball and tennis
  don't have these yet.

- **Admin codes:** every new tournament gets a 6-character code, shown once at
  creation ("Save this code…"). Only someone who unlocked it (the **Admin**
  button on the tournament page; remembered per device) can enter or edit
  **scores and goals**, **regenerate the schedule**, **edit tournament
  details**, or **remove a team** — enforced by the server, not just hidden
  buttons. Everything else (viewing, registering teams + logos, player names,
  voting, ratings, photo links) stays open to anyone with the link. Tournaments
  created before this feature have no code and stay fully open.

Scoring for standings: **win = 3 points, draw = 1, loss = 0.** Standings are
calculated from the match results, never stored.

---

## Run it on your computer

### 1. Install Node.js (one time only)

1. Go to **https://nodejs.org**
2. Download the **LTS** version (the big green button).
3. Open the downloaded file and click through the installer (default options
   are fine).
4. **Close and reopen** your Terminal so it picks up the new install.

Check it worked by running:

```bash
node --version
```

### 2. Install the app's dependencies (one time)

In Terminal, go to this project folder and run:

```bash
cd "/Users/akoskristof/Desktop/Claude Code/team-sports"
npm install
```

This downloads Express and SQLite into a `node_modules` folder.

### 3. Start the app

```bash
npm start
```

You'll see:

```
  ✅ TeamCup is running!
     Open this in your browser:  http://localhost:3000
```

Open **http://localhost:3000** in your browser. The first time you run it, the
app automatically fills the database with 3 example tournaments so you see it
working right away. Click **＋ Create tournament** to build your own with a
bracket.

To **stop** the app, click the Terminal window and press **Control + C**.

---

## Handy commands

| Command | What it does |
|---|---|
| `npm start` | Start the web app at http://localhost:3000 |
| `npm run seed` | **Reset** the database back to the demo data (wipes current teams/matches) |

Your data is stored in the file **`data.db`**. Delete that file and restart to
begin from a completely empty database.

---

## How the project is organized

```
team-sports/
├── package.json        Project info + the npm commands
├── server.js           The web server: API, schedule generation, advancement
├── db.js               Opens the database, creates tables, upgrades old ones
├── seed.js             Fills the database with example data
├── data.db             The database file (created automatically)
├── public/             Everything the browser loads
│   ├── index.html        Home page (list of tournaments)
│   ├── create.html       Form to create a new tournament
│   ├── add-teams.html    Add teams, then generate the schedule
│   ├── tournament.html   One tournament (groups, standings, bracket, scores)
│   ├── match.html        Football match detail (lineups, goals, photo link)
│   ├── styles.css        The design
│   └── app.js            Browser code that loads data and draws the pages
└── README.md           This file
```

---

## The data model

- **tournaments** — `name`, `sport`, `date`, `time`, `location` (short name),
  `location_url` (optional Google Maps link shown behind the name),
  `description` (optional notes), `format`, `admin_code` (6-char creator code;
  sent as the `X-Admin-Code` header on protected requests and never included in
  any API response after creation; `NULL` on older tournaments = open)
- **teams** — `name`, `tournament_id`, `group_label` (`A`/`B`, set when the
  schedule is generated)
- **matches** — every game (group, semifinal, and final) lives here, told apart
  by `stage`. Group games have both teams; knockout games start blank with a
  `source_a` / `source_b` code (e.g. `A1` = "1st of Group A", `W1` = "winner of
  semifinal 1") and a blank score until played. Also carry `sort_order` (fixture
  order — drag to change) and, for football, a `photo_url`.
- **players** *(football only)* — a team's squad: `team_id`, `slot` (the order —
  the first 5 are the starters on the pitch, the rest are substitutes), `name`,
  `photo` (a small avatar image stored inline). Created the first time you open
  one of the team's matches; add more as substitutes.
- **goals** *(football only)* — one row per goal: `match_id`, `player_id`,
  `minute`. A football match's score is simply its goal count.
- **votes** *(football only)* — Man-of-the-Match votes: `match_id`, `player_id`,
  `voter_token`, with `UNIQUE(match_id, voter_token)` so each device votes once
  per match.
- **ratings** *(football only)* — player ratings as a public vote: `match_id`,
  `player_id`, `voter_token`, `rating` (1–10), with
  `UNIQUE(match_id, player_id, voter_token)`. The shown rating is the average
  across voters; each device can change its vote.

Standings are **not** stored — they're calculated from the played matches (see
`standingsFor` in `server.js`). Knockout teams are filled in by `resolveBracket`
as each round completes. `db.js` upgrades an older database to this shape
automatically, without losing data.

---

## Where to add features later (room to grow)

Added since the first version: **creating tournaments**, **adding teams on their
own page**, **automatic bracket generation**, and **entering scores**.

Still deliberately left out — here's where each would go:

- **User accounts / login** → a new `users` table + login routes in `server.js`,
  then protect actions like creating tournaments or entering scores.
- **Third-place play-off, byes, or custom seeding** → extend `generateSchedule`
  in `server.js` (the `source_a`/`source_b` code system already supports adding
  new knockout slots).
- **Players, photos, ratings/voting, goal-scorers** → a `players` table linked
  to `teams`, plus related tables (e.g. `votes`, `goals`).
- **Payments** → integrate a payment provider behind new routes; keep it
  separate from the tournament logic.

The API and database are structured so these slot in without rewrites.
