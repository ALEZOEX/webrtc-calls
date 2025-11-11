// server.js
require('dotenv').config();

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'], // ✅ Websocket первый
  pingTimeout: 30000, // ✅ Увеличено для Render
  pingInterval: 10000, // ✅ Чаще ping
  upgradeTimeout: 30000,
  maxHttpBufferSize: 1e8,
  allowEIO3: true,
  // ✅ КРИТИЧНО для Render
  cookie: false,
  serveClient: false,
  path: '/socket.io/',
  connectTimeout: 45000
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

// ==========================================
// API ENDPOINT ДЛЯ SENDBEACON
// ==========================================

const bodyParser = require('body-parser');
app.use(bodyParser.json());
app.use(bodyParser.text({ type: '*/*' }));

app.post('/api/user-leave', (req, res) => {
  try {
    let data;
    
    // sendBeacon отправляет как text, парсим вручную
    if (typeof req.body === 'string') {
      data = JSON.parse(req.body);
    } else {
      data = req.body;
    }
    
    const { socketId, roomId, userName } = data;
    
    console.log(`📡 Получен beacon leave от ${userName} (${socketId})`);
    
    // Удаляем из socketList
    if (socketList[socketId]) {
      delete socketList[socketId];
      
      // Уведомляем всех в комнате
      io.to(roomId).emit('FE-user-leave', { 
        userId: socketId, 
        userName 
      });
      
      console.log(`✅ Пользователь ${userName} удален через beacon`);
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Ошибка обработки beacon:', error);
    res.status(500).send('Error');
  }
});

// ==========================================
// УЛУЧШЕННАЯ ОБРАБОТКА ОТКЛЮЧЕНИЙ
// ==========================================

io.on('connection', (socket) => {
  console.log(`🟢 Новый пользователь: ${socket.id}`);
  
  // Таймер для проверки "зомби" соединений
  let disconnectTimer = null;

  socket.on('BE-check-user', ({ roomId, userName }) => {
    let error = false;
    const room = io.sockets.adapter.rooms.get(roomId);
    
    if (room) {
      room.forEach((clientId) => {
        if (socketList[clientId]?.userName === userName) {
          error = true;
        }
      });
    }
    
    socket.emit('FE-error-user-exist', { error });
  });

  socket.on('BE-join-room', ({ roomId, userName }) => {
    console.log(`📥 ${userName} (${socket.id}) присоединился к ${roomId}`);
    
    socket.join(roomId);
    socketList[socket.id] = { 
      userName, 
      video: false, // камера выключена по умолчанию
      audio: true,
      roomId,
      joinedAt: Date.now()
    };

    const users = [];
    const room = io.sockets.adapter.rooms.get(roomId);
    
    if (room) {
      console.log(`📋 Участники в комнате ${roomId}:`, Array.from(room));
      
      room.forEach((clientId) => {
        if (socketList[clientId]) {
          users.push({ 
            userId: clientId, 
            info: {
              userName: socketList[clientId].userName,
              video: socketList[clientId].video,
              audio: socketList[clientId].audio
            }
          });
        }
      });
    }

    console.log(`📤 Отправляем FE-user-join с ${users.length} участниками`);
    console.log('   Список:', users.map(u => `${u.info.userName} (${u.userId})`));
    
    // ✅ КРИТИЧНО: broadcast.to - НЕ отправляет самому себе!
    socket.broadcast.to(roomId).emit('FE-user-join', users);
    
    // ✅ Очищаем таймер отключения (если был)
    if (disconnectTimer) {
      clearTimeout(disconnectTimer);
      disconnectTimer = null;
    }
  });

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

  socket.on('BE-send-message', ({ roomId, msg, sender }) => {
    io.to(roomId).emit('FE-receive-message', { msg, sender });
  });

  socket.on('BE-leave-room', ({ roomId }) => {
    handleUserLeave(socket, roomId);
  });

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

  // ✅ PING-PONG для проверки живых соединений
  socket.on('ping', () => {
    socket.emit('pong');
  });

  // ✅ КРИТИЧНО: Улучшенный disconnect
  socket.on('disconnect', (reason) => {
    console.log(`🔴 Отключился ${socket.id}, причина: ${reason}`);
    
    const userData = socketList[socket.id];
    if (!userData) return;
    
    const { roomId, userName } = userData;
    
    // ✅ НЕМЕДЛЕННО уведомляем других участников
    if (roomId) {
      socket.broadcast.to(roomId).emit('FE-user-leave', { 
        userId: socket.id, 
        userName 
      });
      
      socket.leave(roomId);
    }
    
    // ✅ Удаляем из списка СРАЗУ
    delete socketList[socket.id];
    
    console.log(`✅ Пользователь ${userName} (${socket.id}) полностью удален`);
  });

  // ✅ Обработка ошибок соединения
  socket.on('error', (error) => {
    console.error(`❌ Socket error для ${socket.id}:`, error);
  });
});

// ✅ Вспомогательная функция для выхода
function handleUserLeave(socket, roomId) {
  const userData = socketList[socket.id];
  if (!userData) return;
  
  const { userName } = userData;
  
  console.log(`👋 ${userName} покидает комнату ${roomId}`);
  
  socket.broadcast.to(roomId).emit('FE-user-leave', { 
    userId: socket.id, 
    userName 
  });
  
  socket.leave(roomId);
  delete socketList[socket.id];
}

// ✅ Периодическая очистка "зомби" соединений (каждую минуту)
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [socketId, data] of Object.entries(socketList)) {
    // Если соединение старше 10 минут и нет активности
    if (now - data.joinedAt > 10 * 60 * 1000) {
      // Проверяем, существует ли socket
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) {
        console.log(`🧹 Очистка зомби-соединения: ${socketId}`);
        delete socketList[socketId];
        cleaned++;
      }
    }
  }
  
  if (cleaned > 0) {
    console.log(`🧹 Очищено зомби-соединений: ${cleaned}`);
  }
}, 60000);

http.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║   🎥 WebRTC Server (simple-peer)          ║
║   📡 Port: ${PORT}                          ║
║   🌍 Socket.IO: активен                   ║
╚═══════════════════════════════════════════╝
  `);
});

// В конце server.js, после http.listen()
require('./keep-alive');