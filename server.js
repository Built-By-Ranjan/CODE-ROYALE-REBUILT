'use strict';

// CODE-ROYALE: dependency-free LAN server. No npm packages are required.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const bank = JSON.parse(fs.readFileSync(path.join(DATA, 'questions.json'), 'utf8'));
const leaderboardFile = path.join(DATA, 'leaderboard.json');

let leaderboard = [];
try {
  const saved = JSON.parse(fs.readFileSync(leaderboardFile, 'utf8'));
  if (Array.isArray(saved)) leaderboard = saved.slice(0, 15);
} catch { leaderboard = []; }

function freshPlayers() {
  return {
    1: { name: 'Player 1', ready: false, score: 0, answer: null, connected: false, correctTimeMs: 0 },
    2: { name: 'Player 2', ready: false, score: 0, answer: null, connected: false, correctTimeMs: 0 }
  };
}

let state = {
  players: freshPlayers(), phase: 'lobby', category: 'DSA', difficulty: 'Easy',
  round: 0, total: 5, question: null, deadline: 0, questionStartedAt: 0,
  history: [], winner: null, winnerPlayerId: null,
  message: 'Waiting for players…', updated: Date.now()
};
let tick = null;

function publicState(viewer = 'admin') {
  const q = state.question ? { ...state.question } : null;
  // Never expose the answer key while a question is live or counting down.
  if (q && !['reveal', 'finished'].includes(state.phase)) {
    delete q.correct;
    delete q.explanation;
  }
  const players = {};
  for (const id of ['1', '2']) {
    const p = state.players[id];
    players[id] = {
      name: p.name, ready: p.ready, score: p.score,
      connected: p.connected, hasAnswered: !!p.answer,
      correctTimeMs: p.correctTimeMs || 0,
      status: state.phase === 'finished' ? 'FINISHED' :
        ['question', 'countdown', 'reveal'].includes(state.phase) ? 'PLAYING' :
        (p.ready ? 'READY' : 'WAITING')
    };
  }
  const history = state.history.map(h => ({
    id: h.id, question: h.question, type: h.type || 'mcq',
    ...(viewer === 'admin' ? {
      players: {
        1: h.players && h.players[1] ? { choice: h.players[1].choice, correct: !!h.players[1].correct, timeMs: h.players[1].timeMs } : null,
        2: h.players && h.players[2] ? { choice: h.players[2].choice, correct: !!h.players[2].correct, timeMs: h.players[2].timeMs } : null,
      }
    } : {}),
    ...(viewer === '1' || viewer === '2' ? {
      mine: h.players[viewer] ? { correct: !!h.players[viewer].correct } : null
    } : {})
  }));
  return {
    phase: state.phase, category: state.category, difficulty: state.difficulty,
    round: state.round, total: 5, question: q, deadline: state.deadline,
    history, winner: state.winner, winnerPlayerId: state.winnerPlayerId,
    winnerTrack: state.winnerTrack || null, loserTrack: state.loserTrack || null,
    message: state.message, updated: state.updated, players, leaderboard
  };
}

function send(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(obj));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) { reject(new Error('Request too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}
function matchDifficulty(qDiff, targetDiff) {
  if (targetDiff === 'All') return true;
  if (targetDiff === 'Easy') return qDiff === 'Easy';
  if (targetDiff === 'Medium') return qDiff === 'Easy' || qDiff === 'Medium';
  if (targetDiff === 'Hard') return qDiff === 'Medium' || qDiff === 'Hard';
  return true;
}
function eligibleQuestions() {
  return bank.filter(q =>
    (state.category === 'Mixed' || q.category === state.category) &&
    matchDifficulty(q.difficulty, state.difficulty)
  );
}
function chooseQuestion() {
  let pool = eligibleQuestions().filter(q => !state.history.some(h => h.id === q.id));
  if (!pool.length) pool = eligibleQuestions();
  if (!pool.length) throw new Error('No questions found for this category and difficulty.');

  const errorCount = state.history.filter(h => h.type === 'error').length;
  const mcqCount = state.history.filter(h => h.type !== 'error').length;
  const errorPool = pool.filter(q => q.type === 'error');
  const mcqPool = pool.filter(q => q.type !== 'error');

  let candidatePool = pool;
  if (errorPool.length > 0 && mcqPool.length > 0) {
    if (errorCount < 2 && state.round % 2 === 0) {
      candidatePool = errorPool;
    } else if (mcqCount < 2 && state.round % 2 === 1) {
      candidatePool = mcqPool;
    } else if (errorCount >= 3) {
      candidatePool = mcqPool.length ? mcqPool : errorPool;
    } else if (mcqCount >= 3) {
      candidatePool = errorPool.length ? errorPool : mcqPool;
    }
  }

  return candidatePool[Math.floor(Math.random() * candidatePool.length)];
}
function resetAnswers() {
  for (const p of Object.values(state.players)) p.answer = null;
}
function finishRound() {
  if (!state.question || state.phase !== 'question') return;
  const q = state.question;
  for (const id of ['1', '2']) {
    const p = state.players[id];
    if (p.answer && p.answer.choice === q.correct) {
      p.score += 10;
      p.answer.correct = true;
      p.correctTimeMs += p.answer.elapsedMs;
    } else if (p.answer) p.answer.correct = false;
  }
  state.history.push({
    id: q.id, type: q.type || 'mcq', question: q.question,
    players: {
      1: state.players[1].answer ? { ...state.players[1].answer } : null,
      2: state.players[2].answer ? { ...state.players[2].answer } : null
    }
  });
  state.phase = 'reveal';
  state.message = 'Question complete';
  state.deadline = Date.now() + 3000;
  state.updated = Date.now();
}
let matchCounter = 0;
function finishMatch() {
  stopLoop();
  state.phase = 'finished';
  const a = state.players[1], b = state.players[2];
  if (a.score !== b.score) state.winnerPlayerId = a.score > b.score ? '1' : '2';
  else if (a.correctTimeMs !== b.correctTimeMs) state.winnerPlayerId = a.correctTimeMs < b.correctTimeMs ? '1' : '2';
  else state.winnerPlayerId = null;
  state.winner = state.winnerPlayerId ? state.players[state.winnerPlayerId].name : 'DRAW';
  state.message = state.winnerPlayerId ? `${state.winner} wins the match!` : 'Match tied — DRAW!';
  if (state.winnerPlayerId) {
    matchCounter++;
    state.winnerTrack = (matchCounter % 2 === 1) ? 'winner1' : 'winner2';
    state.loserTrack = (matchCounter % 2 === 1) ? 'loser1' : 'loser2';
  } else {
    state.winnerTrack = null;
    state.loserTrack = null;
  }
  for (const id of ['1', '2']) {
    leaderboard.push({ name: state.players[id].name, score: state.players[id].score, at: new Date().toISOString() });
  }
  leaderboard.sort((x, y) => y.score - x.score);
  leaderboard = leaderboard.slice(0, 15);
  try { fs.writeFileSync(leaderboardFile, JSON.stringify(leaderboard, null, 2)); }
  catch (error) { console.error('Leaderboard save failed:', error.message); }
  state.updated = Date.now();
}
function beginQuestion() {
  if (state.round >= 5) { finishMatch(); return; }
  state.round++;
  resetAnswers();
  state.question = chooseQuestion();
  state.phase = 'countdown';
  state.deadline = Date.now() + 5000;
  state.message = 'Get ready!';
  state.updated = Date.now();
}
function startLoop() {
  clearInterval(tick);
  tick = setInterval(() => {
    const now = Date.now();
    if (state.phase === 'countdown' && now >= state.deadline) {
      state.phase = 'question';
      state.questionStartedAt = now;
      state.deadline = now + 20000;
      state.message = 'Question is live';
      state.updated = now;
    } else if (state.phase === 'question' && now >= state.deadline) {
      finishRound();
    } else if (state.phase === 'reveal' && now >= state.deadline) {
      if (state.round >= 5) finishMatch(); else beginQuestion();
    }
  }, 100);
}
function stopLoop() { if (tick) clearInterval(tick); tick = null; }

function networkAddresses() {
  const all = [];
  for (const [adapter, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if ((entry.family === 'IPv4' || entry.family === 4) && !entry.internal && !entry.address.startsWith('169.254.')) {
        all.push({ adapter, address: entry.address });
      }
    }
  }
  // Windows Mobile Hotspot commonly exposes a "Local Area Connection*" adapter.
  // Print it first when available, but show every address so VPN adapters are not silently mistaken for Wi-Fi.
  const rank = item => /local area connection|wi-?fi direct|hotspot/i.test(item.adapter) ? 0 : /wi-?fi|wireless/i.test(item.adapter) ? 1 : 2;
  return all.sort((a, b) => rank(a) - rank(b));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST'
    });
    return res.end();
  }
  if (url.pathname === '/health' && req.method === 'GET') {
    return send(res, 200, { ok: true, app: 'CODE-ROYALE', port: PORT, phase: state.phase, time: new Date().toISOString() });
  }
  if (url.pathname === '/api/state' && req.method === 'GET') {
    const viewer = ['1', '2'].includes(url.searchParams.get('player')) ? url.searchParams.get('player') : 'admin';
    return send(res, 200, publicState(viewer));
  }
  if (url.pathname === '/api/action' && req.method === 'POST') {
    try {
      const action = await readJson(req);
      if (action.type === 'join') {
        const p = state.players[action.player];
        if (!p || !['lobby', 'finished'].includes(state.phase)) return send(res, 409, { error: 'Player slot unavailable right now.' });
        p.name = String(action.name || `Player ${action.player}`).trim().slice(0, 22) || `Player ${action.player}`;
        p.connected = true; p.ready = false; state.message = `${p.name} joined`;
        console.log(`[JOIN] Player ${action.player}: ${p.name}`);
      } else if (action.type === 'ready') {
        const p = state.players[action.player];
        if (!p || state.phase !== 'lobby') return send(res, 409, { error: 'Lobby is closed.' });
        p.ready = !!action.value; state.message = `${p.name} ${p.ready ? 'is READY' : 'is not ready'}`;
      } else if (action.type === 'settings') {
        if (!['lobby', 'finished'].includes(state.phase)) return send(res, 409, { error: 'Match in progress.' });
        const category = ['DSA', 'Python', 'HTML/CSS', 'Mixed'].includes(action.category) ? action.category : 'DSA';
        const difficulty = ['All', 'Easy', 'Medium', 'Hard'].includes(action.difficulty) ? action.difficulty : 'Easy';
        const pool = bank.filter(q => (category === 'Mixed' || q.category === category) && matchDifficulty(q.difficulty, difficulty));
        if (pool.length < 5) return send(res, 400, { error: 'This selection has fewer than 5 questions. Choose another category/difficulty.' });
        state.category = category; state.difficulty = difficulty; state.total = 5;
      } else if (action.type === 'start') {
        if (!['lobby', 'finished'].includes(state.phase)) return send(res, 409, { error: 'A match is already running.' });
        if (!state.players[1].ready || !state.players[2].ready) return send(res, 409, { error: 'Both players must be READY.' });
        if (eligibleQuestions().length < 5) return send(res, 400, { error: 'Not enough questions for this selection.' });
        for (const p of Object.values(state.players)) { p.score = 0; p.correctTimeMs = 0; p.answer = null; }
        state.history = []; state.round = 0; state.winner = null; state.winnerPlayerId = null;
        beginQuestion(); startLoop();
        console.log(`[MATCH] Started: ${state.category} / ${state.difficulty} / 5 questions`);
      } else if (action.type === 'answer') {
        if (state.phase !== 'question') return send(res, 409, { error: 'Question is not accepting answers.' });
        const p = state.players[action.player];
        if (!p || p.answer) return send(res, 409, { error: 'Answer already submitted.' });
        const index = Number(action.choice);
        if (!Number.isInteger(index) || index < 0 || index > 3) return send(res, 400, { error: 'Invalid answer.' });
        p.answer = { choice: index, at: Date.now(), elapsedMs: Math.max(0, Date.now() - state.questionStartedAt) };
        state.message = `${p.name} submitted an answer`;
        if (state.players[1].answer && state.players[2].answer) finishRound();
      } else if (action.type === 'reset') {
        stopLoop(); state.players = freshPlayers(); state.phase = 'lobby'; state.round = 0;
        state.history = []; state.question = null; state.winner = null;
        state.winnerPlayerId = null; state.winnerTrack = null; state.loserTrack = null; state.deadline = 0;
        state.message = 'New match — players can join';
        console.log('[MATCH] Lobby reset');
      } else return send(res, 400, { error: 'Unknown action.' });
      state.updated = Date.now();
      const viewer = action.player && ['1', '2'].includes(String(action.player)) ? String(action.player) : 'admin';
      return send(res, 200, { ok: true, state: publicState(viewer) });
    } catch (error) {
      console.error('[REQUEST ERROR]', error.message);
      return send(res, 400, { error: 'Bad request.' });
    }
  }

  let requested = url.pathname.replace(/\/+$/, '') || '/';
  if (requested === '/' || requested === '/admin' || requested === '/player/1' || requested === '/player/2') requested = '/index.html';
  const file = path.resolve(PUBLIC, '.' + requested);
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8', '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.json': 'application/json; charset=utf-8'
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

server.on('error', error => {
  console.error('\nSERVER ERROR:', error.message);
  if (error.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Stop the other server or run: set PORT=3001 && npm start`);
  process.exitCode = 1;
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n============================================');
  console.log('       CODE-ROYALE — LOCAL GAME SERVER');
  console.log('============================================');
  console.log(`Admin on THIS laptop: http://localhost:${PORT}/admin`);
  console.log(`Connection test:      http://localhost:${PORT}/health`);
  console.log('\nPLAYER LINKS — use the address of the HOSTPOT/WI-FI adapter:');
  const addresses = networkAddresses();
  if (!addresses.length) console.log('  No LAN IPv4 address found. Check that Wi-Fi/Hotspot is ON.');
  for (const item of addresses) {
    console.log(`  [${item.adapter}] http://${item.address}:${PORT}/player/1`);
    console.log(`                 http://${item.address}:${PORT}/player/2`);
  }
  console.log('\nIMPORTANT: Other laptops must open /health first. It should say ok:true.');
  console.log('Keep this terminal open. Press Ctrl+C only after the game.');
  console.log('============================================\n');
});
