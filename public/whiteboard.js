"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const videoGrid = document.getElementById("video-grid");
  if (!videoGrid) {
    console.error("video-grid не найден");
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

  const socket = window.socket || io(window.location.origin);

  function initWhiteboard() {
    if (whiteboardContainer) return;

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

    canvas = document.createElement("canvas");
    canvas.id = "whiteboard-canvas";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = "none";
    canvas.style.cursor = "crosshair";
    
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
    canvas.width = rect.width;
    canvas.height = rect.height;
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
  }

  function getPointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  function clearWhiteboard() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    socket.emit("whiteboardClear");
  }

  function addUIControls() {
    if (uiAdded) return;

    const controlsDiv = document.createElement("div");
    controlsDiv.id = "whiteboard-controls";
    controlsDiv.style.position = "absolute";
    controlsDiv.style.bottom = "16px";
    controlsDiv.style.left = "50%";
    controlsDiv.style.transform = "translateX(-50%)";
    controlsDiv.style.display = "flex";
    controlsDiv.style.gap = "8px";
    controlsDiv.style.background = "rgba(0,0,0,0.8)";
    controlsDiv.style.padding = "12px";
    controlsDiv.style.borderRadius = "8px";
    controlsDiv.style.zIndex = "100";

    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Очистить";
    clearBtn.style.padding = "8px 12px";
    clearBtn.style.background = "#444";
    clearBtn.style.color = "white";
    clearBtn.style.border = "none";
    clearBtn.style.borderRadius = "4px";
    clearBtn.style.cursor = "pointer";
    clearBtn.addEventListener("click", clearWhiteboard);
    controlsDiv.appendChild(clearBtn);

    const toolBtn = document.createElement("button");
    toolBtn.textContent = "Кисть";
    toolBtn.style.padding = "8px 12px";
    toolBtn.style.background = "#444";
    toolBtn.style.color = "white";
    toolBtn.style.border = "none";
    toolBtn.style.borderRadius = "4px";
    toolBtn.style.cursor = "pointer";
    toolBtn.addEventListener("click", () => {
      currentTool = currentTool === "brush" ? "eraser" : "brush";
      toolBtn.textContent = currentTool === "brush" ? "Кисть" : "Ластик";
    });
    controlsDiv.appendChild(toolBtn);

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = currentColor;
    colorInput.style.width = "40px";
    colorInput.style.height = "36px";
    colorInput.style.cursor = "pointer";
    colorInput.addEventListener("change", (e) => {
      currentColor = e.target.value;
    });
    controlsDiv.appendChild(colorInput);

    const thicknessInput = document.createElement("input");
    thicknessInput.type = "range";
    thicknessInput.min = "1";
    thicknessInput.max = "20";
    thicknessInput.value = lineWidth;
    thicknessInput.style.width = "100px";
    thicknessInput.addEventListener("input", (e) => {
      lineWidth = parseInt(e.target.value);
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
      whiteboardContainer.style.display = "block";
      updateCanvasSize();
      socket.emit("whiteboardOpen");
    } else {
      whiteboardContainer.style.display = "none";
      socket.emit("whiteboardClose");
    }
  }

  const whiteboardButton = document.getElementById("whiteboardButton");
  if (whiteboardButton) {
    whiteboardButton.addEventListener("click", toggleWhiteboard);
  }

  socket.on("whiteboardDraw", (data) => {
    if (!data || !data.points || data.points.length === 0) return;

    context.beginPath();
    context.moveTo(data.points[0].x, data.points[0].y);
    
    for (let i = 1; i < data.points.length; i++) {
      context.lineTo(data.points[i].x, data.points[i].y);
    }

    context.strokeStyle = data.tool === "eraser" ? "#FFFFFF" : data.color;
    context.lineWidth = data.lineWidth;
    context.stroke();
  });

  socket.on("whiteboardClear", () => {
    if (context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
  });
});