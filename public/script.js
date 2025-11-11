"use strict";

//========================================
// ИНИЦИАЛИЗАЦИЯ И ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
//========================================

let calls = {};
let screenShareCalls = {};
let localScreenShareContainerId = null;
let myVideoStream = null;
let isScreenSharing = false;
let screenShareStream = null;
let peer = null;
let socket = null;
const participants = {};
const pendingToConnect = new Set();

let urlParams = new URLSearchParams(window.location.search);
let userName = urlParams.get('userName');
if (!userName || userName.trim() === "") {
  userName = prompt("Введите ваш никнейм:") || "Аноним";
}

const LOG_LEVELS = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
let currentLogLevel = LOG_LEVELS.INFO;

function log(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = type === 'error' ? '❌' : type === 'warn' ? '⚠️' : 'ℹ️';
  const level = type === 'error' ? LOG_LEVELS.ERROR : type === 'warn' ? LOG_LEVELS.WARN : LOG_LEVELS.INFO;
  if (level <= currentLogLevel) {
    console.log(`[${timestamp}] ${prefix}`, message);
  }
}

// Двухфлажковая синхронизация
let socketReady = false;
let peerReady = false;
let joined = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

// ✅ ИСПРАВЛЕНИЕ #6: tryJoin теперь асинхронная и ждет поток ПЕРЕД join-room
async function tryJoin() {
  if (!joined && socketReady && peerReady && peer && peer.id) {
    joined = true;
    console.log("🚀 Получаем доступ к медиа перед join-room");
    
    // КРИТИЧНО: Сначала получаем медиапоток
    await initLocalStream();
    
    console.log("📡 Отправляем join-room:", { roomId: ROOM_ID, peerId: peer.id, userName });
    socket.emit("join-room", ROOM_ID, peer.id, userName);
  } else {
    console.log('⏳ Ожидание готовности:', { socketReady, peerReady, joined, hasPeer: !!peer, peerId: peer?.id });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Ваш браузер не поддерживает WebRTC.');
    return;
  }

  if (!window.Peer) {
    alert('PeerJS не загружен.');
    return;
  }

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (isMobile) {
    console.log('📱 Мобильное устройство');
  }

  // DOM элементы
  const videoGrid = document.getElementById("video-grid");
  const myVideo = document.createElement("video");
  myVideo.muted = true;
  myVideo.playsInline = true;

  const chatSection = document.querySelector(".main__right");
  const toggleChat = document.getElementById("toggleChat");
  const stopVideo = document.getElementById("stopVideo");
  const muteButton = document.getElementById("muteButton");
  const screenShareButton = document.getElementById("screenShareButton");
  const inviteButton = document.getElementById("inviteButton");
  const exitConferenceBtn = document.getElementById("exit-conference-btn");

  if (chatSection) chatSection.style.display = "none";

  if (toggleChat && chatSection) {
    toggleChat.addEventListener("click", () => {
      const isHidden = chatSection.style.display === "none";
      chatSection.style.display = isHidden ? "flex" : "none";
      toggleChat.title = isHidden ? "Скрыть чат" : "Открыть чат";
    });
  }

  // ✅ ИСПРАВЛЕНИЕ #2: Инициализация Socket.IO + сохраняем в window
  socket = io(window.location.origin, {
    transports: ["polling"],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2000,
    timeout: 30000
  });

  window.socket = socket; // ← КРИТИЧНО для whiteboard.js!

  socket.on('connect', () => {
    console.log('✅ Socket.IO подключен:', socket.id);
    socketReady = true;
    reconnectAttempts = 0;
    tryJoin();
  });

  socket.on('connect_error', (error) => {
    console.error('❌ Socket.IO ошибка:', error);
    reconnectAttempts++;
    if (reconnectAttempts >= maxReconnectAttempts) {
      log('Не удалось подключиться к серверу.', 'error');
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('🔌 Socket.IO отключен:', reason);
    socketReady = false;
  });

  // Инициализация PeerJS
  peer = new Peer(undefined, {
    host: PEER_CONFIG.host,
    port: PEER_CONFIG.port,
    path: PEER_CONFIG.path,
    secure: PEER_CONFIG.secure,
    config: PEER_CONFIG.config,
    debug: 2
  });

  // ВАЖНО: регистрируем обработчик входящих вызовов ДО join-room
  peer.on("call", handleIncomingCall);

  peer.on("open", (id) => {
    log("✅ PeerJS подключен: " + id);
    participants[id] = userName;
    peerReady = true;
    reconnectAttempts = 0;
    tryJoin();
  });

  peer.on("error", (error) => {
    console.error("❌ PeerJS ошибка:", error);
    if (error.type === 'network' || error.type === 'disconnected' || error.type === 'server-error') {
      reconnectAttempts++;
      if (reconnectAttempts < maxReconnectAttempts) {
        setTimeout(() => {
          if (peer && peer.disconnected) {
            console.log("🔄 Переподключаем PeerJS...");
            peer.reconnect();
          }
        }, Math.min(2000 * reconnectAttempts, 15000));
      }
    }
  });

  peer.on("disconnected", () => {
    console.log("🔌 PeerJS отключен");
    peerReady = false;
    setTimeout(() => {
      if (peer && !peer.destroyed) {
        console.log("🔄 Переподключаем PeerJS...");
        peer.reconnect();
      }
    }, 1000);
  });

  // Socket события
  socket.on("room-users", (users) => {
    console.log("📥 room-users:", users);
    users.forEach(({ userId, userName: uName }) => {
      participants[userId] = uName || "Участник";
      if (userId === peer?.id) return; // Не звоним сами себе
      
      if (myVideoStream) {
        setTimeout(() => connectToNewUser(userId, myVideoStream, participants[userId]), 300);
      } else {
        pendingToConnect.add(userId);
      }
    });
  });

  socket.on("user-list", (list) => {
    console.log("📋 user-list:", list);
  });

  socket.on("user-connected", (userId, connectedUserName) => {
    console.log("👤 user-connected:", userId, connectedUserName);
    participants[userId] = connectedUserName;
    if (userId === peer?.id) return;
    
    if (myVideoStream) {
      setTimeout(() => connectToNewUser(userId, myVideoStream, connectedUserName), 500);
    } else {
      pendingToConnect.add(userId);
    }
  });

  socket.on("user-disconnected", (userId) => {
    console.log("👋 user-disconnected:", userId);
    if (calls[userId]) {
      calls[userId].close();
      delete calls[userId];
    }
    removeVideoContainerByPeerId(userId);
    delete participants[userId];
  });

  socket.on("screenShareStopped", (initiatorPeerId) => {
    console.log("🖥️ screenShareStopped:", initiatorPeerId);
    removeVideoContainerByPeerId(initiatorPeerId + "-screen");
  });

  // Чат
  const sendButton = document.getElementById("send");
  const chatInput = document.getElementById("chat_message");
  const messagesContainer = document.querySelector(".messages");

  function sendMessage() {
    const text = chatInput?.value.trim();
    if (!text) return;
    socket.emit("message", { sender: userName, text });
    chatInput.value = "";
  }

  if (sendButton) sendButton.addEventListener("click", sendMessage);
  if (chatInput) {
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); sendMessage(); }
    });
  }

  socket.on("messageHistory", (history) => {
    if (!messagesContainer) return;
    messagesContainer.innerHTML = "";
    history.forEach(addMessageToChat);
  });

  socket.on("createMessage", addMessageToChat);

  function addMessageToChat(msg) {
    if (!messagesContainer) return;
    const div = document.createElement("div");
    div.classList.add("message");
    div.innerHTML = `<strong>${msg.sender}:</strong> ${msg.text}`;
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  document.querySelectorAll(".emoji-button").forEach(btn => {
    btn.addEventListener("click", () => {
      const emoji = btn.getAttribute("data-emoji");
      socket.emit("message", { sender: userName, text: emoji });
    });
  });

  // Утилиты
  function toggleFullscreen(el) {
    if (!document.fullscreenElement) el.requestFullscreen().catch(() => {});
    else document.exitFullscreen();
  }

  function removeVideoContainerByPeerId(peerId) {
    const c = document.querySelector(`.video-container[data-peer-id="${peerId}"]`);
    if (c) {
      console.log("🗑️ Удаляем контейнер:", peerId);
      c.remove();
    }
  }

  function createVideoElement() {
    const v = document.createElement("video");
    v.autoplay = true;
    v.playsInline = true;
    return v;
  }

  function addVideoStream(video, stream, isLocal = false, displayName = "", peerId = null, options = {}) {
    const { unmuteOverlay = false } = options;
    if (!videoGrid) return;

    let container = peerId ? document.querySelector(`.video-container[data-peer-id="${peerId}"]`) : null;
    if (!container) {
      container = document.createElement("div");
      container.classList.add("video-container");
      if (peerId) container.setAttribute("data-peer-id", peerId);

      const label = document.createElement("div");
      label.className = "video-placeholder";
      label.textContent = displayName || (isLocal ? "Вы" : "Участник");
      container.appendChild(label);

      const wrapper = document.createElement("div");
      wrapper.className = "video-wrapper";
      wrapper.style.position = "relative";
      wrapper.appendChild(video);
      container.appendChild(wrapper);

      video.playsInline = true;
      video.autoplay = true;
      video.muted = isLocal || unmuteOverlay;

      videoGrid.appendChild(container);
      container.addEventListener("dblclick", () => toggleFullscreen(container));
    }

    if (stream) video.srcObject = stream;

    const tryPlay = () => {
      const p = video.play();
      if (p) p.catch((err) => { 
        console.warn("⚠️ Не удалось автовоспроизвести видео:", err);
        if (!isLocal && unmuteOverlay) showTapToUnmute(container, video); 
      });
    };

    if (video.readyState >= 2) tryPlay();
    else video.onloadedmetadata = tryPlay;
  }

  function showTapToUnmute(container, video) {
    if (container.querySelector(".tap-to-unmute")) return;
    const ov = document.createElement("div");
    ov.className = "tap-to-unmute";
    ov.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.7);color:#fff;font-weight:600;cursor:pointer;z-index:50;font-size:18px;text-align:center;padding:20px;`;
    ov.innerHTML = "🔇<br>Нажмите, чтобы включить звук/видео";
    ov.addEventListener("click", async () => {
      try { 
        video.muted = false; 
        await video.play(); 
        ov.remove(); 
      } catch (e) {
        console.error("Не удалось воспроизвести:", e);
      }
    });
    container.appendChild(ov);
  }

  // ✅ ИСПРАВЛЕНИЕ #5: Улучшенная connectToNewUser с обработкой зависших соединений
  function connectToNewUser(userId, stream, connectedUserName) {
    if (!userId || !stream || !peer || peer.disconnected) {
      console.warn("⚠️ Невозможно подключиться:", { userId, hasStream: !!stream, hasPeer: !!peer, peerDisconnected: peer?.disconnected });
      return;
    }

    // Проверяем, не истек ли старый вызов
    if (calls[userId]) {
      const existingCall = calls[userId];
      const pc = existingCall.peerConnection || existingCall._pc;
      
      // Если соединение уже активно - не звоним повторно
      if (pc && (pc.connectionState === 'connected' || pc.connectionState === 'connecting')) {
        console.log(`✅ Уже подключены к ${userId} (${pc.connectionState})`);
        return;
      } else {
        // Старый вызов завис - закрываем его
        console.log(`⚠️ Закрываем зависший вызов к ${userId}`);
        existingCall.close();
        delete calls[userId];
      }
    }

    try {
      console.log(`📞 Звоним ${userId} (${connectedUserName})`);
      const call = peer.call(userId, stream, { metadata: { userName } });
      if (!call) {
        console.error("❌ peer.call вернул null");
        return;
      }

      const pc = call.peerConnection || call._pc;
      if (pc) {
        pc.addEventListener('iceconnectionstatechange', () => {
          console.log(`🧊 ICE ${userId}:`, pc.iceConnectionState);
          // Если соединение не установилось - пробуем заново
          if (pc.iceConnectionState === 'failed') {
            console.error(`❌ ICE failed для ${userId}, переподключаемся через 2 сек...`);
            delete calls[userId];
            setTimeout(() => connectToNewUser(userId, stream, connectedUserName), 2000);
          }
        });
        pc.addEventListener('connectionstatechange', () => {
          console.log(`🔗 Connection ${userId}:`, pc.connectionState);
        });
      }

      const video = createVideoElement();
      
      call.on("stream", (remoteStream) => {
        console.log("📹 Получен поток от", userId);
        addVideoStream(video, remoteStream, false, connectedUserName, userId, { unmuteOverlay: true });
      });
      
      call.on("error", (err) => { 
        console.error("❌ Ошибка вызова:", err); 
        call.close(); 
        delete calls[userId];
      });
      
      call.on("close", () => {
        console.log("📴 Вызов закрыт:", userId);
        removeVideoContainerByPeerId(userId);
        delete calls[userId];
      });

      calls[userId] = call;
    } catch (e) { 
      console.error("❌ Исключение в connectToNewUser:", e); 
    }
  }

  // ✅ ИСПРАВЛЕНИЕ #4: Улучшенная handleIncomingCall с ожиданием потока
  async function handleIncomingCall(call) {
    console.log("📞 Входящий вызов от:", call.peer, "Метаданные:", call.metadata);
    
    if (calls[call.peer]) {
      console.warn("⚠️ Вызов от", call.peer, "уже существует, игнорируем дубликат");
      return;
    }
    
    calls[call.peer] = call;

    // Обработка демонстрации экрана
    if (call.metadata?.type === "screen-share") {
      call.answer();
      const vid = createVideoElement();
      const cid = call.peer + "-screen";
      call.on("stream", (s) => {
        console.log("🖥️ Получен поток демонстрации от", call.peer);
        addVideoStream(vid, s, false, "🖥️ Демонстрация экрана", cid, { unmuteOverlay: true });
      });
      call.on("close", () => removeVideoContainerByPeerId(cid));
      return;
    }

    // КРИТИЧНО: Ждем, пока myVideoStream будет готов
    if (!myVideoStream) {
      console.warn("⚠️ Входящий вызов, но поток еще не готов. Ждем...");
      let attempts = 0;
      await new Promise(resolve => {
        const checkStream = setInterval(() => {
          attempts++;
          if (myVideoStream) {
            console.log("✅ Поток готов после", attempts * 100, "мс");
            clearInterval(checkStream);
            resolve();
          }
          if (attempts > 50) { // 5 секунд максимум
            console.error("❌ Таймаут ожидания потока");
            clearInterval(checkStream);
            resolve();
          }
        }, 100);
      });
    }

    // Отвечаем на вызов
    call.answer(myVideoStream);
    console.log("✅ Ответили на вызов от", call.peer);
    
    const vid = createVideoElement();
    addVideoStream(vid, null, false, participants[call.peer] || "Участник", call.peer, { unmuteOverlay: true });
    
    call.on("stream", (remoteStream) => {
      console.log("📹 Получен поток от", call.peer);
      addVideoStream(vid, remoteStream, false, participants[call.peer] || "Участник", call.peer, { unmuteOverlay: true });
    });
    
    call.on("close", () => {
      console.log("📴 Входящий вызов закрыт:", call.peer);
      removeVideoContainerByPeerId(call.peer);
      delete calls[call.peer];
    });
    
    call.on("error", (e) => {
      console.error("❌ Ошибка входящего вызова:", e);
      delete calls[call.peer];
    });
  }

  // ✅ Улучшенная initLocalStream (теперь возвращает промис)
  async function initLocalStream() {
    if (myVideoStream) {
      console.log("✅ Медиапоток уже получен");
      return myVideoStream;
    }

    try {
      console.log("🎥 Запрашиваем доступ к камере/микрофону...");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: isMobile 
          ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" } 
          : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true, 
          autoGainControl: true 
        }
      });

      myVideoStream = stream;
      console.log("✅ Медиапоток получен:", stream.getTracks().map(t => `${t.kind}: ${t.label}`));

      // Выключаем видео по умолчанию
      const vt = stream.getVideoTracks()[0];
      if (vt) {
        vt.enabled = false;
        console.log("📹 Камера выключена по умолчанию");
      }
      
      const iconV = stopVideo?.querySelector("i");
      if (iconV) iconV.className = "fa fa-video-slash";

      addVideoStream(myVideo, stream, true, userName + " (Вы)", peer?.id);

      // Подключаемся к отложенным пользователям
      if (pendingToConnect.size > 0) {
        console.log("🔄 Подключаемся к отложенным пользователям:", Array.from(pendingToConnect));
        for (const uid of pendingToConnect) {
          connectToNewUser(uid, myVideoStream, participants[uid] || "Участник");
          pendingToConnect.delete(uid);
        }
      }

      return stream;
    } catch (err) {
      console.error("❌ Ошибка доступа к медиа:", err);
      log("Нет доступа к камере/микрофону. Проверьте разрешения браузера.", 'warn');
      
      // Показываем предупреждение пользователю
      const warning = document.createElement("div");
      warning.style.cssText = "position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#ff4444;color:white;padding:15px 25px;border-radius:8px;z-index:9999;font-weight:600;";
      warning.textContent = "⚠️ Нет доступа к камере/микрофону";
      document.body.appendChild(warning);
      setTimeout(() => warning.remove(), 5000);
      
      return null;
    }
  }

  // Кнопки управления
  if (stopVideo) {
    stopVideo.addEventListener("click", () => {
      if (!myVideoStream) return;
      const vt = myVideoStream.getVideoTracks()[0];
      if (vt) {
        vt.enabled = !vt.enabled;
        const ic = stopVideo.querySelector("i");
        if (ic) ic.className = vt.enabled ? "fa fa-video" : "fa fa-video-slash";
        console.log(vt.enabled ? "📹 Камера включена" : "📹 Камера выключена");
      }
    });
  }

  if (muteButton) {
    muteButton.addEventListener("click", () => {
      if (!myVideoStream) return;
      const at = myVideoStream.getAudioTracks()[0];
      if (at) {
        at.enabled = !at.enabled;
        const ic = muteButton.querySelector("i");
        if (ic) ic.className = at.enabled ? "fa fa-microphone" : "fa fa-microphone-slash";
        console.log(at.enabled ? "🎤 Микрофон включен" : "🎤 Микрофон выключен");
      }
    });
  }

  async function startScreenShare() {
    try {
      console.log("🖥️ Запрашиваем демонстрацию экрана...");
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { 
          cursor: "always" 
        } 
      });
      
      const cid = "screen-share-" + Date.now();
      localScreenShareContainerId = cid;

      const cont = document.createElement("div");
      cont.id = cid;
      cont.className = "video-container screen-share-container";
      
      const vid = createVideoElement();
      vid.srcObject = stream;
      vid.muted = true;
      cont.appendChild(vid);
      videoGrid.appendChild(cont);

      isScreenSharing = true;
      screenShareStream = stream;
      screenShareButton.innerHTML = '<i class="fa fa-stop-circle"></i>';
      screenShareButton.style.background = "#ff4444";

      console.log("✅ Демонстрация начата, отправляем всем участникам");
      for (let uid in calls) {
        try {
          const sc = peer.call(uid, stream, { metadata: { type: "screen-share" } });
          screenShareCalls[uid] = sc;
        } catch (e) {
          console.error("❌ Ошибка отправки демонстрации:", e);
        }
      }

      stream.getVideoTracks()[0].onended = stopScreenShare;
    } catch (e) { 
      console.error("❌ Ошибка демонстрации:", e); 
    }
  }

  function stopScreenShare() {
    console.log("🛑 Останавливаем демонстрацию");
    if (screenShareStream) {
      screenShareStream.getTracks().forEach(t => t.stop());
      screenShareStream = null;
    }
    for (let uid in screenShareCalls) {
      try { screenShareCalls[uid].close(); } catch (e) {}
      delete screenShareCalls[uid];
    }
    if (localScreenShareContainerId) {
      const c = document.getElementById(localScreenShareContainerId);
      if (c) c.remove();
      localScreenShareContainerId = null;
    }
    isScreenSharing = false;
    screenShareButton.innerHTML = '<i class="fa fa-desktop"></i>';
    screenShareButton.style.background = "";
    socket.emit("screenShareStopped", peer.id);
  }

  if (screenShareButton) {
    screenShareButton.addEventListener("click", async () => {
      if (!isScreenSharing) await startScreenShare();
      else stopScreenShare();
    });
  }

  if (inviteButton) {
    inviteButton.addEventListener("click", () => {
      const link = window.location.href.split('?')[0];
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(() => {
          alert("✅ Ссылка скопирована в буфер обмена!");
        }).catch(() => {
          prompt("Скопируйте ссылку:", link);
        });
      } else {
        prompt("Скопируйте ссылку:", link);
      }
    });
  }

  if (exitConferenceBtn) {
    exitConferenceBtn.addEventListener("click", () => {
      if (confirm("Вы уверены, что хотите выйти из конференции?")) {
        window.location.href = "/";
      }
    });
  }

  window.addEventListener("beforeunload", () => {
    console.log("👋 Выход из конференции");
    if (myVideoStream) myVideoStream.getTracks().forEach(t => t.stop());
    if (screenShareStream) screenShareStream.getTracks().forEach(t => t.stop());
    socket.disconnect();
    peer.destroy();
  });
});