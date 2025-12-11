/**
 * @fileoverview Серверное приложение для видеоконференций WebRTC
 * Обрабатывает соединения через Socket.IO и обслуживает веб-страницы
 * @author Qwen Code
 * @version 1.0
 */

// Загрузка переменных окружения
require('dotenv').config();

// Импорт зависимостей
const express = require('express');
const app = express();
const http = require('http').createServer(app);

// Настройка Socket.IO с оптимизациями для продакшена
const io = require('socket.io')(http, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*", // Ограничьте для продакшена
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'], // Приоритет сокет-соединения
  pingTimeout: 30000, // Увеличено для деплоя на Render
  pingInterval: 10000, // Частые пинги для поддержания соединения
  upgradeTimeout: 30000,
  maxHttpBufferSize: 1e8,
  allowEIO3: true,
  // КРИТИЧНО для Render
  cookie: false,
  serveClient: false, // Используем CDN для клиентских библиотек
  path: '/socket.io/',
  connectTimeout: 45000
});

// Валидация и экранирование пользовательского ввода
const validator = require('validator');
const xss = require('xss');

// Определение порта для запуска сервера
const PORT = process.env.PORT || 3030;
const path = require('path');

// Хранилище активных сокетов (участников)
let socketList = {};

// Хранилище паролей приватных комнат
const roomPasswords = new Map();

// Настройка EJS как шаблонизатора
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Обслуживание статических файлов
app.use(express.static(path.join(__dirname, "public")));

// Маршрут для главной страницы
app.get("/", (req, res) => {
  res.render("index");
});

// Маршрут для проверки состояния сервера
app.get("/healthz", (req, res) => res.status(200).send("ok"));

// Маршрут для комнат видеоконференций
app.get("/room/:roomId", (req, res) => {
  const roomId = req.params.roomId;
  const isPrivate = req.query.private === 'true';
  const providedPassword = req.query.password;

  // Если комната помечена как приватная и есть пароль
  if (isPrivate && providedPassword) {
    const storedPassword = roomPasswords.get(roomId);

    // Если пароль не совпадает
    if (storedPassword !== providedPassword) {
      return res.status(403).send('Неверный пароль для доступа в комнату');
    }
  } else if (isPrivate && !providedPassword) {
    // Если комната приватная, но пароль не предоставлен
    return res.status(403).send('Для доступа в приватную комнату требуется пароль');
  }

  res.render("room", { roomId: roomId });
});

// ==========================================
// API ENDPOINT ДЛЯ SENDBEACON
// ==========================================

// Парсинг тела запроса для обработки sendBeacon
const bodyParser = require('body-parser');
app.use(bodyParser.json());
app.use(bodyParser.text({ type: '*/*' }));

/**
 * Обработка уведомлений о выходе пользователя через sendBeacon
 * Этот метод надежно обрабатывает случаи, когда пользователь покидает конференцию
 * и стандартное событие disconnect не может быть отправлено
 */
app.post('/api/user-leave', (req, res) => {
  try {
    let data;

    // sendBeacon отправляет данные как text/plain, поэтому парсим вручную
    if (typeof req.body === 'string') {
      data = JSON.parse(req.body);
    } else {
      data = req.body;
    }

    const { socketId, roomId, userName } = data;

    console.log(`📡 Получен beacon leave от ${userName} (${socketId})`);

    // Удаляем участника из списка сокетов
    if (socketList[socketId]) {
      delete socketList[socketId];

      // Уведомляем всех остальных участников комнаты о выходе
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
// ОБРАБОТКА СОКЕТ-СОЕДИНЕНИЙ
// ==========================================

/**
 * Обработка подключения нового клиента
 * Управление комнатами, участниками и их состоянием
 */
io.on('connection', (socket) => {
  console.log(`🟢 Новый пользователь: ${socket.id}`);

  // Таймер для проверки "зомби" соединений
  let disconnectTimer = null;

  /**
   * Проверка существования пользователя с таким именем в комнате
   * Предотвращает дубликаты имен в одной комнате
   */
  socket.on('BE-check-user', ({ roomId, userName }) => {
    // Валидация данных
    if (!roomId || !userName) {
      socket.emit('FE-error-user-exist', { error: true });
      return;
    }

    // Валидация длины и содержимого имени пользователя
    if (!validator.isLength(userName, { min: 1, max: 50 })) {
      socket.emit('FE-error-user-exist', { error: true });
      return;
    }

    // Проверка комнаты
    if (!validator.isUUID(roomId) && !validator.isAlphanumeric(roomId) || roomId.length > 50) {
      socket.emit('FE-error-user-exist', { error: true });
      return;
    }

    // Экранируем имя пользователя для проверки
    const sanitizedUserName = xss(validator.escape(userName));

    let error = false;
    const room = io.sockets.adapter.rooms.get(roomId);

    if (room) {
      room.forEach((clientId) => {
        if (socketList[clientId]?.userName === sanitizedUserName) {
          error = true;
        }
      });
    }

    socket.emit('FE-error-user-exist', { error });
  });

  /**
   * Обработка присоединения пользователя к комнате
   * Добавляет пользователя в комнату и уведомляет других участников
   */
  socket.on('BE-join-room', ({ roomId, userName, password }) => {
    // Валидация данных пользователя
    if (!roomId || !userName) {
      socket.emit('FE-error', { error: 'Недостаточно данных для присоединения к комнате' });
      return;
    }

    // Валидация длины и содержимого имени пользователя
    if (!validator.isLength(userName, { min: 1, max: 50 })) {
      socket.emit('FE-error', { error: 'Имя пользователя должно быть от 1 до 50 символов' });
      return;
    }

    // Проверка комнаты
    if (!validator.isUUID(roomId) && !validator.isAlphanumeric(roomId) || roomId.length > 50) {
      socket.emit('FE-error', { error: 'Некорректный ID комнаты' });
      return;
    }

    // Проверяем, является ли комната приватной, и если да - проверяем пароль
    const isPrivateRoom = roomPasswords.has(roomId);
    if (isPrivateRoom) {
      if (!password || roomPasswords.get(roomId) !== password) {
        socket.emit('FE-error', { error: 'Неверный пароль для приватной комнаты' });
        return;
      }
    }

    // Экранируем имя пользователя
    const sanitizedUserName = xss(validator.escape(userName));

    // Проверяем, не превышено ли максимальное количество участников в комнате
    const roomForCheck = io.sockets.adapter.rooms.get(roomId);
    const maxParticipants = process.env.MAX_PARTICIPANTS_PER_ROOM || 16; // По умолчанию 16 участников

    if (roomForCheck && roomForCheck.size >= maxParticipants) {
      socket.emit('FE-error', { error: `Комната достигла максимального количества участников: ${maxParticipants}` });
      return;
    }

    console.log(`📥 ${sanitizedUserName} (${socket.id}) присоединился к ${roomId}`);

    // Если комната еще не существует и был передан пароль, сохраняем его
    if (!roomForCheck && password) {
      roomPasswords.set(roomId, password);
      console.log(`🔒 Установлен пароль для новой комнаты: ${roomId}`);
    }

    socket.join(roomId);
    socketList[socket.id] = {
      userName: sanitizedUserName,
      video: false, // камера выключена по умолчанию
      audio: true,
      roomId,
      joinedAt: Date.now()
    };

    // Собираем информацию о существующих участниках
    const users = [];
    const updatedRoom = io.sockets.adapter.rooms.get(roomId);

    if (updatedRoom) {
      console.log(`📋 Участники в комнате ${roomId}:`, Array.from(updatedRoom));

      updatedRoom.forEach((clientId) => {
        if (socketList[clientId] && clientId !== socket.id) { // Исключаем только что подключившегося пользователя
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

    // Отправляем список участников новому пользователю (broadcast НЕ отправляет самому себе!)
    socket.broadcast.to(roomId).emit('FE-user-join', users);

    // Очищаем таймер отключения (если был)
    if (disconnectTimer) {
      clearTimeout(disconnectTimer);
      disconnectTimer = null;
    }
  });

  /**
   * Обработка исходящего звонка от пользователя другому участнику
   */
  socket.on('BE-call-user', ({ userToCall, from, signal }) => {
    // Проверяем, что вызов идет внутри одной комнаты
    const caller = socketList[socket.id];
    const callee = socketList[userToCall];

    if (!caller || !callee || caller.roomId !== callee.roomId) {
      return;
    }

    io.to(userToCall).emit('FE-receive-call', {
      signal,
      from,
      info: socketList[socket.id]
    });
  });

  /**
   * Обработка подтверждения звонка (когда пользователь отвечает на звонок)
   */
  socket.on('BE-accept-call', ({ signal, to }) => {
    // Проверяем, что подтверждение идет внутри одной комнаты
    const answerer = socketList[socket.id];
    const caller = socketList[to];

    if (!answerer || !caller || answerer.roomId !== caller.roomId) {
      return;
    }

    io.to(to).emit('FE-call-accepted', {
      signal,
      answerId: socket.id
    });
  });

  /**
   * Обработка сообщений чата
   * Пересылка сообщений всем участникам комнаты
   */
  socket.on('BE-send-message', ({ roomId, msg, sender }) => {
    // Валидация и экранирование сообщения
    if (!validator.isLength(msg, { min: 1, max: 500 })) {
      return; // Отбрасываем слишком короткие или длинные сообщения
    }

    // Экранируем HTML/XSS в сообщении и имени отправителя
    const sanitizedMsg = xss(msg);
    const sanitizedSender = xss(validator.escape(sender));

    io.to(roomId).emit('FE-receive-message', {
      msg: sanitizedMsg,
      sender: sanitizedSender
    });
  });

  /**
   * Обработка выхода пользователя из комнаты
   */
  socket.on('BE-leave-room', ({ roomId }) => {
    // Проверяем, что пользователь действительно находится в этой комнате
    if (socketList[socket.id]?.roomId === roomId) {
      handleUserLeave(socket, roomId);
    }
  });

  /**
   * Обработка события поднятия руки пользователем
   */
  socket.on('BE-hand-raised', ({ roomId, userName }) => {
    // Проверяем, что пользователь находится в правильной комнате
    if (socketList[socket.id]?.roomId === roomId) {
      socket.broadcast.to(roomId).emit('FE-hand-raised', { userName });
    }
  });

  /**
   * Обработка события опускания руки пользователем
   */
  socket.on('BE-hand-lowered', ({ roomId, userName }) => {
    // Проверяем, что пользователь находится в правильной комнате
    if (socketList[socket.id]?.roomId === roomId) {
      socket.broadcast.to(roomId).emit('FE-hand-lowered', { userName });
    }
  });

  /**
   * Обработка переключения камеры/микрофона
   * Уведомление других участников об изменении состояния
   */
  socket.on('BE-toggle-camera-audio', ({ roomId, switchTarget }) => {
    // Проверяем, что пользователь существует и находится в комнате
    if (!socketList[socket.id] || socketList[socket.id].roomId !== roomId) {
      return;
    }

    // Валидация switchTarget
    if (switchTarget !== 'video' && switchTarget !== 'audio') {
      return;
    }

    if (switchTarget === 'video') {
      socketList[socket.id].video = !socketList[socket.id].video;
    } else {
      socketList[socket.id].audio = !socketList[socket.id].audio;
    }
    socket.broadcast.to(roomId).emit('FE-toggle-camera', {
      userId: socket.id,
      switchTarget
    });
  });

  /**
   * Обработка запроса списка участников (для модерации)
   * Только пользователь, который был первым в комнате, может модерировать
   */
  socket.on('BE-get-participants', ({ roomId }) => {
    // Проверяем, что пользователь находится в правильной комнате
    if (socketList[socket.id]?.roomId === roomId) {
      // Получаем список участников в комнате
      const room = io.sockets.adapter.rooms.get(roomId);
      if (room) {
        const participants = [];
        room.forEach(clientId => {
          if (socketList[clientId]) {
            participants.push({
              userId: clientId,
              userName: socketList[clientId].userName
            });
          }
        });

        // Отправляем список участников обратно запрашивающему
        socket.emit('FE-participants-list', participants);
      }
    }
  });

  /**
   * Обработка команды заглушить пользователя
   * Только пользователь, который был первым в комнате, может модерировать
   */
  socket.on('BE-mute-user', ({ roomId, targetUser }) => {
    // Проверяем, что это модератор (первый пользователь в комнате)
    if (!isModerator(socket, roomId)) {
      return;
    }

    // Проверяем, что целевой пользователь в той же комнате
    let targetSocketId = null;
    for (const [socketId, userData] of Object.entries(socketList)) {
      if (userData.roomId === roomId && userData.userName === targetUser) {
        targetSocketId = socketId;
        break;
      }
    }

    if (targetSocketId) {
      // Обновляем статус аудио у целевого пользователя
      socketList[targetSocketId].audio = false;

      // Уведомляем целевого пользователя о муте
      io.to(targetSocketId).emit('FE-user-muted', { userName: targetUser });

      // Рассылаем информацию о переключении другим участникам комнаты
      socket.broadcast.to(roomId).emit('FE-toggle-camera', {
        userId: targetSocketId,
        switchTarget: 'audio'
      });
    }
  });

  /**
   * Обработка команды отключить видео пользователя
   * Только пользователь, который был первым в комнате, может модерировать
   */
  socket.on('BE-disable-video', ({ roomId, targetUser }) => {
    // Проверяем, что это модератор (первый пользователь в комнате)
    if (!isModerator(socket, roomId)) {
      return;
    }

    // Проверяем, что целевой пользователь в той же комнате
    let targetSocketId = null;
    for (const [socketId, userData] of Object.entries(socketList)) {
      if (userData.roomId === roomId && userData.userName === targetUser) {
        targetSocketId = socketId;
        break;
      }
    }

    if (targetSocketId) {
      // Обновляем статус видео у целевого пользователя
      socketList[targetSocketId].video = false;

      // Уведомляем целевого пользователя о выключенном видео
      io.to(targetSocketId).emit('FE-user-video-disabled', { userName: targetUser });

      // Рассылаем информацию о переключении другим участникам комнаты
      socket.broadcast.to(roomId).emit('FE-toggle-camera', {
        userId: targetSocketId,
        switchTarget: 'video'
      });
    }
  });

  /**
   * Обработка команды исключить пользователя
   * Только пользователь, который был первым в комнате, может модерировать
   */
  socket.on('BE-kick-user', ({ roomId, targetUser }) => {
    // Проверяем, что это модератор (первый пользователь в комнате)
    if (!isModerator(socket, roomId)) {
      return;
    }

    // Проверяем, что целевой пользователь в той же комнате
    let targetSocketId = null;
    for (const [socketId, userData] of Object.entries(socketList)) {
      if (userData.roomId === roomId && userData.userName === targetUser) {
        targetSocketId = socketId;
        break;
      }
    }

    if (targetSocketId) {
      // Уведомляем целевого пользователя об исключении
      io.to(targetSocketId).emit('FE-user-kicked', { targetUser });

      // Завершаем соединение с исключаемым пользователем
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        handleUserLeave(targetSocket, roomId);
        targetSocket.disconnect();
      }
    }
  });

  /**
   * PING-PONG для проверки живых соединений
   */
  socket.on('ping', () => {
    socket.emit('pong');
  });

  /**
   * Обработка отключения клиента
   * Уведомление других участников и очистка данных
   */
  socket.on('disconnect', (reason) => {
    console.log(`🔴 Отключился ${socket.id}, причина: ${reason}`);

    const userData = socketList[socket.id];
    if (!userData) return;

    const { roomId, userName } = userData;

    // НЕМЕДЛЕННО уведомляем других участников
    if (roomId) {
      socket.broadcast.to(roomId).emit('FE-user-leave', {
        userId: socket.id,
        userName
      });

      socket.leave(roomId);
    }

    // Удаляем из списка СРАЗУ
    delete socketList[socket.id];

    console.log(`✅ Пользователь ${userName} (${socket.id}) полностью удален`);
  });

  /**
   * Обработка ошибок сокет-соединения
   */
  socket.on('error', (error) => {
    console.error(`❌ Socket error для ${socket.id}:`, error);
  });
});

/**
 * Проверяет, является ли пользователь модератором комнаты
 * Модератором считается пользователь, который вошёл в комнату первым
 * @param {Object} socket - Сокет пользователя
 * @param {string} roomId - ID комнаты для проверки
 * @returns {boolean} - true, если пользователь является модератором
 */
function isModerator(socket, roomId) {
  const userData = socketList[socket.id];
  if (!userData || userData.roomId !== roomId) {
    return false;
  }

  // Находим самого раннего участника в комнате
  let earliestUser = null;
  let earliestTime = Infinity;

  for (const [socketId, data] of Object.entries(socketList)) {
    if (data.roomId === roomId && data.joinedAt < earliestTime) {
      earliestTime = data.joinedAt;
      earliestUser = socketId;
    }
  }

  // Проверяем, является ли текущий пользователь самым первым
  return socket.id === earliestUser;
}

/**
 * Вспомогательная функция для обработки выхода пользователя из комнаты
 * Удаляет пользователя из комнаты и уведомляет других участников
 * @param {Object} socket - Сокет пользователя
 * @param {string} roomId - ID комнаты, из которой выходит пользователь
 */
function handleUserLeave(socket, roomId) {
  const userData = socketList[socket.id];
  if (!userData || userData.roomId !== roomId) return;

  const { userName } = userData;

  console.log(`👋 ${userName} покидает комнату ${roomId}`);

  socket.broadcast.to(roomId).emit('FE-user-leave', {
    userId: socket.id,
    userName
  });

  socket.leave(roomId);
  delete socketList[socket.id];

  // Проверяем, остались ли еще участники в комнате
  const room = io.sockets.adapter.rooms.get(roomId);
  if (!room || room.size === 0) {
    // Если комната пуста и это была приватная комната, удаляем пароль
    if (roomPasswords.has(roomId)) {
      roomPasswords.delete(roomId);
      console.log(`🔑 Удален пароль для комнаты ${roomId}, комната пуста`);
    }
  }
}

/**
 * Периодическая очистка "зомби" соединений
 * Удаляет соединения, которые остались в списке, но больше не активны
 */
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

/**
 * Периодическая очистка пустых комнат
 * Удаляет комнаты, в которых нет участников
 */
setInterval(() => {
  const rooms = io.sockets.adapter.rooms;
  let cleaned = 0;

  for (const [roomId, room] of rooms) {
    // Если в комнате нет участников кроме broadcaster'а (который может быть только во время сокет-событий)
    if (room.size === 0) {
      console.log(`🧹 Очистка пустой комнаты: ${roomId}`);
      cleaned++;
      // Socket.IO автоматически удаляет пустые комнаты, но мы можем логировать это событие
    }
  }

  if (cleaned > 0) {
    console.log(`🧹 Очищено пустых комнат: ${cleaned}`);
  }
}, process.env.ROOM_CLEANUP_INTERVAL || 3600000); // По умолчанию раз в час

// Запуск сервера
http.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║   🎥 WebRTC Server (simple-peer)          ║
║   📡 Port: ${PORT}                          ║
║   🌍 Socket.IO: активен                   ║
╚═══════════════════════════════════════════╝
  `);
});

// Подключение keep-alive для поддержания соединения
require('./keep-alive');