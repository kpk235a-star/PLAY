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
      ? teams.map((t) => `<li><input class="team-name-input" data-team="${t.id}" value="${escapeHtml(t.name)}" autocomplete="off" aria-label="Team name" /></li>`).join('')
      : '<li class="empty">No teams yet — add your first below.</li>';
    updateHint(teams.length);
  }
  await loadTeams();

  // Rename a team when you edit its name and click away or press Enter.
  listEl.addEventListener('focusout', (e) => {
    if (!e.target.classList.contains('team-name-input')) return;
    const name = e.target.value.trim();
    if (!name) return;
    fetch('/api/teams/' + e.target.dataset.team, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    }).catch(() => {});
  });
  listEl.addEventListener('keydown', (e) => {
    if (e.target.classList.contains('team-name-input') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });

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
  const { tournament, groups, knockout, winner, scorers } = tView;
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

  // Top scorers (football only), shown near the top of the schedule page.
  if (football && scorers && scorers.length) {
    html += topScorersHtml(scorers);
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

// Top-scorer ranking: top 5 always shown, the rest behind a "Show all" toggle.
function scorerRow(s, index) {
  return `
    <div class="rank-row">
      <span class="rank-num">${index + 1}</span>
      <span class="rank-name">${escapeHtml(s.name || 'Player')}</span>
      <span class="rank-team">${escapeHtml(s.teamName)}</span>
      <span class="rank-goals">${s.goals}</span>
    </div>`;
}
function topScorersHtml(scorers) {
  const top = scorers.slice(0, 5);
  const rest = scorers.slice(5);
  return `
    <section class="scorers-block">
      <h2>Top scorers</h2>
      <div class="ranking">
        ${top.map((s, i) => scorerRow(s, i)).join('')}
        <div class="ranking-rest" hidden>${rest.map((s, i) => scorerRow(s, i + 5)).join('')}</div>
      </div>
      ${rest.length
        ? `<button type="button" class="btn-link show-all-scorers" data-expanded="0">Show all ${scorers.length} scorers</button>`
        : ''}
    </section>`;
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
  const showAll = event.target.closest('.show-all-scorers');
  if (showAll) {
    const block = showAll.closest('.scorers-block');
    const rest = block.querySelector('.ranking-rest');
    const expanded = showAll.dataset.expanded === '1';
    rest.hidden = expanded;
    showAll.dataset.expanded = expanded ? '0' : '1';
    showAll.textContent = expanded ? 'Show all ' + (block.querySelectorAll('.rank-row').length) + ' scorers' : 'Show top 5';
    return;
  }
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
// MATCH DETAIL PAGE (football only)
// A visual pitch lineup, a match timer, an ordered goal list with minutes, and
// Man-of-the-Match voting. The timer lives in its own container so it keeps
// running while the rest of the page re-renders.
// =============================================================================
let matchDetail = null;

// 1-2-2 pitch positions per team (percent of the pitch). Slot 0 = keeper,
// slots 1-2 = the back pair, slots 3-4 = the front pair. Team A sits on the
// bottom half; Team B is mirrored on the top half.
const PITCH_SPOTS = {
  A: [{ x: 50, y: 89 }, { x: 30, y: 74 }, { x: 70, y: 74 }, { x: 34, y: 60 }, { x: 66, y: 60 }],
  B: [{ x: 50, y: 11 }, { x: 30, y: 26 }, { x: 70, y: 26 }, { x: 34, y: 40 }, { x: 66, y: 40 }],
};

// A stable per-device token for one-vote-per-device (kept in the browser).
function voterToken() {
  let t = localStorage.getItem('motm-voter-token');
  if (!t) { t = 'v-' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('motm-voter-token', t); }
  return t;
}
function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}
function scoreText(match) {
  return (match.scoreA == null ? 0 : match.scoreA) + ' – ' + (match.scoreB == null ? 0 : match.scoreB);
}

// ---------- Match timer (screen-only, never saved) ----------
const timer = { durationMin: 40, elapsedSec: 0, running: false, intervalId: null };
function clockText(sec) { return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
function liveMinute() { return Math.floor(timer.elapsedSec / 60); }

function renderTimer() {
  document.getElementById('match-timer').innerHTML = `
    <div class="timer">
      <div class="timer-clock" id="timer-clock">0:00</div>
      <div class="timer-controls">
        <label class="timer-field">Minutes
          <input id="timer-minutes" type="number" min="1" value="${timer.durationMin}" />
        </label>
        <button type="button" id="timer-toggle" class="btn-small">Start</button>
        <button type="button" id="timer-reset" class="btn-link">Reset</button>
      </div>
      <div class="timer-status" id="timer-status"></div>
    </div>`;
  updateTimerDisplay();
}
function updateTimerDisplay() {
  const clock = document.getElementById('timer-clock');
  if (clock) clock.textContent = clockText(timer.elapsedSec);
  // Keep un-edited goal-minute boxes in sync with the live clock.
  document.querySelectorAll('.goal-minute:not([data-touched])').forEach((inp) => { inp.value = liveMinute(); });
}
function stopTimer() {
  clearInterval(timer.intervalId);
  timer.intervalId = null;
  timer.running = false;
  const btn = document.getElementById('timer-toggle');
  if (btn) btn.textContent = timer.elapsedSec > 0 ? 'Resume' : 'Start';
}
function tick() {
  const total = timer.durationMin * 60;
  timer.elapsedSec = Math.min(timer.elapsedSec + 1, total);
  updateTimerDisplay();
  if (timer.elapsedSec >= total) {
    stopTimer();
    const s = document.getElementById('timer-status'); if (s) s.textContent = 'Full Time';
    const b = document.getElementById('timer-toggle'); if (b) b.textContent = 'Start';
  }
}
function toggleTimer() {
  if (timer.running) { stopTimer(); return; }
  if (timer.elapsedSec >= timer.durationMin * 60) return; // full time — reset first
  timer.running = true;
  document.getElementById('timer-toggle').textContent = 'Pause';
  document.getElementById('timer-status').textContent = '';
  timer.intervalId = setInterval(tick, 1000);
}
function resetTimer() {
  stopTimer();
  timer.elapsedSec = 0;
  const s = document.getElementById('timer-status'); if (s) s.textContent = '';
  const b = document.getElementById('timer-toggle'); if (b) b.textContent = 'Start';
  updateTimerDisplay();
}

// ---------- Load + overall render ----------
let pendingPhotoPlayerId = null; // which player's disc opened the file picker

async function loadMatchPage() {
  const el = document.getElementById('match-detail');
  el.innerHTML =
    '<div id="match-timer"></div>' +
    '<input type="file" id="photo-file" accept="image/*" style="display:none" />' +
    '<div id="match-body"><p class="loading">Loading match…</p></div>';

  // One set of delegated listeners on the outer container (survives re-renders).
  el.addEventListener('click', onMatchClick);
  el.addEventListener('submit', onPhotoSubmit);
  el.addEventListener('focusout', (e) => { if (e.target.classList.contains('player-name')) savePlayerName(e.target); });
  el.addEventListener('keydown', (e) => {
    if (e.target.classList.contains('player-name') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });
  el.addEventListener('input', (e) => { if (e.target.classList.contains('goal-minute')) e.target.setAttribute('data-touched', '1'); });
  el.addEventListener('change', (e) => {
    if (e.target.id === 'timer-minutes') {
      timer.durationMin = Math.max(1, Math.floor(Number(e.target.value) || 1));
      if (timer.elapsedSec > timer.durationMin * 60) timer.elapsedSec = timer.durationMin * 60;
      updateTimerDisplay();
    } else if (e.target.id === 'photo-file') {
      const file = e.target.files && e.target.files[0];
      if (file && pendingPhotoPlayerId != null) uploadPhoto(pendingPhotoPlayerId, file);
    } else if (e.target.classList.contains('rating-select')) {
      saveRating(Number(e.target.dataset.player), e.target.value);
    }
  });
  // Squad drag-to-reorder: the handle turns dragging on so the inputs still work.
  el.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.squad-row .drag-handle');
    if (handle) handle.closest('.squad-row').setAttribute('draggable', 'true');
  });
  el.addEventListener('dragstart', onSquadDragStart);
  el.addEventListener('dragover', onSquadDragOver);
  el.addEventListener('drop', (e) => e.preventDefault());
  el.addEventListener('dragend', onSquadDragEnd);

  renderTimer();
  if (await refetch()) renderBody();
}

// Shrink a chosen image to a small square avatar and return it as a data URL.
function resizeImage(file, size) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image.'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const min = Math.min(img.width, img.height);        // crop to a centered square
        ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadPhoto(playerId, file) {
  try {
    const dataUrl = await resizeImage(file, 160);
    const res = await fetch('/api/players/' + playerId + '/photo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photo: dataUrl }),
    });
    if (!res.ok) throw new Error('upload failed');
    for (const team of [matchDetail.teamA, matchDetail.teamB]) {
      const p = team.players.find((pl) => pl.id === playerId);
      if (p) p.photo = dataUrl;
    }
    // Update the pitch disc and the squad-list avatar for this player.
    document.querySelectorAll('.player-disc[data-disc="' + playerId + '"], .squad-avatar[data-avatar="' + playerId + '"]').forEach((el) => {
      el.classList.add('has-photo'); el.textContent = ''; el.style.backgroundImage = "url('" + dataUrl + "')";
    });
  } catch (_) { /* soft-fail; the photo just won't change */ }
}

// Cast (or change/clear) this device's rating vote for a player, then refresh
// so the average updates.
async function saveRating(playerId, value) {
  const rating = value === '' ? null : Number(value);
  try {
    await fetch('/api/matches/' + matchDetail.match.id + '/ratings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, rating, voterToken: voterToken() }),
    });
  } catch (_) { /* soft-fail; a reload will re-sync */ }
  if (await refetch()) renderSquadArea();
}

async function refetch() {
  try {
    const res = await fetch('/api/matches/' + getQueryParam('id') + '/detail?voter=' + encodeURIComponent(voterToken()));
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not load this match.');
    matchDetail = body;
    return true;
  } catch (err) {
    document.getElementById('match-body').innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
    matchDetail = null;
    return false;
  }
}

function renderBody() {
  const { match, tournament, teamA, teamB } = matchDetail;
  const back = document.getElementById('back-link');
  back.href = '/tournament.html?id=' + tournament.id;
  back.textContent = '← Back to ' + tournament.name;

  document.getElementById('match-body').innerHTML = `
    <div class="match-detail-header">
      <span class="badge badge-football">⚽ Football</span>
      <div class="md-scoreline">
        <span class="md-team">${escapeHtml(teamA.name)}</span>
        <span class="md-score" id="md-score">${scoreText(match)}</span>
        <span class="md-team">${escapeHtml(teamB.name)}</span>
      </div>
      <p class="card-meta">${escapeHtml(tournament.name)} · 📅 ${formatDate(tournament.date)}${tournament.time ? ' · ' + formatTime(tournament.time) : ''}</p>
    </div>

    <h2>Lineups</h2>
    <div id="pitch-area"></div>

    <h2>Squad <span class="squad-hint">— first 5 start; drag to change the lineup</span></h2>
    <div id="squad-area"></div>

    <h2>Goals</h2>
    <div id="goals-area"></div>

    <h2>Man of the Match</h2>
    <div id="motm-area"></div>

    <h2>Match Photos</h2>
    <div id="photo-area"></div>
  `;
  renderPitch();
  renderSquadArea();
  renderGoalsArea();
  renderMotmArea();
  renderPhotoArea();
}

function updateScore() {
  const el = document.getElementById('md-score');
  if (el) el.textContent = scoreText(matchDetail.match);
}

// ---------- The pitch (the starting five) ----------
function renderPitch() {
  const area = document.getElementById('pitch-area');
  if (area) area.innerHTML = pitchHtml(matchDetail.teamA, matchDetail.teamB);
}
function pitchHtml(teamA, teamB) {
  const player = (p, side) => {
    const spot = PITCH_SPOTS[side][p.slot] || { x: 50, y: 50 };
    const disc = p.photo
      ? `<span class="player-disc disc-${side} has-photo" data-disc="${p.id}" role="button" tabindex="0" title="Change photo" style="background-image:url('${p.photo}')"></span>`
      : `<span class="player-disc disc-${side}" data-disc="${p.id}" role="button" tabindex="0" title="Add photo">${escapeHtml(initials(p.name))}</span>`;
    return `
      <div class="pitch-player" style="left:${spot.x}%;top:${spot.y}%">
        ${disc}
        <input class="player-name pitch-name" data-player="${p.id}" value="${escapeHtml(p.name || '')}" placeholder="Add name" autocomplete="off" aria-label="Player name" />
      </div>`;
  };
  const starters = (players) => players.filter((p) => p.slot < 5); // only the first five are on the pitch
  return `
    <div class="pitch" role="img" aria-label="Match lineup on a football pitch">
      <div class="pitch-line pitch-halfway"></div>
      <div class="pitch-circle"></div>
      <div class="pitch-box pitch-box-top"></div>
      <div class="pitch-box pitch-box-bottom"></div>
      <span class="pitch-team-label label-top">${escapeHtml(teamB.name)}</span>
      <span class="pitch-team-label label-bottom">${escapeHtml(teamA.name)}</span>
      ${starters(teamB.players).map((p) => player(p, 'B')).join('')}
      ${starters(teamA.players).map((p) => player(p, 'A')).join('')}
    </div>`;
}

// ---------- The squad list (starters + substitutes, per team) ----------
function renderSquadArea() {
  const area = document.getElementById('squad-area');
  if (area) area.innerHTML = `<div class="md-columns">${squadColumnHtml(matchDetail.teamA)}${squadColumnHtml(matchDetail.teamB)}</div>`;
}

// A rating cell: this device's vote (a 1–10 picker) plus the average of everyone.
function ratingCellHtml(p) {
  let opts = '<option value="">–</option>';
  for (let n = 1; n <= 10; n++) opts += `<option value="${n}"${p.myRating === n ? ' selected' : ''}>${n}</option>`;
  const avg = p.ratingCount
    ? `<span class="rating-avg" title="${p.ratingCount} vote${p.ratingCount > 1 ? 's' : ''}">${p.rating}<small>·${p.ratingCount}</small></span>`
    : '<span class="rating-avg empty" title="No ratings yet">–</span>';
  return `<span class="rating-cell">
      <select class="rating-select" data-player="${p.id}" aria-label="Your rating out of 10" title="Your rating (1–10)">${opts}</select>
      ${avg}
    </span>`;
}

function squadRowHtml(p, isSub) {
  const avatar = p.photo
    ? `<span class="squad-avatar has-photo" data-avatar="${p.id}" role="button" tabindex="0" title="Change photo" style="background-image:url('${p.photo}')"></span>`
    : `<span class="squad-avatar" data-avatar="${p.id}" role="button" tabindex="0" title="Add photo">${escapeHtml(initials(p.name))}</span>`;
  return `
    <div class="squad-row" data-player="${p.id}">
      <span class="drag-handle" title="Drag to reorder" aria-hidden="true">⠿</span>
      ${avatar}
      <input class="player-name squad-name" data-player="${p.id}" value="${escapeHtml(p.name || '')}" placeholder="Add name" autocomplete="off" aria-label="Player name" />
      ${ratingCellHtml(p)}
      <span class="squad-move">
        <button type="button" class="sq-up" data-player="${p.id}" aria-label="Move up" title="Move up">▲</button>
        <button type="button" class="sq-down" data-player="${p.id}" aria-label="Move down" title="Move down">▼</button>
      </span>
      ${isSub
        ? `<button type="button" class="btn-link remove-player" data-player="${p.id}" aria-label="Remove player" title="Remove player">✕</button>`
        : '<span class="remove-spacer"></span>'}
    </div>`;
}

function squadColumnHtml(team) {
  const players = team.players.slice().sort((a, b) => a.slot - b.slot);
  const starters = players.slice(0, 5);
  const subs = players.slice(5);
  return `
    <div class="md-col squad-col">
      <h3 class="md-col-title">${escapeHtml(team.name)}</h3>
      <div class="squad-list" data-team="${team.id}">
        <div class="squad-section">Starting 5</div>
        ${starters.map((p) => squadRowHtml(p, false)).join('')}
        <div class="squad-section">Substitutes</div>
        ${subs.length ? subs.map((p) => squadRowHtml(p, true)).join('') : '<p class="squad-empty">No substitutes yet.</p>'}
      </div>
      <button type="button" class="btn-small add-sub" data-team="${team.id}">+ Add substitute</button>
    </div>`;
}

// Reorder helpers (drag + ▲▼ buttons) for the squad lists.
let squadDragEl = null;
function onSquadDragStart(event) {
  const row = event.target.closest('.squad-row');
  if (!row) return;
  squadDragEl = row;
  row.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  try { event.dataTransfer.setData('text/plain', row.dataset.player); } catch (_) {}
}
function onSquadDragOver(event) {
  if (!squadDragEl) return;
  const list = event.target.closest('.squad-list');
  if (!list || list !== squadDragEl.parentElement) return; // stay within the same team
  event.preventDefault();
  const rows = [...list.querySelectorAll('.squad-row:not(.dragging)')];
  let after = null, closest = -Infinity;
  for (const row of rows) {
    const box = row.getBoundingClientRect();
    const offset = event.clientY - box.top - box.height / 2;
    if (offset < 0 && offset > closest) { closest = offset; after = row; }
  }
  if (after == null) list.appendChild(squadDragEl);
  else list.insertBefore(squadDragEl, after);
}
async function onSquadDragEnd() {
  if (!squadDragEl) return;
  const list = squadDragEl.parentElement;
  squadDragEl.classList.remove('dragging');
  squadDragEl.setAttribute('draggable', 'false');
  squadDragEl = null;
  if (list && list.classList.contains('squad-list')) await persistSquadOrder(list);
}
function moveSquadRow(row, direction) {
  const list = row.parentElement;
  const rows = [...list.querySelectorAll('.squad-row')];
  const target = rows[rows.indexOf(row) + direction];
  if (!target) return;
  if (direction < 0) list.insertBefore(row, target);
  else list.insertBefore(target, row);
}
async function persistSquadOrder(list) {
  const teamId = list.dataset.team;
  const playerIds = [...list.querySelectorAll('.squad-row')].map((el) => Number(el.dataset.player));
  try {
    const res = await fetch('/api/teams/' + teamId + '/players/reorder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerIds }),
    });
    if (!res.ok) throw new Error('reorder failed');
  } catch (_) { /* the reload below restores the server order */ }
  if (await refetch()) { renderPitch(); renderSquadArea(); }
}

// ---------- Goals: ordered list + per-team add controls ----------
function renderGoalsArea() {
  const area = document.getElementById('goals-area');
  if (!area) return;
  const { teamA, teamB, goals } = matchDetail;
  const teamName = (id) => (id === teamA.id ? teamA.name : teamB.name);
  const teamSide = (id) => (id === teamA.id ? 'a' : 'b');

  const list = goals.length
    ? `<ol class="scorer-list">${goals.map((g) => `
         <li>
           <span class="goal-minute-badge">${g.minute == null ? "—" : g.minute + "'"}</span>
           <span class="goal-name">⚽ ${escapeHtml(g.playerName || 'Player')}</span>
           <span class="goal-team team-${teamSide(g.teamId)}">${escapeHtml(teamName(g.teamId))}</span>
           <button type="button" class="btn-link remove-goal" data-goal="${g.id}" aria-label="Remove goal" title="Remove goal">✕</button>
         </li>`).join('')}</ol>`
    : `<p class="empty">No goals yet.</p>`;

  area.innerHTML = list + `<div class="goal-adders">${goalAdder(teamA)}${goalAdder(teamB)}</div>`;
}

function goalAdder(team) {
  const named = team.players.filter((p) => p.name && p.name.trim());
  if (!named.length) {
    return `<div class="goal-adder-col"><span class="goal-adder-team">${escapeHtml(team.name)}</span><p class="hint-small">Name players on the pitch to record scorers.</p></div>`;
  }
  return `
    <div class="goal-adder-col">
      <span class="goal-adder-team">${escapeHtml(team.name)}</span>
      <div class="goal-adder">
        <select class="goal-select" data-team="${team.id}" aria-label="Scorer for ${escapeHtml(team.name)}">
          ${named.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
        </select>
        <input class="goal-minute" type="number" min="0" inputmode="numeric" value="${liveMinute()}" aria-label="Minute" title="Minute" />
        <button type="button" class="btn-small add-goal" data-team="${team.id}">+ Goal</button>
      </div>
    </div>`;
}

// ---------- Man of the Match voting ----------
function renderMotmArea() {
  const area = document.getElementById('motm-area');
  if (!area) return;
  const { match, teamA, teamB } = matchDetail;
  const players = [
    ...teamA.players.filter((p) => p.name && p.name.trim()).map((p) => ({ ...p, teamName: teamA.name, side: 'a' })),
    ...teamB.players.filter((p) => p.name && p.name.trim()).map((p) => ({ ...p, teamName: teamB.name, side: 'b' })),
  ].sort((x, y) => y.votes - x.votes || x.name.localeCompare(y.name));

  if (!players.length) {
    area.innerHTML = `<p class="hint-small">Name the players on the pitch to open Man-of-the-Match voting.</p>`;
    return;
  }

  const myVote = matchDetail.myVote; // the player id this device voted for, or null
  const maxVotes = players.reduce((m, p) => Math.max(m, p.votes), 0);

  area.innerHTML = `
    <p class="hint-small">Vote for the best player — one vote per device, and you can change it anytime.</p>
    <ul class="motm-list">
      ${players.map((p) => {
        const isLeader = maxVotes > 0 && p.votes === maxVotes;
        const youVoted = myVote === p.id;
        return `
          <li class="motm-row${isLeader ? ' leader' : ''}${youVoted ? ' you-voted' : ''}">
            ${isLeader ? '<span class="motm-crown" title="Current leader">👑</span>' : '<span class="motm-crown"></span>'}
            <span class="motm-name">${escapeHtml(p.name)}</span>
            <span class="motm-team team-${p.side}">${escapeHtml(p.teamName)}</span>
            <span class="motm-count">${p.votes}</span>
            <button type="button" class="btn-small vote-btn${youVoted ? ' voted' : ''}" data-player="${p.id}">${youVoted ? '✓ Voted' : 'Vote'}</button>
          </li>`;
      }).join('')}
    </ul>`;
}

// ---------- Photo ----------
function renderPhotoArea() {
  const area = document.getElementById('photo-area');
  if (!area) return;
  const url = matchDetail.match.photoUrl || '';
  const button = url
    ? `<a class="btn-primary photo-btn" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">📷 Match Photos</a>`
    : '';
  area.innerHTML = `
    <div class="photo-section">
      <form class="photo-form" id="photo-form">
        <input id="photo-url" type="url" placeholder="Paste a Google Drive album link" value="${escapeHtml(url)}" autocomplete="off" />
        <button type="submit">Save</button>
      </form>
      ${button}
      <p id="photo-message" class="form-message"></p>
    </div>`;
}

// ---------- Actions ----------
async function savePlayerName(input) {
  const id = Number(input.dataset.player);
  const name = input.value.trim();
  for (const team of [matchDetail.teamA, matchDetail.teamB]) {
    const p = team.players.find((pl) => pl.id === id);
    if (p) p.name = name;
  }
  // Keep this player's other name fields (pitch + squad list) in sync.
  document.querySelectorAll('.player-name[data-player="' + id + '"]').forEach((el) => { if (el !== input) el.value = name; });
  // Update the initials on the pitch disc and squad avatar (unless a photo shows).
  document.querySelectorAll('.player-disc[data-disc="' + id + '"], .squad-avatar[data-avatar="' + id + '"]').forEach((el) => {
    if (!el.classList.contains('has-photo')) el.textContent = initials(name);
  });
  try {
    await fetch('/api/players/' + id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
  } catch (_) { /* will re-sync on next load */ }
  renderGoalsArea();  // refresh scorer dropdowns
  renderMotmArea();   // refresh voting options
}

async function onMatchClick(event) {
  // Timer controls.
  if (event.target.closest('#timer-toggle')) { toggleTimer(); return; }
  if (event.target.closest('#timer-reset')) { resetTimer(); return; }

  // Tap a player's circle (pitch) or avatar (squad list) to add/replace a photo.
  const photoTarget = event.target.closest('.player-disc, .squad-avatar');
  if (photoTarget) {
    pendingPhotoPlayerId = Number(photoTarget.dataset.disc || photoTarget.dataset.avatar);
    const fileInput = document.getElementById('photo-file');
    fileInput.value = ''; // let the same file be picked again
    fileInput.click();
    return;
  }

  // Squad: add a substitute, remove a player, or nudge the order with ▲▼.
  const addSub = event.target.closest('.add-sub');
  if (addSub) {
    await fetch('/api/teams/' + addSub.dataset.team + '/players', { method: 'POST' });
    if (await refetch()) renderSquadArea();
    return;
  }
  const removePlayer = event.target.closest('.remove-player');
  if (removePlayer) {
    const res = await fetch('/api/players/' + removePlayer.dataset.player, { method: 'DELETE' });
    if (res.ok && (await refetch())) { renderPitch(); renderSquadArea(); }
    return;
  }
  const sqUp = event.target.closest('.sq-up');
  if (sqUp) { const row = sqUp.closest('.squad-row'); const list = row.parentElement; moveSquadRow(row, -1); await persistSquadOrder(list); return; }
  const sqDown = event.target.closest('.sq-down');
  if (sqDown) { const row = sqDown.closest('.squad-row'); const list = row.parentElement; moveSquadRow(row, 1); await persistSquadOrder(list); return; }

  // Add a goal (with the minute from the box next to it).
  const add = event.target.closest('.add-goal');
  if (add) {
    const wrap = add.closest('.goal-adder');
    const select = wrap.querySelector('.goal-select');
    const minuteInput = wrap.querySelector('.goal-minute');
    if (!select || !select.value) return;
    const minute = minuteInput && minuteInput.value !== '' ? Number(minuteInput.value) : liveMinute();
    await fetch('/api/matches/' + matchDetail.match.id + '/goals', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: Number(select.value), minute }),
    });
    if (await refetch()) { updateScore(); renderGoalsArea(); }
    return;
  }

  // Remove a goal.
  const remove = event.target.closest('.remove-goal');
  if (remove) {
    await fetch('/api/goals/' + remove.dataset.goal, { method: 'DELETE' });
    if (await refetch()) { updateScore(); renderGoalsArea(); }
    return;
  }

  // Cast a Man-of-the-Match vote.
  const vote = event.target.closest('.vote-btn');
  if (vote) {
    const playerId = Number(vote.dataset.player);
    try {
      await fetch('/api/matches/' + matchDetail.match.id + '/vote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, voterToken: voterToken() }),
      });
    } catch (_) { /* refetch below shows current state */ }
    if (await refetch()) renderMotmArea(); // moves/records your vote and updates counts
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
    renderPhotoArea();
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
