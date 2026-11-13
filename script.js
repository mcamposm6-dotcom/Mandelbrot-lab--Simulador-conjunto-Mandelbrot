



"use strict";

// ==========================================
// MANDELBROT LAB · PHYMATH 2026 · UNEMI
// ==========================================

const $ = id => document.getElementById(id);

const canvas = {
  fractal: $("fractalCanvas"),
  overlay: $("overlayCanvas"),
  orbit: $("orbitCanvas"),
  module: $("moduleCanvas")
};

const ctx = Object.fromEntries(
  Object.entries(canvas).map(([key, value]) =>
    [key, value.getContext("2d")]
  )
);

const W = canvas.fractal.width;
const H = canvas.fractal.height;

const defaults = {
  iterations: 180,
  zoom: 1,
  centerReal: -0.5,
  centerImag: 0,
  palette: "cosmic"
};

const controlIds = Object.keys(defaults);

const state = {
  phase: "ready",
  task: null,
  raf: null,
  generation: 0,
  progress: 0,
  point: { a: -1, b: 0 },
  z0: { x: 0, y: 0 },
  orbit: [],
  escape: null,
  radius: 2,
  step: 0,
  selected: false,
  hasRendered: false
};

const clamp = (x, a, b) =>
  Math.max(a, Math.min(b, x));

const fmt = x =>
  Number.isFinite(x)
    ? String(Number(x.toPrecision(6)))
    : "∞";

const complexText = (a, b) =>
  `${fmt(a)} ${b < 0 ? "−" : "+"} ${fmt(Math.abs(b))}i`;

const palettes = {
  cosmic: [
    [7, 16, 50], [44, 62, 161], [135, 62, 214],
    [248, 95, 198], [255, 220, 122]
  ],
  ocean: [
    [4, 28, 58], [8, 96, 145], [20, 187, 221],
    [115, 234, 225], [245, 255, 224]
  ],
  fire: [
    [38, 5, 22], [155, 35, 31], [246, 100, 25],
    [255, 190, 71], [255, 250, 189]
  ],
  mono: [
    [18, 28, 44], [70, 86, 116], [126, 150, 172],
    [204, 218, 231], [255, 255, 255]
  ]
};

// ==========================================
// PANTALLAS
// ==========================================

function navigate(page) {
  if (state.phase === "running" && page !== "lab") {
    pause();
  }

  ["welcome", "credits", "lab"].forEach(id => {
    $(id).hidden = id !== page;
    $(id).classList.toggle("active", id === page);
  });

  window.scrollTo(0, 0);
}

$("toCredits").onclick = () => navigate("credits");
$("backWelcome").onclick = () => navigate("welcome");
$("toLab").onclick = () => navigate("lab");
$("homeBtn").onclick = () => navigate("welcome");

$("logoHome").onclick = e => {
  e.preventDefault();
  navigate("welcome");
};

// ==========================================
// PARTÍCULAS DEL FONDO
// ==========================================

for (let i = 0; i < 22; i++) {
  const bubble = document.createElement("span");
  bubble.className = "bubble";

  bubble.style.setProperty("--left", `${(i * 41 + 17) % 100}%`);
  bubble.style.setProperty("--size", `${8 + (i * 17) % 27}px`);
  bubble.style.setProperty("--duration", `${15 + (i * 7) % 13}s`);
  bubble.style.setProperty("--delay", `${-((i * 11) % 23)}s`);

  $("particles").appendChild(bubble);
}

// ==========================================
// PARÁMETROS
// ==========================================

function parameters() {
  return {
    iterations: Number($("iterations").value),
    zoom: Number($("zoom").value),
    centerReal: Number($("centerReal").value),
    centerImag: Number($("centerImag").value),
    palette: $("palette").value
  };
}

function updateOutputs() {
  const p = parameters();

  $("iterationsOut").textContent = p.iterations;
  $("zoomOut").textContent = p.zoom.toFixed(2) + "×";
  $("centerRealOut").textContent = p.centerReal.toFixed(3);
  $("centerImagOut").textContent = p.centerImag.toFixed(3);

  $("metricIter").textContent = p.iterations;
  $("metricZoom").textContent = p.zoom.toFixed(2) + "×";
}

function updateButtons() {
  const running = state.phase === "running";
  const paused = state.phase === "paused";

  $("pauseBtn").disabled = !running;
  $("continueBtn").disabled = !paused;

  $("startBtn").textContent =
    running || paused ? "↻ Iniciar de nuevo" : "▶ Iniciar";
}

function updateStatus(message, progress = state.progress) {
  state.progress = progress;

  $("statusText").textContent = "● " + message;
  $("percentText").textContent =
    Math.round(progress * 100) + " %";

  $("progressFill").style.width = progress * 100 + "%";
}

function stopTask() {
  if (state.raf !== null) {
    cancelAnimationFrame(state.raf);
  }

  state.raf = null;
  state.task = null;
  state.generation++;
}

function clearCanvas(element) {
  const context = element.getContext("2d");
  context.fillStyle = "#071428";
  context.fillRect(0, 0, element.width, element.height);
}

// ==========================================
// REINICIO MANUAL
// ==========================================

function resetView(restore = false) {
  stopTask();

  state.phase = "ready";
  state.progress = 0;
  state.point = { a: -1, b: 0 };
  state.z0 = { x: 0, y: 0 };
  state.orbit = [];
  state.escape = null;
  state.radius = 2;
  state.step = 0;
  state.selected = false;
  state.hasRendered = false;

  if (restore) {
    Object.entries(defaults).forEach(([id, value]) => {
      $(id).value = value;
    });
  }

  updateOutputs();

  clearCanvas(canvas.fractal);
  clearCanvas(canvas.orbit);
  clearCanvas(canvas.module);
  ctx.overlay.clearRect(0, 0, W, H);

  $("fractalPlaceholder").hidden = false;

  $("cRealInput").value = "-1";
  $("cImagInput").value = "0";
  $("zRealInput").value = "0";
  $("zImagInput").value = "0";

  $("metricC").textContent = "−1 + 0i";
  $("metricZ0").textContent = "0 + 0i";
  $("metricEscape").textContent = "Sin calcular";
  $("escapeThresholdLegend").textContent = "Umbral = 2";

  $("complexMessage").textContent =
    "Introduce c y z₀ y pulsa Calcular si escapa.";

  $("resultMessage").textContent =
    "Pulsa Iniciar o Calcular si escapa.";

  $("explanationText").textContent =
    "La ecuación es zₙ₊₁ = zₙ² + c. " +
    "Explora los parámetros del plano complejo.";

  updateStatus("Listo", 0);
  updateButtons();
  updateTable();
}

// ==========================================
// COORDENADAS DEL PLANO COMPLEJO
// ==========================================

function pixelToComplex(px, py, p) {
  const height = 2.9 / p.zoom;
  const width = height * W / H;

  return {
    a: p.centerReal + (px / W - 0.5) * width,
    b: p.centerImag + (0.5 - py / H) * height
  };
}

// ==========================================
// CÁLCULO DE ÓRBITAS
// ==========================================

function calculateOrbit(a, b, zx, zy, maxIterations) {
  let x = zx;
  let y = zy;
  let escape = null;

  const standard = zx === 0 && zy === 0;

  const radius = standard
    ? 2
    : Math.max(2, Math.hypot(a, b) + 1.000001);

  const samples = [{
    n: 0, x, y, m: Math.hypot(x, y)
  }];

  if (samples[0].m > radius) {
    return { samples, escape: 0, radius, standard };
  }

  for (let n = 1; n <= maxIterations; n++) {
    const nx = x * x - y * y + a;
    const ny = 2 * x * y + b;

    x = nx;
    y = ny;

    const magnitude = Math.hypot(x, y);
    samples.push({ n, x, y, m: magnitude });

    if (!Number.isFinite(magnitude) || magnitude > radius) {
      escape = n;
      break;
    }
  }

  return { samples, escape, radius, standard };
}

// ==========================================
// MARCADOR DEL PUNTO c
// ==========================================

function drawMarker() {
  const o = ctx.overlay;
  o.clearRect(0, 0, W, H);

  if (!state.selected) return;

  const p = parameters();
  const height = 2.9 / p.zoom;
  const width = height * W / H;

  const x =
    W / 2 + (state.point.a - p.centerReal) / width * W;

  const y =
    H / 2 - (state.point.b - p.centerImag) / height * H;

  if (x < 0 || x > W || y < 0 || y > H) return;

  o.lineWidth = 2;
  o.strokeStyle = "#ffffff";
  o.beginPath();
  o.arc(x, y, 8, 0, 2 * Math.PI);
  o.moveTo(x - 13, y);
  o.lineTo(x + 13, y);
  o.moveTo(x, y - 13);
  o.lineTo(x, y + 13);
  o.stroke();
}

// ==========================================
// SELECCIÓN DE c Y z₀
// ==========================================

function selectPoint(a, b) {
  state.point = { a, b };
  state.selected = true;

  const { x, y } = state.z0;

  const result = calculateOrbit(
    a, b, x, y, parameters().iterations
  );

  state.orbit = result.samples;
  state.escape = result.escape;
  state.radius = result.radius;

  state.step =
    ["running", "paused"].includes(state.phase)
      ? Math.floor(
          state.progress * (result.samples.length - 1)
        )
      : result.samples.length - 1;

  $("metricC").textContent = complexText(a, b);
  $("metricZ0").textContent = complexText(x, y);

  $("cRealInput").value = a;
  $("cImagInput").value = b;

  $("metricEscape").textContent =
    result.escape === null
      ? "No detectado"
      : "n = " + result.escape;

  $("escapeThresholdLegend").textContent =
    "Umbral = " + fmt(result.radius);

  const description = result.standard
    ? "Mandelbrot (z₀ = 0)"
    : "Órbita con z₀ personalizado";

  if (result.escape === null) {
    $("complexMessage").textContent =
      "No se detectó escape dentro del límite de iteraciones.";

    $("resultMessage").textContent =
      description + ": escape no detectado.";
  } else {
    $("complexMessage").textContent =
      `Escape detectado en la iteración ${result.escape}.`;

    $("resultMessage").textContent =
      description + ": escape en n = " + result.escape + ".";
  }

  $("explanationText").textContent =
    result.standard
      ? (
          result.escape === null
            ? "No se detectó escape. Esto no demuestra pertenencia al conjunto."
            : "Con z₀ = 0, este punto se encuentra fuera del conjunto de Mandelbrot."
        )
      : (
          "Con z₀ distinto de cero, se estudia otra órbita " +
          "de la ecuación; no se demuestra pertenencia a Mandelbrot."
        );

  drawMarker();
  drawGraphs();
  updateTable();
}

// ==========================================
// VALORES INGRESADOS MANUALMENTE
// ==========================================

function analyzeInputs() {
  const ids = [
    "cRealInput",
    "cImagInput",
    "zRealInput",
    "zImagInput"
  ];

  const numbers = ids.map(id => {
    const raw = $(id).value.trim();
    return raw === "" ? NaN : Number(raw);
  });

  if (
    numbers.some(n =>
      !Number.isFinite(n) || Math.abs(n) > 1000000
    )
  ) {
    $("complexMessage").textContent =
      "Ingresa cuatro valores numéricos válidos.";
    return;
  }

  const [a, b, zx, zy] = numbers;

  state.z0 = { x: zx, y: zy };

  // No borra ni reinicia la imagen del fractal.
  selectPoint(a, b);
}

$("analyzeComplexBtn").onclick = analyzeInputs;

document.querySelectorAll(".complex-preset").forEach(button => {
  button.onclick = () => {
    $("cRealInput").value = button.dataset.a;
    $("cImagInput").value = button.dataset.b;
    $("zRealInput").value = "0";
    $("zImagInput").value = "0";
    analyzeInputs();
  };
});

[
  "cRealInput",
  "cImagInput",
  "zRealInput",
  "zImagInput"
].forEach(id => {
  $(id).addEventListener("keydown", event => {
    if (event.key === "Enter") analyzeInputs();
  });
});

// ==========================================
// COLORES DEL FRACTAL
// ==========================================

function fractalColor(iterations, magnitude, palette) {
  const stops = palettes[palette];

  const smooth =
    iterations + 1 -
    Math.log2(
      Math.max(
        1e-9,
        Math.log2(Math.max(magnitude, 2.0001))
      )
    );

  const position =
    (((smooth * 0.028) % 1 + 1) % 1) *
    (stops.length - 1);

  const i = Math.floor(position);
  const t = position - i;

  return stops[i].map((value, k) => {
    const next =
      stops[Math.min(i + 1, stops.length - 1)][k];

    return Math.round(value + (next - value) * t);
  });
}

// ==========================================
// GENERACIÓN DEL FRACTAL
// ==========================================

function startSimulation() {
  stopTask();

  const p = parameters();

  // Se dibuja en una memoria temporal.
  // La imagen visible no se borra durante un nuevo zoom.
  const buffer = document.createElement("canvas");
  buffer.width = W;
  buffer.height = H;

  const bufferContext = buffer.getContext("2d");
  const image = bufferContext.createImageData(W, H);

  state.task = {
    p,
    image,
    bufferContext,
    row: 0,
    generation: state.generation
  };

  state.phase = "running";
  state.progress = 0;
  state.step = 0;

  if (!state.hasRendered) {
    ctx.fractal.clearRect(0, 0, W, H);
  }

  $("fractalPlaceholder").hidden = true;

  selectPoint(state.point.a, state.point.b);

  updateStatus("Generando", 0);
  updateButtons();
  scheduleRender();
}

function scheduleRender() {
  const task = state.task;

  if (
    !task ||
    state.phase !== "running" ||
    state.raf !== null
  ) return;

  state.raf = requestAnimationFrame(() => {
    state.raf = null;

    if (
      state.task === task &&
      task.generation === state.generation &&
      state.phase === "running"
    ) {
      renderBlock(task);
    }
  });
}

function renderBlock(task) {
  const firstRow = task.row;
  const startTime = performance.now();

  while (
    task.row < H &&
    task.row - firstRow < 3 &&
    performance.now() - startTime < 10
  ) {
    const py = task.row;

    for (let px = 0; px < W; px++) {
      const { a, b } = pixelToComplex(
        px + 0.5, py + 0.5, task.p
      );

      let x = 0;
      let y = 0;
      let x2 = 0;
      let y2 = 0;
      let n = 0;

      while (
        n < task.p.iterations &&
        x2 + y2 <= 4
      ) {
        const nx = x2 - y2 + a;
        const ny = 2 * x * y + b;

        x = nx;
        y = ny;
        x2 = x * x;
        y2 = y * y;
        n++;
      }

      const color =
        n === task.p.iterations && x2 + y2 <= 4
          ? [3, 9, 23]
          : fractalColor(
              n,
              Math.hypot(x, y),
              task.p.palette
            );

      const k = (py * W + px) * 4;

      task.image.data[k] = color[0];
      task.image.data[k + 1] = color[1];
      task.image.data[k + 2] = color[2];
      task.image.data[k + 3] = 255;
    }

    task.row++;
  }

  if (task.row > firstRow) {
    task.bufferContext.putImageData(
      task.image,
      0,
      0,
      0,
      firstRow,
      W,
      task.row - firstRow
    );

    // En el primer dibujo se muestran las filas progresivamente.
    // En los posteriores se conserva la imagen antigua.
    if (!state.hasRendered) {
      ctx.fractal.putImageData(
        task.image,
        0,
        0,
        0,
        firstRow,
        W,
        task.row - firstRow
      );
    }
  }

  const progress = task.row / H;

  state.step = Math.max(
    0,
    Math.min(
      state.orbit.length - 1,
      Math.floor(progress * (state.orbit.length - 1))
    )
  );

  drawGraphs();
  updateStatus("Generando", progress);

  if (task.row >= H) {
    // Se reemplaza la imagen solamente al terminar.
    ctx.fractal.putImageData(task.image, 0, 0);

    state.hasRendered = true;
    state.phase = "finished";
    state.step = state.orbit.length - 1;
    state.task = null;

    updateStatus("Finalizado", 1);
    updateButtons();
    drawGraphs();
    drawMarker();

    $("changesHint").textContent =
      "Fractal actualizado. Puedes modificar los parámetros.";
  } else {
    scheduleRender();
  }
}

function pause() {
  if (state.phase !== "running") return;

  state.phase = "paused";

  if (state.raf !== null) {
    cancelAnimationFrame(state.raf);
    state.raf = null;
  }

  updateStatus("Pausado");
  updateButtons();
}

function resume() {
  if (state.phase !== "paused" || !state.task) return;

  state.phase = "running";
  updateStatus("Continuando");
  updateButtons();
  scheduleRender();
}

// ==========================================
// EJES Y GRÁFICAS
// ==========================================

function plotFrame(context, element, maxX, minY, maxY) {
  const w = element.width;
  const h = element.height;

  const L = 64;
  const R = 24;
  const T = 24;
  const B = 40;

  const plotWidth = w - L - R;
  const plotHeight = h - T - B;

  if (!(maxY > minY)) maxY = minY + 1;

  const X = n =>
    L + n / Math.max(maxX, 1) * plotWidth;

  const Y = value =>
    T + (maxY - clamp(value, minY, maxY)) /
    (maxY - minY) * plotHeight;

  context.fillStyle = "#071428";
  context.fillRect(0, 0, w, h);

  context.font = "12px Arial";

  if ($("showGrid").checked) {
    for (let i = 0; i <= 4; i++) {
      const value = maxY - i * (maxY - minY) / 4;
      const y = Y(value);

      context.strokeStyle = "#294668";
      context.beginPath();
      context.moveTo(L, y);
      context.lineTo(w - R, y);
      context.stroke();

      context.fillStyle = "#a8bddd";
      context.fillText(fmt(value), 5, y + 4);
    }

    for (let i = 0; i <= 5; i++) {
      const x = L + i * plotWidth / 5;

      context.strokeStyle = "#294668";
      context.beginPath();
      context.moveTo(x, T);
      context.lineTo(x, h - B);
      context.stroke();
    }
  }

  context.strokeStyle = "#bed7ef";
  context.beginPath();
  context.moveTo(L, T);
  context.lineTo(L, h - B);
  context.lineTo(w - R, h - B);
  context.stroke();

  context.fillStyle = "#e3f4ff";
  context.fillText("n", w - R - 3, h - 14);

  return { X, Y };
}

function drawSeries(
  context, data, frame, selector, color, limit
) {
  context.strokeStyle = color;
  context.lineWidth = 2.5;
  context.beginPath();

  let started = false;

  for (
    let i = 0;
    i <= limit && i < data.length;
    i++
  ) {
    const item = data[i];
    const value = selector(item);

    if (!Number.isFinite(value)) {
      started = false;
      continue;
    }

    const x = frame.X(item.n);
    const y = frame.Y(value);

    if (!started) {
      context.moveTo(x, y);
      started = true;
    } else {
      context.lineTo(x, y);
    }
  }

  context.stroke();
}

function drawGraphs() {
  const data = state.orbit;

  if (!data.length) {
    clearCanvas(canvas.orbit);
    clearCanvas(canvas.module);
    return;
  }

  const limit =
    ["running", "paused"].includes(state.phase)
      ? state.step
      : data.length - 1;

  const visible = data.slice(0, Math.max(1, limit + 1));

  const components = visible
    .flatMap(item => [item.x, item.y])
    .filter(Number.isFinite);

  const maxN = Math.max(
    1,
    data[data.length - 1].n
  );

  const orbitFrame = plotFrame(
    ctx.orbit,
    canvas.orbit,
    maxN,
    Math.min(-2, ...components),
    Math.max(2, ...components)
  );

  drawSeries(
    ctx.orbit, data, orbitFrame,
    d => d.x, "#42e6f2", limit
  );

  drawSeries(
    ctx.orbit, data, orbitFrame,
    d => d.y, "#b177ff", limit
  );

  const modules = visible
    .map(d => d.m)
    .filter(Number.isFinite);

  const maxY = Math.min(
    100,
    Math.max(3, state.radius, ...modules)
  );

  const moduleFrame = plotFrame(
    ctx.module,
    canvas.module,
    maxN,
    0,
    maxY
  );

  ctx.module.strokeStyle = "#ff768c";
  ctx.module.setLineDash([7, 5]);
  ctx.module.beginPath();
  ctx.module.moveTo(
    moduleFrame.X(0),
    moduleFrame.Y(state.radius)
  );
  ctx.module.lineTo(
    moduleFrame.X(maxN),
    moduleFrame.Y(state.radius)
  );
  ctx.module.stroke();
  ctx.module.setLineDash([]);

  drawSeries(
    ctx.module, data, moduleFrame,
    d => d.m, "#ffce72", limit
  );
}

function updateVisibleGraphs() {
  [
    ["showFractal", "fractalCard"],
    ["showOrbit", "orbitCard"],
    ["showModule", "moduleCard"]
  ].forEach(([checkId, cardId]) => {
    $(cardId).classList.toggle(
      "hidden-graph",
      !$(checkId).checked
    );
  });

  drawGraphs();
}

// ==========================================
// TABLA DE ITERACIONES
// ==========================================

function updateTable() {
  const body = $("tableBody");
  body.replaceChildren();

  if (!state.orbit.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 5;
    cell.textContent = "No hay resultados calculados.";

    row.appendChild(cell);
    body.appendChild(row);

    $("tablePoint").textContent = "Sin calcular";
    $("tableInitial").textContent = "0 + 0i";
    $("tableCount").textContent = "0 registros";
    return;
  }

  $("tablePoint").textContent =
    complexText(state.point.a, state.point.b);

  $("tableInitial").textContent =
    complexText(state.z0.x, state.z0.y);

  const fragment = document.createDocumentFragment();

  state.orbit.forEach(d => {
    const row = document.createElement("tr");

    const escaped =
      !Number.isFinite(d.m) || d.m > state.radius;

    if (escaped) row.classList.add("escaped");

    const values = [
      d.n,
      fmt(d.x),
      fmt(d.y),
      fmt(d.m),
      escaped
        ? "Escapa"
        : d.n === 0
          ? "Inicial"
          : "No escapa"
    ];

    values.forEach(value => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });

    fragment.appendChild(row);
  });

  body.appendChild(fragment);

  $("tableCount").textContent =
    state.orbit.length + " registros";
}

// ==========================================
// DESCARGAR CSV
// ==========================================

$("exportCSV").onclick = () => {
  if (!state.orbit.length) {
    alert("Primero debes calcular una órbita.");
    return;
  }

  const lines = [
    "Iteracion,Real,Imaginaria,Modulo,Estado"
  ];

  state.orbit.forEach(d => {
    const escaped =
      !Number.isFinite(d.m) || d.m > state.radius;

    lines.push([
      d.n,
      d.x,
      d.y,
      d.m,
      escaped ? "Escapa" : "No escapa"
    ].join(","));
  });

  const blob = new Blob(
    ["\uFEFF" + lines.join("\r\n")],
    { type: "text/csv;charset=utf-8" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "mandelbrot_resultados.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// ==========================================
// EVENTOS DE LOS BOTONES
// ==========================================

$("startBtn").onclick = startSimulation;
$("pauseBtn").onclick = pause;
$("continueBtn").onclick = resume;

$("restartBtn").onclick = () => resetView(false);

$("defaultsBtn").onclick = () => {
  resetView(true);
  $("changesHint").textContent =
    "Parámetros originales restaurados.";
};

// ==========================================
// ZOOM ESTABLE Y MODIFICACIÓN DE VARIABLES
// ==========================================

controlIds.forEach(id => {
  $(id).addEventListener("input", () => {
    updateOutputs();

    // Solamente se actualizan los valores indicados.
    // No se borra la imagen del fractal.
    $("changesHint").textContent =
      "Ajustando parámetros. Al terminar se actualizará el fractal.";
  });

  $(id).addEventListener("change", () => {
    updateOutputs();

    if ($("fractalPlaceholder").hidden) {
      // Se conserva la vista anterior hasta completar la nueva.
      startSimulation();

      $("changesHint").textContent =
        "Actualizando el fractal sin borrar la vista anterior.";
    } else {
      $("changesHint").textContent =
        "Pulsa Iniciar para generar el fractal.";
    }
  });
});

[
  "showFractal",
  "showOrbit",
  "showModule",
  "showGrid"
].forEach(id => {
  $(id).addEventListener("change", updateVisibleGraphs);
});

// ==========================================
// CLIC SOBRE EL FRACTAL
// ==========================================

canvas.fractal.addEventListener("click", event => {
  if (!state.hasRendered && state.phase === "ready") return;

  const rect = canvas.fractal.getBoundingClientRect();

  const px =
    (event.clientX - rect.left) / rect.width * W;

  const py =
    (event.clientY - rect.top) / rect.height * H;

  const point = pixelToComplex(
    px, py, parameters()
  );

  selectPoint(point.a, point.b);
});

// ==========================================
// ACTIVIDAD DE CINCO PREGUNTAS
// ==========================================

const questions = [
  {
    text: "¿Cuál es la ecuación iterativa del conjunto de Mandelbrot?",
    options: [
      "z(n+1) = z(n) + c",
      "z(n+1) = z(n)² + c",
      "z(n+1) = 2z(n) + c",
      "z(n+1) = c²"
    ],
    correct: 1,
    explanation:
      "La ecuación es z(n+1) = z(n)² + c y se inicia con z₀ = 0."
  },
  {
    text: "¿Qué sucede si |zₙ| supera el valor 2 con z₀ = 0?",
    options: [
      "El punto pertenece al conjunto",
      "La sucesión siempre regresa a cero",
      "Se demuestra que la órbita escapa",
      "La ecuación deja de funcionar"
    ],
    correct: 2,
    explanation:
      "Superar 2 demuestra el escape y que c está fuera del conjunto."
  },
  {
    text: "Si c = 0 y z₀ = 0, ¿qué sucede?",
    options: [
      "Todos los términos son cero",
      "La sucesión escapa en la tercera iteración",
      "La sucesión crece sin límite",
      "La sucesión alterna entre 1 y 2"
    ],
    correct: 0,
    explanation:
      "El valor cero permanece fijo al aplicar la ecuación."
  },
  {
    text: "¿Para qué sirve aumentar las iteraciones máximas?",
    options: [
      "Cambiar la ecuación",
      "Detectar escapes tardíos",
      "Eliminar los números complejos",
      "Demostrar que todos los puntos pertenecen"
    ],
    correct: 1,
    explanation:
      "Más iteraciones pueden detectar puntos que escapan más tarde."
  },
  {
    text: "¿Qué permite hacer el zoom?",
    options: [
      "Cambiar la ecuación",
      "Cambiar el radio de escape",
      "Eliminar la parte imaginaria",
      "Explorar detalles del fractal"
    ],
    correct: 3,
    explanation:
      "El zoom permite observar estructuras a diferentes escalas."
  }
];

let questionIndex = 0;
let quizScore = 0;
let quizAttempts = 0;
let quizAnswered = false;

function showQuestion() {
  const question = questions[questionIndex];

  quizAttempts = 0;
  quizAnswered = false;

  $("quizCounter").textContent =
    `Pregunta ${questionIndex + 1} de ${questions.length}`;

  $("quizQuestion").textContent = question.text;
  $("quizScore").textContent = quizScore + "/10";

  $("quizProgress").style.width =
    questionIndex / questions.length * 100 + "%";

  $("quizFeedback").textContent =
    "Selecciona una respuesta y pulsa Comprobar.";

  $("quizCheck").disabled = false;
  $("quizNext").disabled = true;
  $("quizFinal").hidden = true;

  const box = $("quizOptions");
  box.replaceChildren();

  question.options.forEach((option, index) => {
    const label = document.createElement("label");
    label.className = "quiz-option";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "quizAnswer";
    radio.value = index;

    const text = document.createElement("span");
    text.textContent = option;

    label.append(radio, text);
    box.appendChild(label);
  });
}

function checkAnswer() {
  if (quizAnswered) return;

  const selected = document.querySelector(
    'input[name="quizAnswer"]:checked'
  );

  if (!selected) {
    $("quizFeedback").textContent =
      "Selecciona una alternativa.";
    return;
  }

  const question = questions[questionIndex];
  const choice = Number(selected.value);
  const label = selected.closest("label");

  if (choice === question.correct) {
    quizAnswered = true;

    const points = quizAttempts === 0 ? 2 : 1;
    quizScore += points;

    label.classList.add("correct");

    $("quizFeedback").textContent =
      `¡Correcto! +${points} punto(s). ${question.explanation}`;
  } else {
    quizAttempts++;

    label.classList.add("wrong");
    selected.checked = false;
    selected.disabled = true;

    if (quizAttempts === 1) {
      $("quizFeedback").textContent =
        "Incorrecto. Tienes una segunda oportunidad.";
      return;
    }

    quizAnswered = true;

    $("quizOptions")
      .children[question.correct]
      .classList.add("correct");

    $("quizFeedback").textContent =
      "Respuesta correcta: " +
      question.options[question.correct] +
      ". " + question.explanation;
  }

  $("quizScore").textContent = quizScore + "/10";

  $("quizCheck").disabled = true;
  $("quizNext").disabled = false;

  document.querySelectorAll(
    'input[name="quizAnswer"]'
  ).forEach(radio => {
    radio.disabled = true;
  });
}

function nextQuestion() {
  if (!quizAnswered) return;

  if (questionIndex < questions.length - 1) {
    questionIndex++;
    showQuestion();
    return;
  }

  $("quizCounter").textContent = "Actividad finalizada";
  $("quizQuestion").textContent = "¡Desafío completado!";
  $("quizProgress").style.width = "100%";
  $("quizOptions").replaceChildren();

  $("quizCheck").disabled = true;
  $("quizNext").disabled = true;
  $("quizFinal").hidden = false;

  $("quizFinal").textContent =
    `Calificación final: ${quizScore}/10. ` +
    (
      quizScore >= 7
        ? "Buen trabajo. Comprendiste los conceptos principales."
        : "Explora nuevamente el simulador y repite la actividad."
    );
}

$("quizCheck").onclick = checkAnswer;
$("quizNext").onclick = nextQuestion;

$("quizReset").onclick = () => {
  questionIndex = 0;
  quizScore = 0;
  showQuestion();
};

// ==========================================
// INICIALIZACIÓN
// ==========================================

resetView(true);
updateVisibleGraphs();
showQuestion();
