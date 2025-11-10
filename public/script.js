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

function tryJoin() {
  if (!joined && socketReady && peerReady && peer && peer.id) {
    joined = true;
    console.log("🚀 Отправляем join-room:", { roomId: ROOM_ID, peerId: peer.id, userName });
    socket.emit("join-room", ROOM_ID, peer.id, userName);
    initLocalStream();
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

  // Инициализация Socket.IO
  socket = io(window.location.origin, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    timeout: 30000
  });

  socket.on('connect', () => {
    console.log('✅ Socket.IO подключен');
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
    log("PeerJS подключен: " + id);
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
          if (peer && peer.disconnected) peer.reconnect();
        }, Math.min(2000 * reconnectAttempts, 15000));
      }
    }
  });

  peer.on("disconnected", () => {
    console.log("🔌 PeerJS отключен");
    peerReady = false;
    setTimeout(() => {
      if (peer && !peer.destroyed) peer.reconnect();
    }, 1000);
  });

  // Socket события
  socket.on("room-users", (users) => {
    console.log("room-users:", users);
    users.forEach(({ userId, userName: uName }) => {
      participants[userId] = uName || "Участник";
      if (myVideoStream) {
        setTimeout(() => connectToNewUser(userId, myVideoStream, participants[userId]), 300);
      } else {
        pendingToConnect.add(userId);
      }
    });
  });

  socket.on("user-list", (list) => {
    console.log("user-list:", list);
  });

  socket.on("user-connected", (userId, connectedUserName) => {
    console.log("user-connected:", userId, connectedUserName);
    participants[userId] = connectedUserName;
    if (userId === peer?.id) return;
    
    if (myVideoStream) {
      setTimeout(() => connectToNewUser(userId, myVideoStream, connectedUserName), 500);
    } else {
      pendingToConnect.add(userId);
    }
  });

  socket.on("user-disconnected", (userId) => {
    if (calls[userId]) {
      calls[userId].close();
      delete calls[userId];
    }
    removeVideoContainerByPeerId(userId);
    delete participants[userId];
  });

  socket.on("screenShareStopped", (initiatorPeerId) => {
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
    if (c) c.remove();
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
      if (p) p.catch(() => { if (!isLocal && unmuteOverlay) showTapToUnmute(container, video); });
    };

    if (video.readyState >= 2) tryPlay();
    else video.onloadedmetadata = tryPlay;
  }

  function showTapToUnmute(container, video) {
    if (container.querySelector(".tap-to-unmute")) return;
    const ov = document.createElement("div");
    ov.className = "tap-to-unmute";
    ov.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);color:#fff;font-weight:600;cursor:pointer;z-index:50;`;
    ov.textContent = "Нажмите, чтобы включить звук/видео";
    ov.addEventListener("click", async () => {
      try { video.muted = false; await video.play(); ov.remove(); } catch (e) {}
    });
    container.appendChild(ov);
  }

  function connectToNewUser(userId, stream, connectedUserName) {
    if (!userId || !stream || !peer || peer.disconnected || calls[userId]) return;

    try {
      const call = peer.call(userId, stream, { metadata: { userName } });
      if (!call) return;

      const pc = call.peerConnection || call._pc;
      if (pc) {
        pc.addEventListener('iceconnectionstatechange', () => console.log('ICE', userId, pc.iceConnectionState));
        pc.addEventListener('connectionstatechange', () => console.log('PC', userId, pc.connectionState));
      }

      const video = createVideoElement();
      call.on("stream", (s) => addVideoStream(video, s, false, connectedUserName, userId));
      call.on("error", (err) => { console.error("Call error:", err); call.close(); });
      call.on("close", () => removeVideoContainerByPeerId(userId));

      calls[userId] = call;
    } catch (e) { console.error(e); }
  }

  async function initLocalStream() {
    if (myVideoStream) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: isMobile ? { width: 640, height: 480, facingMode: "user" } : { width: 1280, height: 720, facingMode: "user" },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });

      myVideoStream = stream;

      // Выключаем видео по умолчанию
      const vt = stream.getVideoTracks()[0];
      if (vt) vt.enabled = false;
      const iconV = stopVideo?.querySelector("i");
      if (iconV) iconV.className = "fa fa-video-slash";

      addVideoStream(myVideo, stream, true, userName + " (Вы)");

      // Подключаемся к отложенным
      for (const uid of pendingToConnect) {
        connectToNewUser(uid, myVideoStream, participants[uid] || "Участник");
        pendingToConnect.delete(uid);
      }
    } catch (err) {
      console.error(err);
      log("Нет доступа к камере/микрофону.", 'warn');
    }
  }

  function handleIncomingCall(call) {
    if (calls[call.peer]) return;
    calls[call.peer] = call;

    if (call.metadata?.type === "screen-share") {
      call.answer();
      const vid = createVideoElement();
      const cid = call.peer + "-screen";
      call.on("stream", (s) => addVideoStream(vid, s, false, "🖥️ Демонстрация", cid, { unmuteOverlay: true }));
      call.on("close", () => removeVideoContainerByPeerId(cid));
      return;
    }

    call.answer(myVideoStream || undefined);
    const vid = createVideoElement();
    addVideoStream(vid, null, false, participants[call.peer] || "Участник", call.peer, { unmuteOverlay: true });
    call.on("stream", (s) => addVideoStream(vid, s, false, participants[call.peer] || "Участник", call.peer, { unmuteOverlay: true }));
    call.on("close", () => removeVideoContainerByPeerId(call.peer));
    call.on("error", (e) => console.error(e));
  }

  // Кнопки
  if (stopVideo) {
    stopVideo.addEventListener("click", () => {
      if (!myVideoStream) return;
      const vt = myVideoStream.getVideoTracks()[0];
      if (vt) {
        vt.enabled = !vt.enabled;
        const ic = stopVideo.querySelector("i");
        if (ic) ic.className = vt.enabled ? "fa fa-video" : "fa fa-video-slash";
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
      }
    });
  }

  async function startScreenShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
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

      for (let uid in calls) {
        try {
          const sc = peer.call(uid, stream, { metadata: { type: "screen-share" } });
          screenShareCalls[uid] = sc;
        } catch (e) {}
      }

      stream.getVideoTracks()[0].onended = stopScreenShare;
    } catch (e) { console.error(e); }
  }

  function stopScreenShare() {
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
      prompt("Скопируйте ссылку:", window.location.href.split('?')[0]);
    });
  }

  if (exitConferenceBtn) {
    exitConferenceBtn.addEventListener("click", () => {
      if (confirm("Выйти из конференции?")) window.location.href = "/";
    });
  }

  window.addEventListener("beforeunload", () => {
    if (myVideoStream) myVideoStream.getTracks().forEach(t => t.stop());
    socket.disconnect();
    peer.destroy();
  });
});