const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require("socket.io");
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Linha crucial: Serve todos os arquivos da pasta 'public'
app.use(express.static('public'));

const gameRooms = {};

io.on('connection', (socket) => {
    console.log(`Usuário conectado: ${socket.id}`);

    // Lógica do Lobby
    socket.on('getRoomList', () => {
        socket.emit('roomListUpdate', getPublicRooms());
    });

    socket.on('createRoom', ({ name }) => {
        const roomId = uuidv4();
        gameRooms[roomId] = {
            id: roomId, name,
            players: { [socket.id]: { name: 'Jogador 1', ready: false } },
            playerCount: 1, secretNumbers: {}
        };
        socket.join(roomId);
        io.emit('roomListUpdate', getPublicRooms());
        socket.emit('joinedRoom', { room: gameRooms[roomId] });
    });

    socket.on('joinRoom', (roomId) => {
        const room = gameRooms[roomId];
        if (room && room.playerCount < 2) {
            socket.join(roomId);
            room.players[socket.id] = { name: `Jogador 2`, ready: false };
            room.playerCount++;
            io.emit('roomListUpdate', getPublicRooms());
            io.to(roomId).emit('roomStateChanged', { room });
        } else {
            socket.emit('customError', { message: 'A sala está cheia ou não existe mais.' });
        }
    });

    // Lógica do Jogo Online
    socket.on('playerChoseNumber', ({ roomId, number }) => {
        const room = gameRooms[roomId];
        if (!room || !room.players[socket.id]) return;
        
        room.secretNumbers[socket.id] = number;
        room.players[socket.id].ready = true;
        io.to(roomId).emit('roomStateChanged', { room });

        const allReady = Object.values(room.players).every(p => p.ready);
        if (room.playerCount === 2 && allReady) {
            const firstPlayerId = Object.keys(room.players)[0];
            room.turn = firstPlayerId;
            io.to(roomId).emit('beginGuessing', { turn: room.turn });
        }
    });

    socket.on('makeGuess', ({ roomId, guess }) => {
        const room = gameRooms[roomId];
        if (!room || socket.id !== room.turn) return;

        const opponentId = Object.keys(room.players).find(p => p !== socket.id);
        if (!opponentId || room.secretNumbers[opponentId] === undefined) return;

        const secretNumber = room.secretNumbers[opponentId];
        
        if (guess === secretNumber) {
            io.to(roomId).emit('gameOver', { winnerId: socket.id });
            delete gameRooms[roomId];
            io.emit('roomListUpdate', getPublicRooms());
        } else {
            const result = guess < secretNumber ? 'baixo' : 'alto';
            room.turn = opponentId;
            io.to(roomId).emit('guessResult', { guesserId: socket.id, result, nextTurn: room.turn });
        }
    });

    socket.on('disconnect', () => {
        console.log(`Usuário desconectado: ${socket.id}`);
        for (const roomId in gameRooms) {
            if (gameRooms[roomId].players[socket.id]) {
                delete gameRooms[roomId];
                io.emit('roomListUpdate', getPublicRooms());
                io.to(roomId).emit('opponentDisconnected');
                break;
            }
        }
    });
});

function getPublicRooms() {
    const publicRooms = {};
    for (const roomId in gameRooms) {
        if (gameRooms[roomId].playerCount < 2) {
            publicRooms[roomId] = { ...gameRooms[roomId] };
        }
    }
    return publicRooms;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});