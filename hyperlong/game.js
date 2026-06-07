document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // ── Config ──────────────────────────────────────────────
  const GRID = 17;                 // cells per side
  const BASE_SPEED = 150;          // ms per step at start
  const MIN_SPEED = 65;            // fastest step interval
  const SPEED_STEP = 5;            // ms faster per food
  const FOOD_POINTS = 10;          // base points per food
  const BOMB_EVERY = 4;            // add a bomb every N foods
  const MAX_BOMBS = 12;

  // ── Supabase (shared global leaderboard) ────────────────
  const SB_URL = 'https://xdacfbkdbkhptipfikgr.supabase.co';
  const SB_KEY = 'sb_publishable_xdNZ6VEysJhGeTNgwh3AHQ_ebAgi7Jw';
  const GAME_ID = 'hyperlong';

  async function submitScore(name, score) {
    if (score <= 0) return;
    try {
      await fetch(`${SB_URL}/rest/v1/scores`, {
        method: 'POST',
        headers: {
          'apikey': SB_KEY,
          'Authorization': `Bearer ${SB_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ name: name || 'Anonymous', score, game: GAME_ID })
      });
    } catch (e) { console.warn('submit failed', e); }
  }

  async function fetchScores() {
    try {
      const res = await fetch(
        `${SB_URL}/rest/v1/scores?select=name,score&game=eq.${GAME_ID}&order=score.desc&limit=10`,
        { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` } }
      );
      if (!res.ok) throw new Error('fetch failed');
      return await res.json();
    } catch (e) { console.warn('fetch failed', e); return null; }
  }

  // ── Images ──────────────────────────────────────────────
  const IMG_SRCS = [
    '../hyperdrop/image1.png', '../hyperdrop/image2.png', '../hyperdrop/image3.png',
    '../hyperdrop/image4.png', '../hyperdrop/image5.png', '../hyperdrop/image6.png',
    '../hyperdrop/image7.png'
  ];
  const images = IMG_SRCS.map(src => { const i = new Image(); i.src = src; return i; });

  // ── DOM ─────────────────────────────────────────────────
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
    lbAgainBtn: document.getElementById('lb-again-btn'),
    lbMenuBtn: document.getElementById('lb-menu-btn'),
    boardWrap: document.getElementById('board-wrap'),
    canvas: document.getElementById('board'),
    score: document.getElementById('score'),
    length: document.getElementById('length'),
    best: document.getElementById('best')
  };
  const ctx = el.canvas.getContext('2d');

  // ── State ───────────────────────────────────────────────
  const state = {
    snake: [], dir: { x: 1, y: 0 }, nextDir: { x: 1, y: 0 },
    food: null, foodImg: 0, bombs: [],
    score: 0, foodsEaten: 0, cell: 20,
    playerName: '', running: false, paused: false,
    loop: null, speed: BASE_SPEED
  };

  const BEST_KEY = 'hyperlong_best';
  const getBest = () => parseInt(localStorage.getItem(BEST_KEY) || '0', 10);
  const setBest = v => localStorage.setItem(BEST_KEY, String(v));

  // ── Screen management ───────────────────────────────────
  function show(screen) {
    [el.startScreen, el.lbScreen, el.gameScreen].forEach(s => {
      s.classList.add('hidden'); s.classList.remove('active');
    });
    screen.classList.remove('hidden'); screen.classList.add('active');
  }

  // ── Sizing ──────────────────────────────────────────────
  function sizeBoard() {
    const maxW = Math.min(window.innerWidth * 0.95, 460);
    const maxH = window.innerHeight * 0.68;
    const size = Math.floor(Math.min(maxW, maxH));
    state.cell = Math.floor(size / GRID);
    const px = state.cell * GRID;
    el.canvas.width = px;
    el.canvas.height = px;
  }
  window.addEventListener('resize', () => { sizeBoard(); if (state.running) draw(); });

  // ── Helpers ─────────────────────────────────────────────
  function randomEmptyCell() {
    const occupied = new Set();
    state.snake.forEach(s => occupied.add(s.x + ',' + s.y));
    state.bombs.forEach(b => occupied.add(b.x + ',' + b.y));
    if (state.food) occupied.add(state.food.x + ',' + state.food.y);
    let tries = 0;
    while (tries++ < 500) {
      const x = Math.floor(Math.random() * GRID);
      const y = Math.floor(Math.random() * GRID);
      if (!occupied.has(x + ',' + y)) return { x, y };
    }
    return null;
  }

  function spawnFood() {
    const cell = randomEmptyCell();
    if (cell) { state.food = cell; state.foodImg = Math.floor(Math.random() * images.length); }
  }

  function spawnBomb() {
    if (state.bombs.length >= MAX_BOMBS) state.bombs.shift();
    // Don't drop a bomb right in front of the head
    const head = state.snake[0];
    let cell, tries = 0;
    do {
      cell = randomEmptyCell();
      tries++;
    } while (cell && tries < 20 &&
             Math.abs(cell.x - head.x) + Math.abs(cell.y - head.y) < 3);
    if (cell) state.bombs.push(cell);
  }

  // ── Game lifecycle ──────────────────────────────────────
  function startGame() {
    sizeBoard();
    const mid = Math.floor(GRID / 2);
    state.snake = [{ x: mid, y: mid }, { x: mid - 1, y: mid }, { x: mid - 2, y: mid }];
    state.dir = { x: 1, y: 0 };
    state.nextDir = { x: 1, y: 0 };
    state.bombs = [];
    state.score = 0;
    state.foodsEaten = 0;
    state.speed = BASE_SPEED;
    state.running = true;
    state.paused = false;
    el.boardWrap.classList.remove('paused');
    spawnFood();
    updateHud();
    show(el.gameScreen);
    draw();
    clearInterval(state.loop);
    state.loop = setInterval(tick, state.speed);
  }

  function restartLoop() {
    clearInterval(state.loop);
    state.loop = setInterval(tick, state.speed);
  }

  function updateHud() {
    el.score.textContent = state.score;
    el.length.textContent = state.snake.length;
    el.best.textContent = getBest();
  }

  function tick() {
    if (state.paused || !state.running) return;

    state.dir = state.nextDir;
    const head = state.snake[0];
    const nx = head.x + state.dir.x;
    const ny = head.y + state.dir.y;

    // Wall collision
    if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) return gameOver();
    // Self collision
    for (let i = 0; i < state.snake.length; i++) {
      if (state.snake[i].x === nx && state.snake[i].y === ny) return gameOver();
    }
    // Bomb collision
    for (const b of state.bombs) {
      if (b.x === nx && b.y === ny) return gameOver();
    }

    const newHead = { x: nx, y: ny };
    state.snake.unshift(newHead);

    // Food?
    if (state.food && nx === state.food.x && ny === state.food.y) {
      state.foodsEaten++;
      // Faster snakes earn more per food
      const speedBonus = Math.round((BASE_SPEED - state.speed) / 10);
      state.score += FOOD_POINTS + speedBonus;
      spawnFood();
      if (state.foodsEaten % BOMB_EVERY === 0) spawnBomb();
      if (state.speed > MIN_SPEED) {
        state.speed = Math.max(MIN_SPEED, state.speed - SPEED_STEP);
        restartLoop();
      }
    } else {
      state.snake.pop(); // move forward
    }

    updateHud();
    draw();
  }

  async function gameOver() {
    state.running = false;
    clearInterval(state.loop);

    if (state.score > getBest()) setBest(state.score);

    el.lbTitle.textContent = 'Game Over!';
    el.lbMessage.classList.remove('hidden');
    el.lbMessage.textContent = `You scored ${state.score.toLocaleString()} (length ${state.snake.length})`;
    el.lbAgainBtn.textContent = 'Play Again';
    el.lbList.innerHTML = '<li class="lb-loading">Saving score...</li>';
    show(el.lbScreen);

    await submitScore(state.playerName, state.score);
    renderLeaderboard(state.score);
  }

  // ── Rendering ───────────────────────────────────────────
  function draw() {
    const c = state.cell;
    const px = c * GRID;

    // background
    ctx.fillStyle = '#10161d';
    ctx.fillRect(0, 0, px, px);

    // grid
    ctx.strokeStyle = 'rgba(139,245,197,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= GRID; i++) {
      ctx.moveTo(i * c + 0.5, 0); ctx.lineTo(i * c + 0.5, px);
      ctx.moveTo(0, i * c + 0.5); ctx.lineTo(px, i * c + 0.5);
    }
    ctx.stroke();

    // food (pulsing ring + image)
    if (state.food) {
      const fx = state.food.x * c, fy = state.food.y * c;
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 200);
      ctx.save();
      ctx.shadowColor = 'rgba(139,245,197,' + (0.4 + pulse * 0.5) + ')';
      ctx.shadowBlur = 8 + pulse * 8;
      drawImgCell(state.foodImg, fx, fy, c);
      ctx.restore();
    }

    // snake (cycle character images along the body)
    state.snake.forEach((seg, i) => {
      const sx = seg.x * c, sy = seg.y * c;
      const imgIndex = (i) % images.length;
      drawImgCell(imgIndex, sx, sy, c);
      if (i === 0) {
        // head glow
        ctx.strokeStyle = 'rgba(139,245,197,0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(sx + 1, sy + 1, c - 2, c - 2);
      }
    });

    // bombs
    state.bombs.forEach(b => drawBomb(b.x * c, b.y * c, c));
  }

  function drawImgCell(idx, x, y, size) {
    const img = images[idx];
    ctx.save();
    // rounded clip
    const r = Math.max(2, size * 0.18);
    roundRect(x + 1, y + 1, size - 2, size - 2, r);
    ctx.clip();
    if (img.complete && img.naturalWidth) {
      ctx.drawImage(img, x + 1, y + 1, size - 2, size - 2);
    } else {
      ctx.fillStyle = '#8BF5C5';
      ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
    }
    ctx.restore();
  }

  function drawBomb(x, y, size) {
    const cx = x + size / 2, cy = y + size / 2;
    const r = size * 0.32;
    // body
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(cx, cy + size * 0.05, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ff5c5c';
    ctx.lineWidth = 2;
    ctx.stroke();
    // shine
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(cx - r * 0.3, cy - r * 0.2, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    // fuse
    ctx.strokeStyle = '#c9a227';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.6);
    ctx.lineTo(cx + size * 0.12, cy - r * 1.3);
    ctx.stroke();
    // spark
    ctx.fillStyle = '#ffb000';
    ctx.beginPath();
    ctx.arc(cx + size * 0.12, cy - r * 1.4, size * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Animate food pulse even when snake hasn't moved
  function animatePulse() {
    if (state.running && !state.paused) draw();
    requestAnimationFrame(animatePulse);
  }
  requestAnimationFrame(animatePulse);

  // ── Leaderboard render ──────────────────────────────────
  async function renderLeaderboard(highlightScore) {
    el.lbList.innerHTML = '<li class="lb-loading">Loading...</li>';
    const scores = await fetchScores();
    if (!scores || scores.length === 0) {
      el.lbList.innerHTML = '<li class="lb-loading">No scores yet — be the first!</li>';
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    let highlighted = false;
    el.lbList.innerHTML = scores.map((s, i) => {
      const rank = medals[i] || `#${i + 1}`;
      const you = (!highlighted && highlightScore !== undefined && s.score === highlightScore);
      if (you) highlighted = true;
      return `<li><div class="lb-row${you ? ' you' : ''}">
        <span class="rank">${rank}</span>
        <span class="nm">${escapeHtml(s.name || 'Anonymous')}${you ? ' 👈' : ''}</span>
        <span class="pts">${Number(s.score).toLocaleString()}</span>
      </div></li>`;
    }).join('');
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── Input ───────────────────────────────────────────────
  function setDir(x, y) {
    // prevent reversing into self
    if (x === -state.dir.x && y === -state.dir.y) return;
    state.nextDir = { x, y };
  }

  document.addEventListener('keydown', e => {
    if (!state.running) return;
    switch (e.key) {
      case 'ArrowUp': case 'w': case 'W': setDir(0, -1); e.preventDefault(); break;
      case 'ArrowDown': case 's': case 'S': setDir(0, 1); e.preventDefault(); break;
      case 'ArrowLeft': case 'a': case 'A': setDir(-1, 0); e.preventDefault(); break;
      case 'ArrowRight': case 'd': case 'D': setDir(1, 0); e.preventDefault(); break;
      case 'p': case 'P':
        state.paused = !state.paused;
        el.boardWrap.classList.toggle('paused', state.paused);
        e.preventDefault();
        break;
    }
  });

  // Swipe (mobile)
  let touchStart = null;
  el.canvas.addEventListener('touchstart', e => {
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  el.canvas.addEventListener('touchmove', e => { e.preventDefault(); }, { passive: false });
  el.canvas.addEventListener('touchend', e => {
    if (!touchStart) return;
    const dx = e.changedTouches[0].clientX - touchStart.x;
    const dy = e.changedTouches[0].clientY - touchStart.y;
    if (Math.abs(dx) < 18 && Math.abs(dy) < 18) { touchStart = null; return; }
    if (Math.abs(dx) > Math.abs(dy)) setDir(dx > 0 ? 1 : -1, 0);
    else setDir(0, dy > 0 ? 1 : -1);
    touchStart = null;
  }, { passive: true });

  // ── UI buttons ──────────────────────────────────────────
  el.startBtn.addEventListener('click', () => {
    const name = el.nameInput.value.trim();
    if (!name) { el.nameError.textContent = 'Please enter your name!'; return; }
    el.nameError.textContent = '';
    state.playerName = name;
    startGame();
  });

  el.nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') el.startBtn.click();
  });

  el.viewLbBtn.addEventListener('click', () => {
    el.lbTitle.textContent = 'Global Leaderboard';
    el.lbMessage.classList.add('hidden');
    el.lbAgainBtn.textContent = state.playerName ? 'Play Again' : 'Start Game';
    show(el.lbScreen);
    renderLeaderboard();
  });

  el.lbAgainBtn.addEventListener('click', () => {
    if (state.playerName) startGame();
    else show(el.startScreen);
  });

  el.lbMenuBtn.addEventListener('click', () => show(el.startScreen));

  // ── Init ────────────────────────────────────────────────
  el.best.textContent = getBest();
  sizeBoard();
  show(el.startScreen);
});
