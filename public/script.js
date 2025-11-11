// public/script.js
"use strict";

const currentUser = new URLSearchParams(window.location.search).get('userName') || 
                    prompt("Введите ваш никнейм:") || "Аноним";

const peers = [];
const peersRef = [];
let userVideoAudio = { localUser: { video: true, audio: true } };
let userStream = null;

const videoGrid = document.getElementById("video-grid");
const myVideo = document.createElement("video");
myVideo.muted = true;
myVideo.playsInline = true;

// Socket.IO подключение
const socket = io(window.location.origin, {
  transports: ["polling", "websocket"],
  reconnection: true
});

window.socket = socket; // для whiteboard.js

socket.on('connect', () => {
  console.log('✅ Socket подключен:', socket.id);
  initializeRoom();
});

async function initializeRoom() {
  try {
    // 1. СНАЧАЛА получаем медиапоток
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720 },
      audio: { echoCancellation: true, noiseSuppression: true }
    });

    userStream = stream;
    myVideo.srcObject = stream;
    
    // Выключаем видео по умолчанию
    stream.getVideoTracks()[0].enabled = false;
    
    addVideoStream(myVideo, true, currentUser);

    // 2. ПОТОМ присоединяемся к комнате
    socket.emit('BE-join-room', { 
      roomId: ROOM_ID, 
      userName: currentUser 
    });

    // 3. Обрабатываем события
    setupSocketListeners(stream);
    
  } catch (err) {
    console.error("❌ Ошибка доступа к медиа:", err);
    alert("Нет доступа к камере/микрофону");
  }
}

function setupSocketListeners(stream) {
  // Когда новый пользователь присоединился (мы - старые)
  socket.on('FE-user-join', (users) => {
    console.log('📥 FE-user-join:', users);
    
    users.forEach(({ userId, info }) => {
      if (userId !== socket.id) {
        const peer = createPeer(userId, socket.id, stream);
        peer.userName = info.userName;
        peer.peerID = userId;
        
        peersRef.push({ peerID: userId, peer, userName: info.userName });
        
        userVideoAudio[info.userName] = { 
          video: info.video, 
          audio: info.audio 
        };
      }
    });
  });

  // Входящий вызов (мы - новые)
  socket.on('FE-receive-call', ({ signal, from, info }) => {
    console.log('📞 FE-receive-call от:', from);
    
    const peerIdx = peersRef.find(p => p.peerID === from);
    
    if (!peerIdx) {
      const peer = addPeer(signal, from, stream);
      peer.userName = info.userName;
      peer.peerID = from;
      
      peersRef.push({ peerID: from, peer, userName: info.userName });
      
      userVideoAudio[info.userName] = { 
        video: info.video, 
        audio: info.audio 
      };
    }
  });

  // Вызов принят
  socket.on('FE-call-accepted', ({ signal, answerId }) => {
    console.log('✅ FE-call-accepted от:', answerId);
    const peerIdx = peersRef.find(p => p.peerID === answerId);
    if (peerIdx) {
      peerIdx.peer.signal(signal);
    }
  });

  // Пользователь вышел
  socket.on('FE-user-leave', ({ userId }) => {
    console.log('👋 FE-user-leave:', userId);
    const peerIdx = peersRef.find(p => p.peerID === userId);
    
    if (peerIdx) {
      peerIdx.peer.destroy();
      removeVideoElement(userId);
      
      const index = peersRef.indexOf(peerIdx);
      peersRef.splice(index, 1);
    }
  });

  // Переключение камеры/микрофона
  socket.on('FE-toggle-camera', ({ userId, switchTarget }) => {
    const peerIdx = peersRef.find(p => p.peerID === userId);
    if (peerIdx) {
      if (switchTarget === 'video') {
        userVideoAudio[peerIdx.userName].video = !userVideoAudio[peerIdx.userName].video;
      } else {
        userVideoAudio[peerIdx.userName].audio = !userVideoAudio[peerIdx.userName].audio;
      }
      // Обновите UI если нужно
    }
  });
}

// ✅ Создание исходящего пира
function createPeer(userId, caller, stream) {
  const peer = new SimplePeer({
    initiator: true,
    trickle: false,
    stream: stream,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
      ]
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
    addVideoStream(video, false, peer.userName, userId);
  });

  peer.on('error', (err) => {
    console.error('❌ Peer error:', err);
  });

  peer.on('close', () => {
    console.log('🔌 Peer закрыт:', userId);
  });

  return peer;
}

// ✅ Создание входящего пира
function addPeer(incomingSignal, callerId, stream) {
  const peer = new SimplePeer({
    initiator: false,
    trickle: false,
    stream: stream,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
      ]
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
    addVideoStream(video, false, peer.userName, callerId);
  });

  peer.on('error', (err) => {
    console.error('❌ Peer error:', err);
  });

  peer.signal(incomingSignal);

  return peer;
}

function addVideoStream(video, isLocal, userName, peerId) {
  const container = document.createElement("div");
  container.classList.add("video-container");
  if (peerId) container.setAttribute("data-peer-id", peerId);

  const label = document.createElement("div");
  label.className = "video-placeholder";
  label.textContent = isLocal ? "Вы" : userName;
  container.appendChild(label);

  container.appendChild(video);
  videoGrid.appendChild(container);
}

function removeVideoElement(peerId) {
  const container = document.querySelector(`[data-peer-id="${peerId}"]`);
  if (container) container.remove();
}

// ✅ Кнопки управления
document.getElementById("stopVideo")?.addEventListener("click", () => {
  if (!userStream) return;
  const videoTrack = userStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    const icon = document.querySelector("#stopVideo i");
    if (icon) icon.className = videoTrack.enabled ? "fa fa-video" : "fa fa-video-slash";
  }
});

document.getElementById("muteButton")?.addEventListener("click", () => {
  if (!userStream) return;
  const audioTrack = userStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    socket.emit('BE-toggle-camera-audio', { roomId: ROOM_ID, switchTarget: 'audio' });
    const icon = document.querySelector("#muteButton i");
    if (icon) icon.className = audioTrack.enabled ? "fa fa-microphone" : "fa fa-microphone-slash";
  }
});

document.getElementById("exit-conference-btn")?.addEventListener("click", () => {
  if (confirm("Выйти из конференции?")) {
    socket.emit('BE-leave-room', { roomId: ROOM_ID });
    window.location.href = "/";
  }
});

// Чат (если нужен)
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
    const div = document.createElement("div");
    div.classList.add("message");
    div.innerHTML = `<strong>${sender}:</strong> ${msg}`;
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
});

document.getElementById("send")?.addEventListener("click", () => {
  const input = document.getElementById("chat_message");
  const text = input?.value.trim();
  if (text) {
    socket.emit('BE-send-message', { roomId: ROOM_ID, msg: text, sender: currentUser });
    input.value = "";
  }
});