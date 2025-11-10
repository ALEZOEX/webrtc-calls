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
  socket = io(window.location.origin, {
transports: ["websocket", "polling"],
    reconnection: true
  });

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

  function sendMessage() {
    const messageText = chatInput.value.trim();
    if (!messageText) return;
    
    socket.emit("message", { sender: userName, text: messageText });
    chatInput.value = "";
  }

  if (sendButton) {
    sendButton.addEventListener("click", sendMessage);
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
    if (!messagesContainer) return;
    messagesContainer.innerHTML = "";
    history.forEach((message) => {
      addMessageToChat(message);
    });
  });

  socket.on("createMessage", (message) => {
    addMessageToChat(message);
  });

  function addMessageToChat(message) {
    if (!messagesContainer) return;
    const messageDiv = document.createElement("div");
    messageDiv.classList.add("message");
    messageDiv.innerHTML = `<strong>${message.sender}:</strong> ${message.text}`;
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
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

  peer = new Peer(undefined, {
    host: PEER_CONFIG.host,
    port: PEER_CONFIG.port,
    path: PEER_CONFIG.path,
    secure: PEER_CONFIG.secure,
    config: PEER_CONFIG.config,
    debug: 2
  });

  // 1) Сразу в комнату, не ждём камеру
  peer.on("open", (id) => {
    log("PeerJS подключен: " + id);
    participants[id] = userName;

    // ВАЖНО: входим в комнату немедленно
    socket.emit("join-room", ROOM_ID, id, userName);

    // Стартуем получение камеры/микрофона, но это отдельно
    initLocalStream();
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

  function addVideoStream(video, stream, isLocal = false, displayName = "", peerId = null) {
   if (!stream) return;

    if (peerId) {
      const existingContainer = document.querySelector(`.video-container[data-peer-id="${peerId}"]`);
      if (existingContainer) {
        const existingVideo = existingContainer.querySelector("video");
        if (existingVideo) {
          existingVideo.srcObject = stream;
          existingVideo.play().catch(err => console.error("Ошибка:", err));
        }
        return;
      }
    }

    const container = document.createElement("div");
    container.classList.add("video-container");
    if (peerId) {
      container.setAttribute("data-peer-id", peerId);
    }

    container.addEventListener("dblclick", () => {
      toggleFullscreen(container);
    });

    video.playsInline = true;
    if (isLocal) {
      video.muted = true;
    }

    video.srcObject = stream;
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit="cover";

    container.appendChild(video);

    if (displayName) {
      const nameLabel = document.createElement("div");
      nameLabel.className = "video-placeholder";
      nameLabel.textContent = displayName;
      container.appendChild(nameLabel);
    }

    videoGrid.appendChild(container);

    video.onloadedmetadata = () => {
      video.play().catch(err => console.error("Ошибка:", err));
    };
  }

  function connectToNewUser(userId, stream, connectedUserName) {
    if (!userId || !stream || !peer || peer.disconnected) return;

    try {
      const call = peer.call(userId, stream, {
        metadata: { userName: userName }
      });

if (!call) return;

      const video = createVideoElement();

      call.on("stream", (userVideoStream) => {
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

  // 3) Отвечаем на звонок даже если нет своего стрима (тогда просто смотрим)
  function handleIncomingCall(call) {
    if (call.metadata && call.metadata.type === "screen-share") {
      call.answer();
      const remoteVideo = createVideoElement();
      const containerId = call.peer + "-screen";

      call.on("stream", (remoteStream) => {
        addVideoStream(remoteVideo, remoteStream, false, "🖥️ Демонстрация", containerId);
      });

      call.on("close", () => {
        removeVideoContainerByPeerId(containerId);
      });
    } else {
      const answerStream = myVideoStream || undefined; // можно ответить без своего стрима
      call.answer(answerStream);

      const remoteVideo = createVideoElement();
      call.on("stream", (remoteStream) => {
        const callerName = call.metadata?.userName || participants[call.peer] || "Участник";
        addVideoStream(remoteVideo, remoteStream, false, callerName, call.peer);
      });

      call.on("close", () => removeVideoContainerByPeerId(call.peer));
      call.on("error", (e) => console.error("Ошибка вызова:", e));
    }
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

  // 2) Если пришёл новый пользователь, а стрима ещё нет — отложим подключение
  socket.on("user-connected", (userId, connectedUserName) => {
    log(`Пользователь ${connectedUserName} подключился`);
    participants[userId] = connectedUserName;

    if (userId === peer.id) return;

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

  peer.on("open", (id) => {
    log("PeerJS подключен: " + id);
    participants[id] = userName;
    initLocalStream();
  });

  peer.on("error", (err) => {
    console.error("PeerJS ошибка:", err);
  });

  window.addEventListener("beforeunload", () => {
    if (myVideoStream) {
      myVideoStream.getTracks().forEach(track => track.stop());
    }
    socket.disconnect();
    peer.destroy();
  });
});