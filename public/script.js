"use strict";

const currentUser = new URLSearchParams(window.location.search).get('userName') || 
                    prompt("Введите ваш никнейм:") || "Аноним";

const peersRef = [];
let userVideoAudio = { localUser: { video: false, audio: true } }; // камера выключена!
let userStream = null;

const videoGrid = document.getElementById("video-grid");
const myVideo = document.createElement("video");
myVideo.muted = true;
myVideo.playsInline = true;

const socket = io(window.location.origin, {
  transports: ["polling", "websocket"],
  reconnection: true
});

window.socket = socket;

socket.on('connect', () => {
  console.log('✅ Socket подключен:', socket.id);
  initializeRoom();
});

async function initializeRoom() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720 },
      audio: { echoCancellation: true, noiseSuppression: true }
    });

    userStream = stream;
    myVideo.srcObject = stream;
    
    // ✅ КАМЕРА ВЫКЛЮЧЕНА ПО УМОЛЧАНИЮ
    stream.getVideoTracks()[0].enabled = false;
    
    userVideoAudio.localUser = { video: false, audio: true };
    
    addVideoStream(myVideo, true, currentUser, null);
    
    // Обновляем иконку кнопки
    const iconV = document.querySelector("#stopVideo i");
    if (iconV) iconV.className = "fa fa-video-slash";

    socket.emit('BE-join-room', { 
      roomId: ROOM_ID, 
      userName: currentUser 
    });

    setupSocketListeners(stream);
    
  } catch (err) {
    console.error("❌ Ошибка доступа к медиа:", err);
    alert("Нет доступа к камере/микрофону");
  }
}

function setupSocketListeners(stream) {
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

  socket.on('FE-call-accepted', ({ signal, answerId }) => {
    console.log('✅ FE-call-accepted от:', answerId);
    const peerIdx = peersRef.find(p => p.peerID === answerId);
    if (peerIdx) {
      peerIdx.peer.signal(signal);
    }
  });

  socket.on('FE-user-leave', ({ userId, userName }) => {
    console.log('👋 FE-user-leave:', userId, userName);
    
    const peerIdx = peersRef.findIndex(p => p.peerID === userId);
    
    if (peerIdx !== -1) {
      const peer = peersRef[peerIdx];
      
      if (peer.peer && typeof peer.peer.destroy === 'function') {
        peer.peer.destroy();
      }
      
      peersRef.splice(peerIdx, 1);
      removeVideoElement(userId);
      
      if (userName && userVideoAudio[userName]) {
        delete userVideoAudio[userName];
      }
      
      updateVideoSizes();
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
            // Камера включена
            if (avatar) avatar.classList.add('hidden');
            if (video) video.classList.remove('camera-off');
          } else {
            // Камера выключена
            if (avatar) avatar.classList.remove('hidden');
            if (video) video.classList.add('camera-off');
          }
        }
      } else {
        // АУДИО
        userVideoAudio[userName].audio = !userVideoAudio[userName].audio;
        
        if (container) {
          const micIndicator = container.querySelector('.video-mic-indicator');
          if (micIndicator) {
            if (userVideoAudio[userName].audio) {
              micIndicator.classList.remove('show');
            } else {
              micIndicator.classList.add('show');
            }
          }
        }
      }
    }
  });
}

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
    
    // ВАЖНО: передаем информацию о статусе камеры
    const isLocal = false;
    const hasVideo = userVideoAudio[peer.userName]?.video ?? true;
    
    addVideoStream(video, isLocal, peer.userName, callerId);
    
    // Если камера выключена - сразу обновляем UI
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

  // 1. АВАТАР (первая буква имени)
  const avatar = document.createElement("div");
  avatar.className = "video-avatar";
  avatar.setAttribute("data-color", getAvatarColor(userName));
  avatar.textContent = getInitial(userName);
  
  // Если камера включена - сразу скрываем аватар
  const cameraEnabled = isLocal ? userVideoAudio.localUser.video : true;
  if (cameraEnabled) {
    avatar.classList.add('hidden');
  }
  
  container.appendChild(avatar);

  // 2. VIDEO WRAPPER
  const wrapper = document.createElement("div");
  wrapper.className = "video-wrapper";
  
  video.style.width = "100%";
  video.style.height = "100%";
  video.style.objectFit = "cover";
  
  // Если камера выключена - затемняем видео
  if (!cameraEnabled) {
    video.classList.add('camera-off');
  }
  
  wrapper.appendChild(video);
  container.appendChild(wrapper);

  // 3. ИМЯ ПОЛЬЗОВАТЕЛЯ (внизу слева)
  const nameLabel = document.createElement("div");
  nameLabel.className = "video-name";
  if (isLocal) {
    nameLabel.classList.add('local-user');
  }
  nameLabel.textContent = isLocal ? `${userName}` : userName;
  container.appendChild(nameLabel);
  
  // 4. ИНДИКАТОР МИКРОФОНА (опционально)
  const micIndicator = document.createElement("div");
  micIndicator.className = "video-mic-indicator";
  micIndicator.innerHTML = '<i class="fa fa-microphone-slash"></i> Muted';
  container.appendChild(micIndicator);
  
  videoGrid.appendChild(container);
  
  // КРИТИЧНО: обновляем сетку ПОСЛЕ добавления
  updateGridLayout();
  
  video.play().catch(err => {
    console.warn("⚠️ Не удалось автовоспроизвести:", err);
  });
}

function removeVideoElement(peerId) {
  const container = document.querySelector(`[data-peer-id="${peerId}"]`);
  if (container) {
    container.remove();
    updateGridLayout();
  }
}

// ==========================================
// ДИНАМИЧЕСКОЕ ОБНОВЛЕНИЕ СЕТКИ
// ==========================================

function updateGridLayout() {
  const containers = document.querySelectorAll('.video-container');
  const count = containers.length;
  
  // Убираем все старые классы
  videoGrid.classList.remove(
    'peers-1', 'peers-2', 'peers-3', 'peers-4', 
    'peers-5', 'peers-6', 'peers-7', 'peers-8', 
    'peers-9', 'peers-10', 'peers-11', 'peers-12',
    'peers-13', 'peers-14', 'peers-15', 'peers-16',
    'peers-many'
  );
  
  // Добавляем новый класс в зависимости от количества
  if (count <= 16) {
    videoGrid.classList.add(`peers-${count}`);
  } else {
    videoGrid.classList.add('peers-many');
  }
  
  console.log(`🎨 Обновлена сетка: ${count} участников`);
}

// ==========================================
// УТИЛИТЫ ДЛЯ АВАТАРОВ
// ==========================================

// Генерация цвета по имени (консистентно)
function getAvatarColor(userName) {
  let hash = 0;
  for (let i = 0; i < userName.length; i++) {
    hash = userName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return (Math.abs(hash) % 8) + 1; // Возвращает число от 1 до 8
}

// Получение первой буквы имени
function getInitial(userName) {
  if (!userName || userName.trim() === '') return '?';
  return userName.trim()[0].toUpperCase();
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
    
    // Обновляем иконку кнопки
    const icon = document.querySelector("#stopVideo i");
    if (icon) {
      icon.className = videoTrack.enabled ? "fa fa-video" : "fa fa-video-slash";
    }
    
    // Обновляем UI контейнера
    const myContainer = videoGrid.querySelector('.video-container:first-child');
    if (myContainer) {
      const avatar = myContainer.querySelector('.video-avatar');
      const video = myContainer.querySelector('video');
      
      if (videoTrack.enabled) {
        // Камера включена: скрываем аватар, показываем видео
        if (avatar) avatar.classList.add('hidden');
        if (video) video.classList.remove('camera-off');
      } else {
        // Камера выключена: показываем аватар, скрываем видео
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
// ДЕМОНСТРАЦИЯ ЭКРАНА
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
    
    // Создаем локальное видео для предпросмотра
    const screenVideo = document.createElement('video');
    screenVideo.srcObject = stream;
    screenVideo.muted = true;
    screenVideo.autoplay = true;
    screenVideo.playsInline = true;
    
    addVideoStream(screenVideo, true, "🖥️ Ваш экран", "screen-share-local");
    
    // Обновляем кнопку
    const btn = document.getElementById("screenShareButton");
    if (btn) {
      btn.style.background = "#ff4444";
      const icon = btn.querySelector("i");
      if (icon) icon.className = "fa fa-stop-circle";
    }
    
    // Отправляем поток всем участникам
    const screenTrack = stream.getVideoTracks()[0];
    
    peersRef.forEach(({ peer }) => {
      if (peer && peer._pc) {
        const sender = peer._pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          sender.replaceTrack(screenTrack).catch(err => {
            console.error('Ошибка замены трека:', err);
          });
        }
      }
    });
    
    // Обрабатываем остановку демонстрации
    screenTrack.onended = () => {
      console.log('🖥️ Демонстрация остановлена пользователем');
      stopScreenShare();
    };
    
    console.log('✅ Демонстрация экрана началась');
    
  } catch (err) {
    console.error('❌ Ошибка демонстрации экрана:', err);
    if (err.name === 'NotAllowedError') {
      showNotification('⚠️ Вы отклонили запрос на демонстрацию', 'error');
    }
  }
}

function stopScreenShare() {
  console.log('🛑 Останавливаем демонстрацию экрана');
  
  if (screenShareStream) {
    screenShareStream.getTracks().forEach(track => track.stop());
    screenShareStream = null;
  }
  
  // Удаляем локальное видео демонстрации
  removeVideoElement("screen-share-local");
  
  // Возвращаем камеру
  if (userStream) {
    const videoTrack = userStream.getVideoTracks()[0];
    
    peersRef.forEach(({ peer }) => {
      if (peer && peer._pc) {
        const sender = peer._pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          sender.replaceTrack(videoTrack).catch(err => {
            console.error('Ошибка возврата трека:', err);
          });
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
  // КРИТИЧНО: обновляем сетку после удаления экрана
  updateGridLayout();
}

// ==========================================
// КОПИРОВАНИЕ ССЫЛКИ
// ==========================================

document.getElementById("inviteButton")?.addEventListener("click", () => {
  // Формируем ссылку БЕЗ параметра userName
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
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(-20px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
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
// ВЫХОД ИЗ КОНФЕРЕНЦИИ
// ==========================================

document.getElementById("exit-conference-btn")?.addEventListener("click", () => {
  if (confirm("Выйти из конференции?")) {
    socket.emit('BE-leave-room', { roomId: ROOM_ID });
    window.location.href = "/";
  }
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
// CLEANUP ПРИ ВЫХОДЕ
// ==========================================

window.addEventListener("beforeunload", () => {
  socket.emit('BE-leave-room', { roomId: ROOM_ID });
  
  if (userStream) {
    userStream.getTracks().forEach(track => track.stop());
  }
  
  if (screenShareStream) {
    screenShareStream.getTracks().forEach(track => track.stop());
  }
  
  peersRef.forEach(({ peer }) => {
    if (peer && typeof peer.destroy === 'function') {
      peer.destroy();
    }
  });
  
  socket.disconnect();
});