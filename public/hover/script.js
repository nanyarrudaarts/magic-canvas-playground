/**
 * Hover-driven frame animation — hotspots + PAUSE FRAME CONTROL
 * ------------------------------------------------------------
 * - 5 hotspots invisíveis (polígonos em fração da imagem, 0..1).
 * - Máquina de estados por sequência:
 *     IDLE → PLAYING_TO_PAUSE → PAUSED_AT_TARGET → PLAYING_TO_END → FINISHED
 * - Mouse entra → reproduz do primeiro frame até o frame de pausa e CONGELA.
 * - Mouse sai   → continua do frame de pausa até o último frame e PARA.
 * - Playback baseado em tempo (requestAnimationFrame + duração fixa por
 *   frame) com crossfade entre frames vizinhos para eliminar saltos.
 * - Mover o mouse dentro do hotspot nunca reinicia a animação.
 */
(function () {
  "use strict";

  // ---------- Configuração ----------
  const CONFIG = {
    path: "../frames/",
    prefix: "ezgif-frame-",
    extension: ".jpg",
    padLength: 3,
    baseFrame: 25,        // frame exibido em repouso
    frameDuration: 72,    // ms por frame em 1× (micro-interaction, não GIF)
    crossfade: true,      // mistura suave entre frames vizinhos

  };

  const DEFAULTS = { speed: 1, precision: 100 };

  /** Hotspots — ordem = prioridade em sobreposição (frente primeiro). */
  const HOTSPOTS = [
    {
      id: "sticker",
      start: 203, pause: 218, end: 232,
      polygon: [[0.459, 0.517], [0.525, 0.517], [0.525, 0.600], [0.459, 0.600]],
    },
    {
      id: "micard",
      start: 159, pause: 179, end: 191,
      polygon: [[0.398, 0.500], [0.438, 0.494], [0.446, 0.606], [0.405, 0.606]],
    },
    {
      id: "postcard",
      start: 108, pause: 129, end: 141,
      polygon: [[0.537, 0.439], [0.603, 0.450], [0.600, 0.556], [0.550, 0.583], [0.531, 0.522]],
    },
    {
      id: "fineart",
      start: 51, pause: 81, end: 100,
      polygon: [[0.403, 0.394], [0.500, 0.387], [0.501, 0.528], [0.406, 0.528]],
    },
    {
      id: "carta",
      start: 25, pause: 31, end: 50,
      polygon: [[0.459, 0.322], [0.597, 0.314], [0.600, 0.444], [0.544, 0.472], [0.500, 0.450], [0.500, 0.391], [0.459, 0.394]],
    },
  ];

  const STATE = {
    IDLE: "IDLE",
    PLAYING_TO_PAUSE: "PLAYING_TO_PAUSE",
    PAUSED_AT_TARGET: "PAUSED_AT_TARGET",
    PLAYING_TO_END: "PLAYING_TO_END",
    FINISHED: "FINISHED",
  };

  // ---------- Elementos ----------
  const container = document.getElementById("animation-container");
  const canvas = document.getElementById("animation-canvas");
  const ctx = canvas.getContext("2d");
  const loader = document.getElementById("loader");
  const loaderFill = document.getElementById("loader-fill");
  const loaderText = document.getElementById("loader-text");
  const controls = document.getElementById("controls");
  const controlsToggle = document.getElementById("controls-toggle");
  const speedInput = document.getElementById("speed");
  const speedValue = document.getElementById("speed-value");
  const precisionInput = document.getElementById("precision");
  const precisionValue = document.getElementById("precision-value");
  const resetButton = document.getElementById("reset");

  // ---------- Etapa de scroll (frames 001–024) ----------
  // Camada anterior e independente: controla exclusivamente os frames
  // 001→024. No frame 024 acontece o HANDOFF — o frame fica estático e o
  // sistema de hover existente (intocado) assume o controle.
  const SCROLL = { start: 1, end: 24 };

  // ---------- Estado ----------
  const frames = new Map();
  const neededFrames = [];
  for (let n = SCROLL.start; n <= SCROLL.end; n++) neededFrames.push(n);
  HOTSPOTS.forEach((h) => {
    for (let n = h.start; n <= h.end; n++) neededFrames.push(n);
  });
  if (!neededFrames.includes(CONFIG.baseFrame)) neededFrames.push(CONFIG.baseFrame);

  /**
   * Sequência em exibição (apenas uma por vez, pois há um único canvas):
   * { hotspot, state, pos (float, índice dentro da sequência), skipPause, rush }
   */
  let seq = null;
  let hovered = null;        // hotspot sob o cursor (após estabilização)
  let pendingStart = null;   // hotspot que aguarda a sequência atual terminar
  let lastDrawKey = "";      // evita redesenho sem mudança
  let rafId = null;
  let lastTime = null;

  let speed = DEFAULTS.speed;
  let precision = DEFAULTS.precision / 100;

  // ---------- Utilidades ----------

  function frameFileName(frameNumber) {
    return `${CONFIG.path}${CONFIG.prefix}${String(frameNumber).padStart(CONFIG.padLength, "0")}${CONFIG.extension}`;
  }

  function resolveFrame(frameNumber, hotspot) {
    if (frames.get(frameNumber)) return frames.get(frameNumber);
    const lo = hotspot ? hotspot.start : CONFIG.baseFrame;
    const hi = hotspot ? hotspot.end : CONFIG.baseFrame;
    for (let offset = 1; offset <= hi - lo; offset++) {
      const a = frameNumber - offset;
      const b = frameNumber + offset;
      if (a >= lo && frames.get(a)) return frames.get(a);
      if (b <= hi && frames.get(b)) return frames.get(b);
    }
    return frames.get(CONFIG.baseFrame) || null;
  }

  function pointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  const expandedCache = new WeakMap();
  function expandedPolygon(hotspot) {
    const margin = 0.01 + (1 - precision) * 0.05;
    const cached = expandedCache.get(hotspot);
    if (cached && cached.margin === margin) return cached.polygon;
    const cx = hotspot.polygon.reduce((s, p) => s + p[0], 0) / hotspot.polygon.length;
    const cy = hotspot.polygon.reduce((s, p) => s + p[1], 0) / hotspot.polygon.length;
    const polygon = hotspot.polygon.map(([px, py]) => {
      const dx = px - cx;
      const dy = py - cy;
      const len = Math.hypot(dx, dy) || 1;
      return [px + (dx / len) * margin, py + (dy / len) * margin];
    });
    expandedCache.set(hotspot, { margin, polygon });
    return polygon;
  }

  function hotspotAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    if (hovered && pointInPolygon(x, y, expandedPolygon(hovered))) return hovered;
    for (const h of HOTSPOTS) {
      if (pointInPolygon(x, y, h.polygon)) return h;
    }
    return null;
  }

  // ---------- Renderização ----------

  function ensureCanvasSize(img) {
    if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
    }
  }

  function drawStatic(frameNumber, hotspot) {
    const key = `s:${frameNumber}`;
    if (key === lastDrawKey) return;
    const img = resolveFrame(frameNumber, hotspot);
    if (!img) return;
    ensureCanvasSize(img);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    lastDrawKey = key;
  }

  /** Desenha a posição fracionária da sequência com crossfade entre vizinhos. */
  function drawSequence(s) {
    const h = s.hotspot;
    const idx = Math.floor(s.pos);
    const frac = s.pos - idx;
    const fa = h.start + idx;
    const fb = Math.min(h.end, fa + 1);

    if (!CONFIG.crossfade || fb === fa || frac < 0.02) {
      drawStatic(fa, h);
      return;
    }
    if (frac > 0.98) {
      drawStatic(fb, h);
      return;
    }

    const key = `x:${fa}:${Math.round(frac * 64)}`;
    if (key === lastDrawKey) return;
    const a = resolveFrame(fa, h);
    const b = resolveFrame(fb, h);
    if (!a) return;
    ensureCanvasSize(a);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(a, 0, 0, canvas.width, canvas.height);
    if (b && b !== a) {
      ctx.globalAlpha = frac;
      ctx.drawImage(b, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
    lastDrawKey = key;
  }

  // ---------- Máquina de estados / loop ----------

  function scheduleRender() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(tick);
  }

  function startSequence(hotspot) {
    seq = {
      hotspot,
      state: STATE.PLAYING_TO_PAUSE,
      pos: 0,
      skipPause: hovered !== hotspot, // saiu antes de chegar à pausa → vai direto ao fim
    };
    lastTime = null;
    scheduleRender();
  }

  function tick(now) {
    rafId = null;

    if (!seq) {
      drawStatic(CONFIG.baseFrame, null);
      lastTime = null;
      return;
    }

    const dt = lastTime === null ? 0 : Math.min(100, now - lastTime);
    lastTime = now;

    const h = seq.hotspot;
    const pauseIdx = h.pause - h.start;
    const endIdx = h.end - h.start;
    const playing = seq.state === STATE.PLAYING_TO_PAUSE || seq.state === STATE.PLAYING_TO_END;

    if (playing) {
      const durPerFrame = CONFIG.frameDuration / speed; // ritmo constante, sem aceleração
      seq.pos += dt / durPerFrame;

      if (seq.state === STATE.PLAYING_TO_PAUSE && !seq.skipPause && seq.pos >= pauseIdx) {
        seq.pos = pauseIdx;
        seq.state = STATE.PAUSED_AT_TARGET;   // congela: nada avança
      } else if (seq.pos >= endIdx) {
        seq.pos = endIdx;
        seq.state = STATE.FINISHED;
      }
    }

    drawSequence(seq);

    if (seq.state === STATE.FINISHED) {
      lastTime = null;
      if (pendingStart) {
        const next = pendingStart;
        pendingStart = null;
        startSequence(next);
      }
      return; // permanece estático no último frame
    }

    if (seq.state === STATE.PAUSED_AT_TARGET) {
      lastTime = null;
      return; // permanece estático no frame de pausa
    }

    scheduleRender();
  }

  // ---------- Eventos de hover (enter / leave derivados) ----------

  function onHotspotEnter(hotspot) {
    if (!seq) {
      startSequence(hotspot);
      return;
    }

    if (seq.hotspot === hotspot) {
      // voltou ao mesmo objeto
      if (seq.state === STATE.PAUSED_AT_TARGET) return;   // já congelado: nada muda
      if (seq.state === STATE.PLAYING_TO_PAUSE) {
        seq.skipPause = false;                            // volta a respeitar a pausa
        return;
      }
      startSequence(hotspot);                             // terminando/terminado: recomeça
      return;
    }

    if (seq.state === STATE.FINISHED) {
      startSequence(hotspot);
      return;
    }

    // outro objeto ainda em movimento: deixa terminar no ritmo normal e depois inicia o novo
    pendingStart = hotspot;
    if (seq.state === STATE.PAUSED_AT_TARGET) seq.state = STATE.PLAYING_TO_END;
    else if (seq.state === STATE.PLAYING_TO_PAUSE) seq.skipPause = true;
    scheduleRender();
  }


  function onHotspotLeave(hotspot) {
    if (pendingStart === hotspot) pendingStart = null;
    if (!seq || seq.hotspot !== hotspot) return;

    if (seq.state === STATE.PAUSED_AT_TARGET) {
      seq.state = STATE.PLAYING_TO_END;  // continua do frame de pausa até o fim
      lastTime = null;
      scheduleRender();
    } else if (seq.state === STATE.PLAYING_TO_PAUSE) {
      seq.skipPause = true;              // ainda não chegou à pausa: segue até o fim
    }
  }

  function commitHotspot(hotspot) {
    if (hotspot === hovered) return;
    const previous = hovered;
    hovered = hotspot;
    container.classList.toggle("over-hotspot", !!hotspot);
    if (hotspot) container.classList.add("interacted");

    if (previous) onHotspotLeave(previous);
    if (hotspot) onHotspotEnter(hotspot);
  }

  // Estabilização temporal: confirma a troca só se o cursor permanecer na região.
  let pendingHotspot = null;
  let pendingTimer = null;

  function setHoveredHotspot(hotspot) {
    if (hotspot === hovered) {
      pendingHotspot = null;
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      return;
    }
    if (hotspot === pendingHotspot) return;

    pendingHotspot = hotspot;
    if (pendingTimer !== null) clearTimeout(pendingTimer);

    const delay = hovered === null ? 0 : 70 + (1 - precision) * 260;
    pendingTimer = window.setTimeout(() => {
      pendingTimer = null;
      commitHotspot(pendingHotspot);
    }, delay);
  }

  function handlePointer(clientX, clientY) {
    // mousemove serve apenas para saber SOBRE QUAL região o cursor está;
    // enter/leave são disparados somente quando a região muda.
    setHoveredHotspot(hotspotAt(clientX, clientY));
  }

  function bindEvents() {
    container.addEventListener("mousemove", (e) => handlePointer(e.clientX, e.clientY), { passive: true });
    container.addEventListener("mouseleave", () => setHoveredHotspot(null), { passive: true });

    const touch = (e) => {
      if (e.touches.length > 0) handlePointer(e.touches[0].clientX, e.touches[0].clientY);
    };
    container.addEventListener("touchstart", touch, { passive: true });
    container.addEventListener("touchmove", touch, { passive: true });
    container.addEventListener("touchend", () => setHoveredHotspot(null), { passive: true });
    container.addEventListener("touchcancel", () => setHoveredHotspot(null), { passive: true });
  }

  // ---------- Painel de ajustes ----------

  function applySpeed(value) {
    speed = Number(value);
    speedInput.value = String(speed);
    speedValue.textContent = speed.toFixed(1) + "×";
  }

  function applyPrecision(value) {
    const pct = Number(value);
    precision = pct / 100;
    precisionInput.value = String(pct);
    precisionValue.textContent = pct + "%";
  }

  function bindControls() {
    ["mousemove", "touchstart", "touchmove"].forEach((type) =>
      controls.addEventListener(type, (e) => e.stopPropagation())
    );
    ["mousemove", "touchstart", "touchmove"].forEach((type) =>
      controlsToggle.addEventListener(type, (e) => e.stopPropagation())
    );

    controlsToggle.addEventListener("click", () => {
      const collapsed = controls.classList.toggle("collapsed");
      controlsToggle.setAttribute("aria-expanded", String(!collapsed));
    });

    speedInput.addEventListener("input", (e) => applySpeed(e.target.value));
    precisionInput.addEventListener("input", (e) => applyPrecision(e.target.value));

    resetButton.addEventListener("click", () => {
      applySpeed(DEFAULTS.speed);
      applyPrecision(DEFAULTS.precision);
    });

    applySpeed(DEFAULTS.speed);
    applyPrecision(DEFAULTS.precision);
  }

  // ---------- Preload ----------

  function updateLoader(loaded) {
    const pct = Math.round((loaded / neededFrames.length) * 100);
    loaderFill.style.width = pct + "%";
    loaderText.textContent = `Carregando frames… ${pct}%`;
  }

  function preloadFrames() {
    return new Promise((resolve) => {
      let settled = 0;
      const onSettle = () => {
        settled++;
        updateLoader(settled);
        if (settled === neededFrames.length) resolve();
      };

      neededFrames.forEach((frameNumber) => {
        const img = new Image();
        img.decoding = "async";
        img.onload = () => {
          frames.set(frameNumber, img);
          onSettle();
        };
        img.onerror = () => {
          frames.set(frameNumber, null);
          console.warn("Frame não encontrado:", frameFileName(frameNumber));
          onSettle();
        };
        img.src = frameFileName(frameNumber);
      });
    });
  }

  // ---------- Inicialização ----------

  async function init() {
    bindControls();
    await preloadFrames();

    loader.classList.add("hidden");
    drawStatic(CONFIG.baseFrame, null);
    bindEvents();
  }

  init();
})();
