"use strict";

//========================================
// ИНИЦИАЛИЗАЦИЯ И ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ========================================

let calls = {};
let screenShareCalls = {};
let localScreenShareContainerId = null;
let myVideoStream = null;
let isScreenSharing = false;
let screenShareStream = null;
let peer = null;
let socket = null;
const participants = {};
const pendingToConnect = new Set(); // очередь тех, к кому подключимся позже

let urlParams = new URLSearchParams(window.location.search);
let userName = urlParams.get('userName');
if (!userName || userName.trim() === "") {
  userName = prompt("Введите ваш никнейм:") || "Аноним";
}

function log(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = type === 'error' ? '❌' : type === 'warn' ? '⚠️' : 'ℹ️';
  console.log(`[${timestamp}] ${prefix}`, message);
}

document.addEventListener("DOMContentLoaded", () => {
  // Проверка поддержки WebRTC
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Ваш браузер не поддерживает WebRTC. Пожалуйста, используйте современный браузер.');
    return;
  }

  if (!window.Peer) {
    alert('PeerJS не загружен. Проверьте подключение к интернету.');
    return;
  }

  console.log('🔗 Инициализация Socket.IO с сервером:', window.location.origin);
  
  socket = io(window.location.origin, {
    transports: ["websocket", "polling"],
    reconnection: true
  });

  const videoGrid = document.getElementById("video-grid");
  const myVideo = document.createElement("video");
  myVideo.muted = true;
  myVideo.playsInline = true;

  console.log('📹 Инициализация видео:', {
    videoGrid: !!videoGrid,
    myVideo: !!myVideo
  });

  const chatSection = document.querySelector(".main__right");
  const toggleChat = document.getElementById("toggleChat");
  const stopVideo = document.getElementById("stopVideo");
  const muteButton = document.getElementById("muteButton");
  const screenShareButton = document.getElementById("screenShareButton");
  const inviteButton = document.getElementById("inviteButton");

  if (chatSection) {
    chatSection.style.display = "none";
  }

  if (toggleChat && chatSection) {
    toggleChat.addEventListener("click", () => {
      const isHidden = chatSection.style.display === "none";
      chatSection.style.display = isHidden ? "flex" : "none";
      toggleChat.title = isHidden ? "Скрыть чат" : "Открыть чат";
    });
  }

  const sendButton = document.getElementById("send");
  const chatInput = document.getElementById("chat_message");
  const messagesContainer = document.querySelector(".messages");

  console.log('💬 Инициализация чата:', {
    sendButton: !!sendButton,
    chatInput: !!chatInput,
    messagesContainer: !!messagesContainer
  });

  function sendMessage() {
    const messageText = chatInput.value.trim();
    if (!messageText) return;
    
    console.log('💬 Отправляем сообщение:', { sender: userName, text: messageText });
    socket.emit("message", { sender: userName, text: messageText });
    chatInput.value = "";
  }

  if (sendButton) {
    sendButton.addEventListener("click", () => {
      console.log("chat send clicked; socket.connected=", socket.connected);
      sendMessage();
    });
  }

  if (chatInput) {
    chatInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        sendMessage();
      }
    });
  }

  socket.on("messageHistory", (history) => {
    console.log('💬 Получена история сообщений:', history.length, 'сообщений');
    if (!messagesContainer) {
      console.log('❌ Контейнер сообщений не найден');
      return;
    }
    messagesContainer.innerHTML = "";
    history.forEach((message) => {
      addMessageToChat(message);
    });
  });

  socket.on("createMessage", (msg) => {
    console.log('💬 Получено новое сообщение:', msg);
    addMessageToChat(msg);
  });

  function addMessageToChat(message) {
    if (!messagesContainer) {
      console.log('❌ Не удается добавить сообщение: контейнер не найден');
      return;
    }
    console.log('💬 Добавляем сообщение в чат:', message);
    const messageDiv = document.createElement("div");
    messageDiv.classList.add("message");
    messageDiv.innerHTML = `<strong>${message.sender}:</strong> ${message.text}`;
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    console.log('✅ Сообщение добавлено в чат');
  }

  document.querySelectorAll(".emoji-button").forEach(button => {
    button.addEventListener("click", () => {
      const emoji = button.getAttribute("data-emoji");
      socket.emit("message", { sender: userName, text: emoji });
    });
  });

  // ========================================
  // PEERJS ИНИЦИАЛИЗАЦИЯ
  // ========================================

  console.log('🔧 PeerJS конфигурация:', PEER_CONFIG);
  
  peer = new Peer(undefined, {
    host: PEER_CONFIG.host,
    port: PEER_CONFIG.port,
    path: PEER_CONFIG.path,
    secure: PEER_CONFIG.secure,
    config: PEER_CONFIG.config,
    debug: 2
  });

  // ВАЖНО: ловим входящие до getUserMedia
  peer.on("call", handleIncomingCall);

  // Двухфлажковая синхронизация
  let socketReady = false;
  let peerReady = false;
  let joined = false;

  function tryJoin() {
    if (!joined && socketReady && peerReady) {
      joined = true;
      console.log("🚀 Отправляем join-room:", { roomId: ROOM_ID, peerId: peer.id, userName });
      socket.emit("join-room", ROOM_ID, peer.id, userName);
      initLocalStream(); // камеру запрашиваем после входа
    } else {
      console.log('⏳ Ожидание готовности:', { socketReady, peerReady, joined });
    }
  }

  socket.on('connect', () => {
    console.log('✅ Socket.IO подключен');
    socketReady = true;
    tryJoin();
  });

  socket.on('connect_error', (error) => {
    console.error('❌ Socket.IO ошибка подключения:', error);
    log('Ошибка подключения к серверу', 'error');
  });

  socket.on('disconnect', (reason) => {
    console.log('🔌 Socket.IO отключен:', reason);
    log('Соединение потеряно: ' + reason, 'warn');
  });

  peer.on("open", (id) => {
    log("PeerJS подключен: " + id);
    participants[id] = userName;
    peerReady = true;
    tryJoin();
  });

  peer.on("error", (error) => {
    console.error("❌ PeerJS ошибка:", error);
    log("Ошибка PeerJS: " + error.type, 'error');
  });

  peer.on("disconnected", () => {
    console.log("🔌 PeerJS отключен");
    log("PeerJS соединение потеряно", 'warn');
  });

  function toggleFullscreen(element) {
    if (!document.fullscreenElement) {
      element.requestFullscreen().catch(err => {
        console.error("Ошибка fullscreen:", err);
      });
    } else {
      document.exitFullscreen();
    }
  }
    
  function removeVideoContainerByPeerId(peerId) {
    const container = document.querySelector(`.video-container[data-peer-id="${peerId}"]`);
    if (container) container.remove();
  }

  function createVideoElement() {
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    return video;
  }

  function addVideoStream(video, stream, isLocal = false, displayName = "", peerId = null, options = {}) {
    const { unmuteOverlay = false } = options;
    const videoGrid = document.getElementById("video-grid");
    if (!videoGrid) return;

    let container = null;
    if (peerId) {
      container = document.querySelector(`.video-container[data-peer-id="${peerId}"]`);
    }
    if (!container) {
      container = document.createElement("div");
      container.classList.add("video-container");
      if (peerId) container.setAttribute("data-peer-id", peerId);

      const nameLabel = document.createElement("div");
      nameLabel.className = "video-placeholder";
      nameLabel.textContent = displayName || (isLocal ? "Вы" : "Участник");
      container.appendChild(nameLabel);

      const wrapper = document.createElement("div");
      wrapper.className = "video-wrapper";
      wrapper.style.position = "relative";
      container.appendChild(wrapper);

      video.playsInline = true;
      video.autoplay = true;
      // ВАЖНО: на мобильных видео с аудио не автоплеится — стартуем в muted
      video.muted = isLocal || unmuteOverlay; // для удалённого — true, потом дадим кнопкой включить

      wrapper.appendChild(video);
      videoGrid.appendChild(container);

      container.addEventListener("dblclick", () => {
        if (!document.fullscreenElement) container.requestFullscreen().catch(()=>{});
        else document.exitFullscreen().catch(()=>{});
      });
    }

    if (stream) video.srcObject = stream;

    const tryPlay = () => {
      const p = video.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          if (!isLocal && unmuteOverlay) showTapToUnmute(container, video);
        });
      }
    };

    if (video.readyState >= 2) tryPlay();
    else video.onloadedmetadata = tryPlay;
  }

  function showTapToUnmute(container, video) {
    if (container.querySelector(".tap-to-unmute")) return;
    const overlay = document.createElement("div");
    overlay.className = "tap-to-unmute";
    overlay.style.cssText = `
      position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
      background:rgba(0,0,0,.35); color:#fff; font-weight:600; cursor:pointer; z-index:50;
    `;
    overlay.textContent = "Нажмите, чтобы включить звук/видео";
    overlay.addEventListener("click", async () => {
      try {
        video.muted = false;
        await video.play();
        overlay.remove();
      } catch (e) {
        console.log("Autoplay still blocked:", e);
      }
    });
    container.appendChild(overlay);
  }

  function attachCallDebug(call) {
    const pc = call.peerConnection || call._pc;
    if (pc) {
      pc.addEventListener('iceconnectionstatechange', () => console.log('ICE', call.peer, pc.iceConnectionState));
      pc.addEventListener('connectionstatechange', () => console.log('PC', call.peer, pc.connectionState));
    }
  }

  function connectToNewUser(userId, stream, connectedUserName) {
    console.log("Вызываем пользователя: ", userId, connectedUserName);
    if (!userId || !stream || !peer || peer.disconnected) return;

    try {
      const call = peer.call(userId, stream, {
        metadata: { userName: userName }
      });

      if (!call) return;

      // Add debugging for ICE connection states
      attachCallDebug(call);

      const video = createVideoElement();

      call.on("stream", (userVideoStream) => {
        console.log("Получен стрим от пользователя: ", userId);
        addVideoStream(video, userVideoStream, false, connectedUserName, userId);
      });

      call.on("error", (err) => {
        console.error("Ошибка вызова:", err);
        call.close();
      });

      call.on("close", () => {
        removeVideoContainerByPeerId(userId);
      });

      calls[userId] = call;
    } catch (e) {
      console.error("Ошибка:", e);
    }
  }

  async function initLocalStream() {
    if (myVideoStream) return;

    try {
      // сначала пробуем с видео+аудио
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });

      myVideoStream = stream;

      // выключаем видео по умолчанию
      const v = stream.getVideoTracks()[0];
      if (v) {
        v.enabled = false;
        console.log('📹 Видео выключено по умолчанию');
      }
      
      const iconV = document.querySelector("#stopVideo i");
      if (iconV) {
        iconV.className = "fa fa-video-slash";
        console.log('🔴 Иконка видео обновлена на "выключено"');
      }

      addVideoStream(myVideo, stream, true, userName + " (Вы)");

      // обработка входящих звонков
      peer.on("call", handleIncomingCall);

      // Подключаемся к тем, кого не успели подключить
      if (pendingToConnect.size > 0) {
        for (const uid of Array.from(pendingToConnect)) {
          connectToNewUser(uid, myVideoStream, participants[uid] || "Участник");
          pendingToConnect.delete(uid);
        }
      }
    } catch (err1) {
      // если камера не разрешена, пробуем только аудио
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        myVideoStream = stream;
        addVideoStream(myVideo, stream, true, userName + " (Вы)");
        peer.on("call", handleIncomingCall);

        if (pendingToConnect.size > 0) {
          for (const uid of Array.from(pendingToConnect)) {
            connectToNewUser(uid, myVideoStream, participants[uid] || "Участник");
            pendingToConnect.delete(uid);
          }
        }
      } catch (err2) {
        // если и аудио не дали — всё равно пусть сможете хотя бы смотреть
        log("Нет доступа к камере/микрофону. Вы будете без собственного стрима.", 'warn');
        peer.on("call", handleIncomingCall);
      }
    }
  }

  function handleIncomingCall(call) {
    console.log("Получен входящий вызов от: ", call.peer);
    if (call.metadata && call.metadata.type === "screen-share") {
      call.answer();
      const remoteVideo = createVideoElement();
      const containerId = call.peer + "-screen";
      call.on("stream", (remoteStream) => {
        addVideoStream(remoteVideo, remoteStream, false, "🖥️ Демонстрация", containerId, { unmuteOverlay: true });
      });
      call.on("close", () => removeVideoContainerByPeerId(containerId));
      return;
    }

    // обычный звонок
    call.answer(myVideoStream || undefined); // отвечаем даже без своего стрима
    const remoteVideo = createVideoElement();

    // создадим контейнер заранее и покажем оверлей для запуска
    addVideoStream(remoteVideo, null, false, participants[call.peer] || "Участник", call.peer, { unmuteOverlay: true });

    call.on("stream", (remoteStream) => {
      console.log("Получен стрим во входящем вызове от: ", call.peer);
      addVideoStream(remoteVideo, remoteStream, false, participants[call.peer] || "Участник", call.peer, { unmuteOverlay: true });
    });

    call.on("close", () => removeVideoContainerByPeerId(call.peer));
    call.on("error", (e) => console.error("Ошибка вызова:", e));
  }

  if (stopVideo) {
    stopVideo.addEventListener("click", () => {
      if (!myVideoStream) return;
      const videoTrack = myVideoStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        const icon = stopVideo.querySelector("i");
        if (icon) {
          icon.className = videoTrack.enabled ? "fa fa-video" : "fa fa-video-slash";
        }
      }
    });
  }

  if (muteButton) {
    muteButton.addEventListener("click", () => {
      if (!myVideoStream) return;
      const audioTrack = myVideoStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
       const icon = muteButton.querySelector("i");
        if (icon) {
          icon.className = audioTrack.enabled ? "fa fa-microphone" : "fa fa-microphone-slash";
        }
      }
    });
  }

  async function startScreenShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({video: true });
      
      const containerId = "screen-share-" + Date.now();
      localScreenShareContainerId = containerId;

      const container = document.createElement("div");
      container.id = containerId;
      container.className = "video-container screen-share-container";

      const videoElement = createVideoElement();
     videoElement.srcObject = stream;
      videoElement.muted = true;
      container.appendChild(videoElement);

      videoGrid.appendChild(container);

      isScreenSharing = true;
      screenShareStream = stream;
      screenShareButton.innerHTML = '<i class="fa fa-stop-circle"></i>';

      for (let userId in calls) {
        try {
          const screenCall = peer.call(userId, stream, {
            metadata: { type: "screen-share" }
          });
          screenShareCalls[userId] = screenCall;
        } catch (err) {
          console.error("Ошибка:", err);
        }
      }

      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };

      return stream;
    } catch (error) {
      console.error("Ошибка:", error);
    }
  }

  function stopScreenShare() {
    if (screenShareStream) {
      screenShareStream.getTracks().forEach(track => track.stop());
     screenShareStream = null;
    }

    for (let userId in screenShareCalls) {
      try {
        screenShareCalls[userId].close();
      } catch (err) {}
      delete screenShareCalls[userId];
    }

    if (localScreenShareContainerId) {
      const container = document.getElementById(localScreenShareContainerId);
      if (container) container.remove();
      localScreenShareContainerId = null;
    }

    isScreenSharing = false;
    screenShareButton.innerHTML = '<i class="fa fa-desktop"></i>';
    socket.emit("screenShareStopped", peer.id);
  }

  if (screenShareButton) {
    screenShareButton.addEventListener("click", async () => {
      if (!isScreenSharing) {
        await startScreenShare();
      } else {
        stopScreenShare();
     }
    });
  }

  if (inviteButton) {
    inviteButton.addEventListener("click", () => {
      const link = window.location.href.split('?')[0];
      prompt("Скопируйте ссылку:", link);
    });
  }

  const exitConferenceBtn = document.getElementById("exit-conference-btn");
 if (exitConferenceBtn) {
    exitConferenceBtn.addEventListener("click", () => {
      if (confirm("Выйти из конференции?")) {
        window.location.href = "/";
      }
    });
  }

  // Новый участник получил список тех, кто уже в комнате → сам инициирует звонки
  socket.on("room-users", (users) => {
    // users: [{ userId, userName }]
    console.log('👥 Получен список участников комнаты:', users.length, 'пользователей');
    users.forEach(({ userId, userName: uName }) => {
      console.log('👤 Добавляем существующего пользователя:', userId, uName);
      participants[userId] = uName || "Участник";
      if (myVideoStream) {
        console.log('📞 Подключаемся к пользователю:', userId);
        setTimeout(() => connectToNewUser(userId, myVideoStream, participants[userId]), 300);
      } else {
        console.log('⏳ Откладываем подключение к:', userId, '(нет видео стрима)');
        pendingToConnect.add(userId);
      }
    });
  });

  // (опционально) Актуальный список участников для рисования UI
  socket.on("user-list", (list) => {
    // list: [{ userId, userName }]
    // можно нарисовать боковую панель участников
    console.log("user-list:", list);
  });

  // 2) Если пришёл новый пользователь, а стрима ещё нет — отложим подключение
  socket.on("user-connected", (userId, connectedUserName) => {
    console.log('🆕 Получено user-connected:', userId, connectedUserName);
    log(`Пользователь ${connectedUserName} подключился`);
    participants[userId] = connectedUserName;

    if (userId === peer.id) {
      console.log('ℹ️ Пропускаем подключение к себе');
      return;
    }

    if (myVideoStream) {
      console.log('📞 Подключаемся к новому пользователю:', userId);
      setTimeout(() => connectToNewUser(userId, myVideoStream, connectedUserName), 500);
    } else {
      console.log('⏳ Откладываем подключение к новому пользователю:', userId);
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



  window.addEventListener("beforeunload", () => {
    if (myVideoStream) {
      myVideoStream.getTracks().forEach(track => track.stop());
    }
    socket.disconnect();
    peer.destroy();
  });
});