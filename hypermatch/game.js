document.addEventListener('DOMContentLoaded', () => {
  // ── Supabase ──
  const SB_URL = 'https://xdacfbkdbkhptipfikgr.supabase.co';
  const SB_KEY = 'sb_publishable_xdNZ6VEysJhGeTNgwh3AHQ_ebAgi7Jw';
  const GAME_ID = 'hypermatch';

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

  // ── Piece pool (pick 8 random per game) ──
  const POOL = [21,75,92,99,111,118,120,176,203,229,241,277,339,383,420,421,472,524,525,579,620,659,676,693,758,825,937,963,968,1028,1072,1168,1212,1276,1364,1479,1598];
  const imgPath = id => `../assets/nfts/${id}.jpg`;
  const PAIRS = 8;

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
    grid: document.getElementById('card-grid'),
    pairs: document.getElementById('pairs'),
    moves: document.getElementById('moves'),
    time: document.getElementById('time'),
  };

  const state = { playerName: '', flipped: [], matched: 0, moves: 0, lock: false, startTime: 0, timer: null, started: false };

  function show(scr) {
    [el.startScreen, el.lbScreen, el.gameScreen].forEach(s => { s.classList.add('hidden'); s.classList.remove('active'); });
    scr.classList.remove('hidden'); scr.classList.add('active');
  }

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function buildBoard() {
    const pool = shuffle([...POOL]).slice(0, PAIRS);
    const deck = shuffle([...pool, ...pool]);
    el.grid.innerHTML = '';
    deck.forEach(id => {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.id = id;
      card.innerHTML = `
        <div class="card-inner">
          <div class="card-face card-back">✦</div>
          <div class="card-face card-front"><img src="${imgPath(id)}" alt="piece" loading="lazy"></div>
        </div>`;
      card.addEventListener('click', () => onFlip(card));
      el.grid.appendChild(card);
    });
  }

  function onFlip(card) {
    if (state.lock || card.classList.contains('flipped') || card.classList.contains('matched')) return;
    if (!state.started) startTimer();
    card.classList.add('flipped');
    state.flipped.push(card);
    if (state.flipped.length === 2) {
      state.moves++; el.moves.textContent = state.moves;
      state.lock = true;
      const [a, b] = state.flipped;
      if (a.dataset.id === b.dataset.id) {
        setTimeout(() => {
          a.classList.add('matched'); b.classList.add('matched');
          state.matched++; el.pairs.textContent = `${state.matched}/${PAIRS}`;
          state.flipped = []; state.lock = false;
          if (state.matched === PAIRS) win();
        }, 350);
      } else {
        setTimeout(() => {
          a.classList.remove('flipped'); b.classList.remove('flipped');
          state.flipped = []; state.lock = false;
        }, 800);
      }
    }
  }

  function startTimer() {
    state.started = true; state.startTime = Date.now();
    state.timer = setInterval(() => {
      el.time.textContent = Math.floor((Date.now() - state.startTime) / 1000) + 's';
    }, 200);
  }

  function resetGame() {
    clearInterval(state.timer);
    state.flipped = []; state.matched = 0; state.moves = 0; state.lock = false; state.started = false;
    el.pairs.textContent = `0/${PAIRS}`; el.moves.textContent = '0'; el.time.textContent = '0s';
    buildBoard();
  }

  function startGame() { resetGame(); show(el.gameScreen); }

  async function win() {
    clearInterval(state.timer);
    const secs = Math.floor((Date.now() - state.startTime) / 1000);
    // Higher = better. Perfect game (8 moves) fast scores big; penalties for extra moves & time.
    const score = Math.max(100, 5000 - (state.moves - PAIRS) * 80 - secs * 20);
    el.lbTitle.textContent = 'You Win!';
    el.lbMessage.textContent = `${state.moves} moves · ${secs}s · Score ${score.toLocaleString()}`;
    el.lbMessage.classList.remove('hidden');
    el.lbAgain.style.display = 'block';
    show(el.lbScreen);
    await submitScore(state.playerName, score);
    renderLeaderboard(score);
  }

  async function renderLeaderboard(myScore) {
    el.lbList.innerHTML = '<li class="lb-loading">Loading...</li>';
    const scores = await fetchScores();
    if (!scores || !scores.length) { el.lbList.innerHTML = '<li class="lb-loading">No scores yet — be the first!</li>'; return; }
    const medals = ['🥇','🥈','🥉'];
    el.lbList.innerHTML = scores.map((s, i) => {
      const you = myScore !== undefined && s.score === myScore && s.name === state.playerName;
      return `<li><div class="lb-row${you ? ' you' : ''}">
        <span class="rank">${medals[i] || '#'+(i+1)}</span>
        <span class="nm">${(s.name||'Anon').slice(0,15)}${you ? ' 👈' : ''}</span>
        <span class="pts">${Number(s.score).toLocaleString()}</span>
      </div></li>`;
    }).join('');
  }

  // ── UI ──
  el.startBtn.addEventListener('click', () => {
    const name = el.nameInput.value.trim();
    if (!name) { el.nameError.textContent = 'Please enter your name!'; return; }
    state.playerName = name; el.nameError.textContent = '';
    startGame();
  });
  el.viewLbBtn.addEventListener('click', () => {
    el.lbTitle.textContent = 'Global Leaderboard';
    el.lbMessage.classList.add('hidden');
    el.lbAgain.style.display = 'none';
    show(el.lbScreen); renderLeaderboard();
  });
  el.lbAgain.addEventListener('click', () => { if (state.playerName) startGame(); else show(el.startScreen); });
  el.lbMenu.addEventListener('click', () => show(el.startScreen));

  if (window.self !== window.top) document.querySelectorAll('.back-link').forEach(e => e.style.display = 'none');
  show(el.startScreen);
});
