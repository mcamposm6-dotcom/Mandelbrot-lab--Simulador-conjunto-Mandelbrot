


"use strict";

// MANDELBROT LAB · PHYMATH 2026 · UNEMI

const $ = id => document.getElementById(id);

const canvas = {
  fractal: $("fractalCanvas"),
  overlay: $("overlayCanvas"),
  orbit: $("orbitCanvas"),
  module: $("moduleCanvas")
};

const ctx = Object.fromEntries(
  Object.entries(canvas).map(([k, c]) => [k, c.getContext("2d")])
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
  selected: false
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const fmt = n =>
  Number.isFinite(n) ? String(Number(n.toPrecision(6))) : "∞";

const complexText = (a, b) =>
  `${fmt(a)} ${b < 0 ? "−" : "+"} ${fmt(Math.abs(b))}i`;

const palettes = {
  cosmic: [
    [7,16,50], [44,62,161], [135,62,214],
    [248,95,198], [255,220,122]
  ],
  ocean: [
    [4,28,58], [8,96,145], [20,187,221],
    [115,234,225], [245,255,224]
  ],
  fire: [
    [38,5,22], [155,35,31], [246,100,25],
    [255,190,71], [255,250,189]
  ],
  mono: [
    [18,28,44], [70,86,116], [126,150,172],
    [204,218,231], [255,255,255]
  ]
};

// =====================================
// NAVEGACIÓN
// =====================================

function navigate(screen) {
  if (state.phase === "running" && screen !== "lab") pause();

  ["welcome", "credits", "lab"].forEach(id => {
    $(id).hidden = id !== screen;
    $(id).classList.toggle("active", id === screen);
  });

  window.scrollTo(0, 0);
}

$("toCredits").onclick = () => navigate("credits");
$("backWelcome").onclick = () => navigate("welcome");
$("toLab").onclick = () => navigate("lab");
$("homeBtn").onclick = () => navigate("welcome");

$("logoHome").onclick = event => {
  event.preventDefault();
  navigate("welcome");
};

// =====================================
// BURBUJAS DEL FONDO
// =====================================

for (let i = 0; i < 22; i++) {
  const bubble = document.createElement("span");
  bubble.className = "bubble";

  bubble.style.setProperty("--left", `${(i * 41 + 17) % 100}%`);
  bubble.style.setProperty("--size", `${8 + i * 17 % 27}px`);
  bubble.style.setProperty("--duration", `${15 + i * 7 % 13}s`);
  bubble.style.setProperty("--delay", `${-(i * 11 % 23)}s`);

  $("particles").appendChild(bubble);
}

// =====================================
// PARÁMETROS Y DESLIZADORES
// =====================================

function params() {
  return {
    iterations: Number($("iterations").value),
    zoom: Number($("zoom").value),
    centerReal: Number($("centerReal").value),
    centerImag: Number($("centerImag").value),
    palette: $("palette").value
  };
}

function updateLabels() {
  const p = params();

  $("iterationsOut").textContent = p.iterations;
  $("zoomOut").textContent = p.zoom.toFixed(2) + "×";
  $("centerRealOut").textContent = p.centerReal.toFixed(3);
  $("centerImagOut").textContent = p.centerImag.toFixed(3);

  $("metricIter").textContent = p.iterations;
  $("metricZoom").textContent = p.zoom.toFixed(2) + "×";
}

function buttons() {
  $("pauseBtn").disabled = state.phase !== "running";
  $("continueBtn").disabled = state.phase !== "paused";

  $("startBtn").textContent =
    ["running", "paused"].includes(state.phase)
      ? "↻ Iniciar de nuevo"
      : "▶ Iniciar";
}

function status(message, progress = state.progress) {
  state.progress = progress;
  $("statusText").textContent = "● " + message;
  $("percentText").textContent = Math.round(progress * 100) + " %";
  $("progressFill").style.width = progress * 100 + "%";
}

function stop() {
  if (state.raf !== null) cancelAnimationFrame(state.raf);

  state.raf = null;
  state.task = null;
  state.generation++;
}

function blank(element) {
  const context = element.getContext("2d");
  context.fillStyle = "#071428";
  context.fillRect(0, 0, element.width, element.height);
}

function reset(restore = false) {
  stop();

  state.phase = "ready";
  state.progress = 0;
  state.point = { a: -1, b: 0 };
  state.z0 = { x: 0, y: 0 };
  state.orbit = [];
  state.escape = null;
  state.radius = 2;
  state.step = 0;
  state.selected = false;

  if (restore) {
    Object.entries(defaults).forEach(([id, value]) => {
      $(id).value = value;
    });
  }

  updateLabels();

  ["fractal", "orbit", "module"].forEach(k => blank(canvas[k]));

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
    "Introduce c y z₀ para analizar una órbita.";

  $("resultMessage").textContent =
    "Pulsa Iniciar o Calcular si escapa.";

  $("explanationText").textContent =
    "La ecuación es zₙ₊₁ = zₙ² + c. " +
    "Modifica los parámetros para observar los resultados.";

  status("Listo", 0);
  buttons();
  updateTable();
}

// =====================================
// PLANO COMPLEJO
// =====================================

function pixelComplex(px, py, p) {
  const h = 2.9 / p.zoom;
  const w = h * W / H;

  return {
    a: p.centerReal + (px / W - 0.5) * w,
    b: p.centerImag + (0.5 - py / H) * h
  };
}

// =====================================
// CÁLCULO DE LA ÓRBITA
// =====================================

function calculateOrbit(a, b, zx, zy, maxIterations) {
  let x = zx, y = zy;
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

    const m = Math.hypot(x, y);
    samples.push({ n, x, y, m });

    if (!Number.isFinite(m) || m > radius) {
      escape = n;
      break;
    }
  }

  return { samples, escape, radius, standard };
}

// =====================================
// SELECCIONAR PUNTO
// =====================================

function selectPoint(a, b) {
  const { x, y } = state.z0;

  state.point = { a, b };
  state.selected = true;

  const r = calculateOrbit(
    a, b, x, y, params().iterations
  );

  state.orbit = r.samples;
  state.escape = r.escape;
  state.radius = r.radius;

  state.step = ["running", "paused"].includes(state.phase)
    ? Math.floor(state.progress * (r.samples.length - 1))
    : r.samples.length - 1;

  $("cRealInput").value = a;
  $("cImagInput").value = b;

  $("metricC").textContent = complexText(a, b);
  $("metricZ0").textContent = complexText(x, y);
  $("metricEscape").textContent =
    r.escape === null ? "No detectado" : "n = " + r.escape;

  $("escapeThresholdLegend").textContent =
    "Umbral = " + fmt(r.radius);

  if (r.escape === null) {
    $("resultMessage").textContent =
      "No se detectó escape en las iteraciones calculadas.";

    $("complexMessage").textContent =
      "La órbita no superó el umbral. " +
      "Esto no demuestra que permanezca acotada para siempre.";
  } else {
    $("resultMessage").textContent =
      `Escape detectado en la iteración ${r.escape}.`;

    $("complexMessage").textContent =
      `La órbita superó el umbral ${fmt(r.radius)} ` +
      `en n = ${r.escape}.`;
  }

  $("explanationText").textContent = r.standard
    ? (
        r.escape === null
          ? "Con z₀ = 0 no se detectó escape, pero eso no demuestra pertenencia al conjunto."
          : "Con z₀ = 0, el escape demuestra que c está fuera del conjunto de Mandelbrot."
      )
    : "Con z₀ distinto de cero se estudia otra órbita, " +
      "no la pertenencia de c al conjunto de Mandelbrot.";

  drawMarker();
  drawGraphs();
  updateTable();
}

function analyzeInputs() {
  const inputs = [
    "cRealInput", "cImagInput",
    "zRealInput", "zImagInput"
  ];

  const numbers = inputs.map(id => {
    const raw = $(id).value.trim();
    return raw === "" ? NaN : Number(raw);
  });

  if (numbers.some(n => !Number.isFinite(n) || Math.abs(n) > 1e6)) {
    $("complexMessage").textContent =
      "Introduce cuatro valores numéricos válidos.";
    return;
  }

  const [a, b, zx, zy] = numbers;

  state.z0 = { x: zx, y: zy };
  selectPoint(a, b);
}

$("analyzeComplexBtn").onclick = analyzeInputs;

document.querySelectorAll(".complex-preset").forEach(button => {
  button.onclick = () => {
    $("cRealInput").value = button.dataset.a;
    $("cImagInput").value = button.dataset.b;
    $("zRealInput").value = 0;
    $("zImagInput").value = 0;
    analyzeInputs();
  };
});

["cRealInput", "cImagInput", "zRealInput", "zImagInput"]
  .forEach(id => {
    $(id).addEventListener("keydown", event => {
      if (event.key === "Enter") analyzeInputs();
    });
  });

// =====================================
// MARCADOR EN EL FRACTAL
// =====================================

function drawMarker() {
  const o = ctx.overlay;
  o.clearRect(0, 0, W, H);

  if (!state.selected) return;

  const p = params();
  const h = 2.9 / p.zoom;
  const w = h * W / H;

  const x = W / 2 +
    (state.point.a - p.centerReal) / w * W;

  const y = H / 2 -
    (state.point.b - p.centerImag) / h * H;

  if (x < 0 || x > W || y < 0 || y > H) return;

  o.strokeStyle = "#ffffff";
  o.lineWidth = 2;
  o.beginPath();
  o.arc(x, y, 8, 0, 2 * Math.PI);
  o.moveTo(x - 13, y);
  o.lineTo(x + 13, y);
  o.moveTo(x, y - 13);
  o.lineTo(x, y + 13);
  o.stroke();
}

// =====================================
// COLORES DEL FRACTAL
// =====================================

function fractalColor(iter, magnitude, palette) {
  const stops = palettes[palette];

  const smooth = iter + 1 -
    Math.log2(
      Math.max(
        1e-9,
        Math.log2(Math.max(magnitude, 2.0001))
      )
    );

  const position =
    (((smooth * 0.028) % 1 + 1) % 1) *
    (stops.length - 1);

  const index = Math.floor(position);
  const t = position - index;

  return stops[index].map((c, k) => {
    const next =
      stops[Math.min(index + 1, stops.length - 1)][k];

    return Math.round(c + (next - c) * t);
  });
}

// =====================================
// GENERACIÓN DEL FRACTAL
// =====================================

function start() {
  stop();

  const p = params();

  state.task = {
    p,
    image: ctx.fractal.createImageData(W, H),
    row: 0,
    generation: state.generation
  };

  state.phase = "running";
  state.progress = 0;
  state.step = 0;

  ctx.fractal.clearRect(0, 0, W, H);
  $("fractalPlaceholder").hidden = true;

  selectPoint(state.point.a, state.point.b);
  status("Generando", 0);
  buttons();
  schedule();
}

function schedule() {
  const task = state.task;

  if (!task || state.phase !== "running" || state.raf !== null) {
    return;
  }

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
  const first = task.row;
  const started = performance.now();

  while (
    task.row < H &&
    task.row - first < 3 &&
    performance.now() - started < 10
  ) {
    const py = task.row;

    for (let px = 0; px < W; px++) {
      const { a, b } = pixelComplex(px + 0.5, py + 0.5, task.p);

      let x = 0, y = 0;
      let x2 = 0, y2 = 0;
      let n = 0;

      while (n < task.p.iterations && x2 + y2 <= 4) {
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

  if (task.row > first) {
    ctx.fractal.putImageData(
      task.image,
      0, 0,
      0, first,
      W, task.row - first
    );
  }

  const progress = task.row / H;

  state.step = Math.min(
    state.orbit.length - 1,
    Math.floor(progress * (state.orbit.length - 1))
  );

  drawGraphs();
  status("Generando", progress);

  if (task.row >= H) {
    state.phase = "finished";
    state.task = null;
    state.step = state.orbit.length - 1;

    status("Finalizado", 1);
    buttons();
    drawGraphs();
  } else {
    schedule();
  }
}

function pause() {
  if (state.phase !== "running") return;

  state.phase = "paused";

  if (state.raf !== null) cancelAnimationFrame(state.raf);
  state.raf = null;

  status("Pausado");
  buttons();
}

function resume() {
  if (state.phase !== "paused" || !state.task) return;

  state.phase = "running";
  status("Continuando");
  buttons();
  schedule();
}

// =====================================
// EJES Y GRÁFICAS
// =====================================

function plotFrame(context, element, maxX, minY, maxY) {
  const w = element.width;
  const h = element.height;
  const L = 64, R = 24, T = 24, B = 40;

  const pw = w - L - R;
  const ph = h - T - B;

  if (maxY <= minY) maxY = minY + 1;

  const X = n => L + n / Math.max(maxX, 1) * pw;
  const Y = value =>
    T + (maxY - clamp(value, minY, maxY)) /
    (maxY - minY) * ph;

  context.fillStyle = "#071428";
  context.fillRect(0, 0, w, h);
  context.font = "12px Arial";

  if ($("showGrid").checked) {
    for (let i = 0; i <= 4; i++) {
      const v = maxY - i * (maxY - minY) / 4;
      const y = Y(v);

      context.strokeStyle = "#294668";
      context.beginPath();
      context.moveTo(L, y);
      context.lineTo(w - R, y);
      context.stroke();

      context.fillStyle = "#a8bddd";
      context.fillText(fmt(v), 5, y + 4);
    }

    for (let i = 0; i <= 5; i++) {
      const x = L + i * pw / 5;

      context.strokeStyle = "#294668";
      context.beginPath();
      context.moveTo(x, T);
      context.lineTo(x, h - B);
      context.stroke();

      context.fillStyle = "#a8bddd";
      context.fillText(
        String(Math.round(maxX * i / 5)),
        x - 8, h - 16
      );
    }
  }

  context.strokeStyle = "#bed7ef";
  context.beginPath();
  context.moveTo(L, T);
  context.lineTo(L, h - B);
  context.lineTo(w - R, h - B);
  context.stroke();

  return { X, Y };
}

function drawSeries(context, data, frame, selector, color, limit) {
  context.strokeStyle = color;
  context.lineWidth = 2.5;
  context.beginPath();

  let started = false;

  for (let i = 0; i <= limit && i < data.length; i++) {
    const sample = data[i];
    const value = selector(sample);

    if (!Number.isFinite(value)) {
      started = false;
      continue;
    }

    if (!started) {
      context.moveTo(frame.X(sample.n), frame.Y(value));
      started = true;
    } else {
      context.lineTo(frame.X(sample.n), frame.Y(value));
    }
  }

  context.stroke();
}

function drawGraphs() {
  const data = state.orbit;

  if (!data.length) {
    blank(canvas.orbit);
    blank(canvas.module);
    return;
  }

  const limit =
    ["running", "paused"].includes(state.phase)
      ? state.step
      : data.length - 1;

  const visible = data.slice(0, Math.max(1, limit + 1));

  const components = visible
    .flatMap(v => [v.x, v.y])
    .filter(Number.isFinite);

  const lastN = Math.max(1, data[data.length - 1].n);

  const orbitFrame = plotFrame(
    ctx.orbit,
    canvas.orbit,
    lastN,
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
    .map(v => v.m)
    .filter(Number.isFinite);

  const top = Math.max(3, state.radius, ...modules);

  const moduleFrame = plotFrame(
    ctx.module,
    canvas.module,
    lastN,
    0,
    top
  );

  ctx.module.strokeStyle = "#ff768c";
  ctx.module.setLineDash([7, 5]);
  ctx.module.beginPath();
  ctx.module.moveTo(moduleFrame.X(0), moduleFrame.Y(state.radius));
  ctx.module.lineTo(moduleFrame.X(lastN), moduleFrame.Y(state.radius));
  ctx.module.stroke();
  ctx.module.setLineDash([]);

  drawSeries(
    ctx.module, data, moduleFrame,
    d => d.m, "#ffce72", limit
  );
}

function toggleGraphs() {
  [
    ["showFractal", "fractalCard"],
    ["showOrbit", "orbitCard"],
    ["showModule", "moduleCard"]
  ].forEach(([check, card]) => {
    $(card).classList.toggle(
      "hidden-graph",
      !$(check).checked
    );
  });

  drawGraphs();
}

// =====================================
// TABLA DE RESULTADOS
// =====================================

function updateTable() {
  const tbody = $("tableBody");
  tbody.replaceChildren();

  if (!state.orbit.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 5;
    cell.textContent = "No hay resultados calculados.";

    row.appendChild(cell);
    tbody.appendChild(row);

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

    const escaped = !Number.isFinite(d.m) || d.m > state.radius;

    if (escaped) row.classList.add("escaped");

    [
      d.n,
      fmt(d.x),
      fmt(d.y),
      fmt(d.m),
      escaped ? "Escapa" : d.n === 0 ? "Inicial" : "No escapa"
    ].forEach(value => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });

    fragment.appendChild(row);
  });

  tbody.appendChild(fragment);
  $("tableCount").textContent = state.orbit.length + " registros";
}

function exportCSV() {
  if (!state.orbit.length) {
    alert("Primero debes analizar un punto.");
    return;
  }

  const lines = ["Iteracion,Real,Imaginaria,Modulo,Estado"];

  state.orbit.forEach(d => {
    const escaped = !Number.isFinite(d.m) || d.m > state.radius;

    lines.push([
      d.n, d.x, d.y, d.m,
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
}

// =====================================
// EVENTOS DEL SIMULADOR
// =====================================

$("startBtn").onclick = start;
$("pauseBtn").onclick = pause;
$("continueBtn").onclick = resume;
$("restartBtn").onclick = () => reset(false);

$("defaultsBtn").onclick = () => {
  reset(true);
  $("changesHint").textContent =
    "Parámetros originales restaurados.";
};

$("exportCSV").onclick = exportCSV;

Object.keys(defaults).forEach(id => {
  $(id).addEventListener("input", () => {
    reset(false);
    $("changesHint").textContent =
      "Parámetros modificados. Pulsa Iniciar para aplicarlos.";
  });
});

["showFractal", "showOrbit", "showModule", "showGrid"]
  .forEach(id => {
    $(id).addEventListener("change", toggleGraphs);
  });

canvas.fractal.addEventListener("click", event => {
  if (state.phase === "ready") return;

  const rect = canvas.fractal.getBoundingClientRect();

  const px = (event.clientX - rect.left) / rect.width * W;
  const py = (event.clientY - rect.top) / rect.height * H;

  const c = pixelComplex(px, py, params());
  selectPoint(c.a, c.b);
});

// =====================================
// ACTIVIDAD INTERACTIVA FINAL
// =====================================

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
    explanation: "Se utiliza z(n+1) = z(n)² + c, partiendo de z₀ = 0."
  },
  {
    text: "¿Qué ocurre cuando |zₙ| supera 2 y z₀ = 0?",
    options: [
      "El punto pertenece al conjunto",
      "La órbita se vuelve cero",
      "El punto escapa y está fuera del conjunto",
      "La ecuación deja de funcionar"
    ],
    correct: 2,
    explanation: "Superar 2 demuestra que c no pertenece al conjunto."
  },
  {
    text: "Si c = 0 y z₀ = 0, ¿qué sucede?",
    options: [
      "Todos los términos permanecen en cero",
      "Escapa en la tercera iteración",
      "Crece sin límite",
      "Alterna entre 1 y 2"
    ],
    correct: 0,
    explanation: "El valor cero permanece en cero al aplicar la ecuación."
  },
  {
    text: "¿Qué permite aumentar las iteraciones máximas?",
    options: [
      "Modificar la ecuación",
      "Detectar escapes tardíos",
      "Eliminar la parte imaginaria",
      "Demostrar que todos los puntos pertenecen"
    ],
    correct: 1,
    explanation: "Más iteraciones permiten detectar escapes que ocurren después."
  },
  {
    text: "¿Para qué sirve el zoom?",
    options: [
      "Cambiar la ecuación",
      "Cambiar el radio de escape",
      "Eliminar los números complejos",
      "Explorar detalles del fractal"
    ],
    correct: 3,
    explanation: "El zoom permite explorar regiones a diferentes escalas."
  }
];

let quizIndex = 0;
let quizScore = 0;
let quizAttempts = 0;
let quizAnswered = false;

function showQuestion() {
  const question = questions[quizIndex];

  quizAttempts = 0;
  quizAnswered = false;

  $("quizCounter").textContent =
    `Pregunta ${quizIndex + 1} de ${questions.length}`;

  $("quizQuestion").textContent = question.text;
  $("quizScore").textContent = `${quizScore}/10`;

  $("quizProgress").style.width =
    quizIndex / questions.length * 100 + "%";

  $("quizFeedback").textContent =
    "Selecciona una respuesta y pulsa Comprobar.";

  $("quizFinal").hidden = true;
  $("quizCheck").disabled = false;
  $("quizNext").disabled = true;

  const box = $("quizOptions");
  box.replaceChildren();

  question.options.forEach((option, i) => {
    const label = document.createElement("label");
    label.className = "quiz-option";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "quizAnswer";
    radio.value = i;

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

  const question = questions[quizIndex];
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
        "Respuesta incorrecta. Tienes un segundo intento.";
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

  $("quizScore").textContent = `${quizScore}/10`;
  $("quizCheck").disabled = true;
  $("quizNext").disabled = false;

  document.querySelectorAll(
    'input[name="quizAnswer"]'
  ).forEach(radio => radio.disabled = true);
}

function nextQuestion() {
  if (!quizAnswered) return;

  if (quizIndex < questions.length - 1) {
    quizIndex++;
    showQuestion();
    return;
  }

  $("quizProgress").style.width = "100%";
  $("quizCounter").textContent = "Actividad finalizada";
  $("quizQuestion").textContent = "¡Desafío completado!";
  $("quizOptions").replaceChildren();

  $("quizCheck").disabled = true;
  $("quizNext").disabled = true;

  $("quizFinal").hidden = false;

  $("quizFinal").textContent =
    `Calificación final: ${quizScore}/10. ` +
    (
      quizScore >= 7
        ? "Buen trabajo. Comprendiste los conceptos principales."
        : "Explora nuevamente el laboratorio y repite la actividad."
    );
}

$("quizCheck").onclick = checkAnswer;
$("quizNext").onclick = nextQuestion;

$("quizReset").onclick = () => {
  quizIndex = 0;
  quizScore = 0;
  showQuestion();
};

// =====================================
// INICIALIZACIÓN
// =====================================

updateLabels();
reset(true);
toggleGraphs();
showQuestion();
