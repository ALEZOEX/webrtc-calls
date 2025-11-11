"use strict";

const currentUser = new URLSearchParams(window.location.search).get('userName') || 
                    prompt("Введите ваш никнейм:") || "Аноним";

const peersRef = [];
let userVideoAudio = { localUser: { video: true, audio: true } };
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
    // 1. СНАЧАЛА получаем медиапоток
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720 },
      audio: { echoCancellation: true, noiseSuppression: true }
    });

    userStream = stream;
    myVideo.srcObject = stream;
    
    // ✅ ДОБАВЬТЕ: камера ВКЛЮЧЕНА по умолчанию
    userVideoAudio.localUser = { video: true, audio: true };
    
    addVideoStream(myVideo, true, currentUser, socket.id);

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

  // Пользователь вышел
  socket.on('FE-user-leave', ({ userId, userName }) => {
    console.log('👋 FE-user-leave:', userId, userName);
    
    const peerIdx = peersRef.findIndex(p => p.peerID === userId);
    
    if (peerIdx !== -1) {
      const peer = peersRef[peerIdx];
      
      // Уничтожаем peer
      if (peer.peer && typeof peer.peer.destroy === 'function') {
        peer.peer.destroy();
      }
      
      // Удаляем из массива
      peersRef.splice(peerIdx, 1);
      
      // Удаляем видео элемент
      removeVideoElement(userId);
      
      // Удаляем из userVideoAudio
      if (userName && userVideoAudio[userName]) {
        delete userVideoAudio[userName];
      }
      
      // Пересчитываем размеры оставшихся блоков
      updateVideoSizes();
    }
  });

// Переключение камеры/микрофона (УЛУЧШЕННАЯ ВЕРСИЯ)
  socket.on('FE-toggle-camera', ({ userId, switchTarget }) => {
    const peerIdx = peersRef.find(p => p.peerID === userId);
    
    if (peerIdx) {
      const userName = peerIdx.userName;
      
      if (switchTarget === 'video') {
        userVideoAudio[userName].video = !userVideoAudio[userName].video;
        
        // Обновляем UI
        const container = document.querySelector(`[data-peer-id="${userId}"]`);
        if (container) {
          const placeholder = container.querySelector('.video-placeholder');
          if (placeholder) {
            placeholder.style.display = userVideoAudio[userName].video ? 'none' : 'flex';
          }
        }
      } else {
        userVideoAudio[userName].audio = !userVideoAudio[userName].audio;
        
        // Можно добавить индикатор "микрофон выключен"
        console.log(`🎤 ${userName}: микрофон ${userVideoAudio[userName].audio ? 'включен' : 'выключен'}`);
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

  // Добавляем класс для правильного размера
  const peerCount = document.querySelectorAll('.video-container').length;
  container.classList.add(`width-peer${peerCount > 8 ? '' : peerCount}`);

  const label = document.createElement("div");
  label.className = "video-placeholder";
  label.textContent = isLocal ? `${userName} (Вы)` : userName;
  
  // ВАЖНО: показываем label только если видео выключено
  if (!isLocal && userVideoAudio[userName] && !userVideoAudio[userName].video) {
    label.style.display = 'flex';
  } else {
    label.style.display = 'none';
  }
  
  container.appendChild(label);

  // Обертка для видео
  const wrapper = document.createElement("div");
  wrapper.className = "video-wrapper";
  wrapper.style.position = "relative";
  wrapper.style.width = "100%";
  wrapper.style.height = "100%";
  
  video.style.width = "100%";
  video.style.height = "100%";
  video.style.objectFit = "cover";
  
  wrapper.appendChild(video);
  container.appendChild(wrapper);
  
  videoGrid.appendChild(container);
  
  // КРИТИЧНО: принудительно воспроизводим видео
  video.play().catch(err => {
    console.warn("⚠️ Не удалось автовоспроизвести:", err);
  });
}

function removeVideoElement(peerId) {
  const container = document.querySelector(`[data-peer-id="${peerId}"]`);
  if (container) container.remove();
}

// Добавьте функцию пересчета размеров
function updateVideoSizes() {
  const containers = document.querySelectorAll('.video-container');
  const count = containers.length;
  
  containers.forEach((container, index) => {
    // Удаляем старые классы
    container.classList.remove(...Array.from(container.classList).filter(c => c.startsWith('width-peer')));
    
    // Добавляем новый класс
    container.classList.add(`width-peer${count > 8 ? '' : count}`);
  });
}

// Обновите обработчик кнопки камеры:
document.getElementById("stopVideo")?.addEventListener("click", () => {
  if (!userStream) return;
  
  const videoTrack = userStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    
    // Обновляем состояние
    userVideoAudio.localUser.video = videoTrack.enabled;
    
    // Обновляем иконку
    const icon = document.querySelector("#stopVideo i");
    if (icon) {
      icon.className = videoTrack.enabled ? "fa fa-video" : "fa fa-video-slash";
    }
    
    // Показываем/скрываем placeholder
    const myContainer = document.querySelector(`.video-container[data-peer-id="${socket.id}"]`);
    if (myContainer) {
      const placeholder = myContainer.querySelector('.video-placeholder');
      if (placeholder) {
        placeholder.style.display = videoTrack.enabled ? 'none' : 'flex';
      }
    }
    
    // Уведомляем других участников
    socket.emit('BE-toggle-camera-audio', { 
      roomId: ROOM_ID, 
      switchTarget: 'video' 
    });
  }
});

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

document.getElementById("exit-conference-btn")?.addEventListener("click", () => {
  if (confirm("Выйти из конференции?")) {
    socket.emit('BE-leave-room', { roomId: ROOM_ID });
    window.location.href = "/";
  }
});

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

// Emoji кнопки (ИСПРАВЛЕННАЯ ВЕРСИЯ)
document.querySelectorAll(".emoji-button").forEach(btn => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    const emoji = btn.getAttribute("data-emoji");
    const input = document.getElementById("chat_message");
    
    if (input) {
      // Вставляем эмодзи в конец текста
      input.value += emoji;
      input.focus(); // Возвращаем фокус в поле ввода
    } else {
      // Если нет поля ввода - отправляем сразу как сообщение
      socket.emit('BE-send-message', { 
        roomId: ROOM_ID, 
        msg: emoji, 
        sender: currentUser 
      });
    }
  });
});


window.addEventListener("beforeunload", () => {
  console.log('👋 Выход из конференции');
  socket.emit('BE-leave-room', { roomId: ROOM_ID });
  
  if (userStream) {
    userStream.getTracks().forEach(track => track.stop());
  }
  
  peersRef.forEach(({ peer }) => {
    if (peer && typeof peer.destroy === 'function') {
      peer.destroy();
    }
  });
  
  socket.disconnect();
});