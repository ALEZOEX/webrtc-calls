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

let urlParams = new URLSearchParams(window.location.search);
let userName = urlParams.get('userName');
if (!userName || userName.trim() === "") {
  userName = prompt("Введите ваш никнейм:") || "Аноним";
}

const participants = {};

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

  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302"}
];

  peer = new Peer({
    host: PEER_CONFIG.host,
    port: PEER_CONFIG.port,
    path: PEER_CONFIG.path,
    secure: PEER_CONFIG.secure,
    config: {
      iceServers: iceServers,
      sdpSemantics: 'unified-plan'
    },
debug: 3
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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true
      });

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = false;
     }

      myVideoStream = stream;
      addVideoStream(myVideo, stream, true, userName + " (Вы)");

      peer.on("call", handleIncomingCall);
      socket.emit("join-room", ROOM_ID, peer.id, userName);
    } catch (error) {
      console.error("Ошибка медиа:",error);
      alert("Не удалось получить доступ к камере/микрофону");
    }
  }

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
      if (!myVideoStream) return;

      call.answer(myVideoStream);
      const remoteVideo = createVideoElement();

      call.on("stream", remoteStream => {
        const callerName = call.metadata?.userName || "Участник";
        addVideoStream(remoteVideo, remoteStream, false, callerName, call.peer);
});
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

  socket.on("user-connected", (userId, connectedUserName) => {
    participants[userId] = connectedUserName;
    
    if (userId !== peer.id && myVideoStream) {
      setTimeout(() => {
        connectToNewUser(userId, myVideoStream, connectedUserName);
      }, 1000);
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