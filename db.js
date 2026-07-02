// db.js
// -----------------------------------------------------------------------------
// This file opens our database, makes sure the tables exist, and upgrades older
// databases to the current shape without losing any data.
//
// We use SQLite, which stores the ENTIRE database in a single file on disk
// (data.db, created automatically next to this file). Your data survives
// restarts — there's no separate database program to install or run.
// -----------------------------------------------------------------------------

const Database = require('better-sqlite3');
const path = require('path');

// Where the database file lives. Locally it's data.db in the project folder.
// On a host you can set DATABASE_PATH (e.g. to a mounted persistent disk on
// Render) so your data survives restarts and redeploys.
const dbFile = process.env.DATABASE_PATH || path.join(__dirname, 'data.db');
const db = new Database(dbFile);

// Enforce the links between tables (a match can't point to a missing team).
db.pragma('foreign_keys = ON');

// -----------------------------------------------------------------------------
// 1. The current schema. A brand-new database gets exactly this.
//    (For an existing database, CREATE ... IF NOT EXISTS does nothing here — the
//     migration in step 2 brings it up to date instead.)
//
//    Key idea: ALL games — group games, semifinals, and the final — live in the
//    one "matches" table, told apart by the "stage" column. A blank score means
//    "not played yet"; a blank team slot with a "source" code (like 'A1') means
//    "to be decided" (here, the 1st-placed team of Group A).
// -----------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS tournaments (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT    NOT NULL,
    sport    TEXT    NOT NULL,
    date     TEXT    NOT NULL,
    time     TEXT,                 -- optional kickoff time, e.g. '18:30'
    location TEXT    NOT NULL,
    format   TEXT                  -- 'round-robin' | 'one-group' | 'two-groups' (set when generated)
  );

  CREATE TABLE IF NOT EXISTS teams (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    tournament_id INTEGER NOT NULL,
    group_label   TEXT,             -- 'A' or 'B', assigned when the schedule is generated
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
  );

  CREATE TABLE IF NOT EXISTS matches (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    stage         TEXT    NOT NULL DEFAULT 'group',  -- 'group' | 'semi' | 'final'
    group_label   TEXT,             -- 'A'/'B' for group games; blank for knockout
    bracket_pos   INTEGER,          -- orders knockout games (semi 1, semi 2, final)
    team_a_id     INTEGER,          -- blank until known (knockout placeholders)
    team_b_id     INTEGER,
    source_a      TEXT,             -- knockout only: where team A comes from ('A1','B2','W1'...)
    source_b      TEXT,
    score_a       INTEGER,          -- blank = not played yet
    score_b       INTEGER,
    sort_order    INTEGER,          -- position in the fixture list (drag to reorder)
    photo_url     TEXT,             -- football match detail: Google Drive album link
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
    FOREIGN KEY (team_a_id)     REFERENCES teams(id),
    FOREIGN KEY (team_b_id)     REFERENCES teams(id)
  );

  -- Football only: each team's 5-player roster (1 keeper + 4 outfield). The
  -- position label comes from the slot number (0..4).
  CREATE TABLE IF NOT EXISTS players (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    slot    INTEGER NOT NULL,
    name    TEXT,                 -- editable; blank until entered
    photo   TEXT,                 -- optional avatar, stored as a small image data URL
    FOREIGN KEY (team_id) REFERENCES teams(id)
  );

  -- Football only: one row per goal scored in a match (the scoring team comes
  -- from the player). Goals disappear automatically if the match is regenerated.
  CREATE TABLE IF NOT EXISTS goals (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id  INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    minute    INTEGER,              -- the minute the goal was scored (optional)
    FOREIGN KEY (match_id)  REFERENCES matches(id)  ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players(id)  ON DELETE CASCADE
  );

  -- Football only: Man-of-the-Match votes. One vote per device (voter_token)
  -- per match, enforced by the UNIQUE rule. Votes clear if the match is regenerated.
  CREATE TABLE IF NOT EXISTS votes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id    INTEGER NOT NULL,
    player_id   INTEGER NOT NULL,
    voter_token TEXT    NOT NULL,
    UNIQUE (match_id, voter_token),
    FOREIGN KEY (match_id)  REFERENCES matches(id)  ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players(id)  ON DELETE CASCADE
  );

  -- Football only: a per-match player rating (1-10). One rating per player per
  -- match (UNIQUE), overwritten when changed.
  CREATE TABLE IF NOT EXISTS ratings (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id  INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    rating    INTEGER NOT NULL,
    UNIQUE (match_id, player_id),
    FOREIGN KEY (match_id)  REFERENCES matches(id)  ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players(id)  ON DELETE CASCADE
  );
`);

// -----------------------------------------------------------------------------
// 2. Migration: gently upgrade an older database made by a previous version.
// -----------------------------------------------------------------------------
function columnNames(table) {
  return db.pragma(`table_info(${table})`).map((c) => c.name);
}
function addColumnIfMissing(table, column, definition) {
  if (!columnNames(table).includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Adding new, always-optional columns is simple and safe.
addColumnIfMissing('tournaments', 'time', 'TEXT');
addColumnIfMissing('tournaments', 'format', 'TEXT');
addColumnIfMissing('teams', 'group_label', 'TEXT');

// The "matches" table is trickier: older versions marked team/score columns as
// REQUIRED, but we now need them blank for placeholders. SQLite can't relax that
// rule in place, so we do the standard safe rebuild: create the new table, copy
// existing rows in (as played group games), then swap names. No data is lost.
if (!columnNames('matches').includes('stage')) {
  db.pragma('foreign_keys = OFF'); // must be set outside a transaction
  const rebuildMatches = db.transaction(() => {
    db.exec(`
      CREATE TABLE matches_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        tournament_id INTEGER NOT NULL,
        stage         TEXT    NOT NULL DEFAULT 'group',
        group_label   TEXT,
        bracket_pos   INTEGER,
        team_a_id     INTEGER,
        team_b_id     INTEGER,
        source_a      TEXT,
        source_b      TEXT,
        score_a       INTEGER,
        score_b       INTEGER,
        FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
        FOREIGN KEY (team_a_id)     REFERENCES teams(id),
        FOREIGN KEY (team_b_id)     REFERENCES teams(id)
      );
      INSERT INTO matches_new (id, tournament_id, stage, team_a_id, team_b_id, score_a, score_b)
        SELECT id, tournament_id, 'group', team_a_id, team_b_id, score_a, score_b FROM matches;
      DROP TABLE matches;
      ALTER TABLE matches_new RENAME TO matches;
    `);
  });
  rebuildMatches();
  db.pragma('foreign_keys = ON');
  console.log('Upgraded the matches table to support brackets (existing data kept).');
}

// Fixture ordering: every match gets a sort position. Existing matches start in
// their original (id) order; newly generated schedules set this explicitly.
addColumnIfMissing('matches', 'sort_order', 'INTEGER');
db.prepare('UPDATE matches SET sort_order = id WHERE sort_order IS NULL').run();

// Football match detail: a place to store the photo album link.
addColumnIfMissing('matches', 'photo_url', 'TEXT');

// Goal minutes (added later): older goals rows won't have this column yet.
addColumnIfMissing('goals', 'minute', 'INTEGER');

// Player photos (added later): small avatar image stored as a data URL.
addColumnIfMissing('players', 'photo', 'TEXT');

// Hand this ready-to-use database connection to any file that needs it.
module.exports = db;
