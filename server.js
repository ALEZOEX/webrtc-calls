require('dotenv').config();

const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const path = require("path");
const socketIO = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  maxHttpBufferSize: 1e8,
  allowEIO3: true
});

const { ExpressPeerServer } = require("peer");

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/',
  allow_discovery: true,
  proxied: true,
  key: 'peerjs'
});

app.use("/peerjs", peerServer);

app.get("/", (req, res) => {
  res.render("index");
});

app.get("/healthz", (req, res) => res.status(200).send("ok"));

app.get("/room/:roomId", (req, res) => {
  res.render("room", {
    roomId: req.params.roomId
  });
});

const rooms = new Map();
const MAX_ROOM_HISTORY = 100;

io.on("connection", (socket) => {
  console.log(`[${new Date().toISOString()}] 🟢 Socket.IO подключен: ${socket.id}`);
  console.log(`[${socket.id}] 🔧 Транспорт:`, socket.conn.transport.name);
  console.log(`[${socket.id}] 🌐 IP адрес:`, socket.handshake.address);

  socket.on("join-room", (roomId, userId, userName) => {
    console.log(`[${new Date().toISOString()}] 📥 Получен join-room:`, { roomId, userId, userName });
    
    if (!roomId || !userId || !userName) {
      console.error("❌ Неполные данные для подключения");
      return;
    }

    console.log(`[${roomId}] ▶ join-room от ${userName} (${userId}), socket=${socket.id}`);
    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        users: new Map(),
        messages: [],
        whiteboardState: [],
        createdAt: new Date()
      });
      console.log(`🆕 Создана комната: ${roomId}`);
    }

    const room = rooms.get(roomId);

    const existingUsers = [];
    for (const [uid, info] of room.users.entries()) {
      if (uid !== userId) existingUsers.push({ userId: uid, userName: info.userName });
    }

    console.log(`[${roomId}] ➡ отправляем room-users новому (${existingUsers.length})`);
    console.log(`[${roomId}] 📤 Список пользователей:`, existingUsers);
    socket.emit("room-users", existingUsers);

    room.users.set(userId, { 
      socketId: socket.id, 
      userName,
      joinedAt: new Date()
    });

    console.log(`[${roomId}] 👤 ${userName} (${userId}) присоединился. Всего: ${room.users.size}`);

    if (room.messages.length > 0) {
      console.log(`[${roomId}] 📤 Отправляем историю: ${room.messages.length} сообщений`);
      socket.emit("messageHistory", room.messages);
    } else {
      console.log(`[${roomId}] ℹ️ История сообщений пуста`);
    }

    setTimeout(() => {
      console.log(`[${roomId}] 📢 Отправляем user-connected:`, { userId, userName });
      socket.broadcast.to(roomId).emit("user-connected", userId, userName);
      console.log(`[${roomId}] ✅ user-connected отправлен`);
    }, 500);

    const userList = Array.from(room.users, ([uid, u]) => ({ userId: uid, userName: u.userName }));
    console.log(`[${roomId}] 📤 Отправляем user-list: ${userList.length} пользователей`);
    io.to(roomId).emit("user-list", userList);

    socket.on("message", (data) => {
      try {
        console.log(`[${roomId}] 💬 Получено сообщение:`, data);
        const newMessage = {
          sender: data.sender || "Аноним",
          text: data.text || "",
          timestamp: new Date().toISOString()
        };
        room.messages.push(newMessage);
        if (room.messages.length > MAX_ROOM_HISTORY) {
          room.messages.shift();
        }
        console.log(`[${roomId}] 📤 Рассылаем сообщение всем:`, newMessage);
        io.to(roomId).emit("createMessage", newMessage);
      } catch (error) {
        console.error("❌ Ошибка обработки сообщения:", error);
      }
    });

    socket.on("disconnect", () => {
      console.log(`[${roomId}] 🔴 ${userName} отключился`);
      room.users.delete(userId);
      
      if (room.users.size === 0) {
        setTimeout(() => {
          if (rooms.has(roomId) && rooms.get(roomId).users.size === 0) {
            rooms.delete(roomId);
            console.log(`[${roomId}] 🗑️ Комната удалена (пустая)`);
          }
        }, 5 * 60 * 1000);
      }
      
      socket.broadcast.to(roomId).emit("user-disconnected", userId);
    });

    socket.on("screenShareStopped", (initiatorPeerId) => {
      console.log(`[${roomId}] 🖥️ Демонстрация остановлена: ${initiatorPeerId}`);
      socket.broadcast.to(roomId).emit("screenShareStopped", initiatorPeerId);
    });

    socket.on("whiteboardDraw", (data) => {
      socket.broadcast.to(roomId).emit("whiteboardDraw", data);
    });

    socket.on("whiteboardClear", () => {
      if (rooms.has(roomId)) {
        rooms.get(roomId).whiteboardState = [];
      }
      socket.broadcast.to(roomId).emit("whiteboardClear");
    });

    socket.on("whiteboardOpen", () => {
      console.log(`[${roomId}] ✏️ Доска открыта`);
      socket.broadcast.to(roomId).emit("whiteboardOpen");
    });

    socket.on("whiteboardClose", () => {
      console.log(`[${roomId}] ✏️ Доска закрыта`);
      socket.broadcast.to(roomId).emit("whiteboardClose");
    });
  });

  socket.on("error", (error) => {
    console.error("❌ Socket.IO error:", error);
  });

  socket.on("disconnect", (reason) => {
    console.log(`[${socket.id}] 🔌 Socket.IO отключен:`, reason);
  });
});

peerServer.on('connection', (client) => {
  console.log(`🔗 PeerJS клиент подключен: ${client.id}`);
});

peerServer.on('disconnect', (client) => {
  console.log(`🔌 PeerJS клиент отключен: ${client.id}`);
});

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
  console.log('\n🛑 Получен сигнал завершения...');
  io.emit('server-shutdown', { message: 'Сервер перезагружается' });
  server.close(() => {
    console.log('✅ Сервер остановлен');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('⚠️ Принудительное завершение');
    process.exit(1);
  }, 10000);
}

const PORT = process.env.PORT || 3030;
const ENV = process.env.NODE_ENV || 'development';

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║   🎥 WebRTC Video Conference Server      ║
║                                           ║
║   📡 Port: ${PORT}                          
║   🌍 Environment: ${ENV}                  
║   🎯 PeerJS: локальный + публичный        ║
║                                           ║
╚═══════════════════════════════════════════╝
  `);
});