"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const videoGrid = document.getElementById("video-grid");
  if (!videoGrid) {
    console.error("❌ video-grid не найден");
    return;
  }

  let whiteboardContainer = null;
  let canvas = null;
  let context = null;
  let whiteboardOpened = false;
  let uiAdded = false;

  let drawing = false;
  let currentColor = "#000000";
  let lineWidth = 2;
  let currentTool = "brush";
  let collectedPoints = [];

  // ✅ ИСПРАВЛЕНИЕ #3: Ждем, пока script.js создаст socket
  let socket = null;
  
  async function waitForSocket() {
    return new Promise((resolve) => {
      if (window.socket) {
        resolve(window.socket);
      } else {
        console.log("⏳ Ожидаем создания socket из script.js...");
        const interval = setInterval(() => {
          if (window.socket) {
            clearInterval(interval);
            console.log("✅ Socket получен из window.socket");
            resolve(window.socket);
          }
        }, 100);
        
        // Таймаут на 10 секунд
        setTimeout(() => {
          clearInterval(interval);
          console.error("❌ Таймаут ожидания socket");
          resolve(null);
        }, 10000);
      }
    });
  }

  socket = await waitForSocket();
  
  if (!socket) {
    console.error("❌ Socket не найден, белая доска не будет работать");
    return;
  }

  function initWhiteboard() {
    if (whiteboardContainer) {
      console.log("⚠️ Доска уже инициализирована");
      return;
    }

    console.log("🎨 Инициализация белой доски");

    whiteboardContainer = document.createElement("div");
    whiteboardContainer.id = "shared-whiteboard";
    whiteboardContainer.style.display = "none";
    whiteboardContainer.style.backgroundColor = "white";
    whiteboardContainer.style.border = "3px solid #faa81a";
    whiteboardContainer.style.borderRadius = "12px";
    whiteboardContainer.style.position = "relative";
    whiteboardContainer.style.gridColumn = "1 / -1";
    whiteboardContainer.style.aspectRatio = "16/9";
    whiteboardContainer.style.maxHeight = "70vh";
    whiteboardContainer.style.width = "100%";

    canvas = document.createElement("canvas");
    canvas.id = "whiteboard-canvas";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = "none";
    canvas.style.cursor = "crosshair";
    canvas.style.display = "block";
    
    context = canvas.getContext("2d");
    
    whiteboardContainer.appendChild(canvas);
    videoGrid.insertBefore(whiteboardContainer, videoGrid.firstChild);

    addUIControls();
    setupCanvasListeners();
    updateCanvasSize();
    
    window.addEventListener("resize", updateCanvasSize);
  }

  function updateCanvasSize() {
    if (!canvas || !whiteboardContainer) return;
    const rect = whiteboardContainer.getBoundingClientRect();
    const oldImageData = context.getImageData(0, 0, canvas.width, canvas.height);
    canvas.width = rect.width;
    canvas.height = rect.height;
    context.putImageData(oldImageData, 0, 0);
    console.log("📐 Canvas размер обновлен:", canvas.width, "x", canvas.height);
  }

  function setupCanvasListeners() {
    canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      drawing = true;
      const pos = getPointerPos(e);
      collectedPoints = [pos];
      context.beginPath();
      context.moveTo(pos.x, pos.y);
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      e.preventDefault();
      const pos = getPointerPos(e);
      collectedPoints.push(pos);
      context.lineTo(pos.x, pos.y);
      context.strokeStyle = currentTool === "eraser" ? "#FFFFFF" : currentColor;
      context.lineWidth = lineWidth;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.stroke();

      socket.emit("whiteboardDraw", {
        tool: currentTool,
        color: currentColor,
        lineWidth: lineWidth,
        points: collectedPoints.slice(-2)
      });
    });

    canvas.addEventListener("pointerup", (e) => {
      e.preventDefault();
      drawing = false;
      collectedPoints = [];
    });

    canvas.addEventListener("pointerleave", (e) => {
      if (drawing) {
        drawing = false;
        collectedPoints = [];
      }
    });
  }

  function getPointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function clearWhiteboard() {
    console.log("🧹 Очистка доски");
    context.clearRect(0, 0, canvas.width, canvas.height);
    socket.emit("whiteboardClear");
  }

  function addUIControls() {
    if (uiAdded) return;

    const controlsDiv = document.createElement("div");
    controlsDiv.id = "whiteboard-controls";
    controlsDiv.style.cssText = `
      position: absolute;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 8px;
      background: rgba(0,0,0,0.85);
      padding: 12px 16px;
      border-radius: 12px;
      z-index: 100;
      box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    `;

    const clearBtn = document.createElement("button");
    clearBtn.textContent = "🧹 Очистить";
    clearBtn.style.cssText = `
      padding: 8px 12px;
      background: #ff4444;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.2s;
    `;
    clearBtn.addEventListener("mouseenter", () => clearBtn.style.background = "#cc0000");
    clearBtn.addEventListener("mouseleave", () => clearBtn.style.background = "#ff4444");
    clearBtn.addEventListener("click", clearWhiteboard);
    controlsDiv.appendChild(clearBtn);

    const toolBtn = document.createElement("button");
    toolBtn.textContent = "🖌️ Кисть";
    toolBtn.style.cssText = `
      padding: 8px 12px;
      background: #4CAF50;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.2s;
    `;
    toolBtn.addEventListener("click", () => {
      currentTool = currentTool === "brush" ? "eraser" : "brush";
      toolBtn.textContent = currentTool === "brush" ? "🖌️ Кисть" : "🧽 Ластик";
      toolBtn.style.background = currentTool === "brush" ? "#4CAF50" : "#ff9800";
    });
    controlsDiv.appendChild(toolBtn);

    const colorLabel = document.createElement("span");
    colorLabel.textContent = "Цвет:";
    colorLabel.style.cssText = "color: white; display: flex; align-items: center; margin-left: 8px;";
    controlsDiv.appendChild(colorLabel);

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = currentColor;
    colorInput.style.cssText = `
      width: 40px;
      height: 36px;
      cursor: pointer;
      border: 2px solid white;
      border-radius: 6px;
    `;
    colorInput.addEventListener("change", (e) => {
      currentColor = e.target.value;
      console.log("🎨 Цвет изменен:", currentColor);
    });
    controlsDiv.appendChild(colorInput);

    const thicknessLabel = document.createElement("span");
    thicknessLabel.textContent = "Толщина:";
    thicknessLabel.style.cssText = "color: white; display: flex; align-items: center; margin-left: 12px;";
    controlsDiv.appendChild(thicknessLabel);

    const thicknessInput = document.createElement("input");
    thicknessInput.type = "range";
    thicknessInput.min = "1";
    thicknessInput.max = "20";
    thicknessInput.value = lineWidth;
    thicknessInput.style.cssText = "width: 100px; cursor: pointer;";
    thicknessInput.addEventListener("input", (e) => {
      lineWidth = parseInt(e.target.value);
      console.log("📏 Толщина изменена:", lineWidth);
    });
    controlsDiv.appendChild(thicknessInput);

    whiteboardContainer.appendChild(controlsDiv);
    uiAdded = true;
  }

  function toggleWhiteboard() {
    if (!whiteboardContainer) {
      initWhiteboard();
    }

    whiteboardOpened = !whiteboardOpened;

    if (whiteboardOpened) {
      console.log("✏️ Открываем доску");
      whiteboardContainer.style.display = "block";
      setTimeout(() => updateCanvasSize(), 100);
      socket.emit("whiteboardOpen");
    } else {
      console.log("✏️ Закрываем доску");
      whiteboardContainer.style.display = "none";
      socket.emit("whiteboardClose");
    }
  }

  const whiteboardButton = document.getElementById("whiteboardButton");
  if (whiteboardButton) {
    whiteboardButton.addEventListener("click", toggleWhiteboard);
  } else {
    console.error("❌ Кнопка whiteboardButton не найдена");
  }

  // Socket события
  socket.on("whiteboardDraw", (data) => {
    if (!data || !data.points || data.points.length === 0) return;

    context.beginPath();
    context.moveTo(data.points[0].x, data.points[0].y);
    
    for (let i = 1; i < data.points.length; i++) {
      context.lineTo(data.points[i].x, data.points[i].y);
    }

    context.strokeStyle = data.tool === "eraser" ? "#FFFFFF" : data.color;
    context.lineWidth = data.lineWidth;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke();
  });

  socket.on("whiteboardClear", () => {
    if (context && canvas) {
      console.log("🧹 Получено событие очистки доски");
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
  });

  socket.on("whiteboardOpen", () => {
    if (!whiteboardOpened) {
      console.log("📢 Другой участник открыл доску");
      toggleWhiteboard();
    }
  });

  socket.on("whiteboardClose", () => {
    if (whiteboardOpened) {
      console.log("📢 Другой участник закрыл доску");
      toggleWhiteboard();
    }
  });
});