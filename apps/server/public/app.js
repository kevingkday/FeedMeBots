// Seat coordinates for 6-max oval table (percentage x, y)
const SEAT_POSITIONS = [
  { x: 50, y: 92 },  // Seat 0: Bottom Center (Hero/Dealer 1)
  { x: 18, y: 78 },  // Seat 1: Bottom Left
  { x: 18, y: 22 },  // Seat 2: Top Left
  { x: 50, y: 8 },   // Seat 3: Top Center
  { x: 82, y: 22 },  // Seat 4: Top Right
  { x: 82, y: 78 }   // Seat 5: Bottom Right
];

// Suit icons & colors
const SUIT_ICONS = {
  s: { char: '♠', isRed: false },
  h: { char: '♥', isRed: true },
  d: { char: '♦', isRed: true },
  c: { char: '♣', isRed: false }
};

let pollInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupLiveTable();
  setupLeaderboard();
  setupTestBench();
  setupRegistration();
  setupErrorLogs();
});

function setupTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      const targetId = tab.getAttribute('data-tab');
      const targetContent = document.getElementById(targetId);
      if (targetContent) targetContent.classList.add('active');

      if (targetId === 'tab-leaderboard') loadLeaderboard();
      if (targetId === 'tab-errors') loadErrors();
    });
  });
}

// ---------------- LIVE TABLE ----------------
function setupLiveTable() {
  const toggleBtn = document.getElementById('btn-toggle-runner');
  toggleBtn.addEventListener('click', async () => {
    const isPaused = toggleBtn.textContent.includes('Resume');
    const endpoint = isPaused ? '/api/table/start' : '/api/table/stop';
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();
      updateRunnerStatus(data.isRunning);
    } catch (e) {
      console.error('Failed to toggle runner:', e);
    }
  });

  // Start polling live table
  pollLiveTable();
  pollInterval = setInterval(pollLiveTable, 700);
}

async function pollLiveTable() {
  try {
    const res = await fetch('/api/table/live');
    if (!res.ok) return;
    const { isRunning, state, match } = await res.json();

    updateRunnerStatus(isRunning);
    if (match) {
      const matchElem = document.getElementById('live-match-info');
      if (matchElem) {
        if (match.winnerName) {
          matchElem.innerHTML = `<span style="color: #34d399; font-weight: 800;">🏆 Champion: ${escapeHtml(match.winnerName)}!</span>`;
        } else {
          matchElem.innerHTML = `Match #${match.matchNumber} &middot; <strong style="color: #38bdf8;">${match.playersRemaining}/${match.totalPlayers}</strong> Alive (Hand #${match.handNumber})`;
        }
      }
    }
    if (state) {
      renderTableState(state);
    }
  } catch (e) {
    // Silent fail on network blip
  }
}

function updateRunnerStatus(isRunning) {
  const dot = document.getElementById('runner-status-dot');
  const text = document.getElementById('runner-status-text');
  const btn = document.getElementById('btn-toggle-runner');

  if (isRunning) {
    dot.style.backgroundColor = '#10b981';
    dot.style.boxShadow = '0 0 10px #10b981';
    text.textContent = 'Runner Active';
    btn.textContent = 'Pause Table';
    btn.className = 'btn btn-outline';
  } else {
    dot.style.backgroundColor = '#ef4444';
    dot.style.boxShadow = '0 0 10px #ef4444';
    text.textContent = 'Runner Paused';
    btn.textContent = 'Resume Table';
    btn.className = 'btn btn-primary';
  }
}

function renderTableState(state) {
  document.getElementById('live-hand-id').textContent = state.handId;
  const stageElem = document.getElementById('live-stage');
  stageElem.textContent = state.stage.toUpperCase();

  const settledPots = (state.pots || []).reduce((sum, p) => sum + p.amount, 0);
  const liveRoundBets = (state.seats || []).reduce((sum, s) => sum + (s.currentBet || 0), 0);
  const totalPot = settledPots + liveRoundBets;
  document.getElementById('live-pot').textContent = totalPot.toLocaleString();

  // Community Cards
  const boardElem = document.getElementById('live-community-cards');
  boardElem.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const cardCode = state.communityCards[i];
    if (cardCode) {
      boardElem.appendChild(createCardElement(cardCode));
    } else {
      const slot = document.createElement('div');
      slot.className = 'card card-slot';
      boardElem.appendChild(slot);
    }
  }

  // Seats
  const seatsContainer = document.getElementById('live-seats');
  seatsContainer.innerHTML = '';

  state.seats.forEach((seat, idx) => {
    const pos = SEAT_POSITIONS[idx] || { x: 50, y: 50 };
    const isBusted = seat.stack === 0 || seat.status === 'sitting_out';
    const seatDiv = document.createElement('div');
    seatDiv.className = `seat ${isBusted ? 'folded busted' : seat.status}`;
    if (state.currentTurnSeat === seat.seatIndex) {
      seatDiv.classList.add('active-turn');
    }
    seatDiv.style.left = `${pos.x}%`;
    seatDiv.style.top = `${pos.y}%`;

    const isDealer = state.dealerSeat === seat.seatIndex;

    seatDiv.innerHTML = `
      ${isDealer && !isBusted ? '<div class="dealer-button">D</div>' : ''}
      <div class="seat-avatar" style="${isBusted ? 'opacity: 0.4;' : ''}">
        <div class="seat-name">${escapeHtml(seat.botName || `Bot ${seat.seatIndex}`)}</div>
        <div class="seat-chips">${isBusted ? '<span style="color: #ef4444; font-weight: 700;">ELIMINATED</span>' : (seat.stack || 0).toLocaleString()}</div>
      </div>
      <div class="seat-cards" id="seat-cards-${seat.seatIndex}"></div>
      ${seat.currentBet > 0 ? `<div class="seat-bet">Bet: ${seat.currentBet}</div>` : ''}
    `;

    seatsContainer.appendChild(seatDiv);

    // Cards
    const cardsContainer = seatDiv.querySelector(`#seat-cards-${seat.seatIndex}`);
    if (seat.holeCards && seat.holeCards.length > 0) {
      seat.holeCards.forEach(c => cardsContainer.appendChild(createCardElement(c)));
    } else if ((seat.status === 'active' || seat.status === 'all_in') && !isBusted) {
      // Hidden cards facing down
      cardsContainer.innerHTML = `
        <div class="card card-back"></div>
        <div class="card card-back"></div>
      `;
    }
  });

  // Action feed
  renderActionFeed(state);
}

function renderActionFeed(state) {
  const feed = document.getElementById('live-action-feed');
  if (!state.actionHistory || state.actionHistory.length === 0) {
    feed.innerHTML = '<div class="feed-item placeholder">Hand started...</div>';
    return;
  }

  feed.innerHTML = '';
  // Show last 10 actions
  const recent = state.actionHistory.slice(-10);
  recent.forEach(act => {
    const seat = state.seats.find(s => s.seatIndex === act.seatIndex);
    const botName = seat ? seat.botName : `Seat ${act.seatIndex}`;
    const div = document.createElement('div');
    div.className = `feed-item ${act.action}`;

    let text = `[${act.stage}] ${botName}: ${act.action.toUpperCase()}`;
    if (act.amount) text += ` ${act.amount}`;
    div.textContent = text;
    feed.appendChild(div);
  });

  if (state.winners && state.winners.length > 0) {
    state.winners.forEach(w => {
      const winnerSeat = state.seats.find(s => s.seatIndex === w.seatIndex);
      const name = winnerSeat ? winnerSeat.botName : `Seat ${w.seatIndex}`;
      const winDiv = document.createElement('div');
      winDiv.className = 'feed-item winner';
      winDiv.textContent = `🏆 ${name} won ${w.amount} chips! (${w.handDescription || ''})`;
      feed.appendChild(winDiv);
    });
  }

  feed.scrollTop = feed.scrollHeight;
}

function createCardElement(code) {
  const rank = code[0];
  const suit = code[1];
  const suitInfo = SUIT_ICONS[suit] || { char: suit, isRed: false };

  const el = document.createElement('div');
  el.className = `card ${suitInfo.isRed ? 'red' : 'black'}`;
  el.innerHTML = `<span>${rank}</span><span>${suitInfo.char}</span>`;
  return el;
}

// ---------------- LEADERBOARD ----------------
function setupLeaderboard() {
  document.getElementById('btn-refresh-leaderboard').addEventListener('click', loadLeaderboard);
}

async function loadLeaderboard() {
  const tbody = document.getElementById('leaderboard-tbody');
  try {
    const res = await fetch('/api/leaderboard');
    const { leaderboard } = await res.json();

    if (!leaderboard || leaderboard.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center">No matches played yet.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    leaderboard.forEach((b, idx) => {
      const tr = document.createElement('tr');
      const isPositive = b.bb100 > 0;
      const isNegative = b.bb100 < 0;
      const bbClass = isPositive ? 'positive' : isNegative ? 'negative' : '';

      tr.innerHTML = `
        <td><strong>#${idx + 1}</strong></td>
        <td><strong>${escapeHtml(b.name)}</strong></td>
        <td><span class="badge">${b.isHouse ? 'House' : 'Custom Bot'}</span></td>
        <td><span style="color: var(--accent-gold); font-weight: 800;">${b.tournamentsWon > 0 ? `🏆 ${b.tournamentsWon}` : '-'}</span></td>
        <td>${b.handsPlayed.toLocaleString()}</td>
        <td class="${bbClass}">${b.chipsWon > 0 ? '+' : ''}${b.chipsWon.toLocaleString()}</td>
        <td class="${bbClass}">${b.bb100.toFixed(2)}</td>
        <td>${b.timeouts}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">Failed to load leaderboard.</td></tr>';
  }
}

// ---------------- TEST BENCH ----------------
function setupTestBench() {
  const runBtn = document.getElementById('btn-run-test');
  runBtn.addEventListener('click', async () => {
    const url = document.getElementById('tb-webhook-url').value.trim();
    const name = document.getElementById('tb-bot-name').value.trim();

    if (!url) {
      alert('Please enter a webhook URL.');
      return;
    }

    runBtn.disabled = true;
    runBtn.textContent = '⏳ Testing 1 Hand vs House Bot...';
    const statusBadge = document.getElementById('test-status-badge');
    statusBadge.textContent = 'Playing...';
    statusBadge.className = 'badge';

    const container = document.getElementById('test-exchanges-container');
    container.innerHTML = '<div class="empty-state">Communicating with bot webhook...</div>';
    const summaryBox = document.getElementById('test-summary-box');
    summaryBox.classList.add('hidden');

    try {
      const res = await fetch('/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: url, botName: name })
      });

      const data = await res.json();
      runBtn.disabled = false;
      runBtn.textContent = '🚀 Run Test Hand';

      if (!res.ok) {
        statusBadge.textContent = 'Error';
        statusBadge.className = 'badge';
        container.innerHTML = `<div class="summary-box error">Error: ${escapeHtml(data.error || 'Server error')}</div>`;
        return;
      }

      // Render summary
      summaryBox.classList.remove('hidden');
      if (data.success) {
        statusBadge.textContent = 'Success';
        statusBadge.style.background = 'rgba(16, 185, 129, 0.2)';
        statusBadge.style.color = '#34d399';
        summaryBox.className = 'summary-box';
        summaryBox.innerHTML = `
          <strong>✅ Connection Test Succeeded!</strong>
          <div>Hand ID: <code>${data.handId}</code></div>
          <div>Exchanges: <strong>${data.exchanges.length}</strong> rounds</div>
          <div>Board: <strong>${data.handSummary.communityCards.join(' ') || 'None'}</strong></div>
          <div>Net Chips: <strong>${data.handSummary.botWonChips > 0 ? '+' : ''}${data.handSummary.botWonChips}</strong></div>
        `;
      } else {
        statusBadge.textContent = 'Failed';
        statusBadge.style.background = 'rgba(239, 68, 68, 0.2)';
        statusBadge.style.color = '#f87171';
        summaryBox.className = 'summary-box error';
        summaryBox.innerHTML = `
          <strong>❌ Bot Encountered Timeouts or Errors</strong>
          <div>Hand ID: <code>${data.handId}</code></div>
          <div>Please check the exchanges below for error details.</div>
        `;
      }

      // Render exchanges
      container.innerHTML = '';
      data.exchanges.forEach((ex, idx) => {
        const card = document.createElement('div');
        card.className = 'exchange-card';
        card.innerHTML = `
          <div class="exchange-header">
            <span>Exchange #${idx + 1} &middot; Stage: <strong>${ex.stage.toUpperCase()}</strong></span>
            <span class="latency-badge">${ex.latencyMs}ms</span>
          </div>
          ${ex.error ? `<div style="color: #ef4444; font-size: 12px; margin-bottom: 6px;">⚠️ ${escapeHtml(ex.error)}</div>` : ''}
          <div style="font-size: 12px; margin-bottom: 4px; color: var(--text-muted);">Request Payload (State):</div>
          <pre class="code-view">${escapeHtml(JSON.stringify(ex.requestSent, null, 2))}</pre>
          <div style="font-size: 12px; margin: 8px 0 4px; color: var(--text-muted);">Response Received (Action):</div>
          <pre class="code-view">${escapeHtml(JSON.stringify(ex.responseReceived, null, 2))}</pre>
        `;
        container.appendChild(card);
      });
    } catch (e) {
      runBtn.disabled = false;
      runBtn.textContent = '🚀 Run Test Hand';
      container.innerHTML = `<div class="summary-box error">Network error calling server: ${escapeHtml(e.message)}</div>`;
    }
  });
}

// ---------------- REGISTRATION ----------------
function setupRegistration() {
  const form = document.getElementById('form-register-bot');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const webhookUrl = document.getElementById('reg-webhook').value.trim();

    try {
      const res = await fetch('/api/bots/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, webhookUrl })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to register bot');
        return;
      }

      document.getElementById('reg-res-botid').textContent = data.botId;
      document.getElementById('reg-res-apikey').textContent = data.apiKey;
      document.getElementById('reg-success-panel').style.display = 'block';
      form.reset();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  });
}

// ---------------- ERROR LOGS ----------------
function setupErrorLogs() {
  document.getElementById('btn-refresh-errors').addEventListener('click', loadErrors);
}

async function loadErrors() {
  const tbody = document.getElementById('errors-tbody');
  try {
    const res = await fetch('/api/errors');
    const { errors } = await res.json();

    if (!errors || errors.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center">No error logs recorded.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    errors.forEach(err => {
      const tr = document.createElement('tr');
      const timeStr = new Date(err.created_at).toLocaleTimeString();
      tr.innerHTML = `
        <td>${timeStr}</td>
        <td><strong>${escapeHtml(err.bot_name || err.bot_id)}</strong></td>
        <td><code>${err.hand_id}</code></td>
        <td><span class="badge">${err.stage}</span></td>
        <td><span style="color: #ef4444; font-weight: 600;">${err.error_type}</span></td>
        <td>${escapeHtml(err.error_message)}</td>
        <td><button class="btn btn-outline" style="padding: 4px 8px; font-size: 11px;" onclick='alert(${JSON.stringify(err.payload_sent)})'>View Payload</button></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Failed to load error logs.</td></tr>';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
