"usestrict";

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

// Система уровней логирования
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1, 
  INFO: 2,
  DEBUG: 3
};

let currentLogLevel = LOG_LEVELS.INFO; // Можно изменить на DEBUG для отладки

function log(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = type === 'error' ? '❌' : type ==='warn' ? '⚠️' : 'ℹ️';
  console.log(`[${timestamp}] ${prefix}`, message);
  
  const level = type === 'error' ? LOG_LEVELS.ERROR : 
                type === 'warn' ? LOG_LEVELS.WARN : 
                LOG_LEVELS.INFO;
  
  if(level <= currentLogLevel) {
    console.log(`[${timestamp}] ${prefix}`, message);
  }
}

// Функция для отладочных логов (только для разработки)
function debug(message) {
  if (currentLogLevel >= LOG_LEVELS.DEBUG) {
    console.log(`[${new Date().toLocaleTimeString()}] 🔍`, message);
  }
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

  // Дополнительные проверки для мобильных устройствconstisMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
  if (isMobile) {
    console.log('📱 Мобильное устройство обнаружено, применяем специальные настройки');
    // Длямобильных устройств используем более простые настройки
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
      console.warn('⚠️ Мобильные браузеры требуют HTTPS для WebRTC');
    }
  }

  console.log('🌐 Проверяемдоступность сервера...');
  console.log('🌐 URL сервера:', window.location.origin);
  
  // Проверяем доступность сервера перед инициализацией
  fetch(window.location.origin + '/healthz')
    .then(response => {
      console.log('📡 Ответ от /healthz:', response.status, response.statusText);
      if (response.ok) {
        console.log('✅ Сервер доступен, продолжаем инициализацию');
        initializeApp();
      } else {
        console.log('❌ Сервер отвечает с ошибкой:', response.status);
        showServerError('Сервер отвечаетсошибкой. Попробуйте позже.');
      }
    })
    .catch(err => {
      console.log('❌ Сервер недоступен:', err.message);
      showServerError('Сервер недоступен. Проверьте подключение к интернету или попробуйте позже.');
    });

  function showServerError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
      position: fixed; top: 20px; right: 20px; background: #ff4444; color: white;
padding: 15px; border-radius: 5px; z-index: 10000; max-width: 400px;
    `;
    errorDiv.innerHTML = `
      <strong>Ошибка подключения к серверу</strong><br>
      ${message}<br>
      <small>URL: ${window.location.origin}</small>
    `;
    document.body.appendChild(errorDiv);
    
    setTimeout(() => {
      if (errorDiv.parentNode) {
        errorDiv.parentNode.removeChild(errorDiv);
      }
    }, 10000);
  }

  function initializeApp() {
    // Проверяем доступность основного сервера перед инициализацией
    fetch(window.location.origin + '/healthz')
      .then(response => {
        if (!response.ok) {
          throw new Error(`Основной сервер недоступен: ${response.status}`);
        }
        console.log('✅ Основной сервер доступен');
        
        socket = io(window.location.origin, {
          transports: ["polling"], // Принудительно используем polling для совместимости с Render.com
          reconnection: true,
          reconnectionAttempts: 10, // Увеличиваем количество попыток восстановления
          reconnectionDelay: 2000, // Увеличиваем задержку между попытками
          reconnectionDelayMax: 10000,
          randomizationFactor: 0.5,
          timeout: 30000 // Увеличиваем таймаут
        });

        initializePeerConnection();
      })
      .catch(err => {
        console.log('❌ Основной сервер недоступен:', err.message);
        log('Основной сервер недоступен. Повторная попытка через 5 секунд...', 'warn');
        
        setTimeout(() => {
          initializeApp();
        }, 5000);
      });
  }
    
function createPeerConnectionWithConfig(config = PEER_CONFIG) {
    peer = new Peer(undefined, {
      host: config.host,
      port: config.port,
      path: config.path,
      secure: config.secure,
      config: config.config,
      debug: 2
    });

    // ВАЖНО: ловим входящие до getUserMedia
    peer.on("call", handleIncomingCall);

    peer.on("open", (id) => {
      log("PeerJS подключен: " + id);
      participants[id] = userName;
      peerReady = true;
      reconnectAttempts = 0; // Сбрасываем счетчик попыток при успешном подключении
      tryJoin();
    });

    peer.on("error", (error) => {
      console.error("❌ PeerJS ошибка:", error);
      log("Ошибка PeerJS: " + error.type, 'error');
      
      //Добавляем автоматическое восстановление соединения при потере связи
      if (error.type === 'network' || error.type === 'disconnected' || error.type === 'server-error' || error.type === 'webrtc-error') {
        log("Попытка восстановления PeerJS соединения...", 'warn');
        reconnectAttempts++;
        
        if (reconnectAttempts >= maxReconnectAttempts) {
          log('Не удалось восстановить PeerJS соединение. Перезагрузите страницу.', 'error');
          // Добавим дополнительную информацию о возможных причинах
          if (error.type === 'server-error') {
            log('Сервер PeerJS недоступен. Проверьте подключение к интернету или попробуйте позже.', 'error');
          }
          return;
        }
        
        setTimeout(() => {
          if (peer && !peer.destroyed) {
            // Если соединениепотеряно, пробуем переподключиться
            if (peer.disconnected) {
              peer.reconnect();
            } else {
              // Иначе полностью пересоздаем соединение
              peer.destroy();
              initializePeerConnection();
            }
          }
        }, Math.min(2000* reconnectAttempts, 15000)); // Экспоненциальная задержка
      }
    });

    peer.on("disconnected", () => {
      console.log("🔌 PeerJS отключен");
      log("PeerJS соединение потеряно", 'warn');
      // Автоматическое восстановление соединения
      setTimeout(() => {
        if (peer && !peer.destroyed) {
          peer.reconnect();
        }
      }, 1000);
    });
    
    // Добавляем обработку потери соединения с сервером PeerJS
    setInterval(()=> {
      if (peer && !peer.disconnected && !peer.destroyed) {
        // Проверяем состояние соединения
        if (peer.socket && peer.socket.disconnected) {
          console.log("🔁 Принудительное восстановление PeerJS соединения");
          peer.reconnect();
       }
      }
    }, 30000); // Проверяем каждые 30 секунд
  }

  function createPeerConnection() {
    // Проверяем доступность сервера PeerJS перед подключением
    const peerHost = PEER_CONFIG.host;
    const peerPort = PEER_CONFIG.port;
    const peerPath = PEER_CONFIG.path;
    const protocol = PEER_CONFIG.secure ? 'https' : 'http';
    
    const peerServerUrl = `${protocol}://${peerHost}${peerPort ? ':' + peerPort : ''}${peerPath}`;
    
    console.log('🔍 Проверяем доступность сервера PeerJS:', peerServerUrl);
    
    // Проверяем доступность сервера с таймаутом
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 секунд таймаут
    
    fetch(`${peerServerUrl}/peerjs`, { signal: controller.signal })
      .then(response => {
        clearTimeout(timeoutId);
        if (!response.ok) {
          throw new Error(`Сервер PeerJS недоступен: ${response.status}`);
        }
        console.log('✅ Сервер PeerJS доступен');
        
        // Небольшая задержка перед подключением к серверу PeerJS
        setTimeout(() => {
          createPeerConnectionWithConfig(PEER_CONFIG);
        }, 1000);
      })
      .catch(err => {
        clearTimeout(timeoutId);
        console.log('❌ Сервер PeerJS недоступен:', err.message);
        log('Сервер PeerJS недоступен. Повторная попытка через 5 секунд...', 'warn');
        
        setTimeout(() => {
          createPeerConnection();
        }, 5000);
      });
  }

  initializePeerConnection();

  //Двухфлажковая синхронизация
  let socketReady = false;
  let peerReady = false;
  let joined = false;
  
  //Добавляем переменные для отслеживания состояния соединения
  let reconnectAttempts = 0;
  const maxReconnectAttempts =5;

 function tryJoin() {
    if(!joined && socketReady && peerReady) {
      joined =true;
     console.log("🚀 Отправляемjoin-room:", { roomId:ROOM_ID, peerId: peer.id, userName });
      socket.emit("join-room", ROOM_ID,peer.id, userName);
      initLocalStream(); //камерузапрашиваем после входа
    } else {
      console.log('⏳ Ожидание готовности:', {socketReady, peerReady,joined });
    }
  }

socket.on('connect', () => {
   console.log('✅ Socket.IOподключен');
   socketReady = true;
    reconnectAttempts = 0; // Сбрасываем счетчик попыток при успешном подключении
    tryJoin();
 });

socket.on('connect_error',(error) => {
   console.error('❌ Socket.IO ошибка подключения:', error);
    console.log('🔍 Проверяем доступностьсервера:',window.location.origin);
    
    // Увеличиваем счетчик попыток восстановления
    reconnectAttempts++;
    
   // Если превышен максимальное количество попыток, показываем сообщение об ошибке
    if (reconnectAttempts >= maxReconnectAttempts) {
       log('Не удалось восстановитьсоединение с сервером. Проверьте подключение к интернету.', 'error');
        return;
}
    
    // Планируем повторную попытку подключения
    setTimeout(() => {
        if(socket&& (socket.connected === false)) {
            console.log('🔁 Повторнаяпопытка подключения к Socket.IO...');
            socket.connect();
        }
    }, Math.min(1000 * reconnectAttempts, 10000)); // Экспоненциальная задержка, максимум 10секунд
    fetch(window.location.origin +'/healthz')
      .then(response => {
        if(response.ok) {
          console.log('✅ Сервер отвечает, но Socket.IO не может подключиться');
        } else {
          console.log('❌Серверотвечаетс ошибкой:', response.status);
        }
      })
      .catch(err => {
        console.log('❌ Сервер недоступен:', err.message);
        log('Сервер недоступен. Проверьте подключение к интернету.', 'error');
      });
    
    log('Ошибкаподключения к серверу. Повторная попытка...', 'warn');
  });

socket.on('disconnect', (reason) =>{
    console.log('🔌Socket.IO отключен:', reason);
   log('Соединение потеряно: ' + reason, 'warn');
    
    // Попытка переподключения при сетевых ошибках
    if(reason === 'transport error' ||reason === 'ping timeout' || reason === 'network error'){
        log('Попытка восстановления Socket.IOсоединения...', 'warn');
        setTimeout(() => {
            if(socket && (socket.connected === false)) {
socket.connect();
            }
        }, 3000);
    }
 });

function toggleFullscreen(element) {
    if (!document.fullscreenElement) {
      element.requestFullscreen().catch(err =>{
        console.error("Ошибка fullscreen:", err);
      });
    }else {
     document.exitFullscreen();
    }
  }
    
  function removeVideoContainerByPeerId(peerId) {
    const container =document.querySelector(`.video-container[data-peer-id="${peerId}"]`);
    if (container)container.remove();
}

  function createVideoElement(){
    const video = document.createElement("video");
   video.autoplay = true;
    video.playsInline= true;
   return video;
  }

  function addVideoStream(video,stream,isLocal = false, displayName = "", peerId = null, options = {}) {
const { unmuteOverlay = false }= options;
    const videoGrid =document.getElementById("video-grid");
    
    console.log('🔍 ПроверкаvideoGrid:', {
videoGrid: !!videoGrid,
videoGridId: videoGrid? videoGrid.id : 'null',
videoGridChildren: videoGrid? videoGrid.children.length : 0
});

    if (!videoGrid) {
console.error('❌ videoGrid не найден в DOM!');
      console.log('🔍 ПоискvideoGrid:', document.getElementById("video-grid"));
console.log('🔍Все элементы с классомvideo-grid:', document.querySelectorAll('.video-grid'));
      return;
    }

   console.log('📹 Добавляем видео:', {isLocal, 
      displayName, 
      peerId, 
      hasStream:!!stream,
videoGridExists: !!videoGrid,
videoGridChildren:videoGrid.children.length});

    let container= null;
    if (peerId){
      container= document.querySelector(`.video-container[data-peer-id="${peerId}"]`);
    }
    if(!container) {
      container = document.createElement("div");
     container.classList.add("video-container");
     if (peerId)container.setAttribute("data-peer-id",peerId);
    
      const nameLabel = document.createElement("div");
      nameLabel.className = "video-placeholder";
     nameLabel.textContent = displayName || (isLocal ? "Вы" : "Участник");
      container.appendChild(nameLabel);

      const wrapper = document.createElement("div");
wrapper.className ="video-wrapper";
      wrapper.style.position = "relative";
      container.appendChild(wrapper);

      video.playsInline = true;
      video.autoplay= true;
      // ВАЖНО:на мобильных видео с аудио неавтоплеится — стартуем в mutedvideo.muted =isLocal|| unmuteOverlay; // для удалённого — true, потом дадим кнопкой включить

      wrapper.appendChild(video);
      videoGrid.appendChild(container);

      container.addEventListener("dblclick", () => {
        console.log('🖥️ Дабл клик на видео:',peerId || 'local');
if (!document.fullscreenElement) {
          container.requestFullscreen().catch(()=>{});
       } else {
          document.exitFullscreen().catch(()=>{});
        }
      });

      // Добавим визуальную подсказку длядабл клика
      container.title= "Двойнойкликдля полноэкранного режима";
    }

    if(stream) video.srcObject= stream;

    const tryPlay = () =>{
      const p = video.play();
      if (p && typeof p.catch === "function") {
      p.catch(() => {
          if (!isLocal&& unmuteOverlay)showTapToUnmute(container, video);
        });
     }
    };

    if (video.readyState >= 2) tryPlay();
   else video.onloadedmetadata = tryPlay;
    
   console.log('✅ Видеодобавлено:',{ 
peerId, 
      displayName,containerExists: !!container,
videoInDOM: !!video.parentNode 
   });
  }

  function showTapToUnmute(container, video) {
   if (container.querySelector(".tap-to-unmute")) return;
    const overlay = document.createElement("div");
    overlay.className ="tap-to-unmute";
overlay.style.cssText= `
     position:absolute;inset:0; display:flex;align-items:center; justify-content:center;
      background:rgba(0,0,0,.35); color:#fff; font-weight:600;cursor:pointer; z-index:50;
`;
    overlay.textContent= "Нажмите, чтобывключить звук/видео";
    overlay.addEventListener("click", async () => {
try {
        video.muted = false;
        await video.play();
        overlay.remove();
      }catch(e) {
        console.log("Autoplay stillblocked:", e);
     }
    });
container.appendChild(overlay);
 }

functionattachCallDebug(call) {
    const pc = call.peerConnection || call._pc;
if (pc) {
      console.log('🔗 Создано WebRTC соединение с:', call.peer);
      
      pc.addEventListener('iceconnectionstatechange', ()=> {
console.log('🧊 ICE состояние:', call.peer, pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed') {
console.log('❌ ICE соединение провалено для:', call.peer);
          console.log('💡 Попробуйте отключитьVPN илииспользовать другой интернет');
        }
     });
      
pc.addEventListener('connectionstatechange', () => {
        console.log('🔌 PC состояние:', call.peer,pc.connectionState);
        if (pc.connectionState === 'connected') {
          console.log('✅ WebRTC соединение установлено с:',call.peer);
       }
});
      
pc.addEventListener('icegatheringstatechange',() => {
console.log('🌐 ICE gathering:', call.peer, pc.iceGatheringState);
});
    }
  }

  function connectToNewUser(userId, stream, connectedUserName) {
    console.log('📞 Вызываем пользователя:',{ userId,connectedUserName});
    console.log('🔍 Проверка состояния:',{ 
     hasUserId: !!userId, 
      hasStream: !!stream, 
      hasPeer: !!peer, 
      peerDisconnected: peer?.disconnected 
    });
    
    if (!userId ||!stream || !peer|| peer.disconnected){
     console.log('❌ Невозможно подключиться: недостаточно данных');
      return;
    }

    // Проверяем,невызываем ли уже этого пользователя
    if (calls[userId]) {
      console.log('⚠️ Ужевызываем пользователя:',userId);
      return;
}
    
try {
      const call =peer.call(userId, stream,{
        metadata: { userName: userName }
      });

      if (!call)return;

// Add debugging for ICE connection states
      attachCallDebug(call);

      const video = createVideoElement();

      call.on("stream",(userVideoStream) =>{
        console.log("Полученстримот пользователя: ", userId);
addVideoStream(video, userVideoStream, false, connectedUserName,userId);
      });

      call.on("error", (err) => {
        console.error("Ошибка вызова:", err);
        call.close();
      });

      call.on("close", () =>{
        removeVideoContainerByPeerId(userId);
      });

calls[userId] = call;
    } catch (e) {
console.error("Ошибка:", e);
    }
}

  async function initLocalStream() {
    if (myVideoStream) return;

   try{
//сначала пробуем свидео+аудиоconst isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      
const videoConstraints = isMobile ? 
        { width: { ideal:640}, height: { ideal: 480}, facingMode: "user" } :
       { width: { ideal: 1280 },height: { ideal: 720 }, facingMode:"user"};
      
      const audioConstraints = isMobile ?
        { echoCancellation:true,noiseSuppression: true } :
        { echoCancellation:true, noiseSuppression: true, autoGainControl:true };
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
       audio: audioConstraints
});

      myVideoStream = stream;

      // выключаем видеопоумолчанию
      const v=stream.getVideoTracks()[0];
      if (v) {
       v.enabled = false;
        console.log('📹 Видео выключено по умолчанию');
      }
const iconV = document.querySelector("#stopVideo i");
    if(iconV){
        iconV.className = "fa fa-video-slash";
console.log('🔴 Иконка видео обновлена на"выключено"');
      }

      addVideoStream(myVideo, stream, true, userName + "(Вы)");

      // обработка входящих звонков
peer.on("call", handleIncomingCall);

// Подключаемся к тем, кого не успели подключить
      if (pendingToConnect.size> 0) {
        for (const uidof Array.from(pendingToConnect)){
          connectToNewUser(uid, myVideoStream, participants[uid] ||"Участник");
pendingToConnect.delete(uid);
       }
      }
   } catch (err1) {
      // если камеране разрешена, пробуем только аудио
      try {
        const stream= await navigator.mediaDevices.getUserMedia({ audio: true,video: false});
       myVideoStream =stream;
addVideoStream(myVideo, stream, true, userName + " (Вы)");
        peer.on("call",handleIncomingCall);

        if (pendingToConnect.size > 0) {
          for (const uid of Array.from(pendingToConnect)) {
connectToNewUser(uid,myVideoStream,participants[uid]|| "Участник");
            pendingToConnect.delete(uid);
          }
        }
      } catch (err2) {
        // если и аудио не дали — всё равно пусть сможете хотя бы смотреть
        log("Нет доступак камере/микрофону. Выбудете без собственного стрима.", 'warn');
        peer.on("call", handleIncomingCall);
      }
    }
  }

function handleIncomingCall(call) {
    console.log('📞 Получен входящий вызов от:',call.peer);
    
// Проверяем,не обрабатываемли ужеэтот вызовif (calls[call.peer]) {
      console.log('⚠️ Вызов от', call.peer, 'уже обрабатывается');
      return;
    }

    if (call.metadata && call.metadata.type ==="screen-share") {
call.answer();
      const remoteVideo = createVideoElement();
const containerId= call.peer + "-screen";
      call.on("stream", (remoteStream) => {
addVideoStream(remoteVideo, remoteStream, false, "🖥️ Демонстрация", containerId,{ unmuteOverlay: true});
      });
      call.on("close", () => removeVideoContainerByPeerId(containerId));
      return;
}

    // обычный звонок
    call.answer(myVideoStream || undefined); // отвечаем даже без своего стрима
   const remoteVideo =createVideoElement();

    //создадим контейнер заранее и покажем оверлей для запуска
addVideoStream(remoteVideo, null, false, participants[call.peer]||"Участник", call.peer, { unmuteOverlay: true });

call.on("stream",(remoteStream) =>{
console.log("Полученстрим во входящемвызове от:", call.peer);
      addVideoStream(remoteVideo, remoteStream,false, participants[call.peer] || "Участник", call.peer, { unmuteOverlay: true });
    });

   call.on("close", () => removeVideoContainerByPeerId(call.peer));
   call.on("error", (e) =>console.error("Ошибка вызова:", e));
  }

  if(stopVideo) {
   stopVideo.addEventListener("click",() => {
      if (!myVideoStream) return;
      const videoTrack =myVideoStream.getVideoTracks()[0];
      if(videoTrack) {
videoTrack.enabled= !videoTrack.enabled;
const icon = stopVideo.querySelector("i");
       if (icon) {
icon.className = videoTrack.enabled ? "fafa-video" : "fa fa-video-slash";
       }
     }
});
}

  if (muteButton){
    muteButton.addEventListener("click",() => {
     if (!myVideoStream)return;
      const audioTrack = myVideoStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
      const icon = muteButton.querySelector("i");
        if (icon) {
          icon.className = audioTrack.enabled ? "fafa-microphone": "fa fa-microphone-slash";
}
}
    });
  }

  async function startScreenShare() {
    try {
     const stream = await navigator.mediaDevices.getDisplayMedia({video: true });
      
      constcontainerId = "screen-share-" + Date.now();
      localScreenShareContainerId =containerId;

const container = document.createElement("div");
container.id = containerId;
      container.className = "video-container screen-share-container";

     const videoElement =createVideoElement();
videoElement.srcObject = stream;
     videoElement.muted = true;
      container.appendChild(videoElement);

     videoGrid.appendChild(container);

isScreenSharing= true;
      screenShareStream= stream;
      screenShareButton.innerHTML = '<i class="fa fa-stop-circle"></i>';

for(let userId in calls) {
       try {
const screenCall=peer.call(userId, stream, {
            metadata: {type:"screen-share" }
         });
          screenShareCalls[userId]= screenCall;
       } catch (err) {
          console.error("Ошибка:", err);
        }
      }

     stream.getVideoTracks()[0].onended = ()=> {
       stopScreenShare();
      };

      return stream;
    } catch(error) {
      console.error("Ошибка:", error);
    }
}

  function stopScreenShare(){
    if (screenShareStream) {
      screenShareStream.getTracks().forEach(track => track.stop());
screenShareStream= null;
   }

for (letuserId in screenShareCalls) {
      try {
       screenShareCalls[userId].close();
      } catch(err) {}
     delete screenShareCalls[userId];
    }

    if (localScreenShareContainerId) {
      constcontainer = document.getElementById(localScreenShareContainerId);
if (container)container.remove();
localScreenShareContainerId = null;
    }

    isScreenSharing = false;
    screenShareButton.innerHTML = '<i class="fafa-desktop"></i>';
socket.emit("screenShareStopped", peer.id);
  }

if (screenShareButton){
    screenShareButton.addEventListener("click", async ()=> {
if (!isScreenSharing) {
        await startScreenShare();
} else {
       stopScreenShare();
     }
    });
  }

if (inviteButton) {
    inviteButton.addEventListener("click", () =>{
      const link = window.location.href.split('?')[0];
prompt("Скопируйте ссылку:",link);
   });
  }

  const exitConferenceBtn = document.getElementById("exit-conference-btn");
 if(exitConferenceBtn) {
   exitConferenceBtn.addEventListener("click", () => {
if (confirm("Выйти из конференции?")) {
       window.location.href= "/";
     }
    });
 }

 // Новый участник получил список тех, кто уже в комнате →сам инициирует звонки
socket.on("room-users", (users) => {
   //users: [{ userId, userName }]
   users.forEach(({ userId,userName: uName }) => {
      participants[userId] =uName|| "Участник";
      if (myVideoStream) {
        setTimeout(() =>connectToNewUser(userId, myVideoStream, participants[userId]),300);
} else {
        pendingToConnect.add(userId);
      }
   });
  });

// (опционально)Актуальныйсписок участников для рисования UI
 socket.on("user-list", (list) => {
    // list: [{ userId, userName }]
   // можно нарисоватьбоковую панель участников
console.log("user-list:",list);
  });

  // 2) Еслипришёлновый пользователь, а стримаещё нет —отложимподключение
  socket.on("user-connected", (userId, connectedUserName) => {
participants[userId] = connectedUserName;

    if(userId === peer.id) {
return;
    }

    if (myVideoStream){
      setTimeout(() =>connectToNewUser(userId, myVideoStream, connectedUserName), 500);
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

 socket.on("screenShareStopped", (initiatorPeerId) =>{
    removeVideoContainerByPeerId(initiatorPeerId+"-screen");
  });



    window.addEventListener("beforeunload", ()=>{
if (myVideoStream) {
        myVideoStream.getTracks().forEach(track => track.stop());
      }
socket.disconnect();
      peer.destroy();
});
  } // конец initializeApp
});