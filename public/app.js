// app.js
// -----------------------------------------------------------------------------
// Runs in the visitor's browser. It asks the server's API for data and builds
// the HTML for each page. Which page we're on is set by <body data-page="...">.
// -----------------------------------------------------------------------------

// A friendly emoji + label for each sport.
const SPORTS = {
  football:   { emoji: '⚽', label: 'Football' },
  basketball: { emoji: '🏀', label: 'Basketball' },
  tennis:     { emoji: '🎾', label: 'Tennis' },
  volleyball: { emoji: '🏐', label: 'Volleyball' },
  hockey:     { emoji: '🏑', label: 'Hockey' },
  other:      { emoji: '🏅', label: 'Other' },
};
const sportOf = (key) => SPORTS[key] || { emoji: '🏅', label: key };

// '2026-07-12' -> 'Jul 12, 2026'
function formatDate(isoDate) {
  const d = new Date(isoDate + 'T00:00:00');
  if (isNaN(d)) return isoDate;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
// '18:30' -> '6:30 PM'
function formatTime(t) {
  if (!t) return '';
  const d = new Date('1970-01-01T' + t);
  if (isNaN(d)) return t;
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
// Safely put user text into the page.
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : text;
  return div.innerHTML;
}
// Read a value from the web address, e.g. ?id=2 -> "2".
function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}
// A little line summarising the tournament's date/time/place.
function whenWhere(t) {
  const time = t.time ? ' · ' + formatTime(t.time) : '';
  return `📅 ${formatDate(t.date)}${time} · 📍 ${escapeHtml(t.location)}`;
}

// =============================================================================
// HOME PAGE — list of tournaments as cards
// =============================================================================
async function loadHomePage() {
  const listEl = document.getElementById('tournament-list');
  try {
    const tournaments = await fetch('/api/tournaments').then((r) => r.json());
    if (tournaments.length === 0) {
      listEl.innerHTML = '<p class="empty">No tournaments yet. Create the first one!</p>';
      return;
    }
    listEl.innerHTML = tournaments.map((t) => {
      const s = sportOf(t.sport);
      return `
        <a class="card" href="/tournament.html?id=${t.id}">
          <span class="badge badge-${t.sport}">${s.emoji} ${s.label}</span>
          <h3>${escapeHtml(t.name)}</h3>
          <p class="card-meta">📅 ${formatDate(t.date)}${t.time ? ' · ' + formatTime(t.time) : ''}</p>
          <p class="card-meta">📍 ${escapeHtml(t.location)}</p>
        </a>`;
    }).join('');
  } catch (err) {
    listEl.innerHTML = '<p class="empty">Could not load tournaments. Is the server running?</p>';
  }
}

// =============================================================================
// CREATE PAGE — the new-tournament form
// =============================================================================
function loadCreatePage() {
  const form = document.getElementById('create-form');
  const msg = document.getElementById('form-message');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    msg.textContent = 'Creating…';
    try {
      const res = await fetch('/api/tournaments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not create the tournament.');
      // Straight on to adding teams.
      window.location.href = '/add-teams.html?id=' + body.id;
    } catch (err) {
      msg.textContent = err.message;
    }
  });
}

// =============================================================================
// ADD-TEAMS PAGE — add teams one at a time, then generate the schedule
// =============================================================================
async function loadAddTeamsPage() {
  const id = getQueryParam('id');
  const headerEl = document.getElementById('at-header');
  const listEl = document.getElementById('team-list');
  const hintEl = document.getElementById('format-hint');
  const regenEl = document.getElementById('regenerate-note');
  const btn = document.getElementById('generate-btn');
  let alreadyGenerated = false;

  // Load the tournament header (and whether a schedule already exists).
  try {
    const view = await fetch('/api/tournaments/' + id).then((r) => r.json());
    const t = view.tournament;
    const s = sportOf(t.sport);
    alreadyGenerated = !!t.format;
    headerEl.innerHTML = `
      <span class="badge badge-${t.sport}">${s.emoji} ${s.label}</span>
      <h1>${escapeHtml(t.name)}</h1>
      <p class="card-meta">${whenWhere(t)}</p>`;
  } catch (err) {
    headerEl.innerHTML = '<p class="empty">Could not load this tournament.</p>';
  }

  function updateHint(n) {
    let text;
    btn.disabled = n < 2;
    if (n < 2) text = `Add at least 2 teams to generate a schedule. (${n} so far.)`;
    else if (n < 4) text = `${n} teams → one group, round robin. No knockout — the table winner is the champion.`;
    else if (n <= 5) text = `${n} teams → one group (round robin), then semifinals (top 4) and a final.`;
    else text = `${n} teams → two groups (${Math.ceil(n / 2)} + ${Math.floor(n / 2)}), round robin, then semifinals (top 2 of each) and a final.`;
    hintEl.textContent = text;
    regenEl.textContent = alreadyGenerated
      ? 'This tournament already has a schedule — generating again rebuilds it and clears any scores.'
      : '';
  }

  async function loadTeams() {
    const teams = await fetch('/api/tournaments/' + id + '/teams').then((r) => r.json());
    listEl.innerHTML = teams.length
      ? teams.map((t) => `<li>${escapeHtml(t.name)}</li>`).join('')
      : '<li class="empty">No teams yet — add your first below.</li>';
    updateHint(teams.length);
  }
  await loadTeams();

  // Add a team.
  document.getElementById('add-team-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('team-name');
    const msg = document.getElementById('form-message');
    const name = input.value.trim();
    if (!name) return;
    try {
      const res = await fetch('/api/tournaments/' + id + '/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error('failed');
      input.value = '';
      msg.textContent = `Added “${name}”.`;
      await loadTeams();
      input.focus();
    } catch (err) {
      msg.textContent = 'Could not add that team.';
    }
  });

  // Generate the schedule and go to the tournament page.
  btn.addEventListener('click', async () => {
    const msg = document.getElementById('form-message');
    try {
      const res = await fetch('/api/tournaments/' + id + '/generate', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not generate the schedule.');
      window.location.href = '/tournament.html?id=' + id;
    } catch (err) {
      msg.textContent = err.message;
    }
  });
}

// =============================================================================
// TOURNAMENT PAGE — groups, knockout bracket, champion, and score entry
// =============================================================================
let tView = null;                     // the most recently loaded tournament data
const editingMatches = new Set();     // ids of matches currently being edited

async function loadTournamentPage() {
  await reloadTournament();
  // One set of listeners on the container handles every match (event delegation).
  const content = document.getElementById('content');
  content.addEventListener('submit', onScoreSubmit);
  content.addEventListener('click', onContentClick);
  // Drag-to-reorder for group fixtures. The handle turns on dragging so the score
  // inputs elsewhere on the card still work normally.
  content.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (handle) handle.closest('.match').setAttribute('draggable', 'true');
  });
  content.addEventListener('dragstart', onDragStart);
  content.addEventListener('dragover', onDragOver);
  content.addEventListener('drop', (e) => e.preventDefault());
  content.addEventListener('dragend', onDragEnd);
}

async function reloadTournament() {
  const id = getQueryParam('id');
  try {
    const res = await fetch('/api/tournaments/' + id);
    if (!res.ok) throw new Error('not found');
    tView = await res.json();
    renderTournamentPage();
  } catch (err) {
    document.getElementById('tournament-header').innerHTML =
      '<p class="empty">Could not load this tournament.</p>';
  }
}

function formatDescription(format) {
  if (format === 'round-robin') return 'Round robin';
  if (format === 'one-group') return 'One group + knockout';
  if (format === 'two-groups') return 'Two groups + knockout';
  return '';
}

function renderTournamentPage() {
  const { tournament, groups, knockout, winner } = tView;
  const s = sportOf(tournament.sport);
  const football = tournament.sport === 'football'; // only football matches are clickable

  // Header
  const formatText = formatDescription(tournament.format);
  document.getElementById('tournament-header').innerHTML = `
    <span class="badge badge-${tournament.sport}">${s.emoji} ${s.label}</span>
    <h1>${escapeHtml(tournament.name)}</h1>
    <p class="card-meta">${whenWhere(tournament)}</p>
    <p class="format-line">${formatText ? escapeHtml(formatText) + ' · ' : ''}<a href="/add-teams.html?id=${tournament.id}">Manage teams / regenerate</a></p>`;

  // Champion banner
  document.getElementById('champion').innerHTML = winner
    ? `<div class="champion-banner">🏆 Champion: <strong>${escapeHtml(winner.name)}</strong></div>`
    : '';

  // Body
  const hasAnyMatches = groups.some((g) => g.matches.length) || !!knockout;
  let html = '';

  if (!hasAnyMatches) {
    html += `<div class="notice">No schedule yet. <a href="/add-teams.html?id=${tournament.id}">Add teams and generate the schedule →</a></div>`;
  }

  // Groups: each has a standings table and its (drag-reorderable) fixtures.
  for (const g of groups) {
    html += `<section class="group-block"><h2>${escapeHtml(g.title)}</h2>`;
    html += standingsTableHtml(g.standings);
    if (g.matches.length) {
      html += `<h3 class="fixtures-heading">Fixtures <span class="reorder-hint">— drag <span aria-hidden="true">⠿</span> or use ▲▼ to reorder</span></h3>`;
      html += `<div class="fixtures-list" data-group="${escapeHtml(g.label)}">` +
        g.matches.map((m) => matchCardHtml(m, false, true, football)).join('') + `</div>`;
    }
    html += `</section>`;
  }

  // Knockout stage (not reorderable — its order is fixed by the bracket).
  if (knockout) {
    html += `<section class="ko-block"><h2>Knockout stage</h2>`;
    html += `<h3 class="fixtures-heading">Semifinals</h3>`;
    html += knockout.semis.map((m) => matchCardHtml(m, true, false, football)).join('');
    if (knockout.final) {
      html += `<h3 class="fixtures-heading">Final</h3>`;
      html += matchCardHtml(knockout.final, true, false, football);
    }
    html += `</section>`;
  }

  document.getElementById('content').innerHTML = html;
}

function standingsTableHtml(standings) {
  if (!standings.length) return '<p class="empty">No teams yet.</p>';
  // Goal difference, shown with a sign: +3, 0, -2.
  const gd = (r) => { const d = r.scored - r.conceded; return d > 0 ? '+' + d : String(d); };
  return `
    <table class="table">
      <thead><tr>
        <th class="rank">#</th><th>Team</th>
        <th title="Played">P</th><th title="Wins">W</th><th title="Draws">D</th><th title="Losses">L</th>
        <th title="Goal difference">GD</th><th title="Points">Pts</th>
      </tr></thead>
      <tbody>
        ${standings.map((r, i) => `
          <tr>
            <td class="rank">${i + 1}</td>
            <td>${escapeHtml(r.name)}</td>
            <td>${r.played}</td><td>${r.wins}</td><td>${r.draws}</td><td>${r.losses}</td>
            <td>${gd(r)}</td><td class="points">${r.points}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// One match card. isKnockout controls the "can't end level" hint; reorderable
// adds a drag handle + up/down buttons (used for group fixtures).
function matchCardHtml(m, isKnockout, reorderable, football) {
  const editing = editingMatches.has(m.id);
  const aWon = m.played && m.scoreA > m.scoreB;
  const bWon = m.played && m.scoreB > m.scoreA;
  // Football matches with known teams link to their own detail page.
  const detailLink = football && m.ready;
  const teamName = (name, side, extra) => {
    const cls = `match-team ${side}${extra}`;
    return detailLink
      ? `<a class="${cls} match-team-link" href="/match.html?id=${m.id}">${escapeHtml(name)}</a>`
      : `<span class="${cls}">${escapeHtml(name)}</span>`;
  };

  let middle, actions;
  if (!m.ready) {
    // Teams not decided yet.
    middle = `<span class="match-score tbd">vs</span>`;
    actions = `<span class="match-note">Waiting for the previous round</span>`;
  } else if (m.played && !editing) {
    // Show the result with an edit option.
    middle = `<span class="match-score">${m.scoreA} – ${m.scoreB}</span>`;
    const drawWarn = isKnockout && m.scoreA === m.scoreB
      ? `<span class="match-note warn">Knockout can't end level — edit to a decisive score.</span>` : '';
    actions = `${drawWarn}<button type="button" class="btn-link edit-score" data-id="${m.id}">Edit result</button>`;
  } else {
    // Entry mode: two number boxes + Save (+ Cancel when editing a played game).
    const a = m.scoreA == null ? '' : m.scoreA;
    const b = m.scoreB == null ? '' : m.scoreB;
    middle = `
      <span class="score-entry">
        <input class="score-input" type="number" min="0" inputmode="numeric" name="a" value="${a}" aria-label="${escapeHtml(m.teamA)} score" />
        <span class="score-dash">–</span>
        <input class="score-input" type="number" min="0" inputmode="numeric" name="b" value="${b}" aria-label="${escapeHtml(m.teamB)} score" />
      </span>`;
    actions = `<button type="submit" class="btn-small">Save</button>` +
      (m.played ? ` <button type="button" class="btn-link cancel-edit" data-id="${m.id}">Cancel</button>` : '');
  }

  const body = `
    <div class="match-body">
      <div class="match-row">
        ${teamName(m.teamA, 'team-a', `${aWon ? ' winner' : ''}${m.ready ? '' : ' muted'}`)}
        <span class="match-mid">${middle}</span>
        ${teamName(m.teamB, 'team-b', `${bWon ? ' winner' : ''}${m.ready ? '' : ' muted'}`)}
      </div>
      <div class="match-actions">${actions}</div>
    </div>`;

  // Reorder controls (group fixtures only): a drag handle and up/down buttons.
  const handle = reorderable
    ? `<span class="drag-handle" title="Drag to reorder" aria-hidden="true">⠿</span>` : '';
  const controls = reorderable
    ? `<div class="reorder-controls">
         <button type="button" class="move-up" data-id="${m.id}" aria-label="Move up" title="Move up">▲</button>
         <button type="button" class="move-down" data-id="${m.id}" aria-label="Move down" title="Move down">▼</button>
       </div>` : '';

  const cls = `match${m.ready ? '' : ' tbd'}${reorderable ? ' reorderable' : ''}`;
  const inner = handle + body + controls;
  // Editable matches are wrapped in a <form> so "Save" submits.
  const isEntry = m.ready && (!m.played || editing);
  return isEntry
    ? `<form class="${cls}" data-id="${m.id}">${inner}</form>`
    : `<div class="${cls}" data-id="${m.id}">${inner}</div>`;
}

// Save a score.
async function onScoreSubmit(event) {
  const form = event.target.closest('form.match');
  if (!form) return;
  event.preventDefault();
  const id = Number(form.dataset.id);
  const a = form.querySelector('input[name="a"]').value.trim();
  const b = form.querySelector('input[name="b"]').value.trim();
  const actions = form.querySelector('.match-actions');

  if (a === '' || b === '') {
    actions.insertAdjacentHTML('beforeend', '<span class="match-note warn"> Enter both scores.</span>');
    return;
  }
  try {
    const res = await fetch('/api/matches/' + id + '/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scoreA: Number(a), scoreB: Number(b) }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not save.');
    editingMatches.delete(id);
    await reloadTournament();     // re-fetch so standings and the bracket update
  } catch (err) {
    actions.insertAdjacentHTML('beforeend', `<span class="match-note warn"> ${escapeHtml(err.message)}</span>`);
  }
}

// Handle "Edit result" / "Cancel" and the up/down reorder buttons.
function onContentClick(event) {
  const edit = event.target.closest('.edit-score');
  if (edit) { editingMatches.add(Number(edit.dataset.id)); renderTournamentPage(); return; }
  const cancel = event.target.closest('.cancel-edit');
  if (cancel) { editingMatches.delete(Number(cancel.dataset.id)); renderTournamentPage(); return; }
  const up = event.target.closest('.move-up');
  if (up) { moveCard(up.closest('.match'), -1); return; }
  const down = event.target.closest('.move-down');
  if (down) { moveCard(down.closest('.match'), 1); return; }
}

// ----- Reordering fixtures (drag-and-drop + up/down buttons) -----
let draggingCard = null;

function onDragStart(event) {
  const card = event.target.closest('.match.reorderable');
  if (!card) return;
  draggingCard = card;
  card.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  try { event.dataTransfer.setData('text/plain', card.dataset.id); } catch (_) {}
}

function onDragOver(event) {
  if (!draggingCard) return;
  const list = event.target.closest('.fixtures-list');
  if (!list || list !== draggingCard.parentElement) return; // stay within the same group
  event.preventDefault();
  const after = cardAfterCursor(list, event.clientY);
  if (after == null) list.appendChild(draggingCard);
  else list.insertBefore(draggingCard, after);
}

// Which card should the dragged one go *before*, given the cursor's Y position?
function cardAfterCursor(list, y) {
  const cards = [...list.querySelectorAll('.match.reorderable:not(.dragging)')];
  let closest = null, closestOffset = -Infinity;
  for (const card of cards) {
    const box = card.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closestOffset) { closestOffset = offset; closest = card; }
  }
  return closest;
}

async function onDragEnd() {
  if (!draggingCard) return;
  const list = draggingCard.parentElement;
  draggingCard.classList.remove('dragging');
  draggingCard.setAttribute('draggable', 'false');
  draggingCard = null;
  if (list && list.classList.contains('fixtures-list')) await persistOrder(list);
}

// Move a card one slot up (-1) or down (+1) via the buttons.
async function moveCard(card, direction) {
  if (!card) return;
  const list = card.parentElement;
  if (direction < 0 && card.previousElementSibling) {
    list.insertBefore(card, card.previousElementSibling);
  } else if (direction > 0 && card.nextElementSibling) {
    list.insertBefore(card.nextElementSibling, card);
  } else {
    return; // already at the top/bottom
  }
  await persistOrder(list);
}

// Save the current order of a fixtures list to the server, then re-render.
async function persistOrder(list) {
  const id = getQueryParam('id');
  const matchIds = [...list.querySelectorAll('.match')].map((el) => Number(el.dataset.id));
  try {
    const res = await fetch('/api/tournaments/' + id + '/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchIds }),
    });
    if (!res.ok) throw new Error('reorder failed');
  } catch (err) {
    /* fall through — the reload below restores the server's order */
  }
  await reloadTournament();
}

// =============================================================================
// MATCH DETAIL PAGE (football only) — lineups, goal scorers, photo link
// =============================================================================
const POSITIONS = ['Goalkeeper', 'Defender', 'Defender', 'Midfielder', 'Forward'];
let matchDetail = null;

async function loadMatchPage() {
  const el = document.getElementById('match-detail');
  // Delegated listeners live on the container, which survives re-renders.
  el.addEventListener('click', onMatchClick);
  el.addEventListener('submit', onPhotoSubmit);
  el.addEventListener('focusout', (e) => {
    if (e.target.classList.contains('player-name')) savePlayerName(e.target);
  });
  el.addEventListener('keydown', (e) => {
    if (e.target.classList.contains('player-name') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });
  await reloadMatch(getQueryParam('id'));
}

async function reloadMatch(id) {
  const el = document.getElementById('match-detail');
  try {
    const res = await fetch('/api/matches/' + id + '/detail');
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not load this match.');
    matchDetail = body;
    renderMatchDetail();
  } catch (err) {
    el.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
  }
}

function renderMatchDetail() {
  const { match, tournament, teamA, teamB } = matchDetail;
  const back = document.getElementById('back-link');
  back.href = '/tournament.html?id=' + tournament.id;
  back.textContent = '← Back to ' + tournament.name;

  const scoreA = match.scoreA == null ? 0 : match.scoreA;
  const scoreB = match.scoreB == null ? 0 : match.scoreB;

  document.getElementById('match-detail').innerHTML = `
    <div class="match-detail-header">
      <span class="badge badge-football">⚽ Football</span>
      <div class="md-scoreline">
        <span class="md-team">${escapeHtml(teamA.name)}</span>
        <span class="md-score">${scoreA} – ${scoreB}</span>
        <span class="md-team">${escapeHtml(teamB.name)}</span>
      </div>
      <p class="card-meta">${escapeHtml(tournament.name)} · 📅 ${formatDate(tournament.date)}${tournament.time ? ' · ' + formatTime(tournament.time) : ''}</p>
    </div>

    <h2>Lineups</h2>
    <div class="md-columns">${lineupHtml(teamA)}${lineupHtml(teamB)}</div>

    <h2>Goals</h2>
    <div id="goals-area" class="md-columns"></div>

    <h2>Match Photos</h2>
    ${photoHtml(match)}
  `;
  renderGoalsArea();
}

function lineupHtml(team) {
  return `
    <div class="md-col">
      <h3 class="md-col-title">${escapeHtml(team.name)}</h3>
      <div class="lineup">
        ${team.players.map((p) => `
          <label class="player-slot">
            <span class="player-pos">${p.position}</span>
            <input class="player-name" type="text" data-player="${p.id}" value="${escapeHtml(p.name || '')}" placeholder="Add name" autocomplete="off" />
          </label>`).join('')}
      </div>
    </div>`;
}

// Rebuild just the goals section (used after a name change so the scorer
// dropdowns refresh without disturbing the lineup inputs you're editing).
function renderGoalsArea() {
  const area = document.getElementById('goals-area');
  if (!area) return;
  const { teamA, teamB, goals } = matchDetail;
  area.innerHTML =
    goalColumnHtml(teamA, goals.filter((g) => g.teamId === teamA.id)) +
    goalColumnHtml(teamB, goals.filter((g) => g.teamId === teamB.id));
}

function goalColumnHtml(team, teamGoals) {
  const named = team.players.filter((p) => p.name && p.name.trim());
  const adder = named.length
    ? `<div class="goal-adder">
         <select class="goal-select" data-team="${team.id}" aria-label="Scorer for ${escapeHtml(team.name)}">
           ${named.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} · ${p.position}</option>`).join('')}
         </select>
         <button type="button" class="btn-small add-goal" data-team="${team.id}">+ Goal</button>
       </div>`
    : `<p class="hint-small">Add player names above to record goal scorers.</p>`;
  const list = teamGoals.length
    ? `<ul class="goal-list">${teamGoals.map((g) => `
         <li>
           <span class="goal-scorer">⚽ ${escapeHtml(g.playerName || POSITIONS[g.playerSlot] || 'Player')}</span>
           <button type="button" class="btn-link remove-goal" data-goal="${g.id}" aria-label="Remove goal" title="Remove goal">✕</button>
         </li>`).join('')}</ul>`
    : `<p class="empty">No goals yet.</p>`;
  return `<div class="md-col"><h3 class="md-col-title">${escapeHtml(team.name)}</h3>${adder}${list}</div>`;
}

function photoHtml(match) {
  const url = match.photoUrl || '';
  const button = url
    ? `<a class="btn-primary photo-btn" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">📷 Match Photos</a>`
    : '';
  return `
    <div class="photo-section">
      <form class="photo-form" id="photo-form">
        <input id="photo-url" type="url" placeholder="Paste a Google Drive album link" value="${escapeHtml(url)}" autocomplete="off" />
        <button type="submit">Save</button>
      </form>
      ${button}
      <p id="photo-message" class="form-message"></p>
    </div>`;
}

// Save a player's name (on blur or Enter). Only rebuild the dropdowns when a
// player becomes named/unnamed, so editing a spelling doesn't disrupt anything.
async function savePlayerName(input) {
  const id = Number(input.dataset.player);
  const name = input.value.trim();
  let membershipChanged = false;
  for (const team of [matchDetail.teamA, matchDetail.teamB]) {
    const p = team.players.find((pl) => pl.id === id);
    if (p) {
      const wasNamed = !!(p.name && p.name.trim());
      p.name = name;
      if (wasNamed !== !!name) membershipChanged = true;
    }
  }
  try {
    await fetch('/api/players/' + id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
  } catch (_) { /* will re-sync on next load */ }
  if (membershipChanged) renderGoalsArea();
}

async function onMatchClick(event) {
  const add = event.target.closest('.add-goal');
  if (add) {
    const select = document.querySelector('.goal-select[data-team="' + add.dataset.team + '"]');
    if (!select || !select.value) return;
    await fetch('/api/matches/' + matchDetail.match.id + '/goals', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: Number(select.value) }),
    });
    await reloadMatch(matchDetail.match.id);
    return;
  }
  const remove = event.target.closest('.remove-goal');
  if (remove) {
    await fetch('/api/goals/' + remove.dataset.goal, { method: 'DELETE' });
    await reloadMatch(matchDetail.match.id);
  }
}

async function onPhotoSubmit(event) {
  if (event.target.id !== 'photo-form') return;
  event.preventDefault();
  const url = document.getElementById('photo-url').value.trim();
  const msg = document.getElementById('photo-message');
  try {
    const res = await fetch('/api/matches/' + matchDetail.match.id + '/photo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not save the link.');
    matchDetail.match.photoUrl = body.photoUrl;
    renderMatchDetail();
  } catch (err) {
    msg.textContent = err.message;
  }
}

// =============================================================================
// Pick the right code for this page.
// =============================================================================
const page = document.body.dataset.page;
if (page === 'home') loadHomePage();
else if (page === 'create') loadCreatePage();
else if (page === 'add-teams') loadAddTeamsPage();
else if (page === 'tournament') loadTournamentPage();
else if (page === 'match') loadMatchPage();
