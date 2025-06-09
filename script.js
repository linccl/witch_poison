// --- Global State ---
let GAME_MODE = null, player = { name: '' }, socket = null, currentRoom = null;
let waitingForServer = false; // Prevents multiple actions while waiting for server response

// --- DOM Elements ---
const screens = {
    modeSelection: document.getElementById('mode-selection-screen'),
    username: document.getElementById('username-screen'),
    onlineLobby: document.getElementById('online-lobby-screen'),
    singlePlayerRoom: document.getElementById('single-player-room-screen'),
    game: document.getElementById('game-screen'),
    gameOver: document.getElementById('game-over-screen'),
};

const singlePlayerBtn = document.getElementById('single-player-btn');
const multiplayerBtn = document.getElementById('multiplayer-btn');
const usernameInput = document.getElementById('username');
const confirmUsernameBtn = document.getElementById('confirm-username-btn');
const onlinePlayerNameSpan = document.getElementById('online-player-name');
const onlineCreateRoomBtn = document.getElementById('online-create-room-btn');
const roomIdInput = document.getElementById('room-id-input');
const onlineJoinRoomBtn = document.getElementById('online-join-room-btn');
const roomInfoDiv = document.getElementById('room-info');
const roomIdDisplay = document.getElementById('room-id-display');
const playerList = document.getElementById('player-list');
const onlineGameSettings = document.getElementById('online-game-settings');
const onlineGridSizeInput = document.getElementById('online-grid-size');
const startGameBtn = document.getElementById('start-game-btn');
const playerCountInput = document.getElementById('player-count');
const gridSizeInput = document.getElementById('grid-size');
const createSinglePlayerGameBtn = document.getElementById('create-single-player-game-btn');
const gameStatus = document.getElementById('game-status');
const gameBoard = document.getElementById('game-board');
const rollDiceBtn = document.getElementById('roll-dice-btn');
const diceResult = document.getElementById('dice-result');
const winnerMessage = document.getElementById('winner-message');
const playAgainBtn = document.getElementById('play-again-btn');
const backToHomeBtns = document.querySelectorAll('.back-to-home-btn');
const exitRoomBtn = document.getElementById('exit-room-btn');

// --- Utility Functions ---
function switchScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenName].classList.add('active');
}

function updateGameStatus(message) {
    gameStatus.textContent = message;
}

function setupGameBoard(size) {
    gameBoard.innerHTML = '';
    gameBoard.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
    gameBoard.style.gridTemplateRows = `repeat(${size}, 1fr)`;
    for (let i = 0; i < size * size; i++) {
        const cake = document.createElement('div');
        cake.classList.add('cake');
        cake.dataset.id = i;
        gameBoard.appendChild(cake);
    }
}

function lockUI() { waitingForServer = true; document.body.style.cursor = 'wait'; }
function unlockUI() { waitingForServer = false; document.body.style.cursor = 'default'; }

// ---------------------------------------------
// --- SINGLE PLAYER MODE LOGIC ---
// ---------------------------------------------
const singlePlayer = {
    players: [],
    gameState: 'INIT',
    currentPlayerIndex: 0,

    startGame(creatorName, playerCount, gridSize) {
        // Reset UI
        screens.gameOver.style.display = 'none';
        gameStatus.style.display = 'block';
        diceResult.style.display = 'block';
        rollDiceBtn.style.display = 'none';
        diceResult.textContent = '';
        
        // Initialize players
        this.players = [];
        this.players.push({ name: creatorName, poison: null, diceRoll: 0, isActive: true });
        for (let i = 1; i < playerCount; i++) {
            this.players.push({ name: `玩家 ${i + 1}`, poison: null, diceRoll: 0, isActive: true });
        }
        
        this.currentPlayerIndex = 0;
        this.gameState = 'SETUP_POISON';
        
        setupGameBoard(gridSize);
        updateGameStatus(`${this.players[this.currentPlayerIndex].name}，请秘密选择你的毒药。`);
    },

    handleCakeClick(cakeElement) {
        if (!cakeElement.classList.contains('cake') || cakeElement.classList.contains('eaten')) return;

        if (this.gameState === 'SETUP_POISON') {
            this.handlePoisonSetup(cakeElement);
        } else if (this.gameState === 'TURN_BASED') {
            this.handleTurn(cakeElement);
        }
    },

    handlePoisonSetup(cakeElement) {
        const cakeId = parseInt(cakeElement.dataset.id);
        this.players[this.currentPlayerIndex].poison = cakeId;
        
        cakeElement.style.backgroundColor = '#8a63d2';
        setTimeout(() => { cakeElement.style.backgroundColor = ''; }, 500);
        
        alert(`好的，${this.players[this.currentPlayerIndex].name}，你的毒药已选定。`);
        this.currentPlayerIndex++;

        if (this.currentPlayerIndex < this.players.length) {
            updateGameStatus(`${this.players[this.currentPlayerIndex].name}，请选择你的毒药。`);
        } else {
            this.gameState = 'ROLL_DICE';
            this.currentPlayerIndex = 0;
            updateGameStatus(`所有玩家已选择毒药！请 ${this.players[this.currentPlayerIndex].name} 投骰子。`);
            rollDiceBtn.style.display = 'block';
        }
    },

    handleTurn(cakeElement) {
        const cakeId = parseInt(cakeElement.dataset.id);
        cakeElement.classList.add('eaten');
        const eater = this.players[this.currentPlayerIndex];
        const poisonOwners = this.players.filter(p => p.poison === cakeId);

        if (poisonOwners.length > 0) {
            const ateOwnPoison = poisonOwners.some(p => p.name === eater.name);
            if (ateOwnPoison) {
                eater.isActive = false;
                const actualWinners = poisonOwners.filter(p => p.name !== eater.name);
                if (actualWinners.length > 0) {
                    const winnerNames = actualWinners.map(p => p.name).join(' 和 ');
                    this.endGame(cakeElement, `${eater.name} 吃掉自己的毒药出局，但 ${winnerNames} 也把毒药放在这！恭喜 ${winnerNames} 获胜！`);
                } else {
                    const remaining = this.players.filter(p => p.isActive);
                    if (remaining.length === 1) {
                        this.endGame(cakeElement, `${eater.name} 吃掉自己的毒药出局！最后的赢家是 ${remaining[0].name}！`);
                    } else if (remaining.length > 1) {
                        alert(`${eater.name} 吃掉了自己的毒药，出局了！`);
                        this.currentPlayerIndex = this.findNextActivePlayerIndex(this.currentPlayerIndex);
                        updateGameStatus(`轮到 ${this.players[this.currentPlayerIndex].name} 吃蛋糕。`);
                    } else {
                        this.endGame(cakeElement, `所有人都出局了！平局！`);
                    }
                }
            } else {
                const winnerNames = poisonOwners.map(p => p.name).join(' 和 ');
                this.endGame(cakeElement, `${eater.name} 吃到了 ${winnerNames} 的毒药！恭喜 ${winnerNames} 获胜！`);
            }
        } else {
            cakeElement.style.backgroundColor = "#555";
            this.currentPlayerIndex = this.findNextActivePlayerIndex(this.currentPlayerIndex);
            updateGameStatus(`轮到 ${this.players[this.currentPlayerIndex].name} 吃蛋糕。`);
        }
    },
    
    handleRollDice() {
        if (this.gameState !== 'ROLL_DICE') return;

        const roll = Math.floor(Math.random() * 6) + 1;
        this.players[this.currentPlayerIndex].diceRoll = roll;
        diceResult.textContent = `${this.players[this.currentPlayerIndex].name} 掷出了 ${roll} 点！`;
        
        rollDiceBtn.disabled = true;
        setTimeout(() => {
            rollDiceBtn.disabled = false;
            this.currentPlayerIndex++;
            if (this.currentPlayerIndex < this.players.length) {
                updateGameStatus(`请 ${this.players[this.currentPlayerIndex].name} 投骰子。`);
            } else {
                this.gameState = 'TURN_BASED';
                this.players.sort((a, b) => b.diceRoll - a.diceRoll);
                this.currentPlayerIndex = 0;
                rollDiceBtn.style.display = 'none';
                diceResult.textContent = `出手顺序: ${this.players.map(p => p.name).join(' -> ')}`;
                updateGameStatus(`游戏开始！轮到 ${this.players[this.currentPlayerIndex].name} 吃蛋糕。`);
            }
        }, 1500);
    },

    findNextActivePlayerIndex(startIndex) {
        let nextIndex = (startIndex + 1) % this.players.length;
        while (!this.players[nextIndex].isActive) {
            if (nextIndex === startIndex) return -1;
            nextIndex = (nextIndex + 1) % this.players.length;
        }
        return nextIndex;
    },

    endGame(poisonedCake, message) {
        this.gameState = 'GAME_OVER';
        winnerMessage.textContent = message;
        if (poisonedCake) {
            poisonedCake.innerText = '☠️';
            poisonedCake.style.backgroundColor = '#ff6b6b';
        }
        screens.gameOver.style.display = 'block';
        gameStatus.style.display = 'none';
        diceResult.style.display = 'none';
    }
};

// ---------------------------------------------
// --- MULTIPLAYER MODE LOGIC ---
// ---------------------------------------------
const multiPlayer = {
    initialize() {
        if (socket) return;
        socket = io({ transports: ['websocket'] }); // Force websocket to avoid some network issues
        
        socket.on('connect', () => unlockUI());
        socket.on('disconnect', () => { lockUI(); updateGameStatus("与服务器断开连接...正在尝试重连..."); });

        socket.on('roomCreated', ({ roomId, players }) => this.updateLobby(roomId, players));
        socket.on('joinSuccess', ({ roomId, players }) => this.updateLobby(roomId, players));
        socket.on('playerListUpdate', ({ players }) => this.updatePlayerList(players));
        socket.on('roomError', (message) => { alert(message); unlockUI(); });

        socket.on('gameStarted', (room) => {
            currentRoom = room; setupGameBoard(room.gameSettings.gridSize);
            screens.gameOver.style.display = 'none'; gameStatus.style.display = 'block';
            diceResult.style.display = 'block'; switchScreen('game');
            this.updateUIFromGameState(room);
        });
        socket.on('gameStateUpdate', (room) => {
            unlockUI(); currentRoom = room; this.updateUIFromGameState(room);
        });
        socket.on('diceRolled', ({ playerName, roll }) => diceResult.textContent = `${playerName} 掷出了 ${roll} 点！`);
        socket.on('cakeEaten', ({ cakeId, nextPlayerName }) => {
            const cake = gameBoard.querySelector(`[data-id='${cakeId}']`);
            if (cake) { cake.classList.add('eaten'); cake.style.backgroundColor = "#555"; }
            updateGameStatus(`轮到 ${nextPlayerName} 吃蛋糕。`);
        });
        socket.on('playerEliminated', ({ playerName, cakeId }) => {
            const cake = gameBoard.querySelector(`[data-id='${cakeId}']`);
            if (cake) { cake.innerText = '☠️'; cake.style.backgroundColor = '#ff6b6b'; }
            alert(`${playerName} 吃掉了自己的毒药，出局了！`);
        });
        socket.on('gameOver', ({ cakeId, message }) => {
            unlockUI();
            const cake = gameBoard.querySelector(`[data-id='${cakeId}']`);
            if (cake) { cake.innerText = '☠️'; cake.style.backgroundColor = '#ff6b6b'; }
            winnerMessage.textContent = message; screens.gameOver.style.display = 'block';
            gameStatus.style.display = 'none'; diceResult.style.display = 'none';
        });
        socket.on('backToLobby', (room) => {
            unlockUI(); currentRoom = room; this.updateLobby(room.id, room.players); switchScreen('onlineLobby');
        });
    },

    updateLobby(roomId, players) {
        roomIdDisplay.textContent = roomId;
        this.updatePlayerList(players);
        roomInfoDiv.style.display = 'block';
    },
    
    updatePlayerList(players) {
        playerList.innerHTML = '';
        players.forEach(p => {
            const li = document.createElement('li');
            li.textContent = p.name + (p.isHost ? ' (房主)' : '');
            playerList.appendChild(li);
        });
        const self = players.find(p => p.id === socket.id);
        const isHost = self && self.isHost;
        startGameBtn.style.display = isHost ? 'block' : 'none';
        onlineGameSettings.style.display = isHost ? 'block' : 'none';
    },

    updateUIFromGameState(room) {
        // Clear previous "my-poison" highlight before applying a new one
        const oldPoison = gameBoard.querySelector('.my-poison');
        if (oldPoison) oldPoison.classList.remove('my-poison');

        const self = room.players.find(p => p.id === socket.id); if (!self) return;
        
        // **FIX**: Persistently highlight the player's own poison after selection phase
        if (room.gameState !== 'SETUP_POISON' && self.poison !== null) {
            const myPoisonCake = gameBoard.querySelector(`[data-id='${self.poison}']`);
            if (myPoisonCake && !myPoisonCake.classList.contains('eaten')) {
                myPoisonCake.classList.add('my-poison');
            }
        }
        
        const currentPlayer = room.players[room.currentPlayerIndex]; let statusMsg = '';
        rollDiceBtn.style.display = 'none';
        switch(room.gameState) {
            case 'SETUP_POISON':
                statusMsg = (self.id === currentPlayer.id) ? '轮到你选择毒药了！' : `正在等待 ${currentPlayer.name} 选择毒药...`;
                break;
            case 'ROLL_DICE':
                diceResult.textContent = '';
                if (self.id === currentPlayer.id) { statusMsg = '轮到你投骰子了！'; rollDiceBtn.style.display = 'block'; } 
                else { statusMsg = `正在等待 ${currentPlayer.name} 投骰子...`; }
                break;
            case 'TURN_BASED':
                const turnOrder = room.players.filter(p => p.isActive).map(p => p.name).join(' -> ');
                diceResult.textContent = `出手顺序: ${turnOrder}`;
                statusMsg = (self.id === currentPlayer.id) ? '轮到你吃蛋糕了！' : `正在等待 ${currentPlayer.name} 吃蛋糕...`;
                break;
        }
        updateGameStatus(statusMsg);
    }
};

// --- Main Event Listeners ---
singlePlayerBtn.addEventListener('click', () => { GAME_MODE = 'single'; switchScreen('username'); });
multiplayerBtn.addEventListener('click', () => { GAME_MODE = 'online'; switchScreen('username'); });
confirmUsernameBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (!username) { alert('请输入你的名字！'); return; }
    player.name = username;
    if (GAME_MODE === 'single') switchScreen('singlePlayerRoom');
    else if (GAME_MODE === 'online') {
        onlinePlayerNameSpan.textContent = player.name;
        switchScreen('onlineLobby');
        multiPlayer.initialize();
    }
});
createSinglePlayerGameBtn.addEventListener('click', () => {
    const playerCount = parseInt(playerCountInput.value); const gridSize = parseInt(gridSizeInput.value);
    if (playerCount < 2 || playerCount > 3) { alert('玩家人数必须是 2 或 3！'); return; }
    if (gridSize < 3 || gridSize > 10) { alert('棋盘大小必须在 3x3 和 10x10 之间！'); return; }
    switchScreen('game');
    singlePlayer.startGame(player.name, playerCount, gridSize);
});
onlineCreateRoomBtn.addEventListener('click', () => { if (socket) socket.emit('createRoom', { playerName: player.name }); });
onlineJoinRoomBtn.addEventListener('click', () => { const roomId = roomIdInput.value.trim().toUpperCase(); if (roomId && socket) socket.emit('joinRoom', { roomId, playerName: player.name }); });
startGameBtn.addEventListener('click', () => { const gridSize = parseInt(onlineGridSizeInput.value); if (socket) socket.emit('startGame', { gridSize }); });
gameBoard.addEventListener('click', (event) => {
    if (waitingForServer) return;
    if (GAME_MODE === 'single') { singlePlayer.handleCakeClick(event.target); return; }
    if (socket && currentRoom) {
        const self = currentRoom.players.find(p => p.id === socket.id); if (!self || !self.isActive) return;
        const currentPlayer = currentRoom.players[currentRoom.currentPlayerIndex]; if (self.id !== currentPlayer.id) return;
        const cake = event.target; if (!cake.classList.contains('cake') || cake.classList.contains('eaten')) return;
        const cakeId = parseInt(cake.dataset.id); lockUI();
        if (currentRoom.gameState === 'SETUP_POISON') {
            cake.style.backgroundColor = '#8a63d2';
            setTimeout(() => { cake.style.backgroundColor = ''; }, 500);
            
            socket.emit('choosePoison', { cakeId });
        } else if (currentRoom.gameState === 'TURN_BASED') {
            socket.emit('eatCake', { cakeId });
        } else { unlockUI(); }
    }
});
rollDiceBtn.addEventListener('click', () => {
    if (waitingForServer) return;
    if (GAME_MODE === 'single') { singlePlayer.handleRollDice(); }
    else if (socket) { lockUI(); socket.emit('rollDice'); }
});
playAgainBtn.addEventListener('click', () => {
    if (GAME_MODE === 'single') { switchScreen('singlePlayerRoom'); }
    else if (socket) { lockUI(); socket.emit('returnToLobby'); }
});

backToHomeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        window.location.href = 'https://poison.lincc.cc/';
    });
});

exitRoomBtn.addEventListener('click', () => {
    window.location.href = 'https://poison.lincc.cc/';
});

// --- Initialize ---
switchScreen('modeSelection');
