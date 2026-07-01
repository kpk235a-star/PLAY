// seed.js
// -----------------------------------------------------------------------------
// This fills the database with example data so the app has something to show.
//
//   • The server runs this automatically the first time, if the database is
//     empty (see the bottom of server.js).
//   • You can also reset to this demo data anytime with:  npm run seed
//
// Running it clears the existing tournaments/teams/matches first, so it always
// gives the same clean starting point.
// -----------------------------------------------------------------------------

const db = require('./db');

// Three example tournaments, each with a handful of teams and some played
// matches. Scores drive the standings (win = 3, draw = 1, loss = 0).
const DEMO = [
  {
    name: 'Summer Football Cup',
    sport: 'football',
    date: '2026-07-12',
    location: 'Riverside Park',
    teams: ['Red Lions', 'Blue Hawks', 'Green Foxes', 'Yellow Jackets'],
    // matches use the team's INDEX in the list above (0-based)
    matches: [
      [0, 1, 2, 1],
      [2, 3, 0, 0],
      [0, 2, 3, 1],
      [1, 3, 2, 2],
    ],
  },
  {
    name: 'City Basketball Showdown',
    sport: 'basketball',
    date: '2026-08-03',
    location: 'Downtown Arena',
    teams: ['Sky Dunkers', 'Court Kings', 'Net Rippers'],
    matches: [
      [0, 1, 78, 65],
      [1, 2, 88, 90],
      [0, 2, 70, 70],
    ],
  },
  {
    name: 'Open Tennis Classic',
    sport: 'tennis',
    date: '2026-09-01',
    location: 'Greenfield Courts',
    teams: ['Ace Squad', 'Top Spinners', 'Baseline Crew', 'Smash Bros'],
    matches: [
      [0, 1, 2, 0],
      [2, 3, 1, 2],
      [0, 3, 2, 1],
    ],
  },
];

function seedDatabase() {
  // Clear old data first (children before parents because of foreign keys).
  db.exec('DELETE FROM matches; DELETE FROM teams; DELETE FROM tournaments;');

  const insertTournament = db.prepare(
    'INSERT INTO tournaments (name, sport, date, location) VALUES (?, ?, ?, ?)'
  );
  const insertTeam = db.prepare(
    'INSERT INTO teams (name, tournament_id) VALUES (?, ?)'
  );
  const insertMatch = db.prepare(
    'INSERT INTO matches (tournament_id, team_a_id, team_b_id, score_a, score_b) VALUES (?, ?, ?, ?, ?)'
  );

  for (const t of DEMO) {
    const tournamentId = insertTournament.run(t.name, t.sport, t.date, t.location).lastInsertRowid;

    // Insert teams and remember their new database IDs, in order.
    const teamIds = t.teams.map((name) => insertTeam.run(name, tournamentId).lastInsertRowid);

    // Insert matches, translating the list-index into the real team ID.
    for (const [a, b, scoreA, scoreB] of t.matches) {
      insertMatch.run(tournamentId, teamIds[a], teamIds[b], scoreA, scoreB);
    }
  }

  console.log(`✅ Seeded ${DEMO.length} example tournaments.`);
}

// Let server.js call this, AND allow running this file directly with "npm run seed".
module.exports = { seedDatabase };

if (require.main === module) {
  seedDatabase();
}
