const app = document.getElementById('app');
const pathName = location.pathname.replace(/\/+$/, '') || '/';
const isAdmin = pathName.startsWith('/admin');
const playerId = pathName.endsWith('/2') ? '2' : '1';
let state = null, view = 'match', soundOn = true, lastPhase = '', lastRound = 0, lastMineCorrect = null, lastCountdown = null;
let selectedCategory = null, selectedDifficulty = null;
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const playerQuery = isAdmin ? '' : `?player=${playerId}`;
async function act(data) {
  try {
    const response = await fetch('/api/action', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) alert(result.error || 'Action failed');
    await refresh();
    return result;
  } catch { alert('Cannot reach the host computer.'); }
}
function playSound(name) {
  if (!soundOn) return;
  const audio = new Audio(`/sounds/${name}.mp3`);
  audio.volume = 0.8;
  audio.play().catch(() => {});
}
function soundEvents() {
  if (!state) return;
  if (state.phase === 'countdown') {
    const seconds = Math.max(1, Math.ceil((state.deadline - Date.now()) / 1000));
    if (seconds !== lastCountdown) { playSound('countdown'); lastCountdown = seconds; }
  } else lastCountdown = null;
  if (state.phase === 'question' && (lastPhase !== 'question' || lastRound !== state.round)) playSound('go');
  if (state.phase === 'reveal' && lastPhase !== 'reveal') {
    if (!isAdmin) {
      const mine = state.history[state.history.length - 1]?.mine;
      if (mine) playSound(mine.correct ? 'correct' : 'wrong');
    }
  }
  if (state.phase === 'finished' && lastPhase !== 'finished') {
    if (state.winnerPlayerId === null) playSound('draw');
    else if (isAdmin || state.winnerPlayerId === playerId) playSound('winner');
    else playSound('loser');
  }
  lastPhase = state.phase;
  lastRound = state.round;
}
async function refresh() {
  try {
    const response = await fetch('/api/state' + playerQuery, {cache:'no-store'});
    state = await response.json();
    soundEvents();
    const nameValue = document.getElementById('name')?.value;
    render();
    const nameInput = document.getElementById('name');
    if (nameInput && nameValue !== undefined) { nameInput.value = nameValue; }
  } catch {
    app.innerHTML = '<section class="panel">Cannot reach game server. Check that the host laptop is running.</section>';
  }
}
function header(label) { return `<header class="top"><div class="brand">CODE<span>•</span>ROYALE</div><div class="tag">${label}</div></header>`; }
function playerCards() {
  return `<div class="grid">${['1','2'].map(id => {
    const p = state.players[id];
    return `<div class="player"><div class="row"><strong>${esc(p.name)}</strong><span class="status">${esc(p.status)}</span></div><div class="score">${p.score} <small class="muted">pts</small></div></div>`;
  }).join('')}</div>`;
}
function winnerCard() {
  const isDraw = state.winnerPlayerId === null;
  return `<section class="winner-card"><div class="trophy">${isDraw ? '🤝' : '🏆'}</div><div class="eyebrow">FINAL RESULT</div><h1>${isDraw ? 'IT’S A DRAW!' : 'WINNER!'}</h1><div class="winner-name">${esc(state.winner)}</div><p>${isDraw ? 'Both players finished level.' : `${esc(state.players[state.winnerPlayerId].name)} takes the match!`}</p>${playerCards()}</section>`;
}
function admin() {
  let content = '';
  if (state.phase === 'finished' && view !== 'score') {
    content = winnerCard();
    content += `<section class="panel"><p class="muted">Match finished · 5 questions · ${esc(state.category)} · ${esc(state.difficulty)}</p><button onclick="act({type:'reset'})">NEW MATCH / RESET LOBBY</button></section>`;
  } else if (view === 'score') {
    content = `<section class="panel"><h2>Leaderboard · Top 15</h2><table class="table"><tr><th>Rank</th><th>Player</th><th>Score</th></tr>${(state.leaderboard || []).map((p,i) => `<tr><td>${i+1}</td><td>${esc(p.name)}</td><td>${p.score}</td></tr>`).join('') || '<tr><td colspan="3">No completed matches yet</td></tr>'}</table><p class="muted">Best 15 player results saved on this host computer.</p></section>`;
  } else if (view === 'screen') {
    content = `<section class="panel center"><div class="eyebrow">MATCH STATUS</div><h1>${state.phase === 'lobby' ? 'WAITING ROOM' : 'LIVE MATCH'}</h1><div class="big">${state.phase === 'lobby' ? '—' : `${state.round}/5`}</div><h2>${esc(state.message)}</h2><p class="muted">${esc(state.category)} · ${esc(state.difficulty)} · 5 questions</p>${playerCards()}</section>`;
  } else {
    content = `<section class="panel"><div class="eyebrow">ADMIN CONTROL ROOM</div><h2>Match setup</h2><div class="row"><div><label>Category</label><select id="cat" onchange="selectedCategory=this.value"><option ${ (selectedCategory || state.category)==='DSA'?'selected':''}>DSA</option><option ${ (selectedCategory || state.category)==='Python'?'selected':''}>Python</option><option ${ (selectedCategory || state.category)==='HTML/CSS'?'selected':''}>HTML/CSS</option><option ${ (selectedCategory || state.category)==='Mixed'?'selected':''}>Mixed</option></select></div><div><label>Difficulty</label><select id="diff" onchange="selectedDifficulty=this.value"><option ${ (selectedDifficulty || state.difficulty)==='All'?'selected':''}>All</option><option ${ (selectedDifficulty || state.difficulty)==='Easy'?'selected':''}>Easy</option><option ${ (selectedDifficulty || state.difficulty)==='Medium'?'selected':''}>Medium</option><option ${ (selectedDifficulty || state.difficulty)==='Hard'?'selected':''}>Hard</option></select></div><div><label>Questions per match</label><input value="5 questions (fixed)" disabled></div></div><div class="actions"><button onclick="saveSettings()">SAVE SETTINGS</button><button onclick="act({type:'start'})" ${!(state.players[1].ready && state.players[2].ready) || !['lobby','finished'].includes(state.phase) ? 'disabled' : ''}>START MATCH</button><button class="secondary" onclick="act({type:'reset'})">RESET LOBBY</button><button class="secondary" onclick="toggleSound()">${soundOn?'🔊 Sound ON':'🔇 Sound OFF'}</button></div><p class="muted">Both players must join and press READY. Admin sees player names, status, scores and progress — not their chosen answers.</p></section>${playerCards()}<section class="panel"><h2>Live activity</h2><p>${esc(state.message)}</p><p class="muted">${state.phase === 'lobby' ? 'Waiting for both players' : state.phase === 'question' ? `Question ${state.round} of 5 is live` : state.phase === 'countdown' ? 'Countdown in progress' : state.phase === 'reveal' ? 'Round completed' : state.phase}</p></section>`;
  }
  app.innerHTML = header('ADMIN DASHBOARD') + content + `<nav class="nav"><button class="${view==='match'?'':'secondary'}" onclick="setView('match')">Dashboard</button><button class="${view==='score'?'':'secondary'}" onclick="setView('score')">Scoreboard</button><button class="${view==='screen'?'':'secondary'}" onclick="setView('screen')">Match Screen</button></nav>`;
}
function player() {
  const p = state.players[playerId];
  let body = '';
  if (!p.connected) {
    body = `<section class="panel hero"><div class="eyebrow">PLAYER ${playerId}</div><h1>Ready to play?</h1><p class="muted">Enter your name and join the arena.</p><label>Your name</label><input id="name" maxlength="22" placeholder="Enter player name" onkeydown="if(event.key==='Enter')join()"><div class="actions"><button onclick="join()">JOIN GAME</button></div></section>`;
  } else if (state.phase === 'lobby') {
    body = `<section class="panel hero"><div class="eyebrow">PLAYER ${playerId}</div><h1>Welcome, ${esc(p.name)}!</h1><p class="muted">${p.ready?'You are READY. Waiting for the other player.':'Tap READY when you are set.'}</p><button onclick="act({type:'ready',player:'${playerId}',value:${!p.ready}})">${p.ready?'CANCEL READY':'I AM READY'}</button></section>${playerCards()}`;
  } else if (state.phase === 'countdown') {
    const seconds = Math.max(1, Math.ceil((state.deadline - Date.now()) / 1000));
    body = `<section class="panel hero"><div class="eyebrow">QUESTION ${state.round} / 5</div><h1>GET READY</h1><div class="big">${seconds}</div><p class="muted">Same question for both players.</p></section>`;
  } else if (state.phase === 'question') {
    body = `<section class="panel"><div class="meta"><span class="pill">${esc(state.question.category)}</span><span class="pill">${esc(state.question.difficulty)}</span><span class="pill">QUESTION ${state.round}/5</span></div><div class="question">${esc(state.question.question)}</div>${p.hasAnswered ? '<h2 class="good">Answer submitted! Waiting for the other player…</h2>' : state.question.options.map((option,index) => `<button class="option" onclick="answer(${index})">${'ABCD'[index]}. ${esc(option)}</button>`).join('')}</section>`;
  } else if (state.phase === 'reveal') {
    const mine = state.history[state.history.length - 1]?.mine;
    body = `<section class="panel"><div class="eyebrow">ANSWER REVEAL</div><h1>${mine?.correct?'Correct! +10':'Not this time'}</h1><div class="question">${esc(state.question?.question || '')}</div><p class="good">Correct answer: ${esc(state.question?.options?.[state.question?.correct] || '')}</p><p class="muted">${esc(state.question?.explanation || '')}</p>${playerCards()}</section>`;
  } else {
    const winner = state.winnerPlayerId === playerId;
    body = `<section class="winner-card"><div class="trophy">${state.winnerPlayerId === null ? '🤝' : winner ? '🏆' : '🎮'}</div><div class="eyebrow">FINAL RESULT</div><h1>${state.winnerPlayerId === null ? 'IT’S A DRAW!' : winner ? 'YOU WIN!' : 'MATCH OVER'}</h1><div class="winner-name">${esc(state.winner)}</div><div class="big">${p.score} pts</div><p>${winner ? 'Champion! Well played.' : state.winnerPlayerId === null ? 'Great match by both players.' : 'Good game! Better luck next time.'}</p>${playerCards()}</section>`;
  }
  app.innerHTML = header(`PLAYER ${playerId}`) + body + `<div class="center muted sound"><button class="secondary" onclick="toggleSound()">${soundOn?'🔊 Sound ON':'🔇 Sound OFF'}</button></div>`;
}
window.join = () => { const name = document.getElementById('name').value.trim(); if (name) act({type:'join',player:playerId,name}); };
window.answer = index => act({type:'answer',player:playerId,choice:index});
window.saveSettings = () => { selectedCategory = document.getElementById('cat').value; selectedDifficulty = document.getElementById('diff').value; act({type:'settings',category:selectedCategory,difficulty:selectedDifficulty}); };
window.setView = value => { view = value; render(); };
window.toggleSound = () => { soundOn = !soundOn; render(); };
function render() { if (!state) return; isAdmin ? admin() : player(); }
refresh();
setInterval(refresh, 1000);
