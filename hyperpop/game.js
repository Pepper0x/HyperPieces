document.addEventListener('DOMContentLoaded', () => {
  // ── Supabase ──
  const SB_URL = 'https://xdacfbkdbkhptipfikgr.supabase.co';
  const SB_KEY = 'sb_publishable_xdNZ6VEysJhGeTNgwh3AHQ_ebAgi7Jw';
  const GAME_ID = 'hyperpop';
  async function submitScore(name, score) {
    try {
      await fetch(`${SB_URL}/rest/v1/scores`, {
        method: 'POST',
        headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ name: name || 'Anonymous', score, game: GAME_ID })
      });
    } catch (e) { console.warn(e); }
  }
  async function fetchScores() {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/scores?select=name,score&game=eq.${GAME_ID}&order=score.desc&limit=10`,
        { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } });
      if (!r.ok) throw 0; return await r.json();
    } catch (e) { return null; }
  }

  // ── Bubble types: each piece has a distinct background color, so the whole
  //    round NFT image IS the match signal (no borders needed). ──
  const TYPES = [
    { color: '#8BF5C5', id: 120 },
    { color: '#ff4d6d', id: 620 },
    { color: '#ffd23f', id: 963 },
    { color: '#36c5ff', id: 968 },
    { color: '#b06bff', id: 1191 },
  ];
  const imgs = TYPES.map(t => { const im = new Image(); im.src = `../assets/nfts/${t.id}.jpg`; return im; });

  const COLS = 8, START_ROWS = 5, SHOTS_PER_DROP = 5;

  const el = {
    startScreen: document.getElementById('start-screen'),
    lbScreen: document.getElementById('lb-screen'),
    gameScreen: document.getElementById('game-screen'),
    nameInput: document.getElementById('player-name'),
    nameError: document.getElementById('name-error'),
    startBtn: document.getElementById('start-btn'),
    viewLbBtn: document.getElementById('view-lb-btn'),
    lbTitle: document.getElementById('lb-title'),
    lbMessage: document.getElementById('lb-message'),
    lbList: document.getElementById('lb-list'),
    lbAgain: document.getElementById('lb-again-btn'),
    lbMenu: document.getElementById('lb-menu-btn'),
    boardWrap: document.getElementById('board-wrap'),
    canvas: document.getElementById('board'),
    score: document.getElementById('score'),
    best: document.getElementById('best'),
  };
  const ctx = el.canvas.getContext('2d');

  const BEST_KEY = 'hyperpopBest';
  let W, H, R, yStep, shooterX, shooterY, topParity;
  const G = { grid: [], current: 0, next: 0, moving: null, aim: -Math.PI / 2,
              score: 0, best: +(localStorage.getItem(BEST_KEY) || 0),
              running: false, over: false, shots: 0, raf: null, playerName: '' };

  function show(scr) {
    [el.startScreen, el.lbScreen, el.gameScreen].forEach(s => { s.classList.add('hidden'); s.classList.remove('active'); });
    scr.classList.remove('hidden'); scr.classList.add('active');
  }

  function sizeBoard() {
    W = Math.floor(Math.min(window.innerWidth * 0.95, 380));
    R = Math.floor(W / (2 * COLS));
    W = R * 2 * COLS;                       // snap width to grid
    H = Math.floor(Math.min(window.innerHeight * 0.72, 640));
    yStep = R * Math.sqrt(3);
    el.canvas.width = W; el.canvas.height = H;
    shooterX = W / 2; shooterY = H - R * 1.5;
  }

  const colsInRow = r => ((r + topParity) % 2 === 0) ? COLS : COLS - 1;
  const cellX = (r, c) => R + ((r + topParity) % 2) * R + c * 2 * R;
  const cellY = r => R + r * yStep;
  const randType = () => Math.floor(Math.random() * TYPES.length);

  function neighbors(r, c) {
    const par = (r + topParity) % 2;
    const deltas = par === 0
      ? [[0,-1],[0,1],[-1,-1],[-1,0],[1,-1],[1,0]]
      : [[0,-1],[0,1],[-1,0],[-1,1],[1,0],[1,1]];
    const res = [];
    for (const [dr, dc] of deltas) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < G.grid.length && G.grid[nr] && nc >= 0 && nc < G.grid[nr].length) res.push([nr, nc]);
    }
    return res;
  }

  function ensureRow(r) {
    while (G.grid.length <= r) {
      const idx = G.grid.length;
      G.grid.push(new Array(colsInRow(idx)).fill(null));
    }
  }

  function resetGame() {
    sizeBoard();
    topParity = 0;
    G.grid = [];
    for (let r = 0; r < START_ROWS; r++) {
      const row = new Array(colsInRow(r)).fill(null).map(() => randType());
      G.grid.push(row);
    }
    G.current = randType(); G.next = randType();
    G.moving = null; G.score = 0; G.over = false; G.shots = 0;
    el.score.textContent = '0'; el.best.textContent = G.best;
  }

  function addTopRow() {
    topParity = 1 - topParity;
    G.grid.unshift(new Array(colsInRow(0)).fill(null).map(() => randType()));
  }

  // Find the grid cell a moving bubble should snap to
  function findCell(x, y) {
    let r = Math.max(0, Math.round((y - R) / yStep));
    ensureRow(r);
    const off = ((r + topParity) % 2) * R;
    let c = Math.round((x - R - off) / (2 * R));
    c = Math.max(0, Math.min(colsInRow(r) - 1, c));
    if (G.grid[r][c] === null) return [r, c];
    // search nearby empties
    let best = null, bestD = Infinity;
    const consider = (rr, cc) => {
      if (rr < 0) return; ensureRow(rr);
      if (cc < 0 || cc >= G.grid[rr].length) return;
      if (G.grid[rr][cc] !== null) return;
      const dx = cellX(rr, cc) - x, dy = cellY(rr) - y, d = dx*dx + dy*dy;
      if (d < bestD) { bestD = d; best = [rr, cc]; }
    };
    for (const [nr, nc] of neighbors(r, c)) consider(nr, nc);
    consider(r + 1, c); consider(r + 1, c - 1); consider(r + 1, c + 1);
    if (best) return best;
    ensureRow(r + 1); return [r + 1, Math.min(c, colsInRow(r + 1) - 1)];
  }

  function sameColorCluster(r, c, type) {
    const seen = new Set(), stack = [[r, c]], out = [];
    while (stack.length) {
      const [cr, cc] = stack.pop();
      const k = cr + ',' + cc;
      if (seen.has(k)) continue; seen.add(k);
      if (!G.grid[cr] || G.grid[cr][cc] !== type) continue;
      out.push([cr, cc]);
      for (const n of neighbors(cr, cc)) stack.push(n);
    }
    return out;
  }

  function dropFloating() {
    const connected = new Set();
    const stack = [];
    if (G.grid[0]) for (let c = 0; c < G.grid[0].length; c++) if (G.grid[0][c] !== null) stack.push([0, c]);
    while (stack.length) {
      const [r, c] = stack.pop(); const k = r + ',' + c;
      if (connected.has(k)) continue; connected.add(k);
      for (const [nr, nc] of neighbors(r, c)) if (G.grid[nr][nc] !== null) stack.push([nr, nc]);
    }
    let dropped = 0;
    for (let r = 0; r < G.grid.length; r++)
      for (let c = 0; c < G.grid[r].length; c++)
        if (G.grid[r][c] !== null && !connected.has(r + ',' + c)) { G.grid[r][c] = null; dropped++; }
    return dropped;
  }

  function settle(type, x, y) {
    const [r, c] = findCell(x, y);
    G.grid[r][c] = type;
    const cluster = sameColorCluster(r, c, type);
    if (cluster.length >= 3) {
      for (const [cr, cc] of cluster) G.grid[cr][cc] = null;
      G.score += cluster.length * 10;
      const dropped = dropFloating();
      if (dropped) G.score += dropped * 20;
      G.shots = 0;
    } else {
      G.shots++;
      if (G.shots >= SHOTS_PER_DROP) { addTopRow(); G.shots = 0; }
    }
    el.score.textContent = G.score;
    if (G.score > G.best) { G.best = G.score; localStorage.setItem(BEST_KEY, G.best); el.best.textContent = G.best; }

    // game over if any bubble crosses the danger line
    for (let r2 = 0; r2 < G.grid.length; r2++)
      for (let c2 = 0; c2 < G.grid[r2].length; c2++)
        if (G.grid[r2][c2] !== null && cellY(r2) + R >= shooterY - R) return die();
  }

  function shoot() {
    if (G.moving || G.over) return;
    const sp = R * 0.8;
    G.moving = { x: shooterX, y: shooterY, vx: Math.cos(G.aim) * sp, vy: Math.sin(G.aim) * sp, type: G.current };
    G.current = G.next; G.next = randType();
  }

  function stepMoving() {
    const m = G.moving; if (!m) return;
    const steps = 4;
    for (let s = 0; s < steps; s++) {
      m.x += m.vx / steps; m.y += m.vy / steps;
      if (m.x < R) { m.x = R; m.vx = -m.vx; }
      if (m.x > W - R) { m.x = W - R; m.vx = -m.vx; }
      if (m.y <= R) { settle(m.type, m.x, R); G.moving = null; return; }
      // collide with grid
      for (let r = 0; r < G.grid.length; r++) {
        for (let c = 0; c < G.grid[r].length; c++) {
          if (G.grid[r][c] === null) continue;
          const dx = m.x - cellX(r, c), dy = m.y - cellY(r);
          if (dx*dx + dy*dy < (2*R*0.85)*(2*R*0.85)) { settle(m.type, m.x, m.y); G.moving = null; return; }
        }
      }
    }
  }

  // ── Render ──
  function drawBubble(cx, cy, type, radius) {
    const rr = radius || R; const im = imgs[type];
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, rr - 1, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    if (im && im.complete && im.naturalWidth) {
      ctx.drawImage(im, cx - rr, cy - rr, rr * 2, rr * 2);   // full round image, no border
    } else {
      ctx.fillStyle = TYPES[type].color; ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
    }
    ctx.restore();
  }

  function draw() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1a0535'); g.addColorStop(1, '#10001f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // danger line
    ctx.strokeStyle = 'rgba(255,80,120,0.4)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, shooterY - R); ctx.lineTo(W, shooterY - R); ctx.stroke();
    ctx.setLineDash([]);

    for (let r = 0; r < G.grid.length; r++)
      for (let c = 0; c < G.grid[r].length; c++)
        if (G.grid[r][c] !== null) drawBubble(cellX(r, c), cellY(r), G.grid[r][c]);

    // aim guide
    if (!G.moving && !G.over) {
      let ax = shooterX, ay = shooterY, dx = Math.cos(G.aim), dy = Math.sin(G.aim);
      ctx.strokeStyle = 'rgba(139,245,197,0.5)'; ctx.setLineDash([5, 8]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ax, ay);
      for (let i = 0; i < 200; i++) {
        ax += dx * R * 0.5; ay += dy * R * 0.5;
        if (ax < R) { ax = R; dx = -dx; } if (ax > W - R) { ax = W - R; dx = -dx; }
        if (ay < R * 3) break;
        ctx.lineTo(ax, ay);
      }
      ctx.stroke(); ctx.setLineDash([]);
    }

    // moving bubble
    if (G.moving) drawBubble(G.moving.x, G.moving.y, G.moving.type);

    // shooter (current + next)
    drawBubble(shooterX, shooterY, G.current);
    drawBubble(W - R * 1.2, H - R * 0.9, G.next, R * 0.7);
  }

  function loop() {
    if (!G.running) return;
    stepMoving(); draw();
    if (G.running) G.raf = requestAnimationFrame(loop);
  }

  function startGame() {
    resetGame(); draw();
    G.running = true; G.raf = requestAnimationFrame(loop);
  }

  function die() {
    if (G.over) return;
    G.over = true; G.running = false; cancelAnimationFrame(G.raf);
    endGame();
  }

  async function endGame() {
    el.lbTitle.textContent = 'Game Over!';
    el.lbMessage.textContent = `Score ${G.score.toLocaleString()}` + (G.score === G.best && G.score > 0 ? '  🏆 NEW BEST!' : '');
    el.lbMessage.classList.remove('hidden');
    el.lbAgain.style.display = 'block';
    show(el.lbScreen);
    if (G.score > 0) await submitScore(G.playerName, G.score);
    renderLeaderboard(G.score);
  }

  async function renderLeaderboard(myScore) {
    el.lbList.innerHTML = '<li class="lb-loading">Loading...</li>';
    const scores = await fetchScores();
    if (!scores || !scores.length) { el.lbList.innerHTML = '<li class="lb-loading">No scores yet — be the first!</li>'; return; }
    const medals = ['🥇','🥈','🥉'];
    el.lbList.innerHTML = scores.map((s, i) => {
      const you = myScore !== undefined && s.score === myScore && s.name === G.playerName;
      return `<li><div class="lb-row${you ? ' you' : ''}">
        <span class="rank">${medals[i] || '#'+(i+1)}</span>
        <span class="nm">${(s.name||'Anon').slice(0,15)}${you ? ' 👈' : ''}</span>
        <span class="pts">${Number(s.score).toLocaleString()}</span>
      </div></li>`;
    }).join('');
  }

  // ── Input: aim with pointer, tap/click to shoot ──
  function setAim(clientX, clientY) {
    const rect = el.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (W / rect.width);
    const y = (clientY - rect.top) * (H / rect.height);
    let ang = Math.atan2(y - shooterY, x - shooterX);
    // clamp to upward arc
    if (ang > -0.15) ang = -0.15;
    if (ang < -Math.PI + 0.15) ang = -Math.PI + 0.15;
    G.aim = ang;
  }
  el.canvas.addEventListener('pointermove', e => { if (!el.gameScreen.classList.contains('hidden')) setAim(e.clientX, e.clientY); });
  el.canvas.addEventListener('pointerdown', e => {
    if (el.gameScreen.classList.contains('hidden')) return;
    e.preventDefault(); setAim(e.clientX, e.clientY); shoot();
  });
  window.addEventListener('resize', () => { if (G.running) { sizeBoard(); draw(); } });

  // ── UI ──
  el.startBtn.addEventListener('click', () => {
    const name = el.nameInput.value.trim();
    if (!name) { el.nameError.textContent = 'Please enter your name!'; return; }
    G.playerName = name; el.nameError.textContent = '';
    show(el.gameScreen); startGame();
  });
  el.viewLbBtn.addEventListener('click', () => {
    el.lbTitle.textContent = 'Global Leaderboard';
    el.lbMessage.classList.add('hidden'); el.lbAgain.style.display = 'none';
    show(el.lbScreen); renderLeaderboard();
  });
  el.lbAgain.addEventListener('click', () => { if (G.playerName) { show(el.gameScreen); startGame(); } else show(el.startScreen); });
  el.lbMenu.addEventListener('click', () => show(el.startScreen));

  if (window.self !== window.top) document.querySelectorAll('.back-link').forEach(e => e.style.display = 'none');
  sizeBoard();
  show(el.startScreen);
});
