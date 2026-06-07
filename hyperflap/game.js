document.addEventListener('DOMContentLoaded', () => {
  // ── Supabase (shared leaderboard) ──
  const SB_URL = 'https://xdacfbkdbkhptipfikgr.supabase.co';
  const SB_KEY = 'sb_publishable_xdNZ6VEysJhGeTNgwh3AHQ_ebAgi7Jw';
  const GAME_ID = 'hyperflap';

  async function submitScore(name, score) {
    try {
      await fetch(`${SB_URL}/rest/v1/scores`, {
        method: 'POST',
        headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ name: name || 'Anonymous', score, game: GAME_ID })
      });
    } catch (e) { console.warn('submit failed', e); }
  }
  async function fetchScores() {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/scores?select=name,score&game=eq.${GAME_ID}&order=score.desc&limit=10`,
        { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } });
      if (!r.ok) throw 0;
      return await r.json();
    } catch (e) { return null; }
  }

  // ── Selectable pieces (25, spread across owned pool) ──
  const PIECE_IDS = [21,99,120,229,339,421,525,620,693,758,937,963,1028,1072,1168,1212,1276,1412,1598,1773,1848,1859,1946,2115,2204];
  // Each piece has a weight: heavier falls faster (harder) but scores more per pipe.
  const WEIGHT_TIERS = [0.85, 0.95, 1.05, 1.15, 1.25];
  const WEIGHTS = {};
  PIECE_IDS.forEach((id, i) => { WEIGHTS[id] = WEIGHT_TIERS[i % WEIGHT_TIERS.length]; });
  const pointsPerPipe = w => Math.round(10 * w);   // 9..13 pts per pipe
  const imgPath = id => `../assets/nfts/${id}.jpg`;

  // ── Elements ──
  const el = {
    startScreen: document.getElementById('start-screen'),
    lbScreen: document.getElementById('lb-screen'),
    gameScreen: document.getElementById('game-screen'),
    nameInput: document.getElementById('player-name'),
    nameError: document.getElementById('name-error'),
    pieceGrid: document.getElementById('piece-grid'),
    startBtn: document.getElementById('start-btn'),
    viewLbBtn: document.getElementById('view-lb-btn'),
    lbTitle: document.getElementById('lb-title'),
    lbMessage: document.getElementById('lb-message'),
    lbList: document.getElementById('lb-list'),
    lbAgain: document.getElementById('lb-again-btn'),
    lbMenu: document.getElementById('lb-menu-btn'),
    boardWrap: document.getElementById('board-wrap'),
    canvas: document.getElementById('board'),
    tapHint: document.getElementById('tap-hint'),
    score: document.getElementById('score'),
    best: document.getElementById('best'),
  };
  const ctx = el.canvas.getContext('2d');

  // ── State ──
  const BEST_KEY = 'hyperflapBest';
  const state = {
    playerName: '', selectedId: PIECE_IDS[0], weight: WEIGHTS[PIECE_IDS[0]],
    score: 0, best: +(localStorage.getItem(BEST_KEY) || 0),
    running: false, paused: false, started: false, gameOver: false,
    bird: null, pipes: [], raf: null, lastSpawnX: 0,
  };
  const birdImg = new Image();
  birdImg.src = imgPath(state.selectedId);

  // ── Screen mgmt ──
  function show(scr) {
    [el.startScreen, el.lbScreen, el.gameScreen].forEach(s => { s.classList.add('hidden'); s.classList.remove('active'); });
    scr.classList.remove('hidden'); scr.classList.add('active');
  }

  // ── Build piece selector ──
  PIECE_IDS.forEach((id, i) => {
    const d = document.createElement('div');
    d.className = 'piece' + (i === 0 ? ' sel' : '');
    d.dataset.id = id;
    const im = document.createElement('img');
    im.src = imgPath(id); im.alt = 'Piece ' + id; im.loading = 'lazy';
    im.onerror = () => { d.style.display = 'none'; };
    d.appendChild(im);
    const wt = document.createElement('span');
    wt.className = 'wt';
    wt.textContent = WEIGHTS[id].toFixed(2) + '×';
    d.appendChild(wt);
    d.addEventListener('click', () => {
      el.pieceGrid.querySelectorAll('.piece').forEach(p => p.classList.remove('sel'));
      d.classList.add('sel');
      state.selectedId = id;
      state.weight = WEIGHTS[id];
      birdImg.src = imgPath(id);
      updateWeightInfo();
    });
    el.pieceGrid.appendChild(d);
  });

  function updateWeightInfo() {
    const info = document.getElementById('weight-info');
    if (!info) return;
    const w = state.weight;
    const label = w <= 0.9 ? 'FLOATY' : w >= 1.2 ? 'HEAVY' : 'BALANCED';
    info.innerHTML = `Weight <b>${w.toFixed(2)}×</b> · ${label} · ${pointsPerPipe(w)} pts/pipe`;
  }

  // ── Canvas sizing ──
  function sizeBoard() {
    const w = Math.min(window.innerWidth * 0.95, 440);
    const h = Math.min(window.innerHeight * 0.62, 640);
    el.canvas.width = Math.floor(w);
    el.canvas.height = Math.floor(h);
  }

  // ── Physics (scaled by board height) ──
  function cfg() {
    const h = el.canvas.height, w = el.canvas.width, s = h / 600;
    return {
      w, h, s,
      gravity: 0.46 * s * state.weight,
      flap: -8.6 * s * (0.92 + 0.08 * state.weight),
      pipeSpeed: 2.7 * s + Math.min(state.score * 0.03 * s, 1.6 * s),
      gap: 178 * s,
      pipeW: 62 * s,
      spawnDist: 235 * s,
      birdSize: 46 * s,
      birdX: w * 0.28,
    };
  }

  function resetGame() {
    const c = cfg();
    state.score = 0; state.started = false; state.gameOver = false; state.paused = false;
    state.pipes = [];
    state.bird = { x: c.birdX, y: c.h / 2, vel: 0, size: c.birdSize };
    state.lastSpawnX = c.w + 80;
    el.score.textContent = '0';
    el.best.textContent = state.best;
    el.tapHint.classList.remove('hidden');
  }

  function flap() {
    if (state.gameOver || state.paused) return;
    if (!state.started) { state.started = true; el.tapHint.classList.add('hidden'); }
    state.bird.vel = cfg().flap;
  }

  function spawnPipe() {
    const c = cfg();
    const margin = 40 * c.s;
    const gapY = margin + Math.random() * (c.h - c.gap - margin * 2);
    state.pipes.push({ x: c.w, gapY, scored: false });
  }

  function update() {
    const c = cfg();
    const b = state.bird;

    if (!state.started) {
      // idle bob
      b.y = c.h / 2 + Math.sin(Date.now() / 300) * 8 * c.s;
      return;
    }

    b.vel += c.gravity;
    b.y += b.vel;

    // ceiling clamp
    if (b.y < 0) { b.y = 0; b.vel = 0; }
    // floor = death
    if (b.y + b.size > c.h) { return die(); }

    // spawn pipes by distance
    const last = state.pipes[state.pipes.length - 1];
    if (!last || (c.w - last.x) >= c.spawnDist) spawnPipe();

    // move pipes, score, collide
    for (const p of state.pipes) {
      p.x -= c.pipeSpeed;
      // score
      if (!p.scored && p.x + c.pipeW < b.x) {
        p.scored = true; state.score += pointsPerPipe(state.weight);
        el.score.textContent = state.score;
      }
      // collision (bird as circle-ish box)
      const bx = b.x, by = b.y, bs = b.size;
      const inX = bx + bs > p.x && bx < p.x + c.pipeW;
      if (inX) {
        const inGap = by > p.gapY && by + bs < p.gapY + c.gap;
        if (!inGap) return die();
      }
    }
    // cull
    state.pipes = state.pipes.filter(p => p.x + c.pipeW > -10);
  }

  function die() {
    if (state.gameOver) return;
    state.gameOver = true;
    state.running = false;
    cancelAnimationFrame(state.raf);
    if (state.score > state.best) { state.best = state.score; localStorage.setItem(BEST_KEY, state.best); }
    endGame();
  }

  // ── Render ──
  function draw() {
    const c = cfg();
    // background gradient
    const g = ctx.createLinearGradient(0, 0, 0, c.h);
    g.addColorStop(0, '#1a0535'); g.addColorStop(0.5, '#3d0a52'); g.addColorStop(1, '#10001f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.w, c.h);

    // distant grid floor
    ctx.strokeStyle = 'rgba(139,245,197,0.12)'; ctx.lineWidth = 1;
    const fy = c.h * 0.82;
    for (let i = 0; i <= 10; i++) { const x = (i / 10) * c.w; ctx.beginPath(); ctx.moveTo(x, fy); ctx.lineTo(c.w/2 + (x - c.w/2) * 3, c.h); ctx.stroke(); }
    for (let yy = fy; yy < c.h; yy += 12) { ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(c.w, yy); ctx.stroke(); }

    // pipes
    for (const p of state.pipes) {
      drawPipe(p.x, 0, c.pipeW, p.gapY);                       // top
      drawPipe(p.x, p.gapY + c.gap, c.pipeW, c.h - (p.gapY + c.gap)); // bottom
    }

    // bird
    const b = state.bird;
    const ang = Math.max(-0.45, Math.min(1.4, b.vel / (12 * c.s)));
    ctx.save();
    ctx.translate(b.x + b.size / 2, b.y + b.size / 2);
    ctx.rotate(ang);
    if (birdImg.complete && birdImg.naturalWidth) {
      ctx.save();
      ctx.beginPath();
      const r = b.size * 0.18;
      roundRect(ctx, -b.size/2, -b.size/2, b.size, b.size, r);
      ctx.clip();
      ctx.drawImage(birdImg, -b.size/2, -b.size/2, b.size, b.size);
      ctx.restore();
      ctx.strokeStyle = 'rgba(139,245,197,0.9)'; ctx.lineWidth = 2;
      roundRect(ctx, -b.size/2, -b.size/2, b.size, b.size, r); ctx.stroke();
    } else {
      ctx.fillStyle = '#8BF5C5';
      ctx.fillRect(-b.size/2, -b.size/2, b.size, b.size);
    }
    ctx.restore();
  }

  function drawPipe(x, y, w, h) {
    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, '#0c8f5f'); grad.addColorStop(0.5, '#8BF5C5'); grad.addColorStop(1, '#0c8f5f');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#06281c'; ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  function roundRect(c2, x, y, w, h, r) {
    c2.beginPath();
    c2.moveTo(x + r, y);
    c2.arcTo(x + w, y, x + w, y + h, r);
    c2.arcTo(x + w, y + h, x, y + h, r);
    c2.arcTo(x, y + h, x, y, r);
    c2.arcTo(x, y, x + w, y, r);
    c2.closePath();
  }

  // ── Loop ──
  function loop() {
    if (!state.running) return;
    if (!state.paused) { update(); draw(); }
    if (state.running) state.raf = requestAnimationFrame(loop);
  }

  function startGame() {
    sizeBoard();
    resetGame();
    draw();
    state.running = true;
    state.raf = requestAnimationFrame(loop);
  }

  function togglePause() {
    if (!state.running || state.gameOver || !state.started) return;
    state.paused = !state.paused;
    el.boardWrap.classList.toggle('paused', state.paused);
  }

  // ── Game over → leaderboard ──
  async function endGame() {
    el.lbTitle.textContent = 'Game Over!';
    el.lbMessage.textContent = `Your score: ${state.score}` + (state.score === state.best && state.score > 0 ? '  🏆 NEW BEST!' : '');
    el.lbMessage.classList.remove('hidden');
    el.lbAgain.style.display = 'block';
    show(el.lbScreen);
    if (state.score > 0) await submitScore(state.playerName, state.score);
    renderLeaderboard(state.score);
  }

  async function renderLeaderboard(myScore) {
    el.lbList.innerHTML = '<li class="lb-loading">Loading...</li>';
    const scores = await fetchScores();
    if (!scores || !scores.length) { el.lbList.innerHTML = '<li class="lb-loading">No scores yet — be the first!</li>'; return; }
    const medals = ['🥇','🥈','🥉'];
    el.lbList.innerHTML = scores.map((s, i) => {
      const you = myScore !== undefined && s.score === myScore && (s.name === state.playerName);
      return `<li><div class="lb-row${you ? ' you' : ''}">
        <span class="rank">${medals[i] || '#'+(i+1)}</span>
        <span class="nm">${(s.name||'Anon').slice(0,15)}${you ? ' 👈' : ''}</span>
        <span class="pts">${Number(s.score).toLocaleString()}</span>
      </div></li>`;
    }).join('');
  }

  // ── Input ──
  function onFlapInput(e) {
    if (el.gameScreen.classList.contains('hidden')) return;
    e.preventDefault();
    flap();
  }
  el.boardWrap.addEventListener('pointerdown', onFlapInput);
  document.addEventListener('keydown', e => {
    if (el.gameScreen.classList.contains('hidden')) return;
    if (e.code === 'Space' || e.key === ' ' || e.key === 'ArrowUp') { e.preventDefault(); flap(); }
    if (e.key === 'p' || e.key === 'P') togglePause();
  });
  window.addEventListener('resize', () => { if (state.running) { sizeBoard(); draw(); } });

  // ── UI wiring ──
  el.startBtn.addEventListener('click', () => {
    const name = el.nameInput.value.trim();
    if (!name) { el.nameError.textContent = 'Please enter your name!'; return; }
    state.playerName = name; el.nameError.textContent = '';
    show(el.gameScreen);
    startGame();
  });
  el.viewLbBtn.addEventListener('click', () => {
    el.lbTitle.textContent = 'Global Leaderboard';
    el.lbMessage.classList.add('hidden');
    el.lbAgain.style.display = 'none';
    show(el.lbScreen);
    renderLeaderboard();
  });
  el.lbAgain.addEventListener('click', () => {
    if (state.playerName) { show(el.gameScreen); startGame(); }
    else show(el.startScreen);
  });
  el.lbMenu.addEventListener('click', () => show(el.startScreen));

  // Hide back-link when embedded in the arcade cabinet (EJECT handles exit)
  if (window.self !== window.top) {
    document.querySelectorAll('.back-link').forEach(e => e.style.display = 'none');
  }

  // init
  sizeBoard();
  updateWeightInfo();
  show(el.startScreen);
});
