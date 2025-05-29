const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ========== Game Core Data ==========
const questions = [
  {
    question: "What is the capital of France?",
    options: ["London", "Berlin", "Paris", "Madrid"],
    answer: "Paris"
  },
  {
    question: "Which planet is known as the Red Planet?",
    options: ["Venus", "Mars", "Jupiter", "Saturn"],
    answer: "Mars"
  },
  {
    question: "What is the capital of China?",
    options: ["Tokyo", "Seoul", "Beijing", "Shanghai"],
    answer: "Beijing"
  },
  {
    question: "Who painted the Mona Lisa?",
    options: ["Van Gogh", "Picasso", "Da Vinci", "Rembrandt"],
    answer: "Da Vinci"
  },
  {
    question: "What is the chemical symbol for gold?",
    options: ["Ag", "Fe", "Au", "Cu"],
    answer: "Au"
  }
];

let players = [];
let games = {};

app.use(express.static('public'));

// ========== Socket Event Handling ==========
io.on('connection', (socket) => {
  // Player Joins
  socket.on('join', (name) => {
    const existingById = players.find(p => p.id === socket.id);
    const existingByName = players.some(p => p.name === name.trim());
    
    if (existingById) return;
    if (existingByName) {
      socket.emit('nameConflict');
      return;
    }

    players.push({ id: socket.id, name: name.trim(), inGame: false });
    io.emit('updatePlayers', players.filter(p => !p.inGame));
  });

  // Initiate Challenge
  socket.on('challenge', (targetId) => {
    const challenger = players.find(p => p.id === socket.id);
    const target = players.find(p => p.id === targetId);

    if (!challenger) return socket.emit('error', 'Invalid challenger session');
    if (challenger.inGame) return socket.emit('error', 'You are already in a game');
    if (!target) return socket.emit('error', 'Target player not found');
    if (target.inGame) return socket.emit('error', 'Target player is in game');

    io.to(targetId).emit('challengeReceived', {
      challengerId: socket.id,
      challengerName: challenger.name
    });
  });

  // Accept Challenge
  socket.on('acceptChallenge', ({ challengerId }) => {
    const gameId = `${socket.id}-${challengerId}`;
    
    players = players.map(p => 
      [socket.id, challengerId].includes(p.id) ? { ...p, inGame: true } : p
    );

    socket.join(gameId);
    const challengerSocket = io.sockets.sockets.get(challengerId);
    if (challengerSocket) challengerSocket.join(gameId);

    games[gameId] = {
      players: [socket.id, challengerId],
      scores: { [socket.id]: 0, [challengerId]: 0 },
      currentQuestion: 0,
      timer: null,
      answered: false
    };

    io.to(gameId).emit('updateScores', games[gameId].scores);
    startRound(gameId);
    io.to(gameId).emit('gameStart', gameId);
  });

  // Handle Answer Submission
  socket.on('submitAnswer', ({ answer, gameId }) => {
    const game = games[gameId];
    if (!game || game.answered) return;

    if (game.timer) clearTimeout(game.timer);
    game.answered = true;

    const correctAnswer = questions[game.currentQuestion].answer;
    if (answer === correctAnswer) {
      game.scores[socket.id] = (game.scores[socket.id] || 0) + 2;
    } else {
      const opponentId = game.players.find(id => id !== socket.id);
      game.scores[opponentId] = (game.scores[opponentId] || 0) + 1;
    }

    io.to(gameId).emit('disableOptions');
    io.to(gameId).emit('updateScores', game.scores);

    game.timer = setTimeout(() => {
      game.answered = false;
      nextRound(gameId);
    }, 1000);
  });

  // Handle Timeout
  socket.on('timeout', ({ gameId }) => {
    const game = games[gameId];
    if (game) handleTimeout(gameId);
  });

  // Request Player List Update
  socket.on('requestPlayerListUpdate', () => {
    io.emit('updatePlayers', players.filter(p => !p.inGame));
  });

  // Disconnect
  socket.on('disconnect', () => {
    players = players.filter(p => p.id !== socket.id);
    io.emit('updatePlayers', players.filter(p => !p.inGame));
  });
});

// ========== Helper Functions ==========
function startRound(gameId) {
  const game = games[gameId];
  if (!game) return;

  if (game.timer) clearTimeout(game.timer);
  game.timer = setTimeout(() => handleTimeout(gameId), 10000);
  sendQuestion(gameId);
}

function nextRound(gameId) {
  const game = games[gameId];
  if (!game) return;

  game.currentQuestion++;
  
  if (game.currentQuestion < questions.length) {
    startRound(gameId);
  } else {
    endGame(gameId);
  }
}

function handleTimeout(gameId) {
  const game = games[gameId];
  if (!game) return;

  if (game.timer) clearTimeout(game.timer);
  game.players.forEach(id => game.scores[id] ||= 0);
  io.to(gameId).emit('updateScores', game.scores);
  game.timer = setTimeout(() => nextRound(gameId), 1000);
}

function sendQuestion(gameId) {
  const game = games[gameId];
  const question = questions[game.currentQuestion];
  io.to(gameId).emit('newQuestion', {
    ...question,
    round: game.currentQuestion + 1
  });
}

function endGame(gameId) {
  const game = games[gameId];
  io.to(gameId).emit('gameOver', JSON.stringify(game.scores));
  delete games[gameId];
  players = players.map(p => 
    game.players.includes(p.id) ? { ...p, inGame: false } : p
  );
  const availablePlayers = players.filter(p => !p.inGame);
  io.emit('updatePlayers', availablePlayers);
}

server.listen(3000);