'use strict';

// CODE-ROYALE: Next-Gen Esports Client
const app = document.getElementById('app');
const pathName = location.pathname.replace(/\/+$/, '') || '/';
const isAdmin = pathName.startsWith('/admin');
const playerId = pathName.endsWith('/2') ? '2' : '1';
const playerQuery = isAdmin ? '' : `?player=${playerId}`;

// State Management
let state = null;
let currentView = 'match'; // 'match', 'score', 'screen'
const soundStorageKey = isAdmin ? 'cr_admin_sound' : `cr_player_sound_${playerId}`;
let soundOn = true;
try {
  const savedSound = localStorage.getItem(soundStorageKey);
  if (savedSound !== null) soundOn = savedSound === 'true';
} catch {}

let lastPhase = '';
let lastRound = 0;
let lastCountdownTick = null;
let lastRevealPlayedRound = 0;
let countdownAudio = null;

// Strict Audio Alternation State (Starts with 1 for both outcomes)
let winnerCounter = 0;
let loserCounter = 0;
let lastFinishedMatchKey = null;

try {
  const savedWin = sessionStorage.getItem('cr_win_count');
  if (savedWin !== null) winnerCounter = Number(savedWin) || 0;
  const savedLose = sessionStorage.getItem('cr_lose_count');
  if (savedLose !== null) loserCounter = Number(savedLose) || 0;
  lastFinishedMatchKey = sessionStorage.getItem('cr_last_match_key') || null;
} catch {}

// Escaping helper
const esc = str => String(str ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));

// Sound Engine
function playSound(name, rate = 1.0) {
  if (!soundOn) return null;
  try {
    const audio = new Audio(`/sounds/${name}.mp3`);
    audio.volume = 0.85;
    if (rate !== 1.0) audio.playbackRate = rate;
    audio.play().catch(() => {});
    return audio;
  } catch {
    return null;
  }
}

function handleSoundEvents() {
  if (!state) return;

  // 1. Countdown sound (ONLY during initial match countdown in Round 1)
  if (state.phase === 'countdown') {
    if (state.round === 1) {
      const seconds = Math.max(1, Math.ceil((state.deadline - Date.now()) / 1000));
      if (seconds !== lastCountdownTick) {
        lastCountdownTick = seconds;
        // Stop overlapping countdown audio before next tick
        if (countdownAudio) {
          try { countdownAudio.pause(); countdownAudio.currentTime = 0; } catch {}
          countdownAudio = null;
        }
        countdownAudio = playSound('countdown', 0.9);
      }
    } else {
      // Later rounds (2, 3, 4, 5) show visual timer but are completely silent
      if (countdownAudio) {
        try { countdownAudio.pause(); countdownAudio.currentTime = 0; } catch {}
        countdownAudio = null;
      }
      lastCountdownTick = null;
    }
  } else {
    if (countdownAudio) {
      try { countdownAudio.pause(); countdownAudio.currentTime = 0; } catch {}
      countdownAudio = null;
    }
    lastCountdownTick = null;
  }

  // 2. Go sound (ONLY once after initial countdown when Round 1 starts)
  if (state.phase === 'question' && state.round === 1 && (lastPhase !== 'question' || lastRound !== state.round)) {
    playSound('go');
  }

  // 3. Reveal sound (correct / wrong)
  if (state.phase === 'reveal' && lastPhase !== 'reveal' && lastRevealPlayedRound !== state.round) {
    lastRevealPlayedRound = state.round;
    if (!isAdmin) {
      const mine = state.history && state.history.length ? state.history[state.history.length - 1]?.mine : null;
      playSound(mine?.correct ? 'correct' : 'wrong');
    } else {
      // Admin hears match feedback: correct if at least one answered right, wrong if both wrong
      const lastH = state.history && state.history.length ? state.history[state.history.length - 1] : null;
      const p1Correct = !!(lastH && lastH.players && lastH.players[1] && lastH.players[1].correct);
      const p2Correct = !!(lastH && lastH.players && lastH.players[2] && lastH.players[2].correct);
      if (p1Correct || p2Correct) {
        playSound('correct');
      } else {
        playSound('wrong');
      }
    }
  }

  // 4. Match finish result sound (Strict Alternation: exactly once per match result)
  if (state.phase === 'finished') {
    const matchKey = (state.history && state.history.length)
      ? state.history.map(h => h.id).join('-')
      : String(state.deadline || state.updated);

    if (lastFinishedMatchKey !== matchKey) {
      lastFinishedMatchKey = matchKey;
      try { sessionStorage.setItem('cr_last_match_key', matchKey); } catch {}

      if (state.winnerPlayerId === null) {
        // Draw: does not advance winner or loser alternation counters
        playSound('draw');
      } else if (isAdmin) {
        // Admin hears winner presentation: strict alternation winner1 -> winner2 -> winner1
        winnerCounter++;
        try { sessionStorage.setItem('cr_win_count', String(winnerCounter)); } catch {}
        const fallbackTrack = (winnerCounter % 2 === 1) ? 'winner1' : 'winner2';
        playSound(state.winnerTrack || fallbackTrack);
      } else if (state.winnerPlayerId === playerId) {
        // Player WON: strict alternation winner1 -> winner2 -> winner1
        winnerCounter++;
        try { sessionStorage.setItem('cr_win_count', String(winnerCounter)); } catch {}
        const fallbackTrack = (winnerCounter % 2 === 1) ? 'winner1' : 'winner2';
        playSound(state.winnerTrack || fallbackTrack);
      } else {
        // Player LOST: strict alternation loser1 -> loser2 -> loser1
        loserCounter++;
        try { sessionStorage.setItem('cr_lose_count', String(loserCounter)); } catch {}
        const fallbackTrack = (loserCounter % 2 === 1) ? 'loser1' : 'loser2';
        playSound(state.loserTrack || fallbackTrack);
      }
    }
  }

  lastPhase = state.phase;
  lastRound = state.round;
}

// Server Communication
async function act(data) {
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (!res.ok) {
      alert(result.error || 'Action could not be completed.');
    }
    await refresh();
    return result;
  } catch {
    alert('Cannot reach the game server. Check network connection.');
  }
}

async function refresh() {
  try {
    const res = await fetch('/api/state' + playerQuery, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state = await res.json();
    handleSoundEvents();
    render();
  } catch {
    // If server unreachable
    if (!app.dataset.error) {
      app.dataset.error = '1';
      app.innerHTML = `
        <header class="top-bar">
          <div class="brand-wrap"><div class="brand-logo">CODE<span>•</span>ROYALE</div></div>
        </header>
        <div class="panel" style="text-align:center; padding: 40px 20px;">
          <h2 style="color:var(--rose); margin-bottom: 12px;">⚠️ Server Connection Lost</h2>
          <p class="p-score-sub">Waiting for server on host laptop... Retrying automatically.</p>
        </div>
      `;
    }
  }
}

let playerChosenChoice = null;

// UI Components
function renderHeader(tagText, tagClass = 'badge-cyan') {
  return `
    <header class="top-bar">
      <div class="brand-wrap">
        <div class="brand-logo">CODE<span>•</span>ROYALE</div>
      </div>
      <div class="top-actions">
        <span class="badge ${tagClass}">${tagText}</span>
        <button class="btn-sound" onclick="toggleSound()">
          ${soundOn ? '🔊 Sound ON' : '🔇 Sound OFF'}
        </button>
      </div>
    </header>
  `;
}

function renderDuelHUD() {
  const p1 = state.players['1'];
  const p2 = state.players['2'];
  const isP1 = playerId === '1';
  const isP2 = playerId === '2';

  return `
    <div class="duel-hud">
      <!-- Player 1 -->
      <div class="duel-player p1 ${isP1 ? 'is-me' : ''}">
        <div class="duel-score">${p1.score}<small>PTS</small></div>
        <div class="duel-info">
          <div class="duel-name">
            ${esc(p1.name)} ${isP1 ? '<span class="badge badge-cyan" style="font-size:9px; padding:2px 6px;">YOU</span>' : ''}
          </div>
          <span class="duel-status ${p1.hasAnswered ? 'status-locked' : 'status-thinking'}">
            ${p1.hasAnswered ? '⚡ LOCKED IN' : '⏳ THINKING'}
          </span>
        </div>
      </div>

      <!-- Center VS & Progress -->
      <div class="duel-center">
        <div class="duel-vs">VS</div>
        <div class="duel-progress">
          <div class="progress-dots">
            ${[1, 2, 3, 4, 5].map(i => `
              <span class="p-dot ${i === state.round ? 'current' : i < state.round ? 'done' : ''}"></span>
            `).join('')}
          </div>
          <span class="duel-round-label">ROUND ${state.round}/5</span>
        </div>
      </div>

      <!-- Player 2 -->
      <div class="duel-player p2 ${isP2 ? 'is-me' : ''}">
        <div class="duel-info" style="text-align:right;">
          <div class="duel-name">
            ${esc(p2.name)} ${isP2 ? '<span class="badge badge-magenta" style="font-size:9px; padding:2px 6px;">YOU</span>' : ''}
          </div>
          <span class="duel-status ${p2.hasAnswered ? 'status-locked' : 'status-thinking'}">
            ${p2.hasAnswered ? '⚡ LOCKED IN' : '⏳ THINKING'}
          </span>
        </div>
        <div class="duel-score">${p2.score}<small>PTS</small></div>
      </div>
    </div>
  `;
}

function renderPlayerCards() {
  const p1 = state.players['1'];
  const p2 = state.players['2'];

  function card(id, p) {
    const isP1 = id === '1';
    const accentClass = isP1 ? 'p1' : 'p2';
    const statusClass = p.status === 'READY' ? 'status-ready' :
      p.status === 'PLAYING' ? 'status-playing' : 'status-waiting';

    return `
      <div class="player-card ${accentClass}">
        <div class="p-header">
          <span class="badge ${isP1 ? 'badge-cyan' : 'badge-magenta'}">PLAYER ${id}</span>
          <span class="p-status-pill ${statusClass}">
            ${p.connected ? '●' : '○'} ${esc(p.status)}
          </span>
        </div>
        <div class="p-name">${esc(p.name)}</div>
        <div class="p-score-wrap">
          <div class="p-score">${p.score}</div>
          <span class="p-score-sub">PTS</span>
        </div>
      </div>
    `;
  }

  return `<div class="players-grid">${card('1', p1)}${card('2', p2)}</div>`;
}

function renderAdminWinnerCelebration() {
  const isDraw = state.winnerPlayerId === null;
  const p1 = state.players['1'];
  const p2 = state.players['2'];

  let p1Correct = 0, p2Correct = 0;
  for (const h of state.history || []) {
    if (h.players && h.players[1] && h.players[1].correct) p1Correct++;
    if (h.players && h.players[2] && h.players[2].correct) p2Correct++;
  }

  if (isDraw) {
    return `
      <section class="winner-hero">
        <div class="trophy-badge">🤝</div>
        <div class="champ-ribbon" style="background:var(--gold); color:#041017;">MATCH TIED — SPLIT HONORS</div>
        <h1 class="champ-name">HONORABLE DRAW!</h1>
        <div class="winner-sub">
          Both players scored equally (${p1.score} pts) and matched tie-breaker speed!
        </div>

        <div class="podium-grid">
          <div class="podium-card" style="border: 2px solid var(--cyan); box-shadow: 0 10px 40px rgba(0,0,0,0.6), var(--cyan-glow);">
            <div class="podium-rank" style="color:var(--cyan);">🤝 TIED • PLAYER 1</div>
            <div class="podium-name">${esc(p1.name)}</div>
            <div class="podium-score" style="color:var(--cyan);">${p1.score} <small>PTS</small></div>
            <div class="podium-meta">
              <span>✓ ${p1Correct}/5 Correct</span>
              <span>⚡ ${(p1.correctTimeMs / 1000).toFixed(1)}s Speed</span>
            </div>
          </div>

          <div class="podium-card" style="border: 2px solid var(--magenta); box-shadow: 0 10px 40px rgba(0,0,0,0.6), var(--magenta-glow);">
            <div class="podium-rank" style="color:var(--magenta);">🤝 TIED • PLAYER 2</div>
            <div class="podium-name">${esc(p2.name)}</div>
            <div class="podium-score" style="color:var(--magenta);">${p2.score} <small>PTS</small></div>
            <div class="podium-meta">
              <span>✓ ${p2Correct}/5 Correct</span>
              <span>⚡ ${(p2.correctTimeMs / 1000).toFixed(1)}s Speed</span>
            </div>
          </div>
        </div>

        <!-- Head to Head Summary -->
        <table class="h2h-table" style="max-width:680px; margin: 20px auto 0;">
          <thead>
            <tr>
              <th class="h2h-metric">Head-to-Head</th>
              <th style="color:var(--cyan);">${esc(p1.name)}</th>
              <th style="color:var(--magenta);">${esc(p2.name)}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="h2h-metric">Final Score</td>
              <td style="color:var(--cyan); font-weight:800;">${p1.score} pts</td>
              <td style="color:var(--magenta); font-weight:800;">${p2.score} pts</td>
            </tr>
            <tr>
              <td class="h2h-metric">Correct Answers</td>
              <td>${p1Correct} / 5</td>
              <td>${p2Correct} / 5</td>
            </tr>
            <tr>
              <td class="h2h-metric">Tie-Break Time</td>
              <td>${(p1.correctTimeMs / 1000).toFixed(1)}s</td>
              <td>${(p2.correctTimeMs / 1000).toFixed(1)}s</td>
            </tr>
            <tr>
              <td class="h2h-metric">Result</td>
              <td style="color:var(--gold); font-weight:800;">🤝 DRAW</td>
              <td style="color:var(--gold); font-weight:800;">🤝 DRAW</td>
            </tr>
          </tbody>
        </table>
      </section>
    `;
  }

  const winnerId = state.winnerPlayerId;
  const loserId = winnerId === '1' ? '2' : '1';
  const winner = state.players[winnerId];
  const loser = state.players[loserId];
  const isP1 = winnerId === '1';
  const winnerCorrect = isP1 ? p1Correct : p2Correct;
  const loserCorrect = isP1 ? p2Correct : p1Correct;

  return `
    <section class="winner-hero ${isP1 ? 'is-p1' : 'is-p2'}">
      <div class="trophy-badge">🏆</div>
      <div class="champ-ribbon">CODE-ROYALE ESPORTS CHAMPION</div>
      <h1 class="champ-name">${esc(winner.name)}</h1>
      <div class="winner-sub">
        Crown Champion! Outstanding performance across 5 rounds.
      </div>

      <div class="podium-grid">
        <!-- 1st Place Champion Card -->
        <div class="podium-card podium-winner ${isP1 ? 'is-p1' : 'is-p2'}">
          <div class="podium-rank">👑 1ST PLACE • CHAMPION</div>
          <div class="podium-name">${esc(winner.name)}</div>
          <div class="podium-score">${winner.score} <small>PTS</small></div>
          <div class="podium-meta">
            <span>✓ ${winnerCorrect}/5 Correct</span>
            <span>⚡ ${(winner.correctTimeMs / 1000).toFixed(1)}s Speed</span>
          </div>
        </div>

        <!-- 2nd Place Runner-Up Card -->
        <div class="podium-card podium-runner-up">
          <div class="podium-rank">🥈 2ND PLACE • RUNNER-UP</div>
          <div class="podium-name">${esc(loser.name)}</div>
          <div class="podium-score">${loser.score} <small>PTS</small></div>
          <div class="podium-meta">
            <span>${loserCorrect}/5 Correct</span>
            <span>⚡ ${(loser.correctTimeMs / 1000).toFixed(1)}s Speed</span>
          </div>
        </div>
      </div>

      <!-- Head to Head Summary -->
      <table class="h2h-table" style="max-width:680px; margin: 20px auto 0;">
        <thead>
          <tr>
            <th class="h2h-metric">Head-to-Head</th>
            <th style="color:var(--cyan);">${esc(p1.name)} ${isP1 ? '(Champion)' : ''}</th>
            <th style="color:var(--magenta);">${esc(p2.name)} ${!isP1 ? '(Champion)' : ''}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="h2h-metric">Final Score</td>
            <td style="color:var(--cyan); font-weight:800;">${p1.score} pts</td>
            <td style="color:var(--magenta); font-weight:800;">${p2.score} pts</td>
          </tr>
          <tr>
            <td class="h2h-metric">Correct Answers</td>
            <td>${p1Correct} / 5</td>
            <td>${p2Correct} / 5</td>
          </tr>
          <tr>
            <td class="h2h-metric">Tie-Break Time</td>
            <td>${(p1.correctTimeMs / 1000).toFixed(1)}s</td>
            <td>${(p2.correctTimeMs / 1000).toFixed(1)}s</td>
          </tr>
          <tr>
            <td class="h2h-metric">Result</td>
            <td style="font-weight:800; color:${isP1 ? 'var(--gold)' : 'var(--text-muted)'};">
              ${isP1 ? '🏆 CHAMPION' : '🥈 RUNNER-UP'}
            </td>
            <td style="font-weight:800; color:${!isP1 ? 'var(--gold)' : 'var(--text-muted)'};">
              ${!isP1 ? '🏆 CHAMPION' : '🥈 RUNNER-UP'}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  `;
}

function renderAdminLiveMatch(isBigScreen = false) {
  const p1 = state.players['1'];
  const p2 = state.players['2'];
  const lastH = (state.history && state.history.length) ? state.history[state.history.length - 1] : null;
  const p1Ans = (state.phase === 'reveal' && lastH?.players) ? lastH.players[1] : null;
  const p2Ans = (state.phase === 'reveal' && lastH?.players) ? lastH.players[2] : null;

  // Compute round winner info if reveal
  let roundBannerHtml = '';
  if (state.phase === 'reveal') {
    if (p1Ans?.correct && p2Ans?.correct) {
      if (p1Ans.timeMs < p2Ans.timeMs) {
        const diff = ((p2Ans.timeMs - p1Ans.timeMs) / 1000).toFixed(1);
        roundBannerHtml = `
          <div class="round-winner-banner">
            <span class="round-trophy">👑</span>
            <div>
              <div class="round-winner-title">ROUND WINNER: ${esc(p1.name)}!</div>
              <div class="round-winner-sub">Both answered correctly! ${esc(p1.name)} was faster by ${diff}s (+10 pts each)</div>
            </div>
          </div>
        `;
      } else if (p2Ans.timeMs < p1Ans.timeMs) {
        const diff = ((p1Ans.timeMs - p2Ans.timeMs) / 1000).toFixed(1);
        roundBannerHtml = `
          <div class="round-winner-banner">
            <span class="round-trophy">👑</span>
            <div>
              <div class="round-winner-title">ROUND WINNER: ${esc(p2.name)}!</div>
              <div class="round-winner-sub">Both answered correctly! ${esc(p2.name)} was faster by ${diff}s (+10 pts each)</div>
            </div>
          </div>
        `;
      } else {
        roundBannerHtml = `
          <div class="round-winner-banner banner-tied">
            <span class="round-trophy">🤝</span>
            <div>
              <div class="round-winner-title">TIED SPEED — BOTH SCORED!</div>
              <div class="round-winner-sub">Both answered correctly with equal speed (+10 pts each)</div>
            </div>
          </div>
        `;
      }
    } else if (p1Ans?.correct && !p2Ans?.correct) {
      roundBannerHtml = `
        <div class="round-winner-banner">
          <span class="round-trophy">👑</span>
          <div>
            <div class="round-winner-title">ROUND WINNER: ${esc(p1.name)}!</div>
            <div class="round-winner-sub">Only ${esc(p1.name)} solved it correctly (+10 pts)</div>
          </div>
        </div>
      `;
    } else if (p2Ans?.correct && !p1Ans?.correct) {
      roundBannerHtml = `
        <div class="round-winner-banner">
          <span class="round-trophy">👑</span>
          <div>
            <div class="round-winner-title">ROUND WINNER: ${esc(p2.name)}!</div>
            <div class="round-winner-sub">Only ${esc(p2.name)} solved it correctly (+10 pts)</div>
          </div>
        </div>
      `;
    } else {
      roundBannerHtml = `
        <div class="round-winner-banner banner-none">
          <span class="round-trophy">❌</span>
          <div>
            <div class="round-winner-title">NO ROUND WINNER</div>
            <div class="round-winner-sub">Neither player answered correctly (+0 pts)</div>
          </div>
        </div>
      `;
    }
  }

  // Card highlight classes
  let p1CardClass = '';
  let p2CardClass = '';
  if (state.phase === 'question') {
    if (p1.hasAnswered) p1CardClass = 'card-eval-locked-p1';
    if (p2.hasAnswered) p2CardClass = 'card-eval-locked-p2';
  } else if (state.phase === 'reveal') {
    p1CardClass = p1Ans?.correct ? 'card-eval-correct' : 'card-eval-wrong';
    p2CardClass = p2Ans?.correct ? 'card-eval-correct' : 'card-eval-wrong';
  }

  // Status badges
  function playerStatusBadge(p, ans) {
    if (state.phase === 'countdown') {
      return `<span class="duel-status status-thinking">⏳ PREPARING</span>`;
    }
    if (state.phase === 'question') {
      if (p.hasAnswered) return `<span class="duel-status status-locked pulse-glow">⚡ LOCKED IN</span>`;
      return `<span class="duel-status status-thinking">⏳ THINKING...</span>`;
    }
    if (state.phase === 'reveal') {
      if (ans?.correct) return `<span class="admin-eval-pill eval-correct">✅ CORRECT (+10)</span>`;
      if (ans && !ans.correct) return `<span class="admin-eval-pill eval-wrong">❌ WRONG (+0)</span>`;
      return `<span class="admin-eval-pill eval-timeout">⏱️ TIMED OUT (+0)</span>`;
    }
    return '';
  }

  const remainingSeconds = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
  const percentTime = Math.min(100, Math.max(0, (remainingSeconds / 20) * 100));

  let liveBody = `
    <!-- Top Duel HUD -->
    <div class="duel-hud" style="margin-bottom:16px;">
      <!-- Player 1 -->
      <div class="duel-player p1 ${p1CardClass}" style="padding:8px 12px; border-radius:var(--radius-md); transition:all 0.3s ease;">
        <div class="duel-score">${p1.score}<small>PTS</small></div>
        <div class="duel-info">
          <div class="duel-name">
            <span class="badge badge-cyan" style="font-size:9px; padding:2px 6px;">P1</span> ${esc(p1.name)}
          </div>
          ${playerStatusBadge(p1, p1Ans)}
        </div>
      </div>

      <!-- Center Progress -->
      <div class="duel-center">
        <div class="duel-vs">VS</div>
        <div class="duel-progress">
          <div class="progress-dots">
            ${[1, 2, 3, 4, 5].map(i => `
              <span class="p-dot ${i === state.round ? 'current' : i < state.round ? 'done' : ''}"></span>
            `).join('')}
          </div>
          <span class="duel-round-label">ROUND ${state.round}/5</span>
        </div>
      </div>

      <!-- Player 2 -->
      <div class="duel-player p2 ${p2CardClass}" style="padding:8px 12px; border-radius:var(--radius-md); transition:all 0.3s ease;">
        <div class="duel-info" style="text-align:right;">
          <div class="duel-name">
            ${esc(p2.name)} <span class="badge badge-magenta" style="font-size:9px; padding:2px 6px;">P2</span>
          </div>
          ${playerStatusBadge(p2, p2Ans)}
        </div>
        <div class="duel-score">${p2.score}<small>PTS</small></div>
      </div>
    </div>
  `;

  if (state.phase === 'countdown') {
    const seconds = Math.max(1, Math.ceil((state.deadline - Date.now()) / 1000));
    liveBody += `
      <div class="panel countdown-hero">
        <span class="badge badge-gold" style="margin-bottom:12px;">ROUND ${state.round} OF 5</span>
        <div style="display:flex; justify-content:center; gap:8px; margin-bottom:14px;">
          <span class="badge badge-cyan">${esc(state.question?.category || state.category)}</span>
          <span class="badge badge-gold">${esc(state.question?.difficulty || state.difficulty)}</span>
        </div>
        <h2 style="font-size:24px; font-weight:800; color:#fff;">GET READY</h2>
        <div class="countdown-number">${seconds}</div>
        <p class="p-score-sub" style="font-size:15px;">
          ${state.round === 1 ? 'Match begins in ' + seconds + 's!' : 'Round ' + state.round + ' goes live in ' + seconds + 's!'}
        </p>
      </div>
    `;
  } else if (state.phase === 'question') {
    const isTimerLow = remainingSeconds <= 5;
    liveBody += `
      <div class="timer-strip">
        <div class="timer-strip-label">
          <span>ROUND TIME</span>
          <span class="timer-countdown-pill ${isTimerLow ? 'timer-urgent' : ''}">
            ⏱️ ${remainingSeconds}s
          </span>
        </div>
        <div style="display:flex; gap:8px;">
          <span class="badge badge-cyan">${esc(state.question?.category)}</span>
          <span class="badge badge-gold">${esc(state.question?.difficulty)}</span>
        </div>
      </div>
      <div class="timer-bar-wrap" style="margin-top:-10px; margin-bottom:18px;">
        <div class="timer-bar-fill" style="width:${percentTime}%;"></div>
      </div>

      <div class="question-card">
        <div class="question-text">${esc(state.question?.question || '')}</div>
        ${state.question?.code ? `
          <div class="code-box">
            <pre class="code-snippet"><code>${esc(state.question.code)}</code></pre>
          </div>
        ` : ''}
      </div>

      <!-- Neutral options for viewers; NO private choices exposed -->
      <div class="options-grid">
        ${(state.question?.options || []).map((opt, idx) => `
          <div class="option-btn" style="cursor:default;">
            <span class="option-letter">${'ABCD'[idx]}</span>
            <span>${esc(opt)}</span>
          </div>
        `).join('')}
      </div>

      <div class="panel" style="margin-top:16px; text-align:center; padding:16px;">
        <span class="duel-status ${p1.hasAnswered && p2.hasAnswered ? 'status-locked' : 'status-thinking'}" style="font-size:13px; padding:6px 16px;">
          ${p1.hasAnswered && p2.hasAnswered ? '⚡ BOTH PLAYERS LOCKED IN! EVALUATING...' :
            p1.hasAnswered ? `⚡ ${esc(p1.name)} LOCKED IN — WAITING FOR ${esc(p2.name)}` :
            p2.hasAnswered ? `⚡ ${esc(p2.name)} LOCKED IN — WAITING FOR ${esc(p1.name)}` :
            '⏳ PLAYERS ARE SOLVING QUESTION...'}
        </span>
      </div>
    `;
  } else if (state.phase === 'reveal') {
    const correctIdx = state.question?.correct;
    liveBody += `
      ${roundBannerHtml}

      <div class="question-card">
        <div class="question-text" style="font-size:20px;">${esc(state.question?.question || '')}</div>
        ${state.question?.code ? `
          <div class="code-box">
            <pre class="code-snippet"><code>${esc(state.question.code)}</code></pre>
          </div>
        ` : ''}
      </div>

      <div class="options-grid">
        ${(state.question?.options || []).map((opt, idx) => {
          const isThisCorrect = idx === correctIdx;
          const p1ChoseThis = p1Ans && p1Ans.choice === idx;
          const p2ChoseThis = p2Ans && p2Ans.choice === idx;
          const optClass = isThisCorrect ? 'correct-opt' : (p1ChoseThis || p2ChoseThis) ? 'wrong-opt' : '';

          return `
            <div class="option-btn ${optClass}" style="cursor:default; opacity:${isThisCorrect || p1ChoseThis || p2ChoseThis ? '1' : '0.45'};">
              <span class="option-letter" style="${isThisCorrect ? 'border-color:var(--emerald); color:var(--emerald);' : ''}">
                ${'ABCD'[idx]}
              </span>
              <span>
                ${esc(opt)}
                ${isThisCorrect ? ' <strong style="color:var(--emerald);">★ CORRECT ANSWER</strong>' : ''}
                ${p1ChoseThis ? `<span class="badge badge-cyan" style="font-size:9px; margin-left:6px;">${esc(p1.name)} Picked</span>` : ''}
                ${p2ChoseThis ? `<span class="badge badge-magenta" style="font-size:9px; margin-left:6px;">${esc(p2.name)} Picked</span>` : ''}
              </span>
            </div>
          `;
        }).join('')}
      </div>

      <div class="panel" style="margin-top:16px; padding:16px; border-left:4px solid var(--cyan);">
        <strong style="color:var(--cyan);">💡 Key Takeaway:</strong>
        <span style="color:#fff; margin-left:6px;">${esc(state.question?.explanation || '')}</span>
      </div>
    `;
  }

  // If on Dashboard tab (not big screen), also provide quick control buttons
  if (!isBigScreen) {
    liveBody += `
      <div class="panel" style="margin-top:16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <span class="p-score-sub">Match in progress • Round ${state.round}/5 • ${esc(state.category)} (${esc(state.difficulty)})</span>
        <button class="btn btn-secondary" onclick="act({type:'reset'})" style="padding:8px 16px; font-size:12px;">
          ⚠️ ABORT / RESET MATCH
        </button>
      </div>
    `;
  }

  return liveBody;
}

// -------------------------------------------------------------
// Admin Screen View
// -------------------------------------------------------------
function renderAdmin() {
  const bothReady = state.players[1].ready && state.players[2].ready;
  const canStart = bothReady && ['lobby', 'finished'].includes(state.phase);
  const isMatchLive = ['countdown', 'question', 'reveal'].includes(state.phase);

  let mainContent = '';

  if (currentView === 'score') {
    // Scoreboard Tab
    mainContent = `
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">🏆 HALL OF FAME — TOP 15</div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th>Score</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              ${(state.leaderboard && state.leaderboard.length) ? state.leaderboard.map((item, i) => `
                <tr>
                  <td>${i === 0 ? '🥇 1st' : i === 1 ? '🥈 2nd' : i === 2 ? '🥉 3rd' : `#${i + 1}`}</td>
                  <td><strong>${esc(item.name)}</strong></td>
                  <td style="color:var(--cyan); font-weight:700;">${item.score} pts</td>
                  <td style="color:var(--text-muted); font-size:13px;">${item.at ? new Date(item.at).toLocaleDateString() : 'Recent'}</td>
                </tr>
              `).join('') : `
                <tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:28px;">No completed matches recorded yet.</td></tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } else if (currentView === 'screen') {
    // Big Screen Mode
    if (state.phase === 'finished') {
      mainContent = renderAdminWinnerCelebration();
    } else if (isMatchLive) {
      mainContent = renderAdminLiveMatch(true);
    } else {
      mainContent = `
        <div class="panel" style="text-align:center; padding: 48px 24px;">
          <span class="badge badge-gold" style="margin-bottom:14px;">ESPORTS ARENA BROADCAST</span>
          <h1 style="font-size:clamp(36px,7vw,64px); font-weight:900; margin-bottom:12px;">WAITING ROOM</h1>
          <p style="font-size:18px; color:var(--cyan); margin-bottom:24px;">${esc(state.message)}</p>
          <p class="p-score-sub" style="margin-bottom:28px;">${esc(state.category)} • ${esc(state.difficulty)} Level</p>
          ${renderPlayerCards()}
        </div>
      `;
    }
  } else {
    // Dashboard Tab
    if (state.phase === 'finished') {
      mainContent = `
        ${renderAdminWinnerCelebration()}
        <div class="panel" style="text-align:center;">
          <p class="p-score-sub" style="margin-bottom:16px;">
            Match completed • 5 Questions • ${esc(state.category)} • ${esc(state.difficulty)}
          </p>
          <button class="btn btn-primary" onclick="act({type:'reset'})">
            🔄 START NEW MATCH / RESET LOBBY
          </button>
        </div>
      `;
    } else if (isMatchLive) {
      mainContent = renderAdminLiveMatch(false);
    } else {
      // Lobby Configuration
      mainContent = `
        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">⚙️ MATCH CONFIGURATION</div>
            <span id="settings-status" class="badge badge-cyan" style="display:none;">Saved ✓</span>
          </div>

          <div class="form-grid">
            <div class="form-group">
              <label class="form-label" for="cat">Category</label>
              <select id="cat" class="control" onchange="onAdminSettingsChange()">
                <option value="DSA" ${state.category === 'DSA' ? 'selected' : ''}>DSA (Algorithms & Data Structures)</option>
                <option value="Python" ${state.category === 'Python' ? 'selected' : ''}>Python Programming</option>
                <option value="HTML/CSS" ${state.category === 'HTML/CSS' ? 'selected' : ''}>HTML / CSS Web Dev</option>
                <option value="Mixed" ${state.category === 'Mixed' ? 'selected' : ''}>Mixed (All Topics)</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" for="diff">Difficulty Level</label>
              <select id="diff" class="control" onchange="onAdminSettingsChange()">
                <option value="Easy" ${state.difficulty === 'Easy' ? 'selected' : ''}>Easy (Beginner Basics)</option>
                <option value="Medium" ${state.difficulty === 'Medium' ? 'selected' : ''}>Medium (Mix of Easy & Medium)</option>
                <option value="Hard" ${state.difficulty === 'Hard' ? 'selected' : ''}>Hard (Mix of Med & Hard)</option>
                <option value="All" ${state.difficulty === 'All' ? 'selected' : ''}>All Difficulties</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Format</label>
              <input class="control" value="5 Questions • Fast-Paced Match" disabled style="opacity:0.75;">
            </div>
          </div>

          <div class="btn-group">
            <button 
              id="btn-start"
              class="btn btn-primary btn-start-match ${bothReady ? 'ready-glow' : ''}" 
              onclick="act({type:'start'})"
              ${!canStart ? 'disabled' : ''}>
              🚀 START MATCH
            </button>

            <button class="btn btn-secondary" onclick="act({type:'reset'})">
              🔄 RESET LOBBY
            </button>
          </div>

          <p class="p-score-sub" style="margin-top:14px;">
            ${bothReady 
              ? '🔥 Both players are READY! Click START MATCH to launch.' 
              : '⏳ Both players must join and tap READY on their screens before the match can begin.'}
          </p>
        </div>

        ${renderPlayerCards()}

        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">📡 LIVE MATCH ACTIVITY</div>
            <span class="badge badge-gold">${state.phase.toUpperCase()}</span>
          </div>
          <p style="font-size:16px; font-weight:600; color:#fff; margin-bottom:6px;">${esc(state.message)}</p>
          <p class="p-score-sub">Waiting in lobby room</p>
        </div>
      `;
    }
  }

  const bottomNav = `
    <nav class="bottom-nav">
      <button class="nav-tab ${currentView === 'match' ? 'active' : ''}" onclick="setView('match')">Dashboard</button>
      <button class="nav-tab ${currentView === 'score' ? 'active' : ''}" onclick="setView('score')">Scoreboard</button>
      <button class="nav-tab ${currentView === 'screen' ? 'active' : ''}" onclick="setView('screen')">Match Screen</button>
    </nav>
  `;

  // Preserve focus if admin is actively using select
  const activeId = document.activeElement ? document.activeElement.id : null;
  app.dataset.error = '';
  app.innerHTML = renderHeader('ADMIN CONTROL', 'badge-gold') + mainContent + bottomNav;

  if (activeId && document.getElementById(activeId)) {
    try { document.getElementById(activeId).focus(); } catch {}
  }
}

// Admin Settings Handler
window.onAdminSettingsChange = () => {
  const catEl = document.getElementById('cat');
  const diffEl = document.getElementById('diff');
  if (!catEl || !diffEl) return;

  const category = catEl.value;
  const difficulty = diffEl.value;
  act({ type: 'settings', category, difficulty }).then(() => {
    const statusPill = document.getElementById('settings-status');
    if (statusPill) {
      statusPill.style.display = 'inline-flex';
      setTimeout(() => { if (statusPill) statusPill.style.display = 'none'; }, 2000);
    }
  });
};

// -------------------------------------------------------------
// Player Screen View
// -------------------------------------------------------------
function renderPlayer() {
  const p = state.players[playerId];
  const isP1 = playerId === '1';
  const roleBadge = isP1 ? 'PLAYER 1 ARENA' : 'PLAYER 2 ARENA';
  const roleClass = isP1 ? 'badge-cyan' : 'badge-magenta';

  let body = '';

  // 1. Entry Screen (Not connected / Name entry)
  if (!p.connected) {
    // If user is currently typing in the name box, do not blow away input!
    const existingInput = document.getElementById('name');
    if (existingInput && app.dataset.viewType === 'entry') {
      // Keep existing entry form intact to prevent typing disruption
      return;
    }

    app.dataset.viewType = 'entry';
    body = `
      <div class="panel ${isP1 ? 'panel-cyan' : 'panel-magenta'}" style="text-align:center; padding: 42px 24px;">
        <span class="badge ${roleClass}" style="margin-bottom:16px;">${isP1 ? '🔵 PLAYER 1 REGISTRATION' : '🟣 PLAYER 2 REGISTRATION'}</span>
        <h1 style="font-size:clamp(30px,6vw,52px); font-weight:900; margin-bottom:10px;">ENTER THE ARENA</h1>
        <p class="p-score-sub" style="font-size:16px; margin-bottom:28px;">
          5 rounds of quick-fire coding challenges. Speed is your tie-breaker.
        </p>

        <div style="max-width:380px; margin: 0 auto 20px;">
          <label class="form-label" style="text-align:left; display:block; margin-bottom:8px;">Your Player Name</label>
          <input 
            id="name" 
            class="control" 
            maxlength="22" 
            placeholder="e.g. CodeNinja, Alex" 
            autocomplete="off"
            onkeydown="if(event.key==='Enter')join()"
            style="font-size:17px; text-align:center; padding:16px;">
        </div>

        <button class="btn btn-primary" onclick="join()" style="width:100%; max-width:380px; font-size:16px;">
          ⚔️ ENTER THE MATCH
        </button>
      </div>
    `;
    app.innerHTML = renderHeader(roleBadge, roleClass) + body;
    const inputEl = document.getElementById('name');
    if (inputEl) inputEl.focus();
    return;
  }

  app.dataset.viewType = state.phase;

  // 2. Lobby Screen (Waiting room & Ready status)
  if (state.phase === 'lobby') {
    const oppId = isP1 ? '2' : '1';
    const opp = state.players[oppId];

    body = `
      <div class="panel ${isP1 ? 'panel-cyan' : 'panel-magenta'}" style="text-align:center; padding: 36px 20px;">
        <span class="badge ${roleClass}" style="margin-bottom:12px;">READY ROOM</span>
        <h1 style="font-size:clamp(26px,5vw,44px); font-weight:800; margin-bottom:6px;">
          Welcome, ${esc(p.name)}!
        </h1>
        <p class="p-score-sub" style="font-size:16px; margin-bottom:28px;">
          ${p.ready ? '✅ You are marked READY. Waiting for opponent and host to launch.' : '⚡ Tap READY when you are set to compete.'}
        </p>

        <div style="margin-bottom:28px;">
          <button 
            class="btn ${p.ready ? 'btn-cancel-ready' : 'btn-ready'}" 
            onclick="act({type:'ready', player:'${playerId}', value:${!p.ready}})">
            ${p.ready ? '✖ CANCEL READY' : '⚡ I AM READY!'}
          </button>
        </div>

        <p class="p-score-sub" style="font-size:14px;">
          Opponent: <strong>${esc(opp.name)}</strong> (${opp.connected ? (opp.ready ? '✅ READY' : '⏳ Waiting') : 'Not Joined Yet'})
        </p>
      </div>

      ${renderPlayerCards()}
    `;
  }

  // 3. Countdown Screen
  else if (state.phase === 'countdown') {
    playerChosenChoice = null;
    const seconds = Math.max(1, Math.ceil((state.deadline - Date.now()) / 1000));
    body = `
      ${renderDuelHUD()}
      <div class="panel countdown-hero">
        <span class="badge badge-gold" style="margin-bottom:12px;">ROUND ${state.round} OF 5</span>
        <div style="display:flex; justify-content:center; gap:8px; margin-bottom:14px;">
          <span class="badge badge-cyan">${esc(state.question.category)}</span>
          <span class="badge badge-gold">${esc(state.question.difficulty)}</span>
        </div>
        <h2 style="font-size:24px; font-weight:800; color:#fff;">GET READY</h2>
        <div class="countdown-number">${seconds}</div>
        <p class="p-score-sub" style="font-size:15px;">
          Question goes live in ${seconds}s — stay sharp!
        </p>
      </div>
    `;
  }

  // 4. Live Question Screen
  else if (state.phase === 'question') {
    const remainingSeconds = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
    const isTimerLow = remainingSeconds <= 5;
    const percentTime = Math.min(100, Math.max(0, (remainingSeconds / 20) * 100));
    const oppId = isP1 ? '2' : '1';
    const oppName = state.players[oppId]?.name || 'Opponent';

    body = `
      ${renderDuelHUD()}

      <div class="timer-strip">
        <div class="timer-strip-label">
          <span>TIME LIMIT</span>
          <span class="timer-countdown-pill ${isTimerLow ? 'timer-urgent' : ''}">
            ⏱️ ${remainingSeconds}s ${isTimerLow ? '⚠️ HURRY!' : ''}
          </span>
        </div>
        <div style="display:flex; gap:8px;">
          <span class="badge badge-cyan">${esc(state.question.category)}</span>
          <span class="badge badge-gold">${esc(state.question.difficulty)}</span>
        </div>
      </div>
      <div class="timer-bar-wrap" style="margin-top:-10px; margin-bottom:18px;">
        <div class="timer-bar-fill" style="width:${percentTime}%;"></div>
      </div>

      <div class="question-card">
        <div class="question-text">${esc(state.question.question)}</div>
        ${state.question.code ? `
          <div class="code-box">
            <pre class="code-snippet"><code>${esc(state.question.code)}</code></pre>
          </div>
        ` : ''}
      </div>

      ${p.hasAnswered ? `
        <div class="locked-banner">
          <div style="font-size:38px; margin-bottom:8px;">🎯</div>
          <h2 style="color:var(--cyan); font-weight:800; margin-bottom:4px;">Answer Locked In!</h2>
          <p class="p-score-sub" style="font-size:15px;">
            Waiting for ${esc(oppName)} to submit or for time to expire...
          </p>
        </div>

        <div class="options-grid">
          ${state.question.options.map((opt, idx) => {
            const isMyChoice = playerChosenChoice === idx;
            return `
              <div class="option-btn ${isMyChoice ? 'selected' : ''}" style="cursor:default; opacity:${isMyChoice ? '1' : '0.45'};">
                <span class="option-letter">${'ABCD'[idx]}</span>
                <span>${esc(opt)} ${isMyChoice ? '✓ (Your Answer)' : ''}</span>
              </div>
            `;
          }).join('')}
        </div>
      ` : `
        <div class="options-grid">
          ${state.question.options.map((opt, idx) => `
            <button class="option-btn" onclick="answer(${idx})">
              <span class="option-letter">${'ABCD'[idx]}</span>
              <span>${esc(opt)}</span>
            </button>
          `).join('')}
        </div>
      `}
    `;
  }

  // 5. Answer Reveal Screen
  else if (state.phase === 'reveal') {
    const mine = state.history[state.history.length - 1]?.mine;
    const isCorrect = !!mine?.correct;
    const correctIdx = state.question?.correct;
    const hasAnswered = p.hasAnswered;

    body = `
      ${renderDuelHUD()}

      <div class="reveal-banner ${isCorrect ? 'reveal-correct' : 'reveal-wrong'}">
        <div class="reveal-icon">${isCorrect ? '🎉' : hasAnswered ? '❌' : '⏱️'}</div>
        <div>
          <div class="reveal-title">
            ${isCorrect ? 'CORRECT! +10 POINTS' : hasAnswered ? 'INCORRECT (+0 PTS)' : 'TIME EXPIRED (+0 PTS)'}
          </div>
          <div class="reveal-explanation">
            <strong>Correct Answer:</strong> ${esc(state.question?.options?.[correctIdx] || '')}
            <br>
            <span style="color:#fff;">💡 ${esc(state.question?.explanation || '')}</span>
          </div>
        </div>
      </div>

      <div class="question-card">
        <div class="question-text" style="font-size:20px;">${esc(state.question?.question || '')}</div>
        ${state.question?.code ? `
          <div class="code-box">
            <pre class="code-snippet"><code>${esc(state.question.code)}</code></pre>
          </div>
        ` : ''}
      </div>

      <div class="options-grid">
        ${(state.question?.options || []).map((opt, idx) => {
          const isThisCorrect = idx === correctIdx;
          const isMyChoice = playerChosenChoice === idx;
          const optClass = isThisCorrect ? 'correct-opt' : (isMyChoice && !isThisCorrect) ? 'wrong-opt' : '';

          return `
            <div class="option-btn ${optClass}" style="cursor:default; opacity:${(isThisCorrect || isMyChoice) ? '1' : '0.45'};">
              <span class="option-letter" style="${isThisCorrect ? 'border-color:var(--emerald); color:var(--emerald);' : (isMyChoice && !isThisCorrect) ? 'border-color:var(--rose); color:var(--rose);' : ''}">
                ${'ABCD'[idx]}
              </span>
              <span>
                ${esc(opt)}
                ${isThisCorrect ? ' <strong style="color:var(--emerald);">★ CORRECT ANSWER</strong>' : ''}
                ${(isMyChoice && !isThisCorrect) ? ' <strong style="color:var(--rose);">✗ YOUR CHOICE</strong>' : ''}
              </span>
            </div>
          `;
        }).join('')}
      </div>

      <p class="p-score-sub" style="text-align:center; margin-top:14px;">
        ${state.round >= 5 ? 'Match concludes in a moment...' : 'Next question starts shortly...'}
      </p>
    `;
  }

  // 6. Finished Screen
  else {
    const isWinner = state.winnerPlayerId === playerId;
    const isDraw = state.winnerPlayerId === null;
    const isP1 = playerId === '1';
    const p1 = state.players['1'];
    const p2 = state.players['2'];

    // Compute stats from history
    let p1Correct = 0, p2Correct = 0;
    for (const h of state.history || []) {
      if (h.players && h.players[1] && h.players[1].correct) p1Correct++;
      if (h.players && h.players[2] && h.players[2].correct) p2Correct++;
    }

    body = `
      <div class="winner-hero ${isWinner ? (isP1 ? 'is-p1' : 'is-p2') : ''}">
        <div class="trophy-badge">${isDraw ? '🤝' : isWinner ? '🏆' : '🎮'}</div>
        <h1 class="winner-headline">${isDraw ? "IT'S A DRAW!" : isWinner ? 'YOU WIN!' : 'MATCH OVER'}</h1>
        <div class="winner-sub">
          ${isWinner ? 'Champion performance! Outstanding speed and accuracy.' :
            isDraw ? 'Both players scored equally and matched tie-breaker speed!' :
            'Great match! You fought hard. Ready for a rematch?'}
        </div>
        <div style="font-size:44px; font-weight:900; color:var(--cyan); font-family:'JetBrains Mono',monospace; margin-bottom:16px;">
          ${p.score} PTS
        </div>

        <!-- Head to Head Match Summary Table -->
        <table class="h2h-table">
          <thead>
            <tr>
              <th class="h2h-metric">Head-to-Head</th>
              <th style="color:var(--cyan);">${esc(p1.name)} ${isP1 ? '(You)' : ''}</th>
              <th style="color:var(--magenta);">${esc(p2.name)} ${!isP1 ? '(You)' : ''}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="h2h-metric">Final Score</td>
              <td style="color:var(--cyan); font-weight:800;">${p1.score} pts</td>
              <td style="color:var(--magenta); font-weight:800;">${p2.score} pts</td>
            </tr>
            <tr>
              <td class="h2h-metric">Correct Answers</td>
              <td>${p1Correct} / 5</td>
              <td>${p2Correct} / 5</td>
            </tr>
            <tr>
              <td class="h2h-metric">Tie-Break Time</td>
              <td>${(p1.correctTimeMs / 1000).toFixed(1)}s</td>
              <td>${(p2.correctTimeMs / 1000).toFixed(1)}s</td>
            </tr>
            <tr>
              <td class="h2h-metric">Result</td>
              <td>${state.winnerPlayerId === '1' ? '🏆 WINNER' : isDraw ? '🤝 DRAW' : 'RUNNER-UP'}</td>
              <td>${state.winnerPlayerId === '2' ? '🏆 WINNER' : isDraw ? '🤝 DRAW' : 'RUNNER-UP'}</td>
            </tr>
          </tbody>
        </table>

        <p class="p-score-sub" style="margin-top:20px;">
          The host can now launch a new match or reset the lobby from the Admin Dashboard.
        </p>
      </div>
    `;
  }

  app.innerHTML = renderHeader(roleBadge, roleClass) + body;
}

// Global actions for inline event handlers
window.join = () => {
  const input = document.getElementById('name');
  if (!input) return;
  const val = input.value.trim();
  if (!val) {
    alert('Please enter a player name to join.');
    input.focus();
    return;
  }
  act({ type: 'join', player: playerId, name: val });
};

window.answer = choiceIndex => {
  playerChosenChoice = choiceIndex;
  render();
  act({ type: 'answer', player: playerId, choice: choiceIndex });
};

window.setView = viewName => {
  currentView = viewName;
  render();
};

window.toggleSound = () => {
  soundOn = !soundOn;
  try { localStorage.setItem(soundStorageKey, String(soundOn)); } catch {}
  render();
};

// Dispatcher
function render() {
  if (!state) return;
  if (isAdmin) {
    renderAdmin();
  } else {
    renderPlayer();
  }
}

// Initial polling loop
refresh();
setInterval(refresh, 1000);
