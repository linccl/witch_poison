const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 让服务器可以访问我们的 HTML, CSS, JS 文件
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

const rooms = {}; // 用来存储所有房间信息

// Helper function to get room by socket.id
function findRoomBySocketId(socketId) {
    return Object.keys(rooms).find(roomId => rooms[roomId] && rooms[roomId].players.some(p => p.id === socketId));
}

io.on('connection', (socket) => {
    console.log(`A user connected: ${socket.id}`);

    // --- Lobby Logic ---
    socket.on('createRoom', ({ playerName }) => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            players: [], // Start empty, add player below
            gameSettings: { gridSize: 5 },
            gameState: 'LOBBY' // LOBBY, SETUP_POISON, ROLL_DICE, TURN_BASED, GAME_OVER
        };
        rooms[roomId].players.push({ id: socket.id, name: playerName, isHost: true, isActive: true, poison: null, diceRoll: 0 });
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, players: rooms[roomId].players });
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        roomId = roomId.toUpperCase();
        const room = rooms[roomId];
        if (room) {
            if (room.gameState !== 'LOBBY') {
                socket.emit('roomError', '游戏已经开始，无法加入！');
                return;
            }
            if (room.players.length < 3) {
                room.players.push({ id: socket.id, name: playerName, isHost: false, isActive: true, poison: null, diceRoll: 0 });
                socket.join(roomId);
                socket.emit('joinSuccess', { roomId, players: room.players });
                socket.to(roomId).emit('playerListUpdate', { players: room.players });
            } else {
                socket.emit('roomError', '房间已满！');
            }
        } else {
            socket.emit('roomError', '房间不存在！');
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        const roomId = findRoomBySocketId(socket.id);
        if (!roomId || !rooms[roomId]) return;
        
        const room = rooms[roomId];
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex === -1) return;

        const leavingPlayer = room.players.splice(playerIndex, 1)[0];
        
        if (room.players.length === 0) {
            delete rooms[roomId];
            console.log(`Room ${roomId} closed.`);
            return;
        }

        // **CRASH FIX**: If a player leaves, the currentPlayerIndex might become invalid.
        if (room.gameState !== 'LOBBY') {
            if (room.currentPlayerIndex >= room.players.length) {
                // The index is now out of bounds. Reset to 0 to prevent a server crash.
                room.currentPlayerIndex = 0;
            }
            // Notify remaining players about the updated game state
            io.to(roomId).emit('gameStateUpdate', room);
        }
        
        const hostLeft = !room.players.some(p => p.isHost);
        if (hostLeft && room.players.length > 0) {
            room.players[0].isHost = true;
        }

        io.to(roomId).emit('playerListUpdate', { players: room.players, disconnectedPlayer: leavingPlayer.name });
    });

    // --- Game Logic ---

    socket.on('startGame', ({ gridSize }) => {
        const roomId = findRoomBySocketId(socket.id);
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        if (room.players.length < 2) {
            socket.emit('roomError', '至少需要2名玩家才能开始游戏。');
            return;
        }

        room.gameSettings.gridSize = gridSize;
        room.gameState = 'SETUP_POISON';
        room.currentPlayerIndex = 0;

        io.to(roomId).emit('gameStarted', room);
    });

    socket.on('choosePoison', ({ cakeId }) => {
        const roomId = findRoomBySocketId(socket.id);
        if (!roomId || !rooms[roomId] || rooms[roomId].gameState !== 'SETUP_POISON') return;
        const room = rooms[roomId];
        const player = room.players[room.currentPlayerIndex];
        if (!player || player.id !== socket.id) return;
        player.poison = cakeId;
        room.currentPlayerIndex++;
        if (room.currentPlayerIndex >= room.players.length) {
            room.gameState = 'ROLL_DICE';
            room.currentPlayerIndex = 0;
        }
        io.to(roomId).emit('gameStateUpdate', room);
    });

    socket.on('rollDice', () => {
        const roomId = findRoomBySocketId(socket.id);
        if (!roomId || !rooms[roomId] || rooms[roomId].gameState !== 'ROLL_DICE') return;
        const room = rooms[roomId];
        const player = room.players[room.currentPlayerIndex];
        if (!player || player.id !== socket.id) return;
        player.diceRoll = Math.floor(Math.random() * 6) + 1;
        io.to(roomId).emit('diceRolled', { playerName: player.name, roll: player.diceRoll });
        setTimeout(() => {
            room.currentPlayerIndex++;
            if (room.currentPlayerIndex >= room.players.length) {
                room.gameState = 'TURN_BASED';
                room.players.sort((a, b) => b.diceRoll - a.diceRoll);
                room.currentPlayerIndex = 0;
            }
            io.to(roomId).emit('gameStateUpdate', room);
        }, 1500);
    });

    socket.on('eatCake', ({ cakeId }) => {
        const roomId = findRoomBySocketId(socket.id);
        if (!roomId || !rooms[roomId] || rooms[roomId].gameState !== 'TURN_BASED') return;
        const room = rooms[roomId];
        const eater = room.players[room.currentPlayerIndex];
        if (!eater || eater.id !== socket.id) return;

        const poisonOwners = room.players.filter(p => p.poison === cakeId);

        // Case 1: The cake is poisonous
        if (poisonOwners.length > 0) {
            room.gameState = 'GAME_OVER';
            const ateOwnPoison = poisonOwners.some(p => p.id === eater.id);
            let message = '';
            
            if (ateOwnPoison) {
                eater.isActive = false;
                const otherWinners = poisonOwners.filter(p => p.id !== eater.id);
                if (otherWinners.length > 0) {
                    message = `${eater.name} 吃掉自己的毒药出局，但 ${otherWinners.map(p=>p.name).join('和')} 也把毒药放在这！恭喜 ${otherWinners.map(p=>p.name).join('和')} 获胜！`;
                } else {
                    const remaining = room.players.filter(p => p.isActive);
                    if (remaining.length === 1) message = `${eater.name} 吃掉自己的毒药出局！最后的赢家是 ${remaining[0].name}！`;
                    else if (remaining.length > 1) { // Game continues, not over
                        room.gameState = 'TURN_BASED';
                        io.to(roomId).emit('playerEliminated', { playerName: eater.name, cakeId });
                        let nextIdx = (room.currentPlayerIndex + 1) % room.players.length;
                        while (!room.players[nextIdx].isActive) { nextIdx = (nextIdx + 1) % room.players.length; }
                        room.currentPlayerIndex = nextIdx;
                        io.to(roomId).emit('gameStateUpdate', room);
                        return; // Exit here since game is not over
                    } else message = `所有人都出局了！平局！`;
                }
            } else {
                message = `${eater.name} 吃到了 ${poisonOwners.map(p=>p.name).join('和')} 的毒药！恭喜 ${poisonOwners.map(p=>p.name).join('和')} 获胜！`;
            }
            io.to(roomId).emit('gameOver', { cakeId, message });
        }
        // Case 2: The cake is safe
        else {
            let nextIdx = (room.currentPlayerIndex + 1) % room.players.length;
            while (!room.players[nextIdx].isActive) { nextIdx = (nextIdx + 1) % room.players.length; }
            room.currentPlayerIndex = nextIdx;
            io.to(roomId).emit('cakeEaten', { cakeId, nextPlayerName: room.players[room.currentPlayerIndex].name });
            io.to(roomId).emit('gameStateUpdate', room);
        }
    });

    // --- NEW EVENT: Return to Lobby ---
    socket.on('returnToLobby', () => {
        const roomId = findRoomBySocketId(socket.id);
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        // Reset game state
        room.gameState = 'LOBBY';
        // Reset all players for the next game
        room.players.forEach(p => {
            p.poison = null;
            p.diceRoll = 0;
            p.isActive = true;
        });

        // Notify everyone in the room to go back to the lobby
        io.to(roomId).emit('backToLobby', room);
    });
});

// Unchanged from here
Object.assign(io.sockets.adapter, {
    on(event, listener) {
        if (event === 'startGame') {
            // Find the startGame listener and wrap it
            const originalListener = this.listeners('startGame')[0];
            this.removeAllListeners('startGame');
            super.on('startGame', (data) => {
                const roomId = findRoomBySocketId(data.socket.id);
                if (!roomId || !rooms[roomId]) return;
                const room = rooms[roomId];
                if (room.players.length < 2) {
                    data.socket.emit('roomError', '至少需要2名玩家才能开始游戏。'); return;
                }
                room.gameSettings.gridSize = data.gridSize;
                room.gameState = 'SETUP_POISON';
                room.currentPlayerIndex = 0;
                io.to(roomId).emit('gameStarted', room);
            });
        } else {
            super.on(event, listener);
        }
    }
});
Object.assign(io.sockets.adapter, {
    on(event, listener) {
        if (event === 'returnToLobby') {
            const originalListener = this.listeners('returnToLobby')[0];
            this.removeAllListeners('returnToLobby');
            super.on('returnToLobby', (data) => {
                const roomId = findRoomBySocketId(data.socket.id);
                if (!roomId || !rooms[roomId]) return;
                const room = rooms[roomId];
                room.gameState = 'LOBBY';
                room.players.forEach(p => { p.poison = null; p.diceRoll = 0; p.isActive = true; });
                io.to(roomId).emit('backToLobby', room);
            });
        } else {
            super.on(event, listener);
        }
    }
});

const PORT = process.env.PORT || 4000;
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`服务器正在 http://${HOST}:${PORT} 上运行`);
  console.log(`现在，你可以通过局域网内的其他设备访问了！`);
  console.log(`要从其他设备连接，请找到你电脑的局域网IP地址，然后访问 http://[你的IP地址]:${PORT}`);
});

// --- NEW: Add a timer to log online user count ---
setInterval(() => {
    const onlineCount = io.engine.clientsCount;
    // 使用 console.log 在服务器的控制台输出信息
    console.log(`[Server Status] 当前在线用户数: ${onlineCount}`);
}, 10000); // 10000 毫秒 = 10 秒