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
  setupHandHistory();
  setupLeaderboard();
  setupTestBench();
  setupRegistration();
  setupErrorLogs();
  setupHowItWorks();
  setupContractCheatSheet();

  // Initial route & standalone mode handling
  checkStandaloneUrl();
  handleHashRoute(window.location.hash);
  window.addEventListener('hashchange', () => {
    checkStandaloneUrl();
    handleHashRoute(window.location.hash);
  });
  window.addEventListener('popstate', () => {
    checkStandaloneUrl();
    handleHashRoute(window.location.hash);
  });
});

function checkStandaloneUrl() {
  const params = new URLSearchParams(window.location.search);
  const hash = (window.location.hash || '').replace(/^#\/?/, '').toLowerCase();
  const isStandalone =
    params.get('view') === 'table' ||
    params.get('standalone') === '1' ||
    hash === 'table' ||
    hash === 'arena' ||
    window.location.pathname === '/table' ||
    window.location.pathname === '/arena';

  setStandaloneMode(isStandalone, false);
}

function setStandaloneMode(enabled, updateUrl = true) {
  document.body.classList.toggle('standalone-table-mode', Boolean(enabled));
  const enterBtn = document.getElementById('btn-enter-standalone');
  if (enterBtn) {
    enterBtn.innerHTML = enabled ? '&larr; Exit Focus View' : '⛶ Focus Table';
  }

  if (enabled) {
    switchTab('tab-live', false);
  }

  if (updateUrl) {
    if (enabled) {
      history.pushState(null, '', '/?view=table');
    } else {
      history.pushState(null, '', '/');
    }
  }
}

function handleHashRoute(rawHash) {
  const hash = (rawHash || '').replace(/^#\/?/, '').toLowerCase();
  if (hash === 'table' || hash === 'arena') {
    setStandaloneMode(true, false);
    switchTab('tab-live', false);
    return;
  }

  const map = {
    '': 'tab-live',
    'live': 'tab-live',
    'hands': 'tab-hands',
    'hand': 'tab-hands',
    'history': 'tab-hands',
    'leaderboard': 'tab-leaderboard',
    'testbench': 'tab-testbench',
    'test': 'tab-testbench',
    'register': 'tab-register',
    'errors': 'tab-errors',
    'howitworks': 'tab-howitworks',
    'how-it-works': 'tab-howitworks',
    'docs': 'tab-howitworks',
    'guide': 'tab-howitworks',
    'contract': 'tab-contract',
    'api-contract': 'tab-contract',
    'spec': 'tab-contract',
    'api': 'tab-contract',
    'cheatsheet': 'tab-contract',
    'cheat-sheet': 'tab-contract'
  };

  const targetTabId = map[hash] || 'tab-live';
  switchTab(targetTabId, false);
}

function switchTab(targetId, updateHash = true) {
  const tabs = document.querySelectorAll('.nav-tab');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(t => {
    if (t.getAttribute('data-tab') === targetId) {
      t.classList.add('active');
    } else {
      t.classList.remove('active');
    }
  });

  contents.forEach(c => {
    if (c.id === targetId) {
      c.classList.add('active');
    } else {
      c.classList.remove('active');
    }
  });

  if (updateHash) {
    const hashMap = {
      'tab-live': '',
      'tab-hands': 'hands',
      'tab-leaderboard': 'leaderboard',
      'tab-testbench': 'testbench',
      'tab-register': 'register',
      'tab-errors': 'errors',
      'tab-howitworks': 'howitworks',
      'tab-contract': 'contract'
    };
    const newHash = hashMap[targetId] !== undefined ? hashMap[targetId] : '';
    if (newHash) {
      history.replaceState(null, '', '#' + newHash);
    } else {
      history.replaceState(null, '', window.location.pathname);
    }
  }

  if (targetId === 'tab-hands') loadHands();
  if (targetId === 'tab-leaderboard') loadLeaderboard();
  if (targetId === 'tab-errors') loadErrors();
}

function setupTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-tab');
      switchTab(targetId, true);
    });
  });

  // Intercept hash and doc links
  document.addEventListener('click', (e) => {
    const targetLink = e.target.closest('a');
    if (!targetLink) return;
    const href = targetLink.getAttribute('href');
    if (!href) return;

    if (href.startsWith('#')) {
      e.preventDefault();
      handleHashRoute(href);
    } else if (href === '/hands') {
      e.preventDefault();
      switchTab('tab-hands', true);
    } else if (href === '/how-it-works' || href === '/docs') {
      e.preventDefault();
      switchTab('tab-howitworks', true);
    } else if (href === '/contract' || href === '/api-contract' || href === '/spec') {
      e.preventDefault();
      switchTab('tab-contract', true);
    }
  });
}

// ---------------- LIVE TABLE ----------------
async function toggleTableRunner(triggerBtn) {
  const isPaused = triggerBtn.textContent.includes('Resume');
  const endpoint = isPaused ? '/api/table/start' : '/api/table/stop';
  try {
    const res = await fetch(endpoint, { method: 'POST' });
    const data = await res.json();
    updateRunnerStatus(data.isRunning);
  } catch (e) {
    console.error('Failed to toggle runner:', e);
  }
}

function setupLiveTable() {
  const toggleBtn = document.getElementById('btn-toggle-runner');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => toggleTableRunner(toggleBtn));
  }

  const toggleStandaloneRunnerBtn = document.getElementById('btn-toggle-runner-standalone');
  if (toggleStandaloneRunnerBtn) {
    toggleStandaloneRunnerBtn.addEventListener('click', () => toggleTableRunner(toggleStandaloneRunnerBtn));
  }

  const enterStandaloneBtn = document.getElementById('btn-enter-standalone');
  if (enterStandaloneBtn) {
    enterStandaloneBtn.addEventListener('click', () => {
      const isCurrentlyStandalone = document.body.classList.contains('standalone-table-mode');
      setStandaloneMode(!isCurrentlyStandalone, true);
    });
  }

  const exitStandaloneBtn = document.getElementById('btn-exit-standalone');
  if (exitStandaloneBtn) {
    exitStandaloneBtn.addEventListener('click', () => {
      setStandaloneMode(false, true);
    });
  }

  // Home Hero Banner Minimize/Expand
  const heroCard = document.getElementById('home-hero-card');
  const toggleHeroBtn = document.getElementById('btn-toggle-hero');
  const heroToggleLabel = document.getElementById('hero-toggle-label');
  const heroToggleArrow = document.getElementById('hero-toggle-arrow');

  if (heroCard && toggleHeroBtn) {
    const isHeroHidden = localStorage.getItem('hideHomeHero') === 'true';
    if (isHeroHidden) {
      heroCard.classList.add('collapsed');
      if (heroToggleLabel) heroToggleLabel.textContent = 'Show Intro';
      if (heroToggleArrow) heroToggleArrow.textContent = '▼';
    }

    toggleHeroBtn.addEventListener('click', () => {
      const isNowCollapsed = heroCard.classList.toggle('collapsed');
      if (heroToggleLabel) heroToggleLabel.textContent = isNowCollapsed ? 'Show Intro' : 'Minimize Banner';
      if (heroToggleArrow) heroToggleArrow.textContent = isNowCollapsed ? '▼' : '▲';
      localStorage.setItem('hideHomeHero', isNowCollapsed);
    });
  }

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
  const configs = [
    {
      dot: document.getElementById('runner-status-dot'),
      text: document.getElementById('runner-status-text'),
      btn: document.getElementById('btn-toggle-runner'),
      extraBtnClass: ''
    },
    {
      dot: document.getElementById('runner-status-dot-standalone'),
      text: document.getElementById('runner-status-text-standalone'),
      btn: document.getElementById('btn-toggle-runner-standalone'),
      extraBtnClass: ' btn-sm'
    }
  ];

  configs.forEach(({ dot, text, btn, extraBtnClass }) => {
    if (!dot || !text || !btn) return;
    if (isRunning) {
      dot.style.backgroundColor = '#10b981';
      dot.style.boxShadow = '0 0 10px #10b981';
      text.textContent = 'Runner Active';
      btn.textContent = 'Pause Table';
      btn.className = `btn btn-outline${extraBtnClass}`;
    } else {
      dot.style.backgroundColor = '#ef4444';
      dot.style.boxShadow = '0 0 10px #ef4444';
      text.textContent = 'Runner Paused';
      btn.textContent = 'Resume Table';
      btn.className = `btn btn-primary${extraBtnClass}`;
    }
  });
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
    const isBusted = seat.stack === 0 && seat.status !== 'all_in' || seat.status === 'sitting_out';
    const seatDiv = document.createElement('div');
    seatDiv.className = `seat ${isBusted ? 'folded busted' : seat.status}`;
    if (state.currentTurnSeat === seat.seatIndex) {
      seatDiv.classList.add('active-turn');
    }
    seatDiv.style.left = `${pos.x}%`;
    seatDiv.style.top = `${pos.y}%`;

    const isDealer = state.dealerSeat === seat.seatIndex;
    const isSB = state.smallBlindSeat === seat.seatIndex;
    const isBB = state.bigBlindSeat === seat.seatIndex;

    const posBadges = [];
    if (isDealer && !isBusted) posBadges.push('<span class="pos-pill pos-d" title="Dealer">D</span>');
    if (isSB && !isBusted) posBadges.push('<span class="pos-pill pos-sb" title="Small Blind">SB</span>');
    if (isBB && !isBusted) posBadges.push('<span class="pos-pill pos-bb" title="Big Blind">BB</span>');

    let statusPill = '';
    if (isBusted) {
      statusPill = '<span class="seat-status-pill eliminated">OUT</span>';
    } else if (seat.status === 'folded') {
      statusPill = '<span class="seat-status-pill folded">FOLD</span>';
    } else if (seat.status === 'all_in') {
      statusPill = '<span class="seat-status-pill all-in">ALL-IN</span>';
    }

    seatDiv.innerHTML = `
      ${isDealer && !isBusted ? '<div class="dealer-button">D</div>' : ''}
      <div class="seat-avatar" style="${isBusted ? 'opacity: 0.45;' : ''}">
        <div class="seat-header-row">
          <div class="seat-name"><span class="seat-robot-icon">🤖</span>${escapeHtml(seat.botName || `Bot ${seat.seatIndex}`)}</div>
          <div class="seat-pos-badges">${posBadges.join('')}</div>
        </div>
        <div class="seat-chips-row">
          <div class="seat-chips">${isBusted ? '<span style="color: #ef4444; font-weight: 700;">ELIMINATED</span>' : (seat.stack || 0).toLocaleString()}</div>
          ${statusPill}
        </div>
      </div>
      <div class="seat-bottom-row">
        <div class="seat-cards" id="seat-cards-${seat.seatIndex}"></div>
        ${seat.currentBet > 0 ? `<div class="seat-bet">Bet: ${seat.currentBet.toLocaleString()}</div>` : ''}
      </div>
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

      const wsUrl = `wss://feedmework.com/api/bots/ws?apiKey=${data.apiKey}`;
      const wsEl = document.getElementById('reg-res-wsurl');
      if (wsEl) wsEl.textContent = wsUrl;

      const runCmd = `python client.py --key ${data.apiKey}`;
      const cliEl = document.getElementById('reg-res-clicmd');
      if (cliEl) cliEl.textContent = runCmd;

      const copyBtn = document.getElementById('btn-copy-clicmd');
      if (copyBtn) {
        copyBtn.onclick = () => {
          navigator.clipboard.writeText(runCmd);
          copyBtn.textContent = '✅ Copied!';
          setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
        };
      }

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

// ---------------- HAND HISTORY & TELEMETRY ----------------
let currentHandFilter = { botId: '', limit: '25' };

function setupHandHistory() {
  const botFilter = document.getElementById('hands-bot-filter');
  const limitFilter = document.getElementById('hands-limit-filter');
  const refreshBtn = document.getElementById('btn-refresh-hands');

  if (botFilter) {
    botFilter.addEventListener('change', () => {
      currentHandFilter.botId = botFilter.value;
      loadHands();
    });
  }

  if (limitFilter) {
    limitFilter.addEventListener('change', () => {
      currentHandFilter.limit = limitFilter.value;
      loadHands();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadHands);
  }

  // Modal close handlers
  const modal = document.getElementById('hand-detail-modal');
  const closeBtn = document.getElementById('btn-close-hand-modal');
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
        modal.classList.add('hidden');
      }
    });
  }

  loadBotFilterOptions();
}

async function loadBotFilterOptions() {
  const botSelect = document.getElementById('hands-bot-filter');
  if (!botSelect) return;
  try {
    const res = await fetch('/api/bots');
    if (!res.ok) return;
    const { bots } = await res.json();
    botSelect.innerHTML = '<option value="">All Arena Bots (Global Feed)</option>';
    bots.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = `${b.name} (${b.id})${b.is_house ? ' [House]' : ''}`;
      botSelect.appendChild(opt);
    });
  } catch (e) {
    // Non-critical
  }
}

async function loadHands() {
  const tbody = document.getElementById('hands-tbody');
  const statsElem = document.getElementById('hands-filter-stats');
  const apiLink = document.getElementById('hands-api-link');
  if (!tbody) return;

  const { botId, limit } = currentHandFilter;
  const endpoint = `/api/hands?limit=${limit}${botId ? `&botId=${encodeURIComponent(botId)}` : ''}`;
  if (apiLink) {
    apiLink.href = endpoint;
  }

  try {
    statsElem.textContent = 'Fetching hand records...';
    const res = await fetch(endpoint);
    const data = await res.json();
    const hands = data.hands || [];

    if (hands.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center">No hands recorded yet for this filter.</td></tr>';
      statsElem.textContent = '0 hands found.';
      return;
    }

    statsElem.textContent = `Showing ${hands.length} recent hands.`;
    tbody.innerHTML = '';

    hands.forEach(h => {
      const tr = document.createElement('tr');
      tr.className = 'hand-row';

      // Board runout mini cards
      const boardContainer = document.createElement('div');
      boardContainer.className = 'card-hand-chips';
      for (let i = 0; i < 5; i++) {
        const c = h.communityCards ? h.communityCards[i] : null;
        if (c) {
          boardContainer.appendChild(createMiniCard(c));
        } else {
          const slot = document.createElement('div');
          slot.className = 'mini-card-slot';
          boardContainer.appendChild(slot);
        }
      }

      // Winners display
      let winnersHtml = '<span class="text-muted">Uncontested</span>';
      if (h.winners && h.winners.length > 0) {
        winnersHtml = h.winners.map(w => `
          <div class="winner-pill">
            <span>🏆</span>
            <strong>${escapeHtml(w.botName || `Seat ${w.seatIndex}`)}</strong>
            <span style="color: #34d399;">(+${(w.amount || 0).toLocaleString()})</span>
          </div>
        `).join('');
      }

      const timeStr = h.created_at ? new Date(h.created_at).toLocaleTimeString() : '';

      tr.innerHTML = `
        <td><code style="color: #38bdf8; font-weight: 700;">${escapeHtml(h.id)}</code></td>
        <td><strong style="color: var(--accent-gold);">${escapeHtml(h.game_id || 'Match')}</strong></td>
        <td></td>
        <td><span class="pot-chip-badge">${(h.total_pot || 0).toLocaleString()} chips</span></td>
        <td>${winnersHtml}</td>
        <td><code>${h.small_blind}/${h.big_blind}</code></td>
        <td class="text-muted">${timeStr}</td>
        <td>
          <button class="btn btn-outline btn-sm btn-inspect-hand" data-handid="${escapeHtml(h.id)}">
            🔍 Inspect
          </button>
        </td>
      `;

      // Insert board cards into 3rd column
      tr.children[2].appendChild(boardContainer);

      tr.querySelector('.btn-inspect-hand').addEventListener('click', () => {
        inspectHand(h.id);
      });

      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="color: #ef4444;">Failed to load hands: ${escapeHtml(e.message)}</td></tr>`;
    statsElem.textContent = 'Error loading hands.';
  }
}

function createMiniCard(cardCode) {
  const rank = cardCode[0];
  const suit = cardCode[1];
  const suitInfo = SUIT_ICONS[suit] || { char: suit, isRed: false };
  const div = document.createElement('div');
  div.className = `mini-card ${suitInfo.isRed ? 'red' : 'black'}`;
  div.textContent = `${rank}${suitInfo.char}`;
  return div;
}

async function inspectHand(handId) {
  const modal = document.getElementById('hand-detail-modal');
  const title = document.getElementById('modal-hand-title');
  const meta = document.getElementById('modal-hand-meta');
  const body = document.getElementById('modal-hand-body');
  const rawLink = document.getElementById('modal-raw-link');
  const copyBtn = document.getElementById('btn-copy-hand-json');

  if (!modal || !body) return;

  modal.classList.remove('hidden');
  title.textContent = `Hand Replay: ${handId}`;
  meta.textContent = 'Loading hand telemetry...';
  body.innerHTML = '<div class="text-center" style="padding: 40px;">Fetching full hand exchange logs...</div>';

  try {
    const res = await fetch(`/api/hands/${encodeURIComponent(handId)}`);
    if (!res.ok) {
      body.innerHTML = `<div class="summary-box error">Failed to load hand ${escapeHtml(handId)}</div>`;
      return;
    }

    const data = await res.json();
    const { hand, players } = data;

    meta.textContent = `Match: ${hand.game_id} · Dealer: Seat ${hand.dealer_seat} · Blinds: ${hand.small_blind}/${hand.big_blind} · Total Pot: ${hand.total_pot.toLocaleString()} chips`;
    if (rawLink) rawLink.href = `/api/hands/${encodeURIComponent(handId)}`;

    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(JSON.stringify(data, null, 2));
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '✅ Copied!';
        setTimeout(() => { copyBtn.textContent = originalText; }, 2000);
      };
    }

    // Build modal body
    body.innerHTML = '';

    // 1. Board Section
    const boardSection = document.createElement('div');
    boardSection.className = 'modal-board-section';
    boardSection.innerHTML = `
      <div>
        <div style="font-size: 11px; font-weight: 700; color: #34d399; letter-spacing: 1px; margin-bottom: 6px;">COMMUNITY BOARD RUNOUT</div>
        <div class="board-cards-display" id="modal-board-cards"></div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 11px; color: var(--text-muted); font-weight: 600;">FINAL POT</div>
        <div class="pot-badge" style="margin: 0; font-size: 18px;">${hand.total_pot.toLocaleString()} chips</div>
      </div>
    `;

    const boardCardsContainer = boardSection.querySelector('#modal-board-cards');
    for (let i = 0; i < 5; i++) {
      const c = hand.communityCards ? hand.communityCards[i] : null;
      if (c) {
        const rank = c[0];
        const suit = c[1];
        const suitInfo = SUIT_ICONS[suit] || { char: suit, isRed: false };
        const cardDiv = document.createElement('div');
        cardDiv.className = `board-card-lg ${suitInfo.isRed ? 'red' : 'black'}`;
        cardDiv.innerHTML = `<span>${rank}</span><span>${suitInfo.char}</span>`;
        boardCardsContainer.appendChild(cardDiv);
      } else {
        const slot = document.createElement('div');
        slot.className = 'card card-slot';
        slot.style.width = '44px';
        slot.style.height = '60px';
        boardCardsContainer.appendChild(slot);
      }
    }
    body.appendChild(boardSection);

    // 2. Players Grid
    const playersTitle = document.createElement('h4');
    playersTitle.style.fontSize = '14px';
    playersTitle.style.fontWeight = '700';
    playersTitle.style.color = 'var(--text-secondary)';
    playersTitle.textContent = 'TABLE PARTICIPANTS & CHIP SWINGS';
    body.appendChild(playersTitle);

    const playersGrid = document.createElement('div');
    playersGrid.className = 'modal-players-grid';

    (players || []).forEach(p => {
      const isWinner = (hand.winners || []).some(w => w.seatIndex === p.seat_index);
      const pCard = document.createElement('div');
      pCard.className = `modal-player-card ${isWinner ? 'winner' : ''}`;

      const net = p.net_chips || 0;
      const netClass = net > 0 ? 'positive' : (net < 0 ? 'negative' : '');
      const netSign = net > 0 ? '+' : '';

      let holeCardsHtml = '<span class="text-muted">Cards Mucked</span>';
      if (p.holeCards && p.holeCards.length > 0) {
        holeCardsHtml = p.holeCards.map(c => {
          const rank = c[0];
          const suit = c[1];
          const suitInfo = SUIT_ICONS[suit] || { char: suit, isRed: false };
          return `<span style="font-weight: 800; color: ${suitInfo.isRed ? '#f87171' : '#f8fafc'};">${rank}${suitInfo.char}</span>`;
        }).join(' ');
      }

      pCard.innerHTML = `
        <div class="mp-header">
          <div class="mp-name">${isWinner ? '🏆 ' : ''}Seat ${p.seat_index}: ${escapeHtml(p.bot_name || p.bot_id)}</div>
          <div class="mp-net ${netClass}">${netSign}${net.toLocaleString()}</div>
        </div>
        <div class="mp-details">
          <div>Stack: <strong>${p.starting_stack.toLocaleString()} &rarr; ${p.final_stack.toLocaleString()}</strong></div>
          <div>[ ${holeCardsHtml} ]</div>
        </div>
        ${p.rank_description ? `<div style="font-size: 11px; color: #a5b4fc; margin-top: 6px; font-weight: 600;">${escapeHtml(p.rank_description)}</div>` : ''}
      `;
      playersGrid.appendChild(pCard);
    });
    body.appendChild(playersGrid);

    // 3. Street-by-street Action Timeline
    const timelineTitle = document.createElement('h4');
    timelineTitle.style.fontSize = '14px';
    timelineTitle.style.fontWeight = '700';
    timelineTitle.style.color = 'var(--text-secondary)';
    timelineTitle.textContent = 'STREET-BY-STREET ACTION TIMELINE';
    body.appendChild(timelineTitle);

    const timelineContainer = document.createElement('div');
    timelineContainer.className = 'action-timeline';

    const groupedActions = {
      preflop: [],
      flop: [],
      turn: [],
      river: [],
      showdown: []
    };

    (hand.actionHistory || []).forEach(act => {
      const stage = (act.stage || 'preflop').toLowerCase();
      if (!groupedActions[stage]) groupedActions[stage] = [];
      groupedActions[stage].push(act);
    });

    ['preflop', 'flop', 'turn', 'river'].forEach(stageName => {
      const acts = groupedActions[stageName] || [];
      if (acts.length === 0 && stageName !== 'preflop') return;

      const streetDiv = document.createElement('div');
      streetDiv.className = 'timeline-street';

      streetDiv.innerHTML = `
        <div class="street-header">
          <span>${stageName.toUpperCase()}</span>
          <span>${acts.length} Actions</span>
        </div>
        <div class="street-actions-list"></div>
      `;

      const list = streetDiv.querySelector('.street-actions-list');
      if (acts.length === 0) {
        list.innerHTML = '<div class="text-muted" style="font-size: 12px;">No betting on this street.</div>';
      } else {
        acts.forEach(act => {
          const row = document.createElement('div');
          row.className = 'action-row';

          const bot = players.find(p => p.seat_index === act.seatIndex);
          const botName = bot ? (bot.bot_name || `Seat ${act.seatIndex}`) : `Seat ${act.seatIndex}`;

          let badgeClass = act.action.toLowerCase();
          let actionLabel = act.action.toUpperCase();
          if (act.action === 'raise') {
            actionLabel = `RAISE TO ${act.amount ? act.amount.toLocaleString() : ''}`;
          } else if (act.action === 'call') {
            actionLabel = `CALL ${act.amount ? act.amount.toLocaleString() : ''}`;
          }

          row.innerHTML = `
            <div>
              <strong>${escapeHtml(botName)}</strong>
              <span class="text-muted" style="font-size: 11px; margin-left: 6px;">(Seat ${act.seatIndex})</span>
            </div>
            <div>
              <span class="act-badge ${badgeClass}">${actionLabel}</span>
            </div>
          `;
          list.appendChild(row);
        });
      }

      timelineContainer.appendChild(streetDiv);
    });

    body.appendChild(timelineContainer);

  } catch (e) {
    body.innerHTML = `<div class="summary-box error">Error loading hand replay: ${escapeHtml(e.message)}</div>`;
  }
}

// ---------------- HOW IT WORKS ----------------
function setupHowItWorks() {
  const btnLlm = document.getElementById('btn-show-llm');
  const btnPython = document.getElementById('btn-show-python');
  const btnTs = document.getElementById('btn-show-ts');
  const snippetLlm = document.getElementById('code-snippet-llm');
  const snippetPython = document.getElementById('code-snippet-python');
  const snippetTs = document.getElementById('code-snippet-ts');

  function selectTab(activeBtn, activeSnippet) {
    [btnLlm, btnPython, btnTs].forEach(b => { if (b) b.classList.remove('active-code-tab'); });
    [snippetLlm, snippetPython, snippetTs].forEach(s => { if (s) s.classList.add('hidden'); });
    if (activeBtn) activeBtn.classList.add('active-code-tab');
    if (activeSnippet) activeSnippet.classList.remove('hidden');
  }

  if (btnLlm && snippetLlm) {
    btnLlm.addEventListener('click', () => selectTab(btnLlm, snippetLlm));
  }
  if (btnPython && snippetPython) {
    btnPython.addEventListener('click', () => selectTab(btnPython, snippetPython));
  }
  if (btnTs && snippetTs) {
    btnTs.addEventListener('click', () => selectTab(btnTs, snippetTs));
  }

  // Copy code buttons
  const copyLlm = document.getElementById('btn-copy-llm-code');
  if (copyLlm) {
    copyLlm.addEventListener('click', () => {
      const code = document.getElementById('code-llm-pre').innerText;
      navigator.clipboard.writeText(code);
      copyLlm.textContent = '✅ Copied!';
      setTimeout(() => { copyLlm.textContent = '📋 Copy Code'; }, 2000);
    });
  }

  const copyPython = document.getElementById('btn-copy-python-code');
  if (copyPython) {
    copyPython.addEventListener('click', () => {
      const code = document.getElementById('code-python-pre').innerText;
      navigator.clipboard.writeText(code);
      copyPython.textContent = '✅ Copied!';
      setTimeout(() => { copyPython.textContent = '📋 Copy Code'; }, 2000);
    });
  }

  const copyTs = document.getElementById('btn-copy-ts-code');
  if (copyTs) {
    copyTs.addEventListener('click', () => {
      const code = document.getElementById('code-ts-pre').innerText;
      navigator.clipboard.writeText(code);
      copyTs.textContent = '✅ Copied!';
      setTimeout(() => { copyTs.textContent = '📋 Copy Code'; }, 2000);
    });
  }
}

// ---------------- API CONTRACT & CHEAT SHEET ----------------
function setupContractCheatSheet() {
  const wireCopy = (btnId, codeId, defaultText = '📋 Copy') => {
    const btn = document.getElementById(btnId);
    const codeEl = document.getElementById(codeId);
    if (!btn || !codeEl) return;

    btn.addEventListener('click', () => {
      const text = codeEl.innerText;
      navigator.clipboard.writeText(text);
      const originalText = btn.textContent;
      btn.textContent = '✅ Copied!';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    });
  };

  wireCopy('btn-copy-req-spec', 'code-req-spec', 'Copy');
  wireCopy('btn-copy-res-spec', 'code-res-spec', 'Copy');
  wireCopy('btn-copy-curl-spec', 'code-curl-spec', '📋 Copy Curl Command');
}

