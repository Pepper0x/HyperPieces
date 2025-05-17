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
        gameplay: { // Added for new speed logic
            baseSpeedMs: 1000, // Speed for Level 1 in milliseconds
            speedMultiplier: 1.2, // Each level, speed becomes 1.2x faster (interval / 1.2)
            minSpeedMs: 50,       // Minimum interval in milliseconds (fastest speed)
            linesPerLevel: 4      // Lines to clear to advance to the next level
        }
    };

    // --- Tetromino Data ---
    const tetrominoes = {
        shapes: [ /* I */ [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], /* J */ [[1,0,0],[1,1,1],[0,0,0]], /* L */ [[0,0,1],[1,1,1],[0,0,0]], /* O */ [[1,1],[1,1]], /* S */ [[0,1,1],[1,1,0],[0,0,0]], /* T */ [[0,1,0],[1,1,1],[0,0,0]], /* Z */ [[1,1,0],[0,1,1],[0,0,0]] ],
        colors: ["#00f0f0", "#0000f0", "#f0a000", "#f0f000", "#00f000", "#a000f0", "#f00000"],
        images: ['image1.png','image2.png','image3.png','image4.png','image5.png','image6.png','image7.png']
    };

    // --- Game State ---
    const game = {
        board: [], score: 0, lines: 0, level: 1,
        currentPiece: null, nextPiece: null,
        currentX: 0, currentY: 0, blockSize: 20,
        interval: null, isPaused: false, isGameOver: false, gameStarted: false,
        currentPlayerName: '',
        pieceBag: []
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

    // --- High Score Logic ---
    const HIGH_SCORE_KEY = 'tetrisHighScores';
    const MAX_HIGH_SCORES = 10;

    function getHighScores() {
        const scoresJSON = localStorage.getItem(HIGH_SCORE_KEY);
        try {
            const scores = scoresJSON ? JSON.parse(scoresJSON) : [];
            return Array.isArray(scores) ? scores : [];
        } catch (e) {
            console.error("Error parsing high scores from localStorage", e);
            return [];
        }
    }

    function saveHighScores(scores) {
        if (!Array.isArray(scores)) {
            console.error("Attempted to save non-array as high scores:", scores);
            return;
        }
        const sortedScores = scores
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_HIGH_SCORES);
        localStorage.setItem(HIGH_SCORE_KEY, JSON.stringify(sortedScores));
    }

    function addNewHighScore(newEntry) {
        if (!newEntry || typeof newEntry.name !== 'string' || typeof newEntry.score !== 'number' || !Number.isFinite(newEntry.score)) {
            return;
        }
        const scores = getHighScores();
        scores.push(newEntry);
        saveHighScores(scores);
    }

    function displayHighScores() {
        if (!elements.highScoreList) return;
        const scores = getHighScores();
        elements.highScoreList.innerHTML = '';

        if (scores.length === 0) {
            elements.highScoreList.innerHTML = '<li>No high scores yet!</li>';
        } else {
            scores.forEach((entry, index) => {
                const listItem = document.createElement('li');
                const name = entry.name || 'Anonymous';
                const scoreVal = (typeof entry.score === 'number') ? entry.score : '?';
                listItem.textContent = `#${index + 1}: ${name} - ${scoreVal}`;
                elements.highScoreList.appendChild(listItem);
            });
        }
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
        } else {
            console.error("Attempted to show an invalid screen");
        }
    }

    // --- Core Game Logic Functions ---

    function fillAndShuffleBag() {
        game.pieceBag = [];
        for (let i = 0; i < tetrominoes.shapes.length; i++) {
            game.pieceBag.push(i);
        }
        for (let i = game.pieceBag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [game.pieceBag[i], game.pieceBag[j]] = [game.pieceBag[j], game.pieceBag[i]];
        }
    }

    function createPiece() {
        if (game.pieceBag.length === 0) {
            fillAndShuffleBag();
        }
        const index = game.pieceBag.pop(); 

        if (!tetrominoes || !tetrominoes.shapes || !Array.isArray(tetrominoes.shapes) || tetrominoes.shapes.length === 0) { console.error("CreatePiece Fail: Shapes"); return null; }
        if (!tetrominoes.images || !Array.isArray(tetrominoes.images) || !tetrominoes.colors || !Array.isArray(tetrominoes.colors)) { console.error("CreatePiece Fail: Images/Colors"); return null; }
        if (tetrominoes.shapes.length === 0 || tetrominoes.images.length !== tetrominoes.shapes.length || tetrominoes.colors.length !== tetrominoes.shapes.length) { console.error("CreatePiece Fail: Length Mismatch"); return null; }
        if(index === undefined || index < 0 || index >= tetrominoes.shapes.length) { console.error(`CreatePiece Fail: Invalid index ${index} from bag`); return null; } 
        if (!tetrominoes.shapes[index] || !Array.isArray(tetrominoes.shapes[index])) { console.error(`CreatePiece Fail: No matrix at index ${index}`); return null; }
        if (typeof tetrominoes.images[index] === 'undefined' || typeof tetrominoes.colors[index] === 'undefined') { console.error(`CreatePiece Fail: No image/color at index ${index}`); return null; }
        
        const matrixCopy = JSON.parse(JSON.stringify(tetrominoes.shapes[index]));
        return { shape: index, matrix: matrixCopy, image: tetrominoes.images[index], color: tetrominoes.colors[index] };
    }

    function initBoard() {
        if (!config || !config.board || !Number.isInteger(config.board.height) || !Number.isInteger(config.board.width)) { console.error("initBoard failed: config.board dimensions invalid."); game.board = []; return; }
        game.board = Array(config.board.height).fill().map(() => Array(config.board.width).fill(0));
        if (elements.board) elements.board.innerHTML = '';
    }

    // --- MODIFIED getSpeed FUNCTION ---
    function getSpeed() {
        // Speed for Level 1 is baseSpeedMs.
        // For each subsequent level, the interval is divided by speedMultiplier.
        // Example: Level 1 = 1000ms
        // Level 2 = 1000ms / 1.2 = 833.33ms
        // Level 3 = (1000ms / 1.2) / 1.2 = 1000ms / (1.2^2) = 694.44ms
        const speed = config.gameplay.baseSpeedMs / Math.pow(config.gameplay.speedMultiplier, game.level - 1);
        return Math.max(config.gameplay.minSpeedMs, Math.round(speed)); // Round to nearest ms and ensure minimum speed
    }

    function resetPiecePosition() {
        if (!game.currentPiece || !game.currentPiece.matrix || !config || !config.board) { console.error("ResetPos Fail: Missing data"); return; }
        const pieceWidth = game.currentPiece.matrix[0]?.length || 0;
        game.currentX = Math.floor(config.board.width / 2) - Math.floor(pieceWidth / 2);
        game.currentY = 0;
        let topRowOffset = 0;
        for (let y = 0; y < game.currentPiece.matrix.length; y++) {
            if (game.currentPiece.matrix[y].some(cell => cell !== 0)) {
                break;
            }
            topRowOffset++;
        }
        game.currentY -= topRowOffset;
    }

    function isCollision(matrix, x, y) {
        if (!matrix || !config || !config.board || !game.board) { return true; }
        for (let row = 0; row < matrix.length; row++) {
            if (!matrix[row]) continue;
            for (let col = 0; col < matrix[row].length; col++) {
                if (matrix[row][col]) {
                    const boardX = x + col; const boardY = y + row;
                    if (boardX < 0 || boardX >= config.board.width || boardY >= config.board.height) return true;
                    if (boardY >= 0 && game.board[boardY] && game.board[boardY][boardX]) return true;
                }
            }
        }
        return false;
    }

    function movePiece(direction) {
        if (game.isPaused || game.isGameOver || !game.currentPiece) return false;
        const newX = game.currentX + direction;
        if (!isCollision(game.currentPiece.matrix, newX, game.currentY)) { game.currentX = newX; draw(); return true; }
        return false;
    }

    function moveDown() {
        if (game.isPaused || game.isGameOver || !game.currentPiece) return;
        if (!isCollision(game.currentPiece.matrix, game.currentX, game.currentY + 1)) {
            game.currentY++; draw();
        } else {
            placePiece(); checkLines();
            game.currentPiece = game.nextPiece; game.nextPiece = createPiece();
            if (!game.currentPiece || !game.nextPiece) { console.error("moveDown ERROR: Failed create new/next piece. Ending."); endGame(); return; }
            if (!game.currentPiece.matrix) { console.error("moveDown ERROR: New piece has no matrix. Ending."); endGame(); return; }
            resetPiecePosition();
            if (isCollision(game.currentPiece.matrix, game.currentX, game.currentY)) { endGame(); }
            else { draw(); }
        }
    }

    function rotatePiece() {
        if (game.isPaused || game.isGameOver || !game.currentPiece || !game.currentPiece.matrix) return false;
        const originalMatrix = JSON.parse(JSON.stringify(game.currentPiece.matrix));
        const N = originalMatrix.length;
        const rotated = Array(N).fill(null).map(() => Array(N).fill(0));
        for (let y = 0; y < N; y++) {
            if (!originalMatrix[y]) continue;
            for (let x = 0; x < N; x++) {
                if (typeof originalMatrix[y][x] !== 'undefined') {
                    rotated[x][N - 1 - y] = originalMatrix[y][x];
                }
            }
        }
        const originalX = game.currentX;
        const originalY = game.currentY;
        const kickOffsets = [ [0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0], [0, -2], [-1,-1], [1,-1], [-1,1], [1,1] ];
        for (const [kickX, kickY] of kickOffsets) {
            const newX = originalX + kickX;
            const newY = originalY + kickY;
            if (!isCollision(rotated, newX, newY)) {
                game.currentPiece.matrix = rotated; 
                game.currentX = newX;
                game.currentY = newY;
                draw();
                return true;
            }
        }
        return false; 
    }

    function hardDrop() {
        if (game.isPaused || game.isGameOver || !game.currentPiece) return;
        let dropCount = 0;
        while (!isCollision(game.currentPiece.matrix, game.currentX, game.currentY + 1)) { game.currentY++; dropCount++; }
        if (dropCount > 0) { game.score += dropCount * 2; if (elements.score) elements.score.textContent = game.score; }
        moveDown();
    }

    function placePiece() {
        if (!game.currentPiece || !game.currentPiece.matrix || !game.board || !config || !config.board) return;
        const matrix = game.currentPiece.matrix;
        for (let y = 0; y < matrix.length; y++) {
            if (!matrix[y]) continue;
            for (let x = 0; x < matrix[y].length; x++) {
                if (matrix[y][x]) {
                    const boardY = game.currentY + y; const boardX = game.currentX + x;
                    if (boardY >= 0 && boardY < config.board.height && boardX >= 0 && boardX < config.board.width && game.board[boardY]) {
                        game.board[boardY][boardX] = game.currentPiece.shape + 1;
                    }
                }
            }
        }
        game.currentPiece = null;
    }

    function checkLines() {
        if (!game.board || !config || !config.board) return;
        let linesCleared = 0;
        for (let y = config.board.height - 1; y >= 0; y--) {
            if (!game.board[y]) continue;
            if (game.board[y].every(cell => cell > 0)) {
                linesCleared++;
                for (let row = y; row > 0; row--) {
                    if (game.board[row - 1]) { game.board[row] = game.board[row - 1].slice(); }
                    else { game.board[row] = Array(config.board.width).fill(0); }
                }
                game.board[0] = Array(config.board.width).fill(0); y++;
            }
        }
        if (linesCleared > 0) { updateScore(linesCleared); }
    }

    // --- MODIFIED updateScore FUNCTION ---
    function updateScore(linesCleared) {
        const linePoints = [0, 40, 100, 300, 1200]; // Points per lines cleared (1, 2, 3, 4)
        // Give more points if more lines cleared at once and for higher levels
        game.score += (linePoints[linesCleared] || (linesCleared > 4 ? linePoints[4] : 0)) * game.level;
        game.lines += linesCleared;

        // Level increases every `config.gameplay.linesPerLevel` lines cleared
        const newLevel = Math.floor(game.lines / config.gameplay.linesPerLevel) + 1;

        if (newLevel > game.level) {
            game.level = newLevel;
            if (game.interval) clearInterval(game.interval);
            if (!game.isPaused && !game.isGameOver) { // ensure game is active
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
            clearInterval(game.interval); game.interval = null;
            if (elements.board) elements.board.style.opacity = '0.5';
        } else {
            if (elements.board) elements.board.style.opacity = '1';
            if(game.currentPiece && !game.isGameOver) {
                game.interval = setInterval(moveDown, getSpeed());
            }
            draw();
        }
    }

    function endGame() {
        game.isGameOver = true;
        game.gameStarted = false;

        if (game.interval) clearInterval(game.interval);
        game.interval = null;

        addNewHighScore({ name: game.currentPlayerName || "Anonymous", score: game.score });
        displayHighScores(); 

        if (elements.leaderboardTitle) elements.leaderboardTitle.textContent = "Game Over!";
        if (elements.leaderboardMessage) elements.leaderboardMessage.classList.remove('hidden');
        if (elements.leaderboardActionButtons) elements.leaderboardActionButtons.classList.remove('hidden');
        if (elements.leaderboardTryAgainButton) elements.leaderboardTryAgainButton.style.display = 'inline-block';
        if (elements.leaderboardResetScoresButton) elements.leaderboardResetScoresButton.style.display = 'none';
        if (elements.leaderboardMainMenuButton) elements.leaderboardMainMenuButton.style.display = 'inline-block';
        
        showScreen(elements.leaderboardScreen);

        if (elements.board) {
            elements.board.removeEventListener('touchstart', handleTouchStart);
            elements.board.removeEventListener('touchmove', handleTouchMove);
            elements.board.removeEventListener('touchend', handleTouchEnd);
        }
        document.removeEventListener('keydown', handleKeyPress);
    }

    // --- Rendering Functions ---
    function draw() {
        if (game.isPaused || !game.gameStarted) return;
        if (!config || !config.board) { console.error("Draw Fail: Config"); return; }
        if (!tetrominoes || !tetrominoes.images || !tetrominoes.colors) { console.error("Draw Fail: Tetrominoes"); return; }
        if (!elements || !elements.board || !elements.nextPiece) { console.error("Draw Fail: Elements"); return; }
        elements.board.innerHTML = ''; createGrid();
        for (let y = 0; y < config.board.height; y++) {
            if (!game.board || !game.board[y]) continue;
            for (let x = 0; x < config.board.width; x++) {
                if (game.board[y][x]) {
                    const blockValue = game.board[y][x] - 1;
                    if (blockValue >= 0 && blockValue < tetrominoes.images.length && blockValue < tetrominoes.colors.length) {
                        createBlock(elements.board, x * game.blockSize, y * game.blockSize, tetrominoes.images[blockValue], tetrominoes.colors[blockValue]);
                    }
                }
            }
        }
        if (game.currentPiece && game.currentPiece.matrix) {
            const matrix = game.currentPiece.matrix; const image = game.currentPiece.image; const color = game.currentPiece.color;
            if (typeof image === 'undefined' || typeof color === 'undefined') { /* console.warn for missing image/color */ }
            for (let y = 0; y < matrix.length; y++) {
                if (!matrix[y]) continue;
                for (let x = 0; x < matrix[y].length; x++) {
                    if (matrix[y][x]) {
                        if (typeof image !== 'undefined' && typeof color !== 'undefined') {
                            createBlock(elements.board, (game.currentX + x) * game.blockSize, (game.currentY + y) * game.blockSize, image, color);
                        }
                    }
                }
            }
        }
        if (game.nextPiece) { elements.nextPiece.innerHTML = ''; drawNextPiece(); }
        else { if(elements.nextPiece) elements.nextPiece.innerHTML = ''; }
    }

    function createBlock(parent, left, top, imagePath, fallbackColor) {
        if (!parent) return null;
        const block = document.createElement('div'); block.className = 'block';
        if (imagePath) block.style.backgroundImage = `url(${imagePath})`;
        block.style.backgroundColor = fallbackColor || '#333';
        block.style.backgroundSize = 'cover'; block.style.backgroundPosition = 'center';
        block.style.left = left + 'px'; block.style.top = top + 'px';
        block.style.width = game.blockSize + 'px'; block.style.height = game.blockSize + 'px';
        parent.appendChild(block); return block;
    }

    function createGrid() {
        if (!elements.board || !config || !config.board || game.blockSize <= 0) return;
        const existingGridCells = elements.board.querySelectorAll('.grid-cell');
        existingGridCells.forEach(cell => cell.remove());
        for (let y = 0; y < config.board.height; y++) {
            for (let x = 0; x < config.board.width; x++) {
                const cell = document.createElement('div'); cell.className = 'grid-cell';
                cell.style.left = x * game.blockSize + 'px'; cell.style.top = y * game.blockSize + 'px';
                cell.style.width = game.blockSize + 'px'; cell.style.height = game.blockSize + 'px';
                elements.board.appendChild(cell);
            }
        }
    }

    function drawNextPiece() {
        if (!game.nextPiece || !game.nextPiece.matrix || !elements.nextPiece) { if(elements.nextPiece) elements.nextPiece.innerHTML = ''; return; }
        const matrix = game.nextPiece.matrix; const image = game.nextPiece.image; const color = game.nextPiece.color;
        if (typeof image === 'undefined' || typeof color === 'undefined') { /* console.warn for missing image/color */ }
        const containerWidth = elements.nextPiece.clientWidth; const containerHeight = elements.nextPiece.clientHeight;
        let matrixWidth = 0; let matrixHeight = 0;
        for (let y = 0; y < matrix.length; y++) { let rhb = false; let cw = 0; if (!matrix[y]) continue; for(let xVal=0; xVal<matrix[y].length; xVal++) { if (matrix[y][xVal]) { rhb = true; cw = xVal + 1; } } if(rhb) matrixHeight = y + 1; if (cw > matrixWidth) matrixWidth = cw; }
        if (matrixWidth === 0 && matrix.length > 0 && matrix[0]) matrixWidth = matrix[0].length; if (matrixHeight === 0 && matrix.length > 0) matrixHeight = matrix.length; if (matrixWidth === 0 || matrixHeight === 0) { return; }
        const padding = 0; const cellSize = Math.max(1, Math.floor(Math.min( containerWidth / (matrixWidth + padding), containerHeight / (matrixHeight + padding) )));
        const totalWidth = matrixWidth * cellSize; const totalHeight = matrixHeight * cellSize;
        const offsetX = (containerWidth - totalWidth) / 2; const offsetY = (containerHeight - totalHeight) / 2;
        for (let y = 0; y < matrix.length; y++) { if (!matrix[y]) continue; for (let xVal = 0; xVal < matrix[y].length; xVal++) { if (matrix[y][xVal]) { if (typeof image !== 'undefined' && typeof color !== 'undefined') { const block = createBlock(elements.nextPiece, offsetX + (xVal * cellSize), offsetY + (y * cellSize), image, color ); if (block) { block.style.width = cellSize + 'px'; block.style.height = cellSize + 'px'; } } } } }
    }

    // --- Event Handlers ---
    function handleResize() {
        const viewportWidth = window.innerWidth; const viewportHeight = window.innerHeight;
        let availableWidth = viewportWidth * 0.95; let availableHeight = viewportHeight * 0.90;
        let blockSizeW = 0; let blockSizeH = 0;
        if (config && config.board && config.board.width > 0 && config.board.height > 0) { blockSizeW = Math.floor(availableWidth / config.board.width); blockSizeH = Math.floor(availableHeight / config.board.height); }
        else { console.error("Resize Fail: Config invalid!"); game.blockSize = 4; }
        const validBlockSizeW = Number.isFinite(blockSizeW) ? blockSizeW : 0; const validBlockSizeH = Number.isFinite(blockSizeH) ? blockSizeH : 0;
        game.blockSize = Math.max(4, Math.min(validBlockSizeW, validBlockSizeH, 30)); 
        let boardWidth = 0; let boardHeight = 0;
        if (config && config.board) { boardWidth = game.blockSize * config.board.width; boardHeight = game.blockSize * config.board.height; }
        if (boardWidth > 0 && boardHeight > 0 && elements.board && elements.gameAreaWrapper) {
            elements.board.style.width = boardWidth + 'px'; elements.board.style.height = boardHeight + 'px';
            elements.gameAreaWrapper.style.width = boardWidth + 'px'; elements.gameAreaWrapper.style.height = boardHeight + 'px';
        } else { console.error("Resize Fail: Invalid dimensions or elements missing!", boardWidth, boardHeight); }
        if (game.gameStarted && !game.isPaused && !game.isGameOver) { draw(); }
        else if (!game.gameStarted && elements.gameArea?.classList.contains('hidden')) {
            if (elements.board && elements.board.style.display !== 'none') { elements.board.innerHTML = ''; if (boardWidth > 0 && boardHeight > 0){ createGrid(); } }
        }
        if (game && elements.nextPiece) { if (game.nextPiece) { elements.nextPiece.innerHTML = ''; drawNextPiece(); } else { elements.nextPiece.innerHTML = ''; } }
    }

    function handleKeyPress(event) {
        if (game.isGameOver || !game.gameStarted) return;
        if (game.isPaused && event.keyCode !== 80 && event.key?.toLowerCase() !== 'p') return; // Allow 'P' or 'p' for pause
        switch (event.keyCode) {
            case 37: movePiece(-1); event.preventDefault(); break; // Left Arrow
            case 39: movePiece(1); event.preventDefault(); break;  // Right Arrow
            case 38: rotatePiece(); event.preventDefault(); break; // Up Arrow
            case 40: moveDown(); event.preventDefault(); break;    // Down Arrow
            case 32: hardDrop(); event.preventDefault(); break;   // Space
            case 80: togglePause(); event.preventDefault(); break; // 'P'
        }
         // For 'p' key if keyCode is not always reliable for letters
        if (event.key?.toLowerCase() === 'p' && event.keyCode !== 80) {
             togglePause(); event.preventDefault();
        }
    }

    function handleTouchStart(e) {
        if (game.isGameOver || game.isPaused || !game.gameStarted || e.touches.length !== 1) return; e.preventDefault();
        const t = e.touches[0]; touch.startX = t.clientX; touch.startY = t.clientY; touch.currentX = t.clientX;
        touch.startTime = Date.now(); touch.isDragging = false; touch.isSwipedDown = false; touch.movedHorizontally = false;
    }

    function handleTouchMove(e) {
        if (game.isGameOver || game.isPaused || !game.gameStarted || !touch.startTime || e.touches.length !== 1) return; e.preventDefault();
        const t = e.touches[0]; const deltaXTotal = t.clientX - touch.startX; const deltaYTotal = t.clientY - touch.startY; const deltaXInstant = t.clientX - touch.currentX;
        if (!config || !config.touch) return; const moveThresholdPixels = game.blockSize * config.touch.moveThresholdRatio;
        if (Math.abs(deltaXInstant) > moveThresholdPixels) { 
            const direction = deltaXInstant > 0 ? 1 : -1; 
            if (movePiece(direction)) { 
                touch.currentX = t.clientX;
                touch.movedHorizontally = true; 
                touch.isDragging = true; 
                touch.startX = t.clientX; 
                touch.startY = t.clientY; 
            } 
        }
        if (!touch.isSwipedDown && deltaYTotal > config.touch.swipeDownThreshold && Math.abs(deltaYTotal) > Math.abs(deltaXTotal) * 1.5) { 
            touch.isSwipedDown = true; hardDrop(); touch.startTime = 0; 
        }
    }

    function handleTouchEnd(e) {
        if (game.isGameOver || game.isPaused || !game.gameStarted || !touch.startTime) return;
        const touchDuration = Date.now() - touch.startTime; const endX = e.changedTouches[0].clientX; const endY = e.changedTouches[0].clientY;
        const totalMoveDistance = Math.sqrt(Math.pow(endX - touch.startX, 2) + Math.pow(endY - touch.startY, 2));
        
        if (!config || !config.touch) return;
        if (!touch.isSwipedDown && !touch.movedHorizontally && touchDuration < config.touch.tapTimeout && totalMoveDistance < config.touch.dragThreshold * 1.5) { 
            rotatePiece(); 
        }
        touch.startTime = 0; touch.isDragging = false; touch.isSwipedDown = false; touch.movedHorizontally = false;
    }

    // --- Initialization and Event Listener Setup ---
    function setupGameplayEventListeners() {
        if (!elements.board) return;
        elements.board.removeEventListener('touchstart', handleTouchStart); elements.board.removeEventListener('touchmove', handleTouchMove); elements.board.removeEventListener('touchend', handleTouchEnd); document.removeEventListener('keydown', handleKeyPress);
        elements.board.addEventListener('touchstart', handleTouchStart, { passive: false }); elements.board.addEventListener('touchmove', handleTouchMove, { passive: false }); elements.board.addEventListener('touchend', handleTouchEnd, { passive: false }); document.addEventListener('keydown', handleKeyPress);
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
                if(elements.leaderboardTitle) elements.leaderboardTitle.textContent = "High Scores";
                if(elements.leaderboardMessage) elements.leaderboardMessage.classList.add('hidden');
                if(elements.leaderboardActionButtons) elements.leaderboardActionButtons.classList.remove('hidden');
                if(elements.leaderboardTryAgainButton) elements.leaderboardTryAgainButton.style.display = 'none';
                if(elements.leaderboardResetScoresButton) elements.leaderboardResetScoresButton.style.display = 'inline-block';
                if(elements.leaderboardMainMenuButton) elements.leaderboardMainMenuButton.style.display = 'inline-block';
                
                displayHighScores();
                showScreen(elements.leaderboardScreen);
            });
        }
        
        if (elements.leaderboardTryAgainButton) {
            elements.leaderboardTryAgainButton.addEventListener('click', () => {
                if (game.currentPlayerName) { 
                    showScreen(elements.gameArea);
                    startGame();
                } else { 
                    showScreen(elements.startScreen);
                }
            });
        }
        if (elements.leaderboardMainMenuButton) {
            elements.leaderboardMainMenuButton.addEventListener('click', () => {
                showScreen(elements.startScreen);
            });
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
        game.score = 0;
        game.lines = 0;
        game.level = 1; // Start at level 1
        game.isGameOver = false;
        game.isPaused = false;
        game.currentPiece = null; 
        game.nextPiece = null;
        game.gameStarted = true; 
        game.pieceBag = []; 

        if (game.interval) {
            clearInterval(game.interval);
            game.interval = null;
        }
        initBoard();
        if (elements.score) elements.score.textContent = game.score;
        if (elements.lines) elements.lines.textContent = game.lines;
        if (elements.level) elements.level.textContent = game.level;
        
        if(elements.leaderboardMessage) elements.leaderboardMessage.classList.add('hidden');
        if(elements.leaderboardTryAgainButton) elements.leaderboardTryAgainButton.style.display = 'none';
        if(elements.leaderboardResetScoresButton) elements.leaderboardResetScoresButton.style.display = 'none';
        if(elements.leaderboardTitle) elements.leaderboardTitle.textContent = "High Scores";

        fillAndShuffleBag(); 
        game.currentPiece = createPiece();
        game.nextPiece = createPiece();

        if (!game.currentPiece || !game.nextPiece) {
            console.error("startGame ERROR: Failed to create initial pieces. Check createPiece logs. Aborting start.");
            endGame(); return;
        }
        if (!game.currentPiece.matrix || !Array.isArray(game.currentPiece.matrix)) {
            console.error("startGame ERROR: game.currentPiece is missing a valid 'matrix' property! Aborting start.");
            endGame(); return;
        }
        handleResize(); 
        resetPiecePosition(); 
        if (isCollision(game.currentPiece.matrix, game.currentX, game.currentY)) {
            endGame(); return;
        }
        // Set initial interval using the new getSpeed logic
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