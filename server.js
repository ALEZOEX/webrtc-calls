require('dotenv').config();

const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const path = require("path");
const socketIO = require("socket.io");

const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

const { ExpressPeerServer } = require("peer");

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/'
});

app.use("/peerjs", peerServer);

app.get("/", (req, res) => {
  res.render("index");
});

app.get("/room/:roomId", (req, res) => {
  // Определяем, где мы запущены
  const isProduction = process.env.NODE_ENV === 'production';
  const hostname = req.get('host').split(':')[0]; // Получаем домен без порта
  
  res.render("room", {
    roomId: req.params.roomId,
    peerConfig: {
      host: hostname, // Автоматически берет домен из запроса
      port: isProduction ? 443 : 3030, // На Render всегда 443 (HTTPS)
      path: '/peerjs', // БЕЗ двойного /peerjs
      secure: isProduction // true на Render, false локально
    }
  });
});

const rooms = new Map();
const MAX_ROOM_HISTORY = 100;

io.on("connection", (socket) => {
  console.log(`[${new Date().toISOString()}] Подключен: ${socket.id}`);

  socket.on("join-room", (roomId, userId, userName) => {
    if (!roomId || !userId || !userName) {
      console.error("Неполные данные");
      return;
    }

    socket.join(roomId);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        users: new Map(),
        messages: [],
        whiteboardState: []
      });
    }

    const room = rooms.get(roomId);
    room.users.set(userId, { socketId: socket.id, userName });

    console.log(`[${roomId}] ${userName} присоединился`);
    
    if (room.messages.length > 0) {
      socket.emit("messageHistory", room.messages);
    }

    setTimeout(() => {
      socket.broadcast.to(roomId).emit("user-connected", userId, userName);
    }, 1000);

    socket.on("message", (data) => {
      try {
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
        console.error("Ошибка сообщения:", error);
      }
    });

    socket.on("disconnect", () => {
      console.log(`[${roomId}] ${userName} отключился`);
      room.users.delete(userId);
      
      if (room.users.size === 0) {
        rooms.delete(roomId);
      }
      
      socket.broadcast.to(roomId).emit("user-disconnected", userId);
    });

    socket.on("screenShareStopped", (initiatorPeerId) => {
      socket.broadcast.to(roomId).emit("screenShareStopped", initiatorPeerId);
    });

    socket.on("whiteboardDraw", (data) => {
      socket.broadcast.to(roomId).emit("whiteboardDraw", data);
    });

    socket.on("whiteboardClear", () => {
      socket.broadcast.to(roomId).emit("whiteboardClear");
    });

    socket.on("whiteboardUndo", () => {
      socket.broadcast.to(roomId).emit("whiteboardUndo");
    });

    socket.on("whiteboardOpen", () => {
      socket.broadcast.to(roomId).emit("whiteboardOpen");
    });

    socket.on("whiteboardClose", () => {
      socket.broadcast.to(roomId).emit("whiteboardClose");
    });
  });
});

const PORT = process.env.PORT || 3030;
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   🚀 Server started on port ${PORT}      
╚════════════════════════════════════════╝
  `);
});