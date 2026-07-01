// server.js
// -----------------------------------------------------------------------------
// The web server. Two jobs:
//   1. Serve the web pages (the files in the "public" folder).
//   2. Provide a JSON "API" the pages call to load and save data.
//
// Start it with:  npm start   then open http://localhost:3000
// -----------------------------------------------------------------------------

const express = require('express');
const path = require('path');
const db = require('./db');
const { seedDatabase } = require('./seed');

const app = express();
// Use the port the hosting platform assigns (Render sets process.env.PORT),
// or fall back to 3000 when running locally.
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =============================================================================
// STANDINGS
// Standings aren't stored — we calculate them from played matches.
// Rule: win = 3 points, draw = 1, loss = 0. A match counts only once both
// scores are filled in.
// =============================================================================
function standingsFor(teams, matches) {
  const rows = {};
  for (const t of teams) {
    rows[t.id] = {
      teamId: t.id, name: t.name,
      played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0, points: 0,
    };
  }
  for (const m of matches) {
    if (m.score_a == null || m.score_b == null) continue; // not played yet
    const a = rows[m.team_a_id];
    const b = rows[m.team_b_id];
    if (!a || !b) continue;
    a.played++; b.played++;
    a.scored += m.score_a; a.conceded += m.score_b;
    b.scored += m.score_b; b.conceded += m.score_a;
    if (m.score_a > m.score_b) { a.wins++; a.points += 3; b.losses++; }
    else if (m.score_a < m.score_b) { b.wins++; b.points += 3; a.losses++; }
    else { a.draws++; b.draws++; a.points += 1; b.points += 1; }
  }
  return Object.values(rows).sort((x, y) =>
    y.points - x.points ||
    y.wins - x.wins ||
    (y.scored - y.conceded) - (x.scored - x.conceded) ||
    x.name.localeCompare(y.name)
  );
}

// =============================================================================
// SCHEDULE GENERATION
// Turns your rules into an actual set of matches.
// =============================================================================

// Which structure fits a given number of teams?
function formatForTeamCount(n) {
  if (n < 4) return 'round-robin';   // 2-3 teams: table only, no knockout
  if (n <= 5) return 'one-group';    // 4-5 teams: one group + top-4 knockout
  return 'two-groups';               // 6+ teams: two groups + top-2-each knockout
}

// --- Fixture scheduling ------------------------------------------------------
// Order a group's round-robin games so each team rests 1 or 2 matches between
// its games — never back-to-back (rest 0), never idle for 3+ (rest > 2). That's
// fully achievable for groups up to 5 teams; bigger groups hit a hard maths
// limit, so we get as close as possible (and you can drag games to fine-tune).

// Every pairing in a group (each team plays every other once).
function allPairs(ids) {
  const pairs = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) pairs.push([ids[i], ids[j]]);
  }
  return pairs;
}

// How "bad" an ordering is: playing again immediately (rest 0) or after a long
// wait (rest > 2) both add penalty. Lower is better; 0 is ideal.
function restPenalty(order) {
  const spotsByTeam = new Map();
  order.forEach(([a, b], i) => {
    if (!spotsByTeam.has(a)) spotsByTeam.set(a, []);
    if (!spotsByTeam.has(b)) spotsByTeam.set(b, []);
    spotsByTeam.get(a).push(i);
    spotsByTeam.get(b).push(i);
  });
  let penalty = 0;
  for (const spots of spotsByTeam.values()) {
    for (let i = 1; i < spots.length; i++) {
      const rest = spots[i] - spots[i - 1] - 1;
      if (rest === 0) penalty += 1000;                       // back-to-back
      else if (rest > 2) penalty += 1000 * (rest - 2) ** 2;  // rested too long
    }
  }
  return penalty;
}

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Greedy start: at each step play the pairing whose teams have waited longest,
// while avoiding a back-to-back with the previous game.
function greedyOrder(ids) {
  const pairs = allPairs(ids).map(([a, b]) => ({ a, b, used: false }));
  const lastPlayed = new Map(ids.map((t) => [t, -3]));
  const order = [];
  let prev = new Set();
  for (let pos = 0; pos < pairs.length; pos++) {
    let options = pairs.filter((p) => !p.used);
    const rested = options.filter((p) => !prev.has(p.a) && !prev.has(p.b));
    if (rested.length) options = rested;
    const wait = (p) => Math.max(pos - lastPlayed.get(p.a), pos - lastPlayed.get(p.b));
    options.sort((p, q) => wait(q) - wait(p));
    const chosen = options[0];
    chosen.used = true;
    order.push([chosen.a, chosen.b]);
    lastPlayed.set(chosen.a, pos);
    lastPlayed.set(chosen.b, pos);
    prev = new Set([chosen.a, chosen.b]);
  }
  return order;
}

// Produce a group's fixture order: try a few starting orders and improve each by
// keeping random swaps that don't make the rest worse (a simple "hill climb").
function scheduleGroup(ids) {
  if (ids.length <= 2) return allPairs(ids);
  const starts = [greedyOrder(ids), greedyOrder(ids), shuffled(allPairs(ids)), shuffled(allPairs(ids))];
  let best = null;
  let bestPenalty = Infinity;
  for (const start of starts) {
    const order = start.slice();
    let penalty = restPenalty(order);
    for (let iter = 0; iter < 5000 && penalty > 0; iter++) {
      const i = Math.floor(Math.random() * order.length);
      const j = Math.floor(Math.random() * order.length);
      if (i === j) continue;
      [order[i], order[j]] = [order[j], order[i]];
      const next = restPenalty(order);
      if (next <= penalty) penalty = next;
      else [order[i], order[j]] = [order[j], order[i]]; // undo the swap
    }
    if (penalty < bestPenalty) { bestPenalty = penalty; best = order.slice(); }
    if (bestPenalty === 0) break;
  }
  return best;
}

function generateSchedule(tournamentId) {
  const teams = db
    .prepare('SELECT id, name FROM teams WHERE tournament_id = ? ORDER BY id')
    .all(tournamentId);
  const n = teams.length;
  if (n < 2) throw new Error('Need at least 2 teams.');

  const format = formatForTeamCount(n);

  const insertGroupMatch = db.prepare(
    `INSERT INTO matches (tournament_id, stage, group_label, team_a_id, team_b_id, sort_order)
     VALUES (?, 'group', ?, ?, ?, ?)`
  );
  const insertKnockout = db.prepare(
    `INSERT INTO matches (tournament_id, stage, bracket_pos, source_a, source_b, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const setGroup = db.prepare('UPDATE teams SET group_label = ? WHERE id = ?');

  const build = db.transaction(() => {
    // Start clean so "Generate" can be run again safely.
    db.prepare('DELETE FROM matches WHERE tournament_id = ?').run(tournamentId);
    db.prepare('UPDATE teams SET group_label = NULL WHERE tournament_id = ?').run(tournamentId);

    // Split into groups. Two groups are split as evenly as possible, with the
    // slightly bigger group first (7 teams -> Group A: 4, Group B: 3).
    let groups;
    if (format === 'two-groups') {
      const aCount = Math.ceil(n / 2);
      groups = [['A', teams.slice(0, aCount)], ['B', teams.slice(aCount)]];
    } else {
      groups = [['A', teams]];
    }

    // Round robin inside each group, ordered so teams get rest between games.
    // sort_order records the fixture order (the user can drag to change it later).
    let sortOrder = 0;
    for (const [label, members] of groups) {
      for (const t of members) setGroup.run(label, t.id);
      for (const [aId, bId] of scheduleGroup(members.map((m) => m.id))) {
        insertGroupMatch.run(tournamentId, label, aId, bId, sortOrder++);
      }
    }

    // Knockout placeholders (created now, filled in once the group stage ends).
    if (format === 'one-group') {
      insertKnockout.run(tournamentId, 'semi', 1, 'A1', 'A4', sortOrder++); // 1st vs 4th
      insertKnockout.run(tournamentId, 'semi', 2, 'A2', 'A3', sortOrder++); // 2nd vs 3rd
      insertKnockout.run(tournamentId, 'final', 1, 'W1', 'W2', sortOrder++);
    } else if (format === 'two-groups') {
      insertKnockout.run(tournamentId, 'semi', 1, 'A1', 'B2', sortOrder++); // A-winner vs B-runner-up
      insertKnockout.run(tournamentId, 'semi', 2, 'B1', 'A2', sortOrder++); // B-winner vs A-runner-up
      insertKnockout.run(tournamentId, 'final', 1, 'W1', 'W2', sortOrder++);
    }

    db.prepare('UPDATE tournaments SET format = ? WHERE id = ?').run(format, tournamentId);
  });

  build();
  resolveBracket(tournamentId); // no-op unless results already exist
  return format;
}

// =============================================================================
// ADVANCEMENT
// After any score changes, fill in knockout teams whose stage is now decided.
// =============================================================================
function resolveBracket(tournamentId) {
  const t = db.prepare('SELECT format FROM tournaments WHERE id = ?').get(tournamentId);
  if (!t || !t.format || t.format === 'round-robin') return; // nothing to advance

  const teams = db
    .prepare('SELECT id, name, group_label FROM teams WHERE tournament_id = ?')
    .all(tournamentId);
  const groupMatches = db
    .prepare(`SELECT * FROM matches WHERE tournament_id = ? AND stage = 'group'`)
    .all(tournamentId);

  // Standings per group.
  const standingsByGroup = {};
  for (const label of new Set(teams.map((tm) => tm.group_label || 'A'))) {
    const gTeams = teams.filter((tm) => (tm.group_label || 'A') === label);
    const gMatches = groupMatches.filter((m) => (m.group_label || 'A') === label);
    standingsByGroup[label] = standingsFor(gTeams, gMatches);
  }

  const groupStageComplete =
    groupMatches.length > 0 && groupMatches.every((m) => m.score_a != null && m.score_b != null);

  // Translate a source code ('A1', 'B2', 'W1') into a real team id, or null if
  // that result isn't known yet.
  function resolveSource(code) {
    if (!code) return null;
    if (code[0] === 'W') {
      const pos = Number(code.slice(1));
      const semi = db
        .prepare(`SELECT * FROM matches WHERE tournament_id = ? AND stage = 'semi' AND bracket_pos = ?`)
        .get(tournamentId, pos);
      if (!semi || semi.team_a_id == null || semi.team_b_id == null) return null;
      if (semi.score_a == null || semi.score_b == null) return null;
      if (semi.score_a > semi.score_b) return semi.team_a_id;
      if (semi.score_b > semi.score_a) return semi.team_b_id;
      return null; // a knockout tie can't advance anyone
    }
    if (!groupStageComplete) return null;
    const standings = standingsByGroup[code[0]];
    const pos = Number(code.slice(1));
    return standings && standings[pos - 1] ? standings[pos - 1].teamId : null;
  }

  const updateTeams = db.prepare('UPDATE matches SET team_a_id = ?, team_b_id = ? WHERE id = ?');
  const advance = db.transaction(() => {
    // Semifinals first (they depend on the group stage)...
    for (const s of db.prepare(`SELECT * FROM matches WHERE tournament_id = ? AND stage = 'semi'`).all(tournamentId)) {
      updateTeams.run(resolveSource(s.source_a), resolveSource(s.source_b), s.id);
    }
    // ...then the final (it depends on the semifinals we just set).
    const final = db.prepare(`SELECT * FROM matches WHERE tournament_id = ? AND stage = 'final'`).get(tournamentId);
    if (final) updateTeams.run(resolveSource(final.source_a), resolveSource(final.source_b), final.id);
  });
  advance();
}

// =============================================================================
// BUILDING THE VIEW FOR ONE TOURNAMENT
// Shapes the data the tournament page needs: groups (each with standings +
// fixtures), the knockout bracket, and the champion (if decided).
// =============================================================================
const ORDINAL = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };

function sourceLabel(code, format) {
  if (!code) return 'TBD';
  if (code[0] === 'W') return code === 'W1' ? 'Winner of Semifinal 1' : 'Winner of Semifinal 2';
  const ord = ORDINAL[Number(code.slice(1))] || code.slice(1);
  return format === 'one-group' ? `${ord} place` : `${ord}, Group ${code[0]}`;
}

function getTournamentView(id) {
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
  if (!tournament) return null;

  const teams = db.prepare('SELECT id, name, group_label FROM teams WHERE tournament_id = ? ORDER BY id').all(id);
  const allMatches = db.prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY sort_order, id').all(id);
  const nameById = {};
  for (const t of teams) nameById[t.id] = t.name;

  const groupMatches = allMatches.filter((m) => m.stage === 'group');

  // Group a game/team by its label (older tournaments have none -> one group 'A').
  const labels = [...new Set(teams.map((t) => t.group_label).filter(Boolean))].sort();
  const groupLabels = labels.length ? labels : ['A'];
  const multipleGroups = groupLabels.length > 1;

  const groups = groupLabels.map((label) => {
    const gTeams = teams.filter((t) => (t.group_label || 'A') === label);
    const gMatches = groupMatches.filter((m) => (m.group_label || 'A') === label);
    return {
      label,
      title: multipleGroups ? `Group ${label}` : 'Standings',
      standings: standingsFor(gTeams, gMatches),
      matches: gMatches.map((m) => ({
        id: m.id,
        teamA: nameById[m.team_a_id], teamB: nameById[m.team_b_id],
        scoreA: m.score_a, scoreB: m.score_b,
        played: m.score_a != null && m.score_b != null,
        ready: true,
      })),
    };
  });

  // Knockout side: a real team name if known, otherwise a "to be decided" label.
  const side = (teamId, source) =>
    teamId != null ? nameById[teamId] : sourceLabel(source, tournament.format);

  function knockoutRow(m) {
    return {
      id: m.id,
      stage: m.stage,
      bracketPos: m.bracket_pos,
      teamA: side(m.team_a_id, m.source_a),
      teamB: side(m.team_b_id, m.source_b),
      scoreA: m.score_a, scoreB: m.score_b,
      ready: m.team_a_id != null && m.team_b_id != null, // both teams known -> playable
      played: m.score_a != null && m.score_b != null,
    };
  }

  const semis = allMatches.filter((m) => m.stage === 'semi').map(knockoutRow);
  const finalMatch = allMatches.find((m) => m.stage === 'final');
  const final = finalMatch ? knockoutRow(finalMatch) : null;
  const hasKnockout = semis.length > 0 || final != null;

  const groupStageComplete =
    groupMatches.length > 0 && groupMatches.every((m) => m.score_a != null && m.score_b != null);

  // Who won it all?
  let winner = null;
  if (hasKnockout) {
    if (finalMatch && finalMatch.team_a_id && finalMatch.team_b_id &&
        finalMatch.score_a != null && finalMatch.score_b != null &&
        finalMatch.score_a !== finalMatch.score_b) {
      const wid = finalMatch.score_a > finalMatch.score_b ? finalMatch.team_a_id : finalMatch.team_b_id;
      winner = { teamId: wid, name: nameById[wid] };
    }
  } else if (groupStageComplete && groups[0] && groups[0].standings.length) {
    winner = { teamId: groups[0].standings[0].teamId, name: groups[0].standings[0].name };
  }

  return {
    tournament: {
      id: tournament.id, name: tournament.name, sport: tournament.sport,
      date: tournament.date, time: tournament.time, location: tournament.location,
      format: tournament.format,
    },
    groups,
    knockout: hasKnockout ? { semis, final } : null,
    groupStageComplete,
    winner,
  };
}

// =============================================================================
// API ROUTES
// =============================================================================

// List all tournaments (for the home page).
app.get('/api/tournaments', (req, res) => {
  res.json(db.prepare('SELECT * FROM tournaments ORDER BY date ASC').all());
});

// Create a tournament. Body: { name, sport, date, time, location }.
app.post('/api/tournaments', (req, res) => {
  const name = (req.body.name || '').trim();
  const sport = (req.body.sport || '').trim();
  const date = (req.body.date || '').trim();
  const time = (req.body.time || '').trim();
  const location = (req.body.location || '').trim();

  if (!name || !sport || !date || !location) {
    return res.status(400).json({ error: 'Please fill in name, sport, date, and location.' });
  }
  const info = db
    .prepare('INSERT INTO tournaments (name, sport, date, time, location) VALUES (?, ?, ?, ?, ?)')
    .run(name, sport, date, time || null, location);
  res.status(201).json({ id: info.lastInsertRowid });
});

// Full details for one tournament (groups, knockout, winner).
app.get('/api/tournaments/:id', (req, res) => {
  const view = getTournamentView(Number(req.params.id));
  if (!view) return res.status(404).json({ error: 'Tournament not found' });
  res.json(view);
});

// The plain list of teams (used by the "add teams" page).
app.get('/api/tournaments/:id/teams', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM tournaments WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Tournament not found' });
  }
  res.json(db.prepare('SELECT id, name FROM teams WHERE tournament_id = ? ORDER BY id').all(id));
});

// Add a team to a tournament. Body: { name }.
app.post('/api/tournaments/:id/teams', (req, res) => {
  const id = Number(req.params.id);
  const name = (req.body.name || '').trim();
  if (!db.prepare('SELECT id FROM tournaments WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Tournament not found' });
  }
  if (!name) return res.status(400).json({ error: 'Please provide a team name.' });

  const info = db.prepare('INSERT INTO teams (name, tournament_id) VALUES (?, ?)').run(name, id);
  res.status(201).json({ id: info.lastInsertRowid, name, tournament_id: id });
});

// Generate (or regenerate) the whole schedule from the current teams.
app.post('/api/tournaments/:id/generate', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM tournaments WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Tournament not found' });
  }
  const n = db.prepare('SELECT COUNT(*) AS n FROM teams WHERE tournament_id = ?').get(id).n;
  if (n < 2) return res.status(400).json({ error: 'Add at least 2 teams before generating a schedule.' });

  const format = generateSchedule(id);
  res.json({ ok: true, format });
});

// Record a match result. Body: { scoreA, scoreB }.
app.post('/api/matches/:id/score', (req, res) => {
  const id = Number(req.params.id);
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (match.team_a_id == null || match.team_b_id == null) {
    return res.status(400).json({ error: 'This match is still waiting for its teams to be decided.' });
  }
  const a = Number(req.body.scoreA);
  const b = Number(req.body.scoreB);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
    return res.status(400).json({ error: 'Please enter two whole-number scores (0 or more).' });
  }

  db.prepare('UPDATE matches SET score_a = ?, score_b = ? WHERE id = ?').run(a, b, id);
  resolveBracket(match.tournament_id); // fill in the next round if it's now decided
  res.json({ ok: true });
});

// Reorder a group's fixtures (drag-and-drop). Body: { matchIds: [...] } listing
// that group's group-stage matches in their new order. We reshuffle only their
// own sort positions, so other groups and the knockout are untouched.
app.post('/api/tournaments/:id/reorder', (req, res) => {
  const id = Number(req.params.id);
  const matchIds = req.body.matchIds;
  if (!Array.isArray(matchIds) || matchIds.length === 0) {
    return res.status(400).json({ error: 'No matches to reorder.' });
  }
  const placeholders = matchIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT id, sort_order, stage, group_label, tournament_id FROM matches WHERE id IN (${placeholders})`)
    .all(...matchIds.map(Number));

  if (rows.length !== matchIds.length) {
    return res.status(400).json({ error: 'One or more matches were not found.' });
  }
  const sameGroup = rows.every(
    (r) => r.tournament_id === id && r.stage === 'group' && r.group_label === rows[0].group_label
  );
  if (!sameGroup) {
    return res.status(400).json({ error: 'You can only reorder the group games of one group.' });
  }

  // Keep the same set of positions, just assigned in the new order.
  const slots = rows.map((r) => r.sort_order).sort((x, y) => x - y);
  const update = db.prepare('UPDATE matches SET sort_order = ? WHERE id = ?');
  db.transaction(() => {
    matchIds.forEach((mid, i) => update.run(slots[i], Number(mid)));
  })();
  res.json({ ok: true });
});

// =============================================================================
// FOOTBALL MATCH DETAIL — lineups, goal scorers, and a photo link.
// These only apply to football tournaments; other sports are unaffected.
// =============================================================================

// The 5 lineup slots (1 keeper + 4 outfield). Labels come from the slot number.
const POSITIONS = ['Goalkeeper', 'Defender', 'Defender', 'Midfielder', 'Forward'];

// Make sure a team has its 5 player slots (created empty the first time).
function ensurePlayers(teamId) {
  let players = db.prepare('SELECT id, slot, name FROM players WHERE team_id = ? ORDER BY slot').all(teamId);
  if (players.length === 0) {
    const insert = db.prepare('INSERT INTO players (team_id, slot, name) VALUES (?, ?, NULL)');
    db.transaction(() => {
      for (let slot = 0; slot < POSITIONS.length; slot++) insert.run(teamId, slot);
    })();
    players = db.prepare('SELECT id, slot, name FROM players WHERE team_id = ? ORDER BY slot').all(teamId);
  }
  return players.map((p) => ({ id: p.id, slot: p.slot, name: p.name, position: POSITIONS[p.slot] || 'Player' }));
}

// A football match's score is the number of goals each side scored. Recompute it
// whenever goals change, then let the bracket advance if a stage just finished.
function recomputeScoreFromGoals(match) {
  const rows = db
    .prepare('SELECT p.team_id FROM goals g JOIN players p ON p.id = g.player_id WHERE g.match_id = ?')
    .all(match.id);
  let a = 0, b = 0;
  for (const r of rows) {
    if (r.team_id === match.team_a_id) a++;
    else if (r.team_id === match.team_b_id) b++;
  }
  db.prepare('UPDATE matches SET score_a = ?, score_b = ? WHERE id = ?').run(a, b, match.id);
  resolveBracket(match.tournament_id);
}

// Everything the match detail page needs. Football only.
app.get('/api/matches/:id/detail', (req, res) => {
  const id = Number(req.params.id);
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(match.tournament_id);
  if (!tournament || tournament.sport !== 'football') {
    return res.status(400).json({ error: 'Match details are only available for football tournaments.' });
  }
  if (match.team_a_id == null || match.team_b_id == null) {
    return res.status(400).json({ error: 'This match is still waiting for its teams to be decided.' });
  }

  const teamA = db.prepare('SELECT id, name FROM teams WHERE id = ?').get(match.team_a_id);
  const teamB = db.prepare('SELECT id, name FROM teams WHERE id = ?').get(match.team_b_id);
  const goals = db.prepare(`
    SELECT g.id, g.player_id AS playerId, p.name AS playerName, p.slot AS playerSlot, p.team_id AS teamId
    FROM goals g JOIN players p ON p.id = g.player_id
    WHERE g.match_id = ?
    ORDER BY g.id
  `).all(id);

  res.json({
    match: { id: match.id, scoreA: match.score_a, scoreB: match.score_b, photoUrl: match.photo_url },
    tournament: { id: tournament.id, name: tournament.name, date: tournament.date, time: tournament.time },
    teamA: { id: teamA.id, name: teamA.name, players: ensurePlayers(teamA.id) },
    teamB: { id: teamB.id, name: teamB.name, players: ensurePlayers(teamB.id) },
    goals,
  });
});

// Rename a player. Body: { name }.
app.put('/api/players/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM players WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Player not found' });
  }
  const name = (req.body.name || '').trim();
  db.prepare('UPDATE players SET name = ? WHERE id = ?').run(name || null, id);
  res.json({ ok: true, id, name });
});

// Add a goal for a player. Body: { playerId }.
app.post('/api/matches/:id/goals', (req, res) => {
  const id = Number(req.params.id);
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const player = db.prepare('SELECT id, team_id FROM players WHERE id = ?').get(Number(req.body.playerId));
  if (!player) return res.status(400).json({ error: 'Unknown player.' });
  if (player.team_id !== match.team_a_id && player.team_id !== match.team_b_id) {
    return res.status(400).json({ error: 'That player is not in this match.' });
  }
  const info = db.prepare('INSERT INTO goals (match_id, player_id) VALUES (?, ?)').run(id, player.id);
  recomputeScoreFromGoals(match);
  res.status(201).json({ ok: true, goalId: info.lastInsertRowid });
});

// Remove a goal.
app.delete('/api/goals/:goalId', (req, res) => {
  const goalId = Number(req.params.goalId);
  const goal = db.prepare('SELECT id, match_id FROM goals WHERE id = ?').get(goalId);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(goal.match_id);
  db.prepare('DELETE FROM goals WHERE id = ?').run(goalId);
  if (match) recomputeScoreFromGoals(match);
  res.json({ ok: true });
});

// Save (or clear) the Google Drive photo album link. Body: { url }.
app.post('/api/matches/:id/photo', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM matches WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Match not found' });
  }
  const url = (req.body.url || '').trim();
  if (url && !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Please paste a full link starting with http:// or https://.' });
  }
  db.prepare('UPDATE matches SET photo_url = ? WHERE id = ?').run(url || null, id);
  res.json({ ok: true, photoUrl: url || null });
});

// =============================================================================
// START THE SERVER
// =============================================================================
const tournamentCount = db.prepare('SELECT COUNT(*) AS n FROM tournaments').get().n;
if (tournamentCount === 0) {
  console.log('No data yet — adding example tournaments...');
  seedDatabase();
}

app.listen(PORT, () => {
  console.log('\n  ✅ TeamCup is running!');
  console.log(`     Open this in your browser:  http://localhost:${PORT}\n`);
  console.log('     (Press Control + C in this window to stop the app.)\n');
});
