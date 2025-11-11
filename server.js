// server.js
require('dotenv').config();

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 3030;
const path = require('path');

let socketList = {};

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.render("index");
});

app.get("/healthz", (req, res) => res.status(200).send("ok"));

app.get("/room/:roomId", (req, res) => {
  res.render("room", { roomId: req.params.roomId });
});

// ✅ Socket.IO логика (ПРОСТАЯ И РАБОЧАЯ)
io.on('connection', (socket) => {
  console.log(`🟢 Новый пользователь: ${socket.id}`);

  // Проверка существования имени
  socket.on('BE-check-user', ({ roomId, userName }) => {
    let error = false;
    io.sockets.adapter.rooms.get(roomId)?.forEach((clientId) => {
      if (socketList[clientId]?.userName === userName) {
        error = true;
      }
    });
    socket.emit('FE-error-user-exist', { error });
  });

  // Присоединение к комнате
  socket.on('BE-join-room', ({ roomId, userName }) => {
    console.log(`📥 ${userName} присоединился к ${roomId}`);
    
    socket.join(roomId);
    socketList[socket.id] = { userName, video: true, audio: true };

    // Собираем всех пользователей комнаты
    const users = [];
    const room = io.sockets.adapter.rooms.get(roomId);
    
    if (room) {
      room.forEach((clientId) => {
        if (socketList[clientId]) {
          users.push({ 
            userId: clientId, 
            info: socketList[clientId] 
          });
        }
      });
    }

    // ВАЖНО: отправляем список ТОЛЬКО старым пользователям
    socket.broadcast.to(roomId).emit('FE-user-join', users);
  });

  // Передача WebRTC сигналов
  socket.on('BE-call-user', ({ userToCall, from, signal }) => {
    io.to(userToCall).emit('FE-receive-call', {
      signal,
      from,
      info: socketList[socket.id]
    });
  });

  socket.on('BE-accept-call', ({ signal, to }) => {
    io.to(to).emit('FE-call-accepted', {
      signal,
      answerId: socket.id
    });
  });

  // Чат
  socket.on('BE-send-message', ({ roomId, msg, sender }) => {
    io.to(roomId).emit('FE-receive-message', { msg, sender });
  });

  // Отключение
  socket.on('BE-leave-room', ({ roomId }) => {
    const userName = socketList[socket.id]?.userName;
    delete socketList[socket.id];
    socket.broadcast.to(roomId).emit('FE-user-leave', { 
      userId: socket.id, 
      userName 
    });
    socket.leave(roomId);
  });

  socket.on('disconnect', () => {
    console.log(`🔴 Отключился: ${socket.id}`);
    
    const userName = socketList[socket.id]?.userName;
    
    // КРИТИЧНО: находим все комнаты, где был этот пользователь
    const rooms = Array.from(socket.rooms).filter(room => room !== socket.id);
    
    rooms.forEach(roomId => {
      socket.broadcast.to(roomId).emit('FE-user-leave', { 
        userId: socket.id, 
        userName 
      });
    });
    
    delete socketList[socket.id];
  });

  // Переключение камеры/микрофона
  socket.on('BE-toggle-camera-audio', ({ roomId, switchTarget }) => {
    if (socketList[socket.id]) {
      if (switchTarget === 'video') {
        socketList[socket.id].video = !socketList[socket.id].video;
      } else {
        socketList[socket.id].audio = !socketList[socket.id].audio;
      }
      socket.broadcast.to(roomId).emit('FE-toggle-camera', { 
        userId: socket.id, 
        switchTarget 
      });
    }
  });
});

http.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║   🎥 WebRTC Server (simple-peer)          ║
║   📡 Port: ${PORT}                          ║
║   🌍 Socket.IO: активен                   ║
╚═══════════════════════════════════════════╝
  `);
});