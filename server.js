require('dotenv').config();

const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const path = require("path");
const socketIO = require("socket.io");
const { v4: uuidv4 } = require("uuid");

// Socket.IO с улучшенной конфигурацией
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  maxHttpBufferSize: 1e8
});

const { ExpressPeerServer } = require("peer");

// Настройки Express
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// PeerJS сервер (локальный, но будем использовать публичный на клиенте)
const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/',
  allow_discovery: true
});

app.use("/peerjs", peerServer);

// Маршруты
app.get("/", (req, res) => {
  res.render("index");
});

app.get("/healthz", (req, res) => res.status(200).send("ok"));

app.get("/room/:roomId", (req, res) => {
  res.render("room", {
    roomId: req.params.roomId
  });
});

// Хранилище комнат
const rooms = new Map();
const MAX_ROOM_HISTORY = 100;

// Socket.IO обработчики
io.on("connection", (socket) => {
  console.log(`[${new Date().toISOString()}] 🟢 Socket.IO подключен: ${socket.id}`);

  socket.on("join-room", (roomId, userId, userName) => {
    if (!roomId || !userId || !userName) {
      console.error("❌ Неполные данные для подключения");
      return;
    }

    socket.join(roomId);
    
    // Инициализация комнаты
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
    room.users.set(userId, { 
      socketId: socket.id, 
      userName,
      joinedAt: new Date()
    });

    console.log(`[${roomId}] 👤 ${userName} (${userId}) присоединился. Всего участников: ${room.users.size}`);
    
    // Отправка истории сообщений
    if (room.messages.length > 0) {
      socket.emit("messageHistory", room.messages);
    }

    // Уведомление других участников
    setTimeout(() => {
      socket.broadcast.to(roomId).emit("user-connected", userId, userName);
      console.log(`[${roomId}] 📢 Уведомили других о подключении ${userName}`);
    }, 1000);

    // Обработка сообщений чата
    socket.on("message", (data) => {
      try {
        console.log(`[${roomId}] 💬 Сообщение от ${data.sender}: ${data.text}`);
        
        const newMessage = {
          sender: data.sender || "Аноним",
          text: data.text || "",
          timestamp: new Date().toISOString()
        };
        
        room.messages.push(newMessage);
        
        if (room.messages.length > MAX_ROOM_HISTORY) {
          room.messages.shift();
        }
        
        io.to(roomId).emit("createMessage", newMessage);
      } catch (error) {
        console.error("❌ Ошибка обработки сообщения:", error);
      }
    });

    // Отключение пользователя
    socket.on("disconnect", () => {
      console.log(`[${roomId}] 🔴 ${userName} отключился`);
      room.users.delete(userId);
      
      // Удаление пустых комнат
      if (room.users.size === 0) {
        setTimeout(() => {
          if (rooms.has(roomId) && rooms.get(roomId).users.size === 0) {
            rooms.delete(roomId);
            console.log(`[${roomId}] 🗑️ Комната удалена (пустая)`);
          }
        }, 5 * 60 * 1000); // Удаляем через 5 минут
      }
      
      socket.broadcast.to(roomId).emit("user-disconnected", userId);
    });

    // Демонстрация экрана
    socket.on("screenShareStopped", (initiatorPeerId) => {
      console.log(`[${roomId}] 🖥️ Демонстрация остановлена: ${initiatorPeerId}`);
      socket.broadcast.to(roomId).emit("screenShareStopped", initiatorPeerId);
    });

    // Белая доска
    socket.on("whiteboardDraw", (data) => {
      socket.broadcast.to(roomId).emit("whiteboardDraw", data);
    });

    socket.on("whiteboardClear", () => {
      room.whiteboardState = [];
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
});

// PeerJS события
peerServer.on('connection', (client) => {
  console.log(`🔗 PeerJS клиент подключен: ${client.id}`);
});

peerServer.on('disconnect', (client) => {
  console.log(`🔌 PeerJS клиент отключен: ${client.id}`);
});

// Graceful shutdown
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

// Запуск сервера
const PORT = process.env.PORT || 3030;
const ENV = process.env.NODE_ENV || 'development';

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║   🎥 WebRTC Video Conference Server      ║
║                                           ║
║   📡 Port: ${PORT}                          
║   🌍 Environment: ${ENV}                  
║   🎯 PeerJS: 0.peerjs.com (public)       
║                                           ║
╚═══════════════════════════════════════════╝
  `);
});