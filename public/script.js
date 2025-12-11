"use strict";

// ==========================================
// ВИДЕОКОНФЕРЕНЦИЯ ВЕБ-ПРИЛОЖЕНИЕ
// ==========================================

/**
 * @fileoverview Основной клиентский скрипт для видеоконференц-приложения
 * Реализует WebRTC соединения, управление видеопотоками и интерфейсом
 * @author Qwen Code
 * @version 1.0
 */

// ==========================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ==========================================

/**
 * Имя текущего пользователя, получаемое из URL параметров
 * Если не задано - запрашивается у пользователя
 * @type {string}
 */
const currentUser = new URLSearchParams(window.location.search).get('userName') ||
                    prompt("Введите ваш никнейм:") || "Аноним";

/**
 * Массив для хранения WebRTC peer-соединений
 * @type {Array<Object>}
 */
const peersRef = [];

/**
 * Настройки качества видео
 * @type {Object}
 */
let currentQuality = {
  width: 1280,
  height: 720,
  frameRate: 30
};

/**
 * Объект для хранения состояния видео и аудио пользователей
 * @type {Object}
 */
let userVideoAudio = { localUser: { video: false, audio: true } };

/**
 * Объект MediaStream локального пользователя
 * @type {MediaStream|null}
 */
let userStream = null;

/**
 * DOM элемент для зоны демонстрации экрана
 * @type {HTMLElement}
 */
const screenShareZone = document.getElementById("screen-share-zone");

/**
 * DOM элемент сетки участников
 * @type {HTMLElement}
 */
const participantsGrid = document.getElementById("participants-grid");

/**
 * DOM элемент видео для локального пользователя
 * @type {HTMLVideoElement}
 */
const myVideo = document.createElement("video");
myVideo.muted = true;
myVideo.playsInline = true;

/**
 * Флаг для отслеживания инициализации соединения
 * @type {boolean}
 */
let isInitialized = false;

/**
 * Socket.IO клиентское соединение
 * @type {Object}
 */
const socket = io(window.location.origin, {
  transports: ["websocket", "polling"], // Приоритет сокет-соединения, fallback на polling
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 2000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
  autoConnect: true,
  forceNew: false // Не создавать новое соединение, использовать существующее
});

// Глобальная переменная для доступа к сокету из других частей приложения
window.socket = socket;

// ==========================================
// УТИЛИТЫ
// ==========================================

/**
 * Вычисляет цвет аватара на основе имени пользователя
 * Использует хэширование для консистентного цвета одного и того же имени
 * @param {string} userName - Имя пользователя
 * @returns {number} - Номер цвета из 8 возможных
 */
function getAvatarColor(userName) {
  let hash = 0;
  for (let i = 0; i < userName.length; i++) {
    hash = userName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return (Math.abs(hash) % 8) + 1;
}

/**
 * Получает первую букву имени пользователя для отображения на аватаре
 * Фильтрует эмодзи и специальные символы
 * @param {string} userName - Имя пользователя
 * @returns {string} - Первая буква имени или '?' если имя пустое
 */
function getInitial(userName) {
  if (!userName || userName.trim() === '') return '?';
  // Фильтруем эмодзи и спецсимволы
  const cleanName = userName.replace(/[^\w\s\u0400-\u04FF]/g, '').trim();
  if (cleanName.length === 0) return userName[0];
  return cleanName[0].toUpperCase();
}

// ==========================================
// SOCKET.IO СОБЫТИЯ
// ==========================================

/**
 * Обработчик успешного подключения к серверу
 * Инициализирует комнату при первом подключении
 */
socket.on('connect', () => {
  console.log('✅ Socket подключен:', socket.id);

  // Инициализируем комнату только один раз, при первом подключении
  if (!isInitialized) {
    isInitialized = true;
    startHeartbeat();
    initializeRoom();
  } else {
    console.log('🔄 Переподключение - повторная инициализация НЕ требуется');

    // При переподключении - только переприсоединяемся к комнате
    if (userStream) {
      // Если комната приватная, передаем пароль
      const joinData = {
        roomId: ROOM_ID,
        userName: currentUser
      };

      if (typeof isPrivate !== 'undefined' && isPrivate && typeof password !== 'undefined' && password) {
        joinData.password = password;
      }

      socket.emit('BE-join-room', joinData);
    }
  }
});

/**
 * Обработчик отключения от сервера
 * Очищает интервал heartbeat при отключении
 */
socket.on('disconnect', (reason) => {
  console.log('🔌 Socket отключен:', reason);
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
});

/**
 * Обработчик ошибки подключения к серверу
 * @param {Error} error - Объект ошибки
 */
socket.on('connect_error', (error) => {
  console.error('❌ Ошибка подключения:', error.message);
});

/**
 * Обработчик попытки переподключения
 * @param {number} attemptNumber - Номер попытки переподключения
 */
socket.on('reconnect_attempt', (attemptNumber) => {
  console.log('🔄 Попытка переподключения #', attemptNumber);
});

/**
 * Обработчик успешного переподключения
 * @param {number} attemptNumber - Количество попыток до успешного переподключения
 */
socket.on('reconnect', (attemptNumber) => {
  console.log('✅ Переподключено после', attemptNumber, 'попыток');
  showNotification('✅ Соединение восстановлено', 'success');
});

/**
 * Обработчик неудачного переподключения
 */
socket.on('reconnect_failed', () => {
  console.error('❌ Не удалось переподключиться');
  showNotification('❌ Потеряно соединение с сервером', 'error');
});

// ==========================================
// ИНИЦИАЛИЗАЦИЯ КОМНАТЫ
// ==========================================

/**
 * Инициализирует видеоконференцию
 * Запрашивает доступ к камере и микрофону пользователя, создает локальный поток
 * @async
 * @returns {Promise<void>}
 */
async function initializeRoom() {
  console.log('🚀 Инициализация комнаты...');

  try {
    // Запрашиваем доступ к камере и микрофону с текущими настройками качества
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: currentQuality.width },
        height: { ideal: currentQuality.height },
        frameRate: { ideal: currentQuality.frameRate }
      },
      audio: { echoCancellation: true, noiseSuppression: true }
    });

    // Сохраняем поток и устанавливаем его в локальное видео
    userStream = stream;
    myVideo.srcObject = stream;

    // Отключаем видео по умолчанию
    stream.getVideoTracks()[0].enabled = false;
    userVideoAudio.localUser = { video: false, audio: true };

    // Добавляем локальное видео в интерфейс
    addParticipant(myVideo, currentUser, `local-${socket.id}`, true);

    // Обновляем иконку кнопки отключения видео
    const iconV = document.querySelector("#stopVideo i");
    if (iconV) iconV.className = "fa fa-video-slash";

    // Отправляем на сервер информацию о присоединении
    // Если комната приватная, передаем пароль
    const joinData = {
      roomId: ROOM_ID,
      userName: currentUser
    };

    if (isPrivate && password) {
      joinData.password = password;
    }

    socket.emit('BE-join-room', joinData);

    // Настраиваем слушатели серверных событий
    setupSocketListeners(stream);

    console.log('✅ Комната инициализирована');

  } catch (err) {
    console.error("❌ Ошибка доступа к медиа:", err);
    alert("Нет доступа к камере/микрофону");
  }
}

// ==========================================
// SOCKET СОБЫТИЯ
// ==========================================

function setupSocketListeners(stream) {
  socket.on('FE-user-join', (users) => {
    console.log('📥 FE-user-join:', users);
    
    users.forEach(({ userId, info }) => {
      // ✅ КРИТИЧНО: Пропускаем самого себя!
      if (userId === socket.id) {
        console.log('⏭️ Пропускаем самого себя:', userId);
        return;
      }
      
      // ✅ Проверяем, нет ли уже этого peer
      const existingPeer = peersRef.find(p => p.peerID === userId);
      if (existingPeer) {
        console.log('⏭️ Peer уже существует:', userId);
        return;
      }
      
      console.log('📞 Создаем peer для:', userId, info.userName);
      
      const peer = createPeer(userId, socket.id, stream);
      peer.userName = info.userName;
      peer.peerID = userId;
      
      peersRef.push({ peerID: userId, peer, userName: info.userName });
      
      userVideoAudio[info.userName] = { 
        video: info.video, 
        audio: info.audio 
      };
    });
  });

  socket.on('FE-receive-call', ({ signal, from, info }) => {
    console.log('📞 FE-receive-call от:', from);
    
    // ✅ КРИТИЧНО: Пропускаем самого себя!
    if (from === socket.id) {
      console.log('⏭️ Игнорируем вызов от самого себя');
      return;
    }
    
    // ✅ Проверяем, нет ли уже этого peer
    const existingPeer = peersRef.find(p => p.peerID === from);
    if (existingPeer) {
      console.log('⏭️ Входящий peer уже существует:', from);
      return;
    }
    
    console.log('✅ Принимаем вызов от:', from, info.userName);
    
    const peer = addPeer(signal, from, stream);
    peer.userName = info.userName;
    peer.peerID = from;
    
    peersRef.push({ peerID: from, peer, userName: info.userName });
    
    userVideoAudio[info.userName] = { 
      video: info.video, 
      audio: info.audio 
    };
  });

  socket.on('FE-call-accepted', ({ signal, answerId }) => {
    console.log('✅ FE-call-accepted от:', answerId);
    
    const peerIdx = peersRef.find(p => p.peerID === answerId);
    if (peerIdx) {
      peerIdx.peer.signal(signal);
    } else {
      console.warn('⚠️ Peer не найден для call-accepted:', answerId);
    }
  });

  socket.on('FE-user-leave', ({ userId, userName }) => {
    console.log('👋 FE-user-leave:', userId, userName);
    
    // ✅ Показываем уведомление
    showNotification(`👋 ${userName} вышел из конференции`, 'info');
    
    const peerIdx = peersRef.findIndex(p => p.peerID === userId);
    
    if (peerIdx !== -1) {
      const peer = peersRef[peerIdx];
      const container = document.querySelector(`[data-peer-id="${userId}"]`);
      
      // ✅ Плавное исчезновение
      if (container) {
        container.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        container.style.opacity = '0';
        container.style.transform = 'scale(0.9)';
        
        setTimeout(() => {
          if (peer.peer && typeof peer.peer.destroy === 'function') {
            try {
              peer.peer.destroy();
            } catch (err) {
              console.warn('⚠️ Ошибка при уничтожении peer:', err);
            }
          }
          
          peersRef.splice(peerIdx, 1);
          removeParticipant(userId);
          
          if (userName && userVideoAudio[userName]) {
            delete userVideoAudio[userName];
          }
          
          updateParticipantsGrid();
          
          console.log(`✅ Участник ${userName} удален, осталось: ${peersRef.length}`);
        }, 300);
      } else {
        if (peer.peer && typeof peer.peer.destroy === 'function') {
          peer.peer.destroy();
        }
        peersRef.splice(peerIdx, 1);
        updateParticipantsGrid();
      }
    } else {
      console.warn(`⚠️ Peer ${userId} не найден для удаления`);
    }
  });

  socket.on('FE-toggle-camera', ({ userId, switchTarget }) => {
    const peerIdx = peersRef.find(p => p.peerID === userId);
    
    if (peerIdx) {
      const userName = peerIdx.userName;
      const container = document.querySelector(`[data-peer-id="${userId}"]`);
      
      if (switchTarget === 'video') {
        userVideoAudio[userName].video = !userVideoAudio[userName].video;
        
        if (container) {
          const avatar = container.querySelector('.video-avatar');
          const video = container.querySelector('video');
          
          if (userVideoAudio[userName].video) {
            if (avatar) avatar.classList.add('hidden');
            if (video) video.classList.remove('camera-off');
          } else {
            if (avatar) avatar.classList.remove('hidden');
            if (video) video.classList.add('camera-off');
          }
        }
      } else {
        userVideoAudio[userName].audio = !userVideoAudio[userName].audio;
      }
    }
  });
}

// ==========================================
// WEBRTC PEERS
// ==========================================

function createPeer(userId, caller, stream) {
  const peer = new SimplePeer({
    initiator: true,
    trickle: false,
    stream: stream,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
      ],
      iceCandidatePoolSize: 10
    }
  });

  peer.on('signal', (signal) => {
    socket.emit('BE-call-user', {
      userToCall: userId,
      from: caller,
      signal
    });
  });

  peer.on('stream', (remoteStream) => {
    console.log('📹 Получен поток от:', userId);
    const video = document.createElement('video');
    video.srcObject = remoteStream;
    video.autoplay = true;
    video.playsInline = true;
    
    addParticipant(video, peer.userName, userId, false);
    
    // Проверяем статус камеры
    const hasVideo = userVideoAudio[peer.userName]?.video ?? true;
    if (!hasVideo) {
      setTimeout(() => {
        const container = document.querySelector(`[data-peer-id="${userId}"]`);
        if (container) {
          const avatar = container.querySelector('.video-avatar');
          const videoEl = container.querySelector('video');
          if (avatar) avatar.classList.remove('hidden');
          if (videoEl) videoEl.classList.add('camera-off');
        }
      }, 100);
    }
  });

  // ✅ УЛУЧШЕННАЯ ОБРАБОТКА ОШИБОК
  peer.on('error', (err) => {
    console.error('❌ Peer error:', err.code || err.message || err);
    
    // Не паникуем при "Connection failed" - это нормально при переподключении
    if (err.code === 'ERR_CONNECTION_FAILURE' || err.message?.includes('Connection failed')) {
      console.log('⚠️ Соединение не установлено, возможно пользователь отключился');
      
      // Удаляем peer через 5 секунд если так и не подключился
      setTimeout(() => {
        const peerIdx = peersRef.findIndex(p => p.peerID === userId);
        if (peerIdx !== -1) {
          const peerConnection = peersRef[peerIdx].peer._pc;
          if (peerConnection && peerConnection.connectionState === 'failed') {
            console.log('🗑️ Удаляем неудачное соединение:', userId);
            peersRef.splice(peerIdx, 1);
            removeParticipant(userId);
          }
        }
      }, 5000);
    }
  });

  // Отслеживаем состояние соединения
  peer.on('connect', () => {
    console.log('✅ Peer соединен:', userId);
  });

  peer.on('close', () => {
    console.log('🔌 Peer закрыт:', userId);
  });

  return peer;
}

function addPeer(incomingSignal, callerId, stream) {
  const peer = new SimplePeer({
    initiator: false,
    trickle: false,
    stream: stream,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
      ],
      iceCandidatePoolSize: 10
    }
  });

  peer.on('signal', (signal) => {
    socket.emit('BE-accept-call', { signal, to: callerId });
  });

  peer.on('stream', (remoteStream) => {
    console.log('📹 Получен поток от:', callerId);
    const video = document.createElement('video');
    video.srcObject = remoteStream;
    video.autoplay = true;
    video.playsInline = true;
    
    addParticipant(video, peer.userName, callerId, false);
    
    const hasVideo = userVideoAudio[peer.userName]?.video ?? true;
    if (!hasVideo) {
      setTimeout(() => {
        const container = document.querySelector(`[data-peer-id="${callerId}"]`);
        if (container) {
          const avatar = container.querySelector('.video-avatar');
          const videoEl = container.querySelector('video');
          if (avatar) avatar.classList.remove('hidden');
          if (videoEl) videoEl.classList.add('camera-off');
        }
      }, 100);
    }
  });

  // ✅ УЛУЧШЕННАЯ ОБРАБОТКА ОШИБОК
  peer.on('error', (err) => {
    console.error('❌ Peer error (incoming):', err.code || err.message || err);
    
    if (err.code === 'ERR_CONNECTION_FAILURE' || err.message?.includes('Connection failed')) {
      console.log('⚠️ Входящее соединение не установлено');
      
      setTimeout(() => {
        const peerIdx = peersRef.findIndex(p => p.peerID === callerId);
        if (peerIdx !== -1) {
          const peerConnection = peersRef[peerIdx].peer._pc;
          if (peerConnection && peerConnection.connectionState === 'failed') {
            console.log('🗑️ Удаляем неудачное входящее соединение:', callerId);
            peersRef.splice(peerIdx, 1);
            removeParticipant(callerId);
          }
        }
      }, 5000);
    }
  });

  peer.on('connect', () => {
    console.log('✅ Входящий peer соединен:', callerId);
  });

  peer.on('close', () => {
    console.log('🔌 Входящий peer закрыт:', callerId);
  });

  peer.signal(incomingSignal);

  return peer;
}

// ==========================================
// UI: ДОБАВЛЕНИЕ УЧАСТНИКА
// ==========================================

/**
 * Добавляет участника в интерфейс конференции
 * Создает элементы DOM для отображения видео участника
 * @param {HTMLVideoElement} video - Элемент video для потока участника
 * @param {string} userName - Имя участника
 * @param {string|null} peerId - ID пира (null для локального участника)
 * @param {boolean} isLocal - Является ли участник локальным
 */
function addParticipant(video, userName, peerId, isLocal) {
  // Проверка на существование контейнера для предотвращения дубликатов
  if (peerId) {
    const existing = document.querySelector(`[data-peer-id="${peerId}"]`);
    if (existing) {
      console.warn('⚠️ Контейнер уже существует для:', peerId, '- пропускаем');
      return;
    }
  }

  console.log(`➕ Добавляем участника: ${userName}, peerId: ${peerId}, isLocal: ${isLocal}`);

  // Создаем контейнер участника
  const container = document.createElement("div");
  container.classList.add("participant-container");
  if (peerId) container.setAttribute("data-peer-id", peerId);

  // Создаем аватар с инициалами и цветом
  const avatar = document.createElement("div");
  avatar.className = "video-avatar";
  avatar.setAttribute("data-color", getAvatarColor(userName));
  avatar.textContent = getInitial(userName);

  // Определяем статус камеры и скрываем аватар если камера включена
  const cameraEnabled = isLocal ? userVideoAudio.localUser.video : true;
  if (cameraEnabled) {
    avatar.classList.add('hidden');
  }

  container.appendChild(avatar);

  // Обертка для видео
  const wrapper = document.createElement("div");
  wrapper.className = "video-wrapper";

  // Устанавливаем стили для видео
  video.style.width = "100%";
  video.style.height = "100%";
  video.style.objectFit = "cover";

  if (!cameraEnabled) {
    video.classList.add('camera-off');
  }

  wrapper.appendChild(video);
  container.appendChild(wrapper);

  // Создаем элемент с именем участника
  const nameLabel = document.createElement("div");
  nameLabel.className = "video-name";
  if (isLocal) {
    nameLabel.classList.add('local-user');
  }
  nameLabel.textContent = userName;
  container.appendChild(nameLabel);

  // Добавляем контейнер в сетку участников
  participantsGrid.appendChild(container);
  updateParticipantsGrid();

  // Пытаемся воспроизвести видео
  video.play().catch(err => {
    console.warn("⚠️ Не удалось автовоспроизвести:", err);
  });

  console.log(`✅ Участник добавлен: ${userName} (${isLocal ? 'локальный' : peerId})`);
  console.log(`📊 Всего контейнеров: ${participantsGrid.querySelectorAll('.participant-container').length}`);
}

/**
 * Удаляет участника из интерфейса конференции
 * @param {string} peerId - ID пира для удаления
 */
function removeParticipant(peerId) {
  const container = document.querySelector(`[data-peer-id="${peerId}"]`);
  if (container && container.parentElement === participantsGrid) {
    container.remove();
    updateParticipantsGrid();
  }
}

/**
 * Обновляет стили сетки участников в зависимости от их количества
 * Применяет соответствующие CSS классы для адаптивного отображения
 */
function updateParticipantsGrid() {
  const containers = participantsGrid.querySelectorAll('.participant-container');
  const count = containers.length;

  // Убираем все классы количества участников
  participantsGrid.classList.remove(
    'peers-1', 'peers-2', 'peers-3', 'peers-4',
    'peers-5', 'peers-6', 'peers-7', 'peers-8',
    'peers-9', 'peers-10', 'peers-11', 'peers-12',
    'peers-13', 'peers-14', 'peers-15', 'peers-16',
    'peers-many'
  );

  // Добавляем нужный класс в зависимости от количества участников
  if (count === 0) {
    // Если участников нет - убираем все классы
    return;
  } else if (count <= 16) {
    participantsGrid.classList.add(`peers-${count}`);
  } else {
    participantsGrid.classList.add('peers-many');
  }

  console.log(`🎨 Участников в сетке: ${count}`);
}

// ==========================================
// УПРАВЛЕНИЕ КАМЕРОЙ
// ==========================================

document.getElementById("stopVideo")?.addEventListener("click", () => {
  if (!userStream) return;
  
  const videoTrack = userStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    userVideoAudio.localUser.video = videoTrack.enabled;
    
    const icon = document.querySelector("#stopVideo i");
    if (icon) {
      icon.className = videoTrack.enabled ? "fa fa-video" : "fa fa-video-slash";
    }
    
    const myContainer = participantsGrid.querySelector('.participant-container');
    if (myContainer) {
      const avatar = myContainer.querySelector('.video-avatar');
      const video = myContainer.querySelector('video');
      
      if (videoTrack.enabled) {
        if (avatar) avatar.classList.add('hidden');
        if (video) video.classList.remove('camera-off');
      } else {
        if (avatar) avatar.classList.remove('hidden');
        if (video) video.classList.add('camera-off');
      }
    }
    
    socket.emit('BE-toggle-camera-audio', { 
      roomId: ROOM_ID, 
      switchTarget: 'video' 
    });
  }
});

// ==========================================
// УПРАВЛЕНИЕ МИКРОФОНОМ
// ==========================================

document.getElementById("muteButton")?.addEventListener("click", () => {
  if (!userStream) return;
  
  const audioTrack = userStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    userVideoAudio.localUser.audio = audioTrack.enabled;
    
    socket.emit('BE-toggle-camera-audio', { 
      roomId: ROOM_ID, 
      switchTarget: 'audio' 
    });
    
    const icon = document.querySelector("#muteButton i");
    if (icon) {
      icon.className = audioTrack.enabled ? "fa fa-microphone" : "fa fa-microphone-slash";
    }
  }
});

// ==========================================
// ДЕМОНСТРАЦИЯ ЭКРАНА (ИСПРАВЛЕННАЯ!)
// ==========================================

let screenShareStream = null;
let isScreenSharing = false;

document.getElementById("screenShareButton")?.addEventListener("click", () => {
  if (!isScreenSharing) {
    startScreenShare();
  } else {
    stopScreenShare();
  }
});

async function startScreenShare() {
  try {
    console.log('🖥️ Запрашиваем демонстрацию экрана...');
    
    const stream = await navigator.mediaDevices.getDisplayMedia({ 
      video: { 
        cursor: "always",
        displaySurface: "monitor"
      },
      audio: false
    });
    
    screenShareStream = stream;
    isScreenSharing = true;
    
    // Создаем контейнер для демонстрации
    const screenContainer = document.createElement('div');
    screenContainer.className = 'screen-container';
    screenContainer.id = 'active-screen-share';
    
    const screenVideo = document.createElement('video');
    screenVideo.srcObject = stream;
    screenVideo.muted = true;
    screenVideo.autoplay = true;
    screenVideo.playsInline = true;
    
    const screenLabel = document.createElement('div');
    screenLabel.className = 'screen-label';
    screenLabel.innerHTML = '<i class="fas fa-desktop"></i> Демонстрация экрана';
    
    screenContainer.appendChild(screenVideo);
    screenContainer.appendChild(screenLabel);
    screenShareZone.appendChild(screenContainer);
    
    // Активируем зону демонстрации
    screenShareZone.classList.add('active');
    participantsGrid.classList.add('compact');
    updateParticipantsGrid(); // ✅ Обновляем сетку
    
    // Обновляем кнопку
    const btn = document.getElementById("screenShareButton");
    if (btn) {
      btn.style.background = "rgba(238, 37, 96, 0.4)";
      const icon = btn.querySelector("i");
      if (icon) icon.className = "fa fa-stop-circle";
    }
    
    // Отправляем поток всем участникам
    const screenTrack = stream.getVideoTracks()[0];
    
    // ✅ БЕЗОПАСНАЯ ЗАМЕНА ТРЕКА
    peersRef.forEach(({ peer, peerID }) => {
      if (peer && peer._pc) {
        try {
          const sender = peer._pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender && sender.track) {
            sender.replaceTrack(screenTrack)
              .then(() => {
                console.log('✅ Трек заменен для:', peerID);
              })
              .catch(err => {
                console.warn('⚠️ Не удалось заменить трек для:', peerID, err);
                // Не критичная ошибка, продолжаем работу
              });
          }
        } catch (err) {
          console.warn('⚠️ Ошибка при замене трека:', err);
        }
      }
    });
    
    // Обработка остановки
    screenTrack.onended = () => {
      console.log('🖥️ Демонстрация остановлена пользователем');
      stopScreenShare();
    };
    
    // Воспроизводим локально
    screenVideo.play().catch(err => {
      console.warn('⚠️ Ошибка воспроизведения локального экрана:', err);
    });
    
    console.log('✅ Демонстрация началась');
    
  } catch (err) {
    console.error('❌ Ошибка демонстрации:', err);
    if (err.name === 'NotAllowedError') {
      showNotification('⚠️ Вы отклонили запрос на демонстрацию', 'error');
    } else if (err.name === 'NotFoundError') {
      showNotification('⚠️ Экран для демонстрации не найден', 'error');
    } else {
      showNotification('⚠️ Ошибка демонстрации экрана', 'error');
    }
  }
}

function stopScreenShare() {
  console.log('🛑 Останавливаем демонстрацию');
  
  if (screenShareStream) {
    screenShareStream.getTracks().forEach(track => track.stop());
    screenShareStream = null;
  }
  
  // Удаляем контейнер демонстрации
  const screenContainer = document.getElementById('active-screen-share');
  if (screenContainer) {
    screenContainer.remove();
  }
  
  // Деактивируем зону
  screenShareZone.classList.remove('active');
  participantsGrid.classList.remove('compact');
  updateParticipantsGrid(); // ✅ Обновляем сетку
  
  // Возвращаем камеру
  if (userStream) {
    const videoTrack = userStream.getVideoTracks()[0];
    
    // ✅ БЕЗОПАСНЫЙ ВОЗВРАТ ТРЕКОВ
    peersRef.forEach(({ peer, peerID }) => {
      if (peer && peer._pc) {
        try {
          const sender = peer._pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender && videoTrack) {
            sender.replaceTrack(videoTrack)
              .then(() => {
                console.log('✅ Камера возвращена для:', peerID);
              })
              .catch(err => {
                console.warn('⚠️ Не удалось вернуть камеру для:', peerID, err);
              });
          }
        } catch (err) {
          console.warn('⚠️ Ошибка при возврате камеры:', err);
        }
      }
    });
  }
  
  // Обновляем кнопку
  const btn = document.getElementById("screenShareButton");
  if (btn) {
    btn.style.background = "";
    const icon = btn.querySelector("i");
    if (icon) icon.className = "fa fa-desktop";
  }
  
  isScreenSharing = false;
}

// ==========================================
// КОПИРОВАНИЕ ССЫЛКИ
// ==========================================

document.getElementById("inviteButton")?.addEventListener("click", () => {
  const roomUrl = `${window.location.origin}/room/${ROOM_ID}`;
  
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(roomUrl)
      .then(() => {
        showNotification('✅ Ссылка скопирована!', 'success');
      })
      .catch(err => {
        console.error('Ошибка копирования:', err);
        fallbackCopyLink(roomUrl);
      });
  } else {
    fallbackCopyLink(roomUrl);
  }
});

function fallbackCopyLink(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  
  try {
    document.execCommand('copy');
    showNotification('✅ Ссылка скопирована!', 'success');
  } catch (err) {
    prompt('Скопируйте ссылку вручную:', text);
  }
  
  document.body.removeChild(textarea);
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#ff4444' : '#2196F3'};
    color: white;
    padding: 15px 30px;
    border-radius: 8px;
    font-size: 16px;
    font-weight: 600;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: slideDown 0.3s ease;
  `;
  notification.textContent = message;
  
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideDown {
      from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
  `;
  document.head.appendChild(style);
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 0.3s ease';
    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
      if (document.head.contains(style)) {
        document.head.removeChild(style);
      }
    }, 300);
  }, 3000);
}

// ==========================================
// ВЫХОД
// ==========================================

document.getElementById("exit-conference-btn")?.addEventListener("click", () => {
  if (confirm("Выйти из конференции?")) {
    socket.emit('BE-leave-room', { roomId: ROOM_ID });
    window.location.href = "/";
  }
});

// ==========================================
// ПОДНЯТЬ РУКУ
// ==========================================

let isHandRaised = false;
const raiseHandBtn = document.getElementById("raiseHandBtn");

if (raiseHandBtn) {
  raiseHandBtn.addEventListener("click", () => {
    isHandRaised = !isHandRaised;
    if (isHandRaised) {
      raiseHandBtn.style.background = "rgba(255, 193, 7, 0.4)";
      const icon = raiseHandBtn.querySelector("i");
      if (icon) icon.className = "fas fa-hand-paper";
      socket.emit('BE-hand-raised', { roomId: ROOM_ID, userName: currentUser });
      showNotification(`${currentUser} поднял(а) руку`, 'info');
    } else {
      raiseHandBtn.style.background = "";
      const icon = raiseHandBtn.querySelector("i");
      if (icon) icon.className = "fas fa-hand-paper";
      socket.emit('BE-hand-lowered', { roomId: ROOM_ID, userName: currentUser });
    }
  });
}

// Обработка события поднятия руки другим пользователем
socket.on('FE-hand-raised', (data) => {
  showNotification(`${data.userName} поднял(а) руку`, 'info');
});

// Обработка события опускания руки другим пользователем
socket.on('FE-hand-lowered', (data) => {
  console.log(`${data.userName} опустил(а) руку`);
});

// ==========================================
// ЧАТ
// ==========================================

const chatSection = document.querySelector(".main__right");
if (chatSection) chatSection.style.display = "none";

document.getElementById("toggleChat")?.addEventListener("click", () => {
  if (chatSection) {
    chatSection.style.display = chatSection.style.display === "none" ? "flex" : "none";
  }
});

socket.on('FE-receive-message', ({ msg, sender }) => {
  const messagesContainer = document.querySelector(".messages");
  if (messagesContainer) {
    // Экранируем HTML/XSS в сообщении и имени отправителя
    const sanitizedMsg = msg.replace(/[<>'"&]/g, function(match) {
      return {
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '&': '&amp;'
      }[match];
    });

    const sanitizedSender = sender.replace(/[<>'"&]/g, function(match) {
      return {
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '&': '&amp;'
      }[match];
    });

    const div = document.createElement("div");
    div.classList.add("message");
    div.innerHTML = `<strong>${sanitizedSender}:</strong> ${sanitizedMsg}`;
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
});

document.getElementById("send")?.addEventListener("click", () => {
  const input = document.getElementById("chat_message");
  const text = input?.value.trim();
  if (text) {
    socket.emit('BE-send-message', { 
      roomId: ROOM_ID, 
      msg: text, 
      sender: currentUser 
    });
    input.value = "";
  }
});

document.getElementById("chat_message")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("send")?.click();
  }
});

document.querySelectorAll(".emoji-button").forEach(btn => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    const emoji = btn.getAttribute("data-emoji");
    const input = document.getElementById("chat_message");
    
    if (input) {
      input.value += emoji;
      input.focus();
    }
  });
});

// ==========================================
// ИНДИКАТОР СОСТОЯНИЯ СОЕДИНЕНИЯ
// ==========================================

// Добавляем индикатор соединения в заголовок
function addConnectionIndicator() {
  const header = document.querySelector('.header');
  if (header) {
    const indicatorContainer = document.createElement('div');
    indicatorContainer.id = 'connection-indicator-container';
    indicatorContainer.style.cssText = `
      position: absolute;
      top: 10px;
      right: 10px;
      display: flex;
      align-items: center;
      gap: 8px;
    `;

    const indicator = document.createElement('div');
    indicator.id = 'connection-status';
    indicator.className = 'connection-indicator';
    indicator.title = 'Соединение установлено';

    const statusText = document.createElement('span');
    statusText.id = 'connection-status-text';
    statusText.textContent = 'Подключено';
    statusText.style.color = '#4CAF50';
    statusText.style.fontSize = '14px';

    indicatorContainer.appendChild(indicator);
    indicatorContainer.appendChild(statusText);
    header.appendChild(indicatorContainer);
  }
}

addConnectionIndicator();

// ==========================================
// HEARTBEAT - ТОЛЬКО ОДИН РАЗ!
// ==========================================

let heartbeatInterval = null;
let pingStartTime = 0;

function startHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }

  heartbeatInterval = setInterval(() => {
    if (socket && socket.connected) {
      pingStartTime = Date.now();
      socket.emit('ping');
    } else {
      console.warn('⚠️ Socket не подключен, пропускаем ping');
      updateConnectionStatus('отсутствует', '#f44336');
    }
  }, 30000);

  console.log('💓 Heartbeat запущен');
}

// Обработчик pong
socket.on('pong', () => {
  const latency = Date.now() - pingStartTime;
  if (latency < 200) {
    updateConnectionStatus('отличное', '#4CAF50');
  } else if (latency < 500) {
    updateConnectionStatus('хорошее', '#FFC107');
  } else {
    updateConnectionStatus('слабое', '#f44336');
  }
});

function updateConnectionStatus(statusText, color) {
  const statusElement = document.getElementById('connection-status-text');
  const indicator = document.getElementById('connection-status');

  if (statusElement) {
    statusElement.textContent = statusText;
    statusElement.style.color = color;
  }

  if (indicator) {
    indicator.style.background = color;
    indicator.style.boxShadow = `0 0 8px ${color}80`;
  }
}

// Обработчики состояния сокета
socket.on('connect', () => {
  updateConnectionStatus('подключено', '#4CAF50');
});

socket.on('disconnect', (reason) => {
  updateConnectionStatus('отключено', '#f44336');
  showNotification('Соединение с сервером потеряно', 'error');
});

socket.on('reconnect', (attemptNumber) => {
  updateConnectionStatus('восстановлено', '#4CAF50');
  showNotification(`Соединение восстановлено после ${attemptNumber} попыток`, 'success');
});

// ==========================================
// ФУНКЦИИ МОДЕРАЦИИ
// ==========================================

// Открытие модального окна модерации
document.getElementById("moderationBtn")?.addEventListener("click", () => {
  // Сначала запросим список участников
  socket.emit('BE-get-participants', { roomId: ROOM_ID });
});

// Закрытие модального окна модерации
document.getElementById("closeModerationModal")?.addEventListener("click", () => {
  document.getElementById("moderationModal").style.display = "none";
});

// Обработка получения списка участников
socket.on('FE-participants-list', (participants) => {
  const participantsList = document.getElementById("participantsList");
  if (!participantsList) return;

  // Очищаем текущий список
  participantsList.innerHTML = '';

  // Добавляем каждого участника с кнопками модерации (кроме себя)
  participants.forEach(participant => {
    if (participant.userName !== currentUser) {
      const participantDiv = document.createElement("div");
      participantDiv.className = "participant-moderation-item";
      participantDiv.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px;
        margin: 5px 0;
        background: #2c2c2c;
        border-radius: 6px;
        border: 1px solid #3a3a3a;
      `;

      participantDiv.innerHTML = `
        <span>${participant.userName}</span>
        <div class="moderation-controls">
          <button class="moderation-btn mute-btn" data-username="${participant.userName}" title="Заглушить аудио">
            <i class="fas fa-microphone-slash"></i>
          </button>
          <button class="moderation-btn video-btn" data-username="${participant.userName}" title="Выключить видео">
            <i class="fas fa-video-slash"></i>
          </button>
          <button class="moderation-btn kick-btn" data-username="${participant.userName}" title="Исключить">
            <i class="fas fa-user-times"></i>
          </button>
        </div>
      `;

      participantsList.appendChild(participantDiv);
    }
  });

  // Показываем модальное окно
  document.getElementById("moderationModal").style.display = "block";

  // Добавляем обработчики для кнопок модерации
  document.querySelectorAll(".mute-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const userName = e.target.closest('.moderation-btn').dataset.username;
      socket.emit('BE-mute-user', { roomId: ROOM_ID, targetUser: userName });
    });
  });

  document.querySelectorAll(".video-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const userName = e.target.closest('.moderation-btn').dataset.username;
      socket.emit('BE-disable-video', { roomId: ROOM_ID, targetUser: userName });
    });
  });

  document.querySelectorAll(".kick-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const userName = e.target.closest('.moderation-btn').dataset.username;
      if (confirm(`Вы действительно хотите исключить пользователя ${userName}?`)) {
        socket.emit('BE-kick-user', { roomId: ROOM_ID, targetUser: userName });
      }
    });
  });
});

// Обработка команд модерации
socket.on('FE-user-muted', (data) => {
  showNotification(`Аудио пользователя ${data.userName} отключено модератором`, 'info');
});

socket.on('FE-user-video-disabled', (data) => {
  showNotification(`Видео пользователя ${data.userName} отключено модератором`, 'info');
});

socket.on('FE-user-kicked', (data) => {
  if (data.targetUser === currentUser) {
    showNotification('Вас исключили из конференции', 'error');
    // Перенаправляем на главную страницу
    setTimeout(() => {
      window.location.href = "/";
    }, 2000);
  } else {
    showNotification(`Пользователь ${data.targetUser} исключен из конференции`, 'info');
  }
});

// ==========================================
// ФУНКЦИОНАЛ ЗАПИСИ КОНФЕРЕНЦИИ
// ==========================================

let mediaRecorder;
let recordedChunks = [];
let isRecording = false;

// Обработчик кнопки записи
document.getElementById("recordBtn")?.addEventListener("click", async () => {
  if (!isRecording) {
    await startRecording();
  } else {
    stopRecording();
  }
});

async function startRecording() {
  try {
    // Для записи будем захватывать локальный видеопоток
    if (!userStream) {
      showNotification('Нет активного видеопотока для записи', 'error');
      return;
    }

    // Создаем комбинированный поток для записи (аудио + видео)
    const audioTracks = userStream.getAudioTracks();
    const videoTracks = userStream.getVideoTracks();

    if (audioTracks.length === 0 && videoTracks.length === 0) {
      showNotification('Нет аудио или видео для записи', 'error');
      return;
    }

    // Создаем комбинированный поток
    const combinedStream = new MediaStream([...audioTracks, ...videoTracks]);

    // Создаем MediaRecorder
    mediaRecorder = new MediaRecorder(combinedStream, {
      mimeType: 'video/webm;codecs=vp9,opus' // Поддерживаемый формат
    });

    recordedChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      // Создаем видеофайл из записанных данных
      const blob = new Blob(recordedChunks, { type: 'video/webm' });

      // Создаем URL для скачивания
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `conference-recording-${new Date().toISOString().slice(0, 19)}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Освобождаем ресурсы
      URL.revokeObjectURL(url);

      showNotification('Запись конференции завершена и скачивается', 'success');
    };

    mediaRecorder.start();
    isRecording = true;

    // Обновляем кнопку записи
    const recordBtn = document.getElementById("recordBtn");
    if (recordBtn) {
      recordBtn.style.background = "rgba(238, 37, 96, 0.4)";
      const icon = recordBtn.querySelector("i");
      if (icon) icon.className = "fas fa-stop";
    }

    showNotification('Начата запись конференции', 'info');
  } catch (error) {
    console.error('Ошибка при начале записи:', error);
    showNotification('Ошибка при начале записи конференции', 'error');
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    isRecording = false;

    // Обновляем кнопку записи
    const recordBtn = document.getElementById("recordBtn");
    if (recordBtn) {
      recordBtn.style.background = "";
      const icon = recordBtn.querySelector("i");
      if (icon) icon.className = "fas fa-record-vinyl";
    }
  }
}

// ==========================================
// НАСТРОЙКИ КАЧЕСТВА ВИДЕО
// ==========================================

// Показать/скрыть меню выбора качества
document.getElementById("qualityBtn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const dropdown = document.getElementById("qualityDropdown");
  if (dropdown) {
    dropdown.style.display = dropdown.style.display === "block" ? "none" : "block";
  }
});

// Обработчики выбора качества
document.getElementById("qualityLow")?.addEventListener("click", () => {
  setVideoQuality({ width: 320, height: 240, frameRate: 15 });
  updateActiveQualityButton("qualityLow");
});

document.getElementById("qualityMedium")?.addEventListener("click", () => {
  setVideoQuality({ width: 640, height: 480, frameRate: 24 });
  updateActiveQualityButton("qualityMedium");
});

document.getElementById("qualityHigh")?.addEventListener("click", () => {
  setVideoQuality({ width: 1280, height: 720, frameRate: 30 });
  updateActiveQualityButton("qualityHigh");
});

document.getElementById("qualityUltra")?.addEventListener("click", () => {
  setVideoQuality({ width: 1920, height: 1080, frameRate: 30 });
  updateActiveQualityButton("qualityUltra");
});

// Функция обновления активной кнопки качества
function updateActiveQualityButton(activeId) {
  document.querySelectorAll('.quality-option').forEach(btn => {
    btn.classList.remove('active');
  });

  const activeBtn = document.getElementById(activeId);
  if (activeBtn) {
    activeBtn.classList.add('active');
  }
}

// Функция установки качества видео
async function setVideoQuality(quality) {
  currentQuality = quality;

  try {
    // Получаем новые настройки для видеопотока
    const constraints = {
      video: {
        width: { ideal: quality.width },
        height: { ideal: quality.height },
        frameRate: { ideal: quality.frameRate }
      },
      audio: { echoCancellation: true, noiseSuppression: true }
    };

    // Получаем новый видеопоток с нужным качеством
    const newStream = await navigator.mediaDevices.getUserMedia(constraints);

    // Обновляем локальный поток
    const oldStream = userStream;
    userStream = newStream;

    // Обновляем отображение локального видео
    myVideo.srcObject = newStream;

    // Обновляем поток для всех peer-соединений
    for (const peerRef of peersRef) {
      const peer = peerRef.peer;
      if (peer) {
        // Находим видео дорожку в новом потоке
        const videoTrack = newStream.getVideoTracks()[0];

        // Находим отправителя видео дорожки
        const senders = peer._pc.getSenders();
        const videoSender = senders.find(sender => sender.track && sender.track.kind === 'video');

        if (videoSender) {
          // Заменяем дорожку в существующем соединении
          videoSender.replaceTrack(videoTrack);
        }
      }
    }

    // Останавливаем старый поток
    if (oldStream) {
      oldStream.getTracks().forEach(track => track.stop());
    }

    showNotification(`Качество видео изменено на ${quality.width}x${quality.height}`, 'success');
  } catch (error) {
    console.error('Ошибка при изменении качества видео:', error);
    showNotification('Ошибка при изменении качества видео', 'error');
  }
}

// Закрытие меню при клике вне его
document.addEventListener('click', (event) => {
  const dropdown = document.getElementById("qualityDropdown");
  const qualityBtn = document.getElementById("qualityBtn");

  if (dropdown && !dropdown.contains(event.target) &&
      qualityBtn && !qualityBtn.contains(event.target)) {
    dropdown.style.display = "none";
  }
});

// ✅ Гарантированная отправка при закрытии вкладки
window.addEventListener("beforeunload", (e) => {
  console.log('👋 Закрытие вкладки - отправляем leave');

  // Останавливаем все медиапотоки
  if (userStream) {
    userStream.getTracks().forEach(track => track.stop());
  }

  if (screenShareStream) {
    screenShareStream.getTracks().forEach(track => track.stop());
  }

  // Уничтожаем все peer соединения
  peersRef.forEach(({ peer }) => {
    if (peer && typeof peer.destroy === 'function') {
      peer.destroy();
    }
  });

  // ✅ КРИТИЧНО: Используем sendBeacon для гарантированной отправки
  if (navigator.sendBeacon) {
    const data = JSON.stringify({
      socketId: socket.id,
      roomId: ROOM_ID,
      userName: currentUser
    });

    // sendBeacon гарантированно отправит даже при закрытии вкладки
    navigator.sendBeacon(`${window.location.origin}/api/user-leave`, data);
  }

  // Также пытаемся отправить через socket (может не успеть)
  if (socket && socket.connected) {
    socket.emit('BE-leave-room', { roomId: ROOM_ID });
    socket.disconnect();
  }
});

// ✅ Также обрабатываем видимость страницы
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === 'hidden') {
    console.log('📄 Страница скрыта');
    // Можно отправить heartbeat или логику паузы
  } else {
    console.log('📄 Страница видима');
  }
});

// ✅ Обработка потери соединения
socket.on('connect_error', (error) => {
  console.error('❌ Ошибка подключения:', error);
  showNotification('⚠️ Потеряно соединение с сервером', 'error');
});

socket.on('reconnect', (attemptNumber) => {
  console.log('✅ Переподключено после', attemptNumber, 'попыток');
  showNotification('✅ Соединение восстановлено', 'success');
});