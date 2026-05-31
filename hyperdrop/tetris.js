document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    const config = {
        board: { width: 10, height: 20 },
        touch: {
            dragThreshold: 15,
            moveThresholdRatio: 0.5,
            swipeDownThreshold: 50,
            tapTimeout: 200
        },
        gameplay: {
            baseSpeedMs: 1000,
            speedMultiplier: 1.2,
            minSpeedMs: 50,
            linesPerLevel: 4
        }
    };

    // --- Tetromino Data ---
    const tetrominoes = {
        shapes: [
            /* I */ [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
            /* J */ [[1,0,0],[1,1,1],[0,0,0]],
            /* L */ [[0,0,1],[1,1,1],[0,0,0]],
            /* O */ [[1,1],[1,1]],
            /* S */ [[0,1,1],[1,1,0],[0,0,0]],
            /* T */ [[0,1,0],[1,1,1],[0,0,0]],
            /* Z */ [[1,1,0],[0,1,1],[0,0,0]]
        ],
        colors: ["#00f0f0","#0000f0","#f0a000","#f0f000","#00f000","#a000f0","#f00000"],
        images: ['image1.png','image2.png','image3.png','image4.png','image5.png','image6.png','image7.png']
    };

    // --- Preload images once at startup (avoids per-frame URL lookups) ---
    const loadedImages = tetrominoes.images.map(src => {
        const img = new Image();
        img.src = src;
        return img;
    });

    // --- Rotation kick offsets (static constant, not recreated per call) ---
    const KICK_OFFSETS = [[0,0],[-1,0],[1,0],[0,-1],[-2,0],[2,0],[0,-2],[-1,-1],[1,-1],[-1,1],[1,1]];

    // --- Canvas refs (created once in initBoard) ---
    let boardCanvas = null, boardCtx = null;
    let nextCanvas  = null, nextCtx  = null;

    // --- Game State ---
    const game = {
        board: [], score: 0, lines: 0, level: 1,
        currentPiece: null, nextPiece: null,
        currentX: 0, currentY: 0, blockSize: 20,
        interval: null, isPaused: false, isGameOver: false, gameStarted: false,
        currentPlayerName: '',
        pieceBag: [],
        startTime: null
    };

    // --- DOM Elements ---
    const elements = {
        body: document.body,
        startScreen: document.getElementById('start-screen'),
        leaderboardScreen: document.getElementById('leaderboard-screen'),
        gameArea: document.getElementById('game-area'),
        playerNameInput: document.getElementById('player-name-input'),
        nameError: document.getElementById('name-error'),
        startGameButton: document.getElementById('start-game-button'),
        viewLeaderboardButton: document.getElementById('view-leaderboard-button'),
        highScoreList: document.getElementById('high-score-list'),
        leaderboardTitle: document.getElementById('leaderboard-title'),
        leaderboardMessage: document.getElementById('leaderboard-message'),
        leaderboardActionButtons: document.getElementById('leaderboard-action-buttons'),
        leaderboardTryAgainButton: document.getElementById('leaderboard-try-again-button'),
        leaderboardResetScoresButton: document.getElementById('leaderboard-reset-scores-button'),
        leaderboardMainMenuButton: document.getElementById('leaderboard-main-menu-button'),
        gameAreaWrapper: document.getElementById('game-area-wrapper'),
        board: document.getElementById('board'),
        nextPieceContainer: document.getElementById('next-piece-container'),
        nextPiece: document.getElementById('next-piece'),
        statsPanel: document.getElementById('stats-panel'),
        score: document.getElementById('score'),
        lines: document.getElementById('lines'),
        level: document.getElementById('level'),
        gameOverOriginalDisplay: document.getElementById('game-over-original-display'),
        gameOverPlayer: document.getElementById('game-over-player'),
        finalScore: document.getElementById('final-score')
    };

    // --- Touch State ---
    const touch = { startX: 0, startY: 0, currentX: 0, startTime: 0, isDragging: false, isSwipedDown: false, movedHorizontally: false };

    // --- Supabase (Global Leaderboard) ---
    const SB_URL = 'https://xdacfbkdbkhptipfikgr.supabase.co';
    const SB_KEY = 'sb_publishable_xdNZ6VEysJhGeTNgwh3AHQ_ebAgi7Jw';

    async function submitScoreToCloud(name, score, durationMs) {
        try {
            await fetch(`${SB_URL}/rest/v1/scores`, {
                method: 'POST',
                headers: {
                    'apikey': SB_KEY,
                    'Authorization': `Bearer ${SB_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({ name: name || 'Anonymous', score, duration_ms: durationMs })
            });
        } catch (e) {
            console.warn('Could not submit score to cloud:', e);
        }
    }

    async function fetchGlobalScores() {
        try {
            const res = await fetch(
                `${SB_URL}/rest/v1/scores?select=name,score&order=score.desc&limit=10`,
                { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` } }
            );
            if (!res.ok) throw new Error('fetch failed');
            return await res.json();
        } catch (e) {
            console.warn('Could not fetch global scores:', e);
            return null;
        }
    }

    // --- High Score Logic ---
    const HIGH_SCORE_KEY = 'tetrisHighScores';
    const MAX_HIGH_SCORES = 10;

    function getHighScores() {
        try {
            const scores = JSON.parse(localStorage.getItem(HIGH_SCORE_KEY) || '[]');
            return Array.isArray(scores) ? scores : [];
        } catch (e) {
            return [];
        }
    }

    function saveHighScores(scores) {
        if (!Array.isArray(scores)) return;
        localStorage.setItem(HIGH_SCORE_KEY, JSON.stringify(
            [...scores].sort((a, b) => b.score - a.score).slice(0, MAX_HIGH_SCORES)
        ));
    }

    function addNewHighScore(entry) {
        if (!entry || typeof entry.name !== 'string' || !Number.isFinite(entry.score)) return;
        const scores = getHighScores();
        scores.push(entry);
        saveHighScores(scores);
    }

    async function displayHighScores(currentScore) {
        if (!elements.highScoreList) return;
        elements.highScoreList.innerHTML = '<li class="loading-scores">Loading...</li>';

        const scores = await fetchGlobalScores();

        if (!scores || scores.length === 0) {
            elements.highScoreList.innerHTML = '<li>No scores yet — be the first!</li>';
            return;
        }

        const medals = ['🥇','🥈','🥉'];
        elements.highScoreList.innerHTML = scores.map((e, i) => {
            const rank   = medals[i] || `#${i + 1}`;
            const name   = (e.name || 'Anonymous').slice(0, 15);
            const pts    = Number(e.score).toLocaleString();
            const isYou  = currentScore !== undefined && e.score === currentScore;
            return `<li class="score-entry${isYou ? ' you' : ''}">
                        <span class="rank">${rank}</span>
                        <span class="sname">${name}${isYou ? ' 👈' : ''}</span>
                        <span class="spts">${pts}</span>
                    </li>`;
        }).join('');
    }

    // --- Screen Management ---
    function showScreen(screenElement) {
        elements.startScreen?.classList.add('hidden');
        elements.startScreen?.classList.remove('active');
        elements.leaderboardScreen?.classList.add('hidden');
        elements.leaderboardScreen?.classList.remove('active');
        elements.gameArea?.classList.add('hidden');
        if (screenElement) {
            screenElement.classList.remove('hidden');
            screenElement.classList.add('active');
        }
    }

    // --- Core Game Logic ---

    function fillAndShuffleBag() {
        game.pieceBag = tetrominoes.shapes.map((_, i) => i);
        for (let i = game.pieceBag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [game.pieceBag[i], game.pieceBag[j]] = [game.pieceBag[j], game.pieceBag[i]];
        }
    }

    function createPiece() {
        if (game.pieceBag.length === 0) fillAndShuffleBag();
        const index = game.pieceBag.pop();
        return {
            shape: index,
            // Shallow row-copy is sufficient for 2D arrays of primitives (no JSON.parse/stringify needed)
            matrix: tetrominoes.shapes[index].map(row => [...row]),
            image: tetrominoes.images[index],
            color: tetrominoes.colors[index]
        };
    }

    function initBoard() {
        game.board = Array.from({ length: config.board.height }, () => Array(config.board.width).fill(0));

        // Create canvas elements once; reuse on subsequent games
        if (!boardCanvas) {
            boardCanvas = document.createElement('canvas');
            boardCanvas.style.cssText = 'position:absolute;top:0;left:0;touch-action:none;';
            elements.board.appendChild(boardCanvas);
            boardCtx = boardCanvas.getContext('2d');
        }
        if (!nextCanvas) {
            nextCanvas = document.createElement('canvas');
            elements.nextPiece.innerHTML = '';
            elements.nextPiece.appendChild(nextCanvas);
            nextCtx = nextCanvas.getContext('2d');
        }
    }

    function getSpeed() {
        return Math.max(
            config.gameplay.minSpeedMs,
            Math.round(config.gameplay.baseSpeedMs / Math.pow(config.gameplay.speedMultiplier, game.level - 1))
        );
    }

    function resetPiecePosition() {
        if (!game.currentPiece?.matrix) return;
        const matrix = game.currentPiece.matrix;
        game.currentX = Math.floor(config.board.width / 2) - Math.floor((matrix[0]?.length || 0) / 2);
        game.currentY = 0;
        for (let y = 0; y < matrix.length; y++) {
            if (matrix[y].some(cell => cell !== 0)) break;
            game.currentY--;
        }
    }

    function isCollision(matrix, x, y) {
        for (let row = 0; row < matrix.length; row++) {
            for (let col = 0; col < matrix[row].length; col++) {
                if (matrix[row][col]) {
                    const bx = x + col, by = y + row;
                    if (bx < 0 || bx >= config.board.width || by >= config.board.height) return true;
                    if (by >= 0 && game.board[by]?.[bx]) return true;
                }
            }
        }
        return false;
    }

    function movePiece(direction) {
        if (game.isPaused || game.isGameOver || !game.currentPiece) return false;
        const newX = game.currentX + direction;
        if (!isCollision(game.currentPiece.matrix, newX, game.currentY)) {
            game.currentX = newX;
            draw();
            return true;
        }
        return false;
    }

    function moveDown() {
        if (game.isPaused || game.isGameOver || !game.currentPiece) return;
        if (!isCollision(game.currentPiece.matrix, game.currentX, game.currentY + 1)) {
            game.currentY++;
            draw();
        } else {
            placePiece();
            checkLines();
            game.currentPiece = game.nextPiece;
            game.nextPiece = createPiece();
            if (!game.currentPiece || !game.nextPiece) { endGame(); return; }
            resetPiecePosition();
            if (isCollision(game.currentPiece.matrix, game.currentX, game.currentY)) {
                endGame();
            } else {
                draw();
            }
        }
    }

    function rotatePiece() {
        if (game.isPaused || game.isGameOver || !game.currentPiece?.matrix) return false;
        const orig = game.currentPiece.matrix;
        const N = orig.length;
        // Build rotated matrix with array spread (no JSON round-trip)
        const rotated = Array.from({ length: N }, (_, x) =>
            Array.from({ length: N }, (_, y) => orig[N - 1 - y]?.[x] ?? 0)
        );
        for (const [kx, ky] of KICK_OFFSETS) {
            if (!isCollision(rotated, game.currentX + kx, game.currentY + ky)) {
                game.currentPiece.matrix = rotated;
                game.currentX += kx;
                game.currentY += ky;
                draw();
                return true;
            }
        }
        return false;
    }

    function hardDrop() {
        if (game.isPaused || game.isGameOver || !game.currentPiece) return;
        let dropCount = 0;
        while (!isCollision(game.currentPiece.matrix, game.currentX, game.currentY + 1)) {
            game.currentY++;
            dropCount++;
        }
        if (dropCount > 0) {
            game.score += dropCount * 2;
            if (elements.score) elements.score.textContent = game.score;
        }
        moveDown();
    }

    function placePiece() {
        if (!game.currentPiece?.matrix) return;
        const matrix = game.currentPiece.matrix;
        for (let y = 0; y < matrix.length; y++) {
            for (let x = 0; x < matrix[y].length; x++) {
                if (matrix[y][x]) {
                    const by = game.currentY + y, bx = game.currentX + x;
                    if (by >= 0 && by < config.board.height && bx >= 0 && bx < config.board.width) {
                        game.board[by][bx] = game.currentPiece.shape + 1;
                    }
                }
            }
        }
        game.currentPiece = null;
    }

    function checkLines() {
        let linesCleared = 0;
        for (let y = config.board.height - 1; y >= 0; y--) {
            if (game.board[y].every(cell => cell > 0)) {
                linesCleared++;
                for (let row = y; row > 0; row--) {
                    game.board[row] = game.board[row - 1].slice();
                }
                game.board[0] = Array(config.board.width).fill(0);
                y++;
            }
        }
        if (linesCleared > 0) updateScore(linesCleared);
    }

    function updateScore(linesCleared) {
        const linePoints = [0, 40, 100, 300, 1200];
        game.score += (linePoints[linesCleared] ?? linePoints[4]) * game.level;
        game.lines += linesCleared;
        const newLevel = Math.floor(game.lines / config.gameplay.linesPerLevel) + 1;
        if (newLevel > game.level) {
            game.level = newLevel;
            if (game.interval) clearInterval(game.interval);
            if (!game.isPaused && !game.isGameOver) {
                game.interval = setInterval(moveDown, getSpeed());
            }
        }
        if (elements.score) elements.score.textContent = game.score;
        if (elements.lines) elements.lines.textContent = game.lines;
        if (elements.level) elements.level.textContent = game.level;
    }

    function togglePause() {
        if (game.isGameOver || !game.gameStarted) return;
        game.isPaused = !game.isPaused;
        if (game.isPaused) {
            clearInterval(game.interval);
            game.interval = null;
            if (elements.board) elements.board.style.opacity = '0.5';
        } else {
            if (elements.board) elements.board.style.opacity = '1';
            if (game.currentPiece && !game.isGameOver) {
                game.interval = setInterval(moveDown, getSpeed());
            }
            draw();
        }
    }

    async function endGame() {
        game.isGameOver = true;
        game.gameStarted = false;
        if (game.interval) { clearInterval(game.interval); game.interval = null; }

        const finalScore  = game.score;
        const playerName  = game.currentPlayerName || 'Anonymous';
        const durationMs  = game.startTime ? Date.now() - game.startTime : 0;
        const survivedMin = durationMs >= 30000;

        // Keep local backup
        addNewHighScore({ name: playerName, score: finalScore });

        if (elements.leaderboardTitle) elements.leaderboardTitle.textContent = 'Game Over!';
        if (elements.leaderboardMessage) {
            if (survivedMin) {
                elements.leaderboardMessage.textContent = `✓ Score posted! (${finalScore.toLocaleString()} pts)`;
                elements.leaderboardMessage.style.color = '#00f000';
            } else {
                const secsLeft = Math.ceil((30000 - durationMs) / 1000);
                elements.leaderboardMessage.textContent = `Survive ${secsLeft}s longer to hit the leaderboard!`;
                elements.leaderboardMessage.style.color = '#fca311';
            }
            elements.leaderboardMessage.classList.remove('hidden');
        }
        if (elements.leaderboardActionButtons) elements.leaderboardActionButtons.classList.remove('hidden');
        if (elements.leaderboardTryAgainButton) elements.leaderboardTryAgainButton.style.display = 'inline-block';
        if (elements.leaderboardResetScoresButton) elements.leaderboardResetScoresButton.style.display = 'none';
        if (elements.leaderboardMainMenuButton) elements.leaderboardMainMenuButton.style.display = 'inline-block';

        showScreen(elements.leaderboardScreen);

        // Only submit if they survived 30 seconds
        if (survivedMin) {
            await submitScoreToCloud(playerName, finalScore, durationMs);
        }
        displayHighScores(survivedMin ? finalScore : undefined);

        if (elements.board) {
            elements.board.removeEventListener('touchstart', handleTouchStart);
            elements.board.removeEventListener('touchmove', handleTouchMove);
            elements.board.removeEventListener('touchend', handleTouchEnd);
        }
        document.removeEventListener('keydown', handleKeyPress);
    }

    // --- Canvas Rendering ---

    // Draw a single block onto any canvas context using preloaded images
    function drawBlockOnCtx(ctx, px, py, size, shapeIdx, color) {
        ctx.fillStyle = color;
        ctx.fillRect(px, py, size, size);
        const img = loadedImages[shapeIdx];
        if (img && img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, px, py, size, size);
        }
        // Block border
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
    }

    function draw() {
        if (game.isPaused || !game.gameStarted || !boardCtx) return;

        const bs = game.blockSize;
        const W  = config.board.width;
        const H  = config.board.height;
        const cw = boardCanvas.width;
        const ch = boardCanvas.height;

        // Board background
        boardCtx.fillStyle = '#3a00ac';
        boardCtx.fillRect(0, 0, cw, ch);

        // Grid lines — single path, one stroke call (much cheaper than 200 individual rects)
        boardCtx.strokeStyle = 'rgba(23, 130, 212, 0.4)';
        boardCtx.lineWidth = 1;
        boardCtx.beginPath();
        for (let y = 0; y <= H; y++) {
            boardCtx.moveTo(0,  y * bs + 0.5);
            boardCtx.lineTo(cw, y * bs + 0.5);
        }
        for (let x = 0; x <= W; x++) {
            boardCtx.moveTo(x * bs + 0.5, 0);
            boardCtx.lineTo(x * bs + 0.5, ch);
        }
        boardCtx.stroke();

        // Placed pieces
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const val = game.board[y][x];
                if (val) drawBlockOnCtx(boardCtx, x * bs, y * bs, bs, val - 1, tetrominoes.colors[val - 1]);
            }
        }

        // Active (falling) piece
        if (game.currentPiece?.matrix) {
            const { matrix, shape, color } = game.currentPiece;
            for (let y = 0; y < matrix.length; y++) {
                for (let x = 0; x < matrix[y].length; x++) {
                    if (matrix[y][x]) {
                        drawBlockOnCtx(boardCtx, (game.currentX + x) * bs, (game.currentY + y) * bs, bs, shape, color);
                    }
                }
            }
        }

        // Next piece preview
        if (game.nextPiece?.matrix && nextCtx) {
            const { matrix, shape, color } = game.nextPiece;
            let matW = 0, matH = 0;
            for (let y = 0; y < matrix.length; y++) {
                for (let x = 0; x < matrix[y].length; x++) {
                    if (matrix[y][x]) { matW = Math.max(matW, x + 1); matH = y + 1; }
                }
            }
            if (matW && matH) {
                const nw = nextCanvas.width, nh = nextCanvas.height;
                const cs = Math.floor(Math.min(nw / matW, nh / matH));
                const ox = Math.floor((nw - matW * cs) / 2);
                const oy = Math.floor((nh - matH * cs) / 2);
                nextCtx.clearRect(0, 0, nw, nh);
                for (let y = 0; y < matrix.length; y++) {
                    for (let x = 0; x < matrix[y].length; x++) {
                        if (matrix[y][x]) {
                            drawBlockOnCtx(nextCtx, ox + x * cs, oy + y * cs, cs, shape, color);
                        }
                    }
                }
            }
        }
    }

    // --- Event Handlers ---

    function handleResize() {
        const vw = window.innerWidth, vh = window.innerHeight;
        let bsW = 0, bsH = 0;
        if (config.board.width > 0 && config.board.height > 0) {
            bsW = Math.floor(vw * 0.95 / config.board.width);
            bsH = Math.floor(vh * 0.90 / config.board.height);
        }
        game.blockSize = Math.max(4, Math.min(bsW, bsH, 30));

        const boardW = game.blockSize * config.board.width;
        const boardH = game.blockSize * config.board.height;

        if (elements.board && elements.gameAreaWrapper) {
            elements.board.style.width  = boardW + 'px';
            elements.board.style.height = boardH + 'px';
            elements.gameAreaWrapper.style.width  = boardW + 'px';
            elements.gameAreaWrapper.style.height = boardH + 'px';
        }

        // Keep canvas pixel dimensions in sync with layout dimensions
        if (boardCanvas) {
            boardCanvas.width  = boardW;
            boardCanvas.height = boardH;
        }
        if (nextCanvas && elements.nextPiece) {
            nextCanvas.width  = elements.nextPiece.clientWidth  || 70;
            nextCanvas.height = elements.nextPiece.clientHeight || 70;
        }

        if (game.gameStarted && !game.isPaused && !game.isGameOver) draw();
    }

    function handleKeyPress(event) {
        if (game.isGameOver || !game.gameStarted) return;
        if (game.isPaused && event.keyCode !== 80 && event.key?.toLowerCase() !== 'p') return;
        switch (event.keyCode) {
            case 37: movePiece(-1); event.preventDefault(); break;
            case 39: movePiece(1);  event.preventDefault(); break;
            case 38: rotatePiece(); event.preventDefault(); break;
            case 40: moveDown();    event.preventDefault(); break;
            case 32: hardDrop();    event.preventDefault(); break;
            case 80: togglePause(); event.preventDefault(); break;
        }
        if (event.key?.toLowerCase() === 'p' && event.keyCode !== 80) {
            togglePause(); event.preventDefault();
        }
    }

    function handleTouchStart(e) {
        if (game.isGameOver || game.isPaused || !game.gameStarted || e.touches.length !== 1) return;
        e.preventDefault();
        const t = e.touches[0];
        touch.startX = t.clientX; touch.startY = t.clientY; touch.currentX = t.clientX;
        touch.startTime = Date.now(); touch.isDragging = false; touch.isSwipedDown = false; touch.movedHorizontally = false;
    }

    function handleTouchMove(e) {
        if (game.isGameOver || game.isPaused || !game.gameStarted || !touch.startTime || e.touches.length !== 1) return;
        e.preventDefault();
        const t = e.touches[0];
        const deltaXTotal = t.clientX - touch.startX;
        const deltaYTotal = t.clientY - touch.startY;
        const deltaXInstant = t.clientX - touch.currentX;
        const moveThresholdPixels = game.blockSize * config.touch.moveThresholdRatio;
        if (Math.abs(deltaXInstant) > moveThresholdPixels) {
            if (movePiece(deltaXInstant > 0 ? 1 : -1)) {
                touch.currentX = t.clientX;
                touch.movedHorizontally = true;
                touch.isDragging = true;
                touch.startX = t.clientX;
                touch.startY = t.clientY;
            }
        }
        if (!touch.isSwipedDown && deltaYTotal > config.touch.swipeDownThreshold && Math.abs(deltaYTotal) > Math.abs(deltaXTotal) * 1.5) {
            touch.isSwipedDown = true;
            hardDrop();
            touch.startTime = 0;
        }
    }

    function handleTouchEnd(e) {
        if (game.isGameOver || game.isPaused || !game.gameStarted || !touch.startTime) return;
        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;
        const touchDuration = Date.now() - touch.startTime;
        const totalMove = Math.sqrt(Math.pow(endX - touch.startX, 2) + Math.pow(endY - touch.startY, 2));
        if (!touch.isSwipedDown && !touch.movedHorizontally && touchDuration < config.touch.tapTimeout && totalMove < config.touch.dragThreshold * 1.5) {
            rotatePiece();
        }
        touch.startTime = 0; touch.isDragging = false; touch.isSwipedDown = false; touch.movedHorizontally = false;
    }

    // --- Initialization & Event Listener Setup ---

    function setupGameplayEventListeners() {
        if (!elements.board) return;
        elements.board.removeEventListener('touchstart', handleTouchStart);
        elements.board.removeEventListener('touchmove', handleTouchMove);
        elements.board.removeEventListener('touchend', handleTouchEnd);
        document.removeEventListener('keydown', handleKeyPress);
        elements.board.addEventListener('touchstart', handleTouchStart, { passive: false });
        elements.board.addEventListener('touchmove',  handleTouchMove,  { passive: false });
        elements.board.addEventListener('touchend',   handleTouchEnd,   { passive: false });
        document.addEventListener('keydown', handleKeyPress);
    }

    function setupUIEventListeners() {
        if (elements.startGameButton) {
            elements.startGameButton.addEventListener('click', () => {
                const playerName = elements.playerNameInput.value.trim();
                if (playerName) {
                    game.currentPlayerName = playerName;
                    elements.nameError.textContent = '';
                    showScreen(elements.gameArea);
                    startGame();
                } else {
                    elements.nameError.textContent = 'Please enter your name!';
                }
            });
        }
        if (elements.viewLeaderboardButton) {
            elements.viewLeaderboardButton.addEventListener('click', () => {
                if (elements.leaderboardTitle) elements.leaderboardTitle.textContent = "Global Leaderboard";
                if (elements.leaderboardMessage) elements.leaderboardMessage.classList.add('hidden');
                if (elements.leaderboardActionButtons) elements.leaderboardActionButtons.classList.remove('hidden');
                if (elements.leaderboardTryAgainButton) elements.leaderboardTryAgainButton.style.display = 'none';
                if (elements.leaderboardResetScoresButton) elements.leaderboardResetScoresButton.style.display = 'none';
                if (elements.leaderboardMainMenuButton) elements.leaderboardMainMenuButton.style.display = 'inline-block';
                displayHighScores();
                showScreen(elements.leaderboardScreen);
            });
        }
        if (elements.leaderboardTryAgainButton) {
            elements.leaderboardTryAgainButton.addEventListener('click', () => {
                if (game.currentPlayerName) { showScreen(elements.gameArea); startGame(); }
                else { showScreen(elements.startScreen); }
            });
        }
        if (elements.leaderboardMainMenuButton) {
            elements.leaderboardMainMenuButton.addEventListener('click', () => showScreen(elements.startScreen));
        }
        if (elements.leaderboardResetScoresButton) {
            elements.leaderboardResetScoresButton.addEventListener('click', () => {
                if (confirm("Are you sure you want to reset all high scores? This cannot be undone.")) {
                    saveHighScores([]);
                    displayHighScores();
                }
            });
        }
        window.addEventListener('resize', handleResize);
    }

    function startGame() {
        game.score = 0; game.lines = 0; game.level = 1;
        game.isGameOver = false; game.isPaused = false;
        game.currentPiece = null; game.nextPiece = null;
        game.gameStarted = true; game.pieceBag = [];

        if (game.interval) { clearInterval(game.interval); game.interval = null; }

        initBoard();

        if (elements.score) elements.score.textContent = game.score;
        if (elements.lines) elements.lines.textContent = game.lines;
        if (elements.level) elements.level.textContent = game.level;
        if (elements.leaderboardMessage) elements.leaderboardMessage.classList.add('hidden');
        if (elements.leaderboardTryAgainButton) elements.leaderboardTryAgainButton.style.display = 'none';
        if (elements.leaderboardResetScoresButton) elements.leaderboardResetScoresButton.style.display = 'none';
        if (elements.leaderboardTitle) elements.leaderboardTitle.textContent = "High Scores";

        game.startTime = Date.now();
        fillAndShuffleBag();
        game.currentPiece = createPiece();
        game.nextPiece    = createPiece();

        if (!game.currentPiece || !game.nextPiece) { endGame(); return; }

        handleResize();
        resetPiecePosition();

        if (isCollision(game.currentPiece.matrix, game.currentX, game.currentY)) { endGame(); return; }

        game.interval = setInterval(moveDown, getSpeed());
        setupGameplayEventListeners();
        draw();
    }

    function init() {
        setupUIEventListeners();
        handleResize();
        showScreen(elements.startScreen);
    }
    init();
});
