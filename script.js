


"use strict";

// MANDELBROT LAB · PHYMATH 2026 · UNEMI
// Fractal de Mandelbrot, órbitas complejas y controles en vivo.

const $ = id => document.getElementById(id);

const canvases = {
  fractal: $("fractalCanvas"),
  overlay: $("overlayCanvas"),
  orbit: $("orbitCanvas"),
  module: $("moduleCanvas")
};

const contexts = Object.fromEntries(
  Object.entries(canvases).map(([key, canvas]) => [
    key, canvas.getContext("2d")
  ])
);

const W = canvases.fractal.width;
const H = canvases.fractal.height;

const initial = {
  iterations: 180,
  zoom: 1,
  centerReal: -0.5,
  centerImag: 0,
  palette: "cosmic"
};

const defaults = Object.freeze({ ...initial });

const controlIds = [
  "iterations", "zoom", "centerReal",
  "centerImag", "palette"
];

const state = {
  screen: "welcome",
  phase: "ready",
  task: null,
  raf: null,
  generation: 0,
  progress: 0,
  point: { a: -1, b: 0 },
  orbit: [],
  escape: null,
  escapeRadius: 2,
  z0: { x: 0, y: 0 },
  step: 0,
  selected: false,
  hasRendered: false,
  displayParams: null,
  committedParams: null,
  committedCanvas: null
};

const paletteStops = {
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

const clamp = (v, a, b) =>
  Math.max(a, Math.min(b, v));

const fmt = n =>
  Number.isFinite(n)
    ? String(Number(n.toPrecision(6)))
    : Number.isNaN(n) ? "No definido"
    : n < 0 ? "−∞" : "∞";

// NAVEGACIÓN

function navigate(destination) {
  if (
    state.phase === "running" &&
    destination !== "lab"
  ) pause();

  for (const id of ["welcome", "credits", "lab"]) {
    $(id).hidden = id !== destination;
    $(id).classList.toggle(
      "active", id === destination
    );
  }

  state.screen = destination;
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

// PARTÍCULAS

for (let i = 0; i < 22; i++) {
  const bubble = document.createElement("span");
  bubble.className = "bubble";

  bubble.style.setProperty(
    "--left", `${(i * 41 + 17) % 100}%`
  );
  bubble.style.setProperty(
    "--size", `${8 + (i * 17) % 27}px`
  );
  bubble.style.setProperty(
    "--duration", `${15 + (i * 7) % 13}s`
  );
  bubble.style.setProperty(
    "--delay", `${-((i * 11) % 23)}s`
  );

  $("particles").appendChild(bubble);
}

// PANEL

function values() {
  return Object.fromEntries(
    controlIds.map(id => [
      id,
      id === "palette"
        ? $(id).value
        : Number($(id).value)
    ])
  );
}

function updateOutputs() {
  const v = values();

  $("iterationsOut").textContent = v.iterations;
  $("zoomOut").textContent = v.zoom.toFixed(2) + "×";
  $("centerRealOut").textContent =
    v.centerReal.toFixed(3);
  $("centerImagOut").textContent =
    v.centerImag.toFixed(3);

  $("metricIter").textContent = v.iterations;
  $("metricZoom").textContent =
    v.zoom.toFixed(2) + "×";
}

function buttons() {
  const running = state.phase === "running";
  const paused = state.phase === "paused";

  $("pauseBtn").disabled = !running;
  $("continueBtn").disabled = !paused;

  $("startBtn").textContent =
    running || paused
      ? "↻ Iniciar de nuevo"
      : "▶ Iniciar";
}

function status(message, progress = state.progress) {
  state.progress = progress;
}

function stopCurrent() {
  if (state.raf !== null) {
    cancelAnimationFrame(state.raf);
  }

  state.raf = null;
  state.generation++;
  state.task = null;
}

function blankCanvas(canvas, background = "#071428") {
  const c = canvas.getContext("2d");
  c.fillStyle = background;
  c.fillRect(0, 0, canvas.width, canvas.height);
}

let refreshTimer = null;
let previewRAF = null;
let requestedPreview = null;

// REINICIAR

function resetView(restore = false) {
  if (previewRAF !== null) {
    cancelAnimationFrame(previewRAF);
  }

  previewRAF = null;
  requestedPreview = null;

  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  stopCurrent();

  Object.assign(state, {
    displayParams: null,
    committedParams: null,
    committedCanvas: null,
    phase: "ready",
    progress: 0,
    orbit: [],
    escape: null,
    step: 0,
    selected: false,
    point: { a: -1, b: 0 },
    z0: { x: 0, y: 0 },
    escapeRadius: 2,
    hasRendered: false
  });

  if (restore) {
    for (const [id, value] of Object.entries(defaults)) {
      $(id).value = value;
    }
  }

  updateOutputs();

  for (const key of ["fractal", "orbit", "module"]) {
    blankCanvas(canvases[key]);
  }

  contexts.overlay.clearRect(0, 0, W, H);

  $("fractalPlaceholder").hidden = false;
  $("metricEscape").textContent = "Sin calcular";
  $("metricZ0").textContent = "0 + 0i";
  $("metricC").textContent = "−1 + 0i";
  $("escapeThresholdLegend").textContent = "Umbral = 2";

  $("cRealInput").value = "-1";
  $("cImagInput").value = "0";
  $("zRealInput").value = "0";
  $("zImagInput").value = "0";

  $("complexMessage").textContent =
    "Introduce c y z₀ para calcular el escape.";

  $("resultMessage").textContent =
    "Pulsa Iniciar para generar el fractal.";

  $("explanationText").textContent =
    "Se estudia la ecuación zₙ₊₁ = zₙ² + c.";

  $("changesHint").textContent =
    "Ajusta los parámetros y pulsa Iniciar.";

  status("Listo", 0);
  buttons();
  updateResultTable();
}

// PLANO COMPLEJO
// Se añade una magnificación visual ligada a las iteraciones.
// No modifica la pertenencia matemática al conjunto.

function viewHeight(p) {
  return (
    2.9 / p.zoom *
    Math.pow(
      180 / Math.max(30, p.iterations),
      0.26
    )
  );
}

function pixelToComplex(px, py, p) {
  const height = viewHeight(p);
  const width = height * W / H;

  return {
    a: p.centerReal + (px / W - 0.5) * width,
    b: p.centerImag + (0.5 - py / H) * height
  };
}

// COLORES

function colorSmooth(
  iterations,
  magnitude,
  palette,
  maxIterations = 180
) {
  const stops =
    paletteStops[palette] || paletteStops.cosmic;

  const smooth =
    iterations + 1 -
    Math.log2(
      Math.max(
        1e-9,
        Math.log2(Math.max(magnitude, 2.0001))
      )
    );

  const normalized = clamp(
    Math.log1p(Math.max(0, smooth)) /
    Math.log1p(Math.max(30, maxIterations)),
    0,
    1
  );

  const scaled = normalized * (stops.length - 1);
  const index = Math.min(
    stops.length - 2,
    Math.floor(scaled)
  );

  const fraction = scaled - index;

  return stops[index].map((value, k) =>
    Math.round(
      value +
      (stops[index + 1][k] - value) * fraction
    )
  );
}

// ÓRBITA DE c Y z₀
// El radio es 2 para Mandelbrot (z₀=0).
// Para z₀ personalizado se utiliza un umbral suficiente.

function orbitFor(a, b, maxIter, zx = 0, zy = 0) {
  let x = zx;
  let y = zy;
  let escape = null;

  const standard = zx === 0 && zy === 0;

  const radius = standard
    ? 2
    : Math.max(
        2,
        Math.hypot(a, b) + 1.000001
      );

  const samples = [
    {
      n: 0,
      x,
      y,
      m: Math.hypot(x, y)
    }
  ];

  if (samples[0].m > radius) {
    return {
      samples,
      escape: 0,
      radius,
      standard
    };
  }

  for (let n = 1; n <= maxIter; n++) {
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

  return {
    samples,
    escape,
    radius,
    standard
  };
}

function complexLabel(x, y) {
  return (
    fmt(x) +
    (y < 0 ? " − " : " + ") +
    fmt(Math.abs(y)) +
    "i"
  );
}

function setSelectedPoint(a, b, calc = true) {
  state.point = { a, b };
  state.selected = true;

  const zx = state.z0.x;
  const zy = state.z0.y;

  $("metricC").textContent = complexLabel(a, b);
  $("metricZ0").textContent = complexLabel(zx, zy);

  $("cRealInput").value = String(a);
  $("cImagInput").value = String(b);

  if (calc) {
    const result = orbitFor(
      a,
      b,
      values().iterations,
      zx,
      zy
    );

    state.orbit = result.samples;
    state.escape = result.escape;
    state.escapeRadius = result.radius;
    state.step = result.samples.length - 1;

    $("metricEscape").textContent =
      result.escape === null
        ? "No detectado"
        : `n = ${result.escape}`;

    $("escapeThresholdLegend").textContent =
      `Umbral = ${fmt(result.radius)}`;

    const description = result.standard
      ? "Mandelbrot (z₀ = 0)"
      : "Órbita con z₀ personalizado";

    if (result.escape === null) {
      $("resultMessage").textContent =
        `${description}: no se detectó escape ` +
        `en ${values().iterations} iteraciones.`;

      $("complexMessage").textContent =
        "No se detectó escape. Esto no demuestra " +
        "que la órbita permanezca acotada para siempre.";
    } else {
      $("resultMessage").textContent =
        `${description}: escape detectado ` +
        `en n = ${result.escape}.`;

      $("complexMessage").textContent =
        `La órbita superó el umbral ` +
        `${fmt(result.radius)} en n = ${result.escape}.`;
    }

    $("explanationText").textContent =
      result.standard
        ? (
            result.escape === null
              ? "No se detectó escape; la pertenencia " +
                "no queda demostrada."
              : `El punto c = ${complexLabel(a, b)} ` +
                `está fuera de Mandelbrot.`
          )
        : "Con z₀ distinto de cero estudias una " +
          "órbita personalizada, no la pertenencia " +
          "de c al conjunto de Mandelbrot.";
  }

  drawMarker();
  drawGraphs();
  updateResultTable();
}

// MARCADOR

function drawMarker() {
  const o = contexts.overlay;
  o.clearRect(0, 0, W, H);

  if (!state.selected) return;

  const p = state.displayParams || values();
  const h = viewHeight(p);
  const w = h * W / H;

  const x =
    W / 2 +
    (state.point.a - p.centerReal) / w * W;

  const y =
    H / 2 -
    (state.point.b - p.centerImag) / h * H;

  if (x < 0 || x > W || y < 0 || y > H) {
    return;
  }

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

// VISTA PREVIA DEL FRACTAL

const previewCanvas =
  document.createElement("canvas");

previewCanvas.width = 210;
previewCanvas.height = Math.round(210 * H / W);

const previewContext =
  previewCanvas.getContext("2d");

function quickMandelbrot(a, b, maximum) {
  const x = a - 0.25;
  const q = x * x + b * b;

  if (
    q * (q + x) <= 0.25 * b * b ||
    (a + 1) ** 2 + b * b <= 0.0625
  ) {
    return null;
  }

  let zr = 0;
  let zi = 0;
  let zr2 = 0;
  let zi2 = 0;
  let n = 0;

  while (n < maximum && zr2 + zi2 <= 4) {
    const nextImag = 2 * zr * zi + b;
    zr = zr2 - zi2 + a;
    zi = nextImag;
    zr2 = zr * zr;
    zi2 = zi * zi;
    n++;
  }

  if (n === maximum && zr2 + zi2 <= 4) {
    return null;
  }

  return [n, Math.hypot(zr, zi)];
}

function drawQuickPreview(p) {
  const pw = previewCanvas.width;
  const ph = previewCanvas.height;

  const image =
    previewContext.createImageData(pw, ph);

  const h = viewHeight(p);
  const w = h * W / H;
  const limit = Math.min(p.iterations, 220);

  for (let py = 0; py < ph; py++) {
    const b =
      p.centerImag +
      (0.5 - (py + 0.5) / ph) * h;

    for (let px = 0; px < pw; px++) {
      const a =
        p.centerReal +
        ((px + 0.5) / pw - 0.5) * w;

      const result = quickMandelbrot(
        a,
        b,
        limit
      );

      const rgb = result === null
        ? [3, 9, 23]
        : colorSmooth(
            result[0],
            result[1],
            p.palette,
            p.iterations
          );

      const k = (py * pw + px) * 4;

      image.data[k] = rgb[0];
      image.data[k + 1] = rgb[1];
      image.data[k + 2] = rgb[2];
      image.data[k + 3] = 255;
    }
  }

  previewContext.putImageData(
    image,
    0,
    0
  );

  contexts.fractal.imageSmoothingEnabled = true;
  contexts.fractal.clearRect(0, 0, W, H);

  contexts.fractal.drawImage(
    previewCanvas,
    0,
    0,
    W,
    H
  );

  state.displayParams = { ...p };
  drawMarker();
}

function previewFractal(p) {
  if (
    !state.hasRendered &&
    !$("fractalPlaceholder").hidden
  ) return;

  if (previewRAF !== null) {
    cancelAnimationFrame(previewRAF);
    previewRAF = null;
  }

  requestedPreview = null;
  drawQuickPreview(p);
}

// INICIAR

function start() {
  stopCurrent();

  const p = values();

  const buffer =
    document.createElement("canvas");

  buffer.width = W;
  buffer.height = H;

  const bctx = buffer.getContext("2d");
  const image = bctx.createImageData(W, H);

  state.task = {
    p,
    w: W,
    h: H,
    buffer,
    bctx,
    image,
    row: 0,
    generation: state.generation
  };

  state.phase = "running";
  state.step = 0;
  state.progress = 0;

  if (
    state.hasRendered ||
    $("fractalPlaceholder").hidden
  ) {
    drawQuickPreview(p);
  } else {
    contexts.fractal.clearRect(0, 0, W, H);
    state.displayParams = { ...p };
  }

  $("fractalPlaceholder").hidden = true;

  setSelectedPoint(
    state.point.a,
    state.point.b,
    true
  );

  status("Generando", 0);
  buttons();

  $("changesHint").textContent =
    "El fractal está cambiando con los controles…";

  schedule();
}

function schedule() {
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

// DIBUJO PROGRESIVO EN ALTA RESOLUCIÓN

function renderBlock(t) {
  const first = t.row;
  const startAt = performance.now();

  while (
    t.row < t.h &&
    t.row - first < 10 &&
    performance.now() - startAt < 14
  ) {
    const py = t.row;

    for (let px = 0; px < t.w; px++) {
      const { a, b } = pixelToComplex(
        px + 0.5,
        py + 0.5,
        t.p
      );

      let x = 0;
      let y = 0;
      let x2 = 0;
      let y2 = 0;
      let n = 0;

      while (
        n < t.p.iterations &&
        x2 + y2 <= 4
      ) {
        const ny = 2 * x * y + b;
        const nx = x2 - y2 + a;

        x = nx;
        y = ny;
        x2 = x * x;
        y2 = y * y;
        n++;
      }

      const rgb =
        n === t.p.iterations && x2 + y2 <= 4
          ? [3, 9, 23]
          : colorSmooth(
              n,
              Math.hypot(x, y),
              t.p.palette,
              t.p.iterations
            );

      const index = (py * t.w + px) * 4;

      t.image.data[index] = rgb[0];
      t.image.data[index + 1] = rgb[1];
      t.image.data[index + 2] = rgb[2];
      t.image.data[index + 3] = 255;
    }

    t.row++;
  }

  if (t.row > first) {
    contexts.fractal.putImageData(
      t.image,
      0,
      0,
      0,
      first,
      t.w,
      t.row - first
    );
  }

  const progress = t.row / t.h;

  state.step = Math.max(
    0,
    Math.min(
      state.orbit.length - 1,
      Math.floor(
        progress * (state.orbit.length - 1)
      )
    )
  );

  status("Generando", progress);

  if (t.row >= t.h) {
    contexts.fractal.putImageData(
      t.image,
      0,
      0
    );

    state.hasRendered = true;
    state.phase = "finished";
    state.step = state.orbit.length - 1;
    state.task = null;
    state.displayParams = { ...t.p };
    state.committedParams = { ...t.p };

    if (!state.committedCanvas) {
      state.committedCanvas =
        document.createElement("canvas");
    }

    state.committedCanvas.width = W;
    state.committedCanvas.height = H;

    state.committedCanvas
      .getContext("2d")
      .drawImage(canvases.fractal, 0, 0);

    status("Listo", 1);
    buttons();
    drawGraphs();
    drawMarker();

    $("changesHint").textContent =
      "Fractal actualizado. Mueve el zoom " +
      "o las iteraciones para seguir explorando.";
  } else {
    schedule();
  }
}

// PAUSA Y CONTINUACIÓN

function pause() {
  if (state.phase !== "running") return;

  state.phase = "paused";

  if (state.raf !== null) {
    cancelAnimationFrame(state.raf);
  }

  state.raf = null;
  status("Pausado");
  buttons();
}

function resume() {
  if (
    state.phase !== "paused" ||
    !state.task
  ) return;

  state.phase = "running";

  status("Continuando");
  buttons();
  schedule();
}

// GRÁFICAS CON ESCALA ADAPTABLE

function plotFrame(
  context,
  element,
  maxN,
  rawValues,
  grid,
  compress = false
) {
  const w = element.width;
  const h = element.height;

  const L = 64;
  const R = 24;
  const T = 24;
  const B = 40;

  const pw = w - L - R;
  const ph = h - T - B;

  const transform = v => {
    if (v === Infinity) return 42;
    if (v === -Infinity) return -42;
    if (Number.isNaN(v)) return 0;

    return compress ? Math.asinh(v / 10) : v;
  };

  const vals = rawValues
    .map(transform)
    .filter(Number.isFinite);

  vals.push(0);

  let lo = Math.min(...vals);
  let hi = Math.max(...vals);

  if (Math.abs(hi - lo) < 1e-9) {
    lo -= 1;
    hi += 1;
  }

  const pad = (hi - lo) * 0.12;

  lo -= pad;
  hi += pad;

  context.fillStyle = "#071428";
  context.fillRect(0, 0, w, h);
  context.font = "12px Segoe UI, Arial";

  if (grid) {
    context.strokeStyle = "#294668";
    context.lineWidth = 1;

    for (let i = 0; i <= 4; i++) {
      const y = T + i * ph / 4;

      context.beginPath();
      context.moveTo(L, y);
      context.lineTo(w - R, y);
      context.stroke();

      context.fillStyle = "#a8bddd";

      context.fillText(
        compress
          ? "~" + fmt(
              Math.sinh(
                hi - (hi - lo) * i / 4
              ) * 10
            )
          : fmt(
              hi - (hi - lo) * i / 4
            ),
        5,
        y + 4
      );
    }

    for (let i = 0; i <= 5; i++) {
      const x = L + i * pw / 5;

      context.beginPath();
      context.moveTo(x, T);
      context.lineTo(x, h - B);
      context.stroke();

      context.fillStyle = "#a8bddd";

      context.fillText(
        String(Math.round(maxN * i / 5)),
        x - 8,
        h - 16
      );
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

  if (compress) {
    context.fillStyle = "#ffd78b";
    context.fillText(
      "Escala comprimida", L + 7, 14
    );
  }

  return {
    X: n =>
      L + n / Math.max(1, maxN) * pw,

    Y: v =>
      T +
      (hi - clamp(transform(v), lo, hi)) /
      (hi - lo) * ph
  };
}

function drawSeries(
  context,
  data,
  plot,
  selector,
  color
) {
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 2.4;

  context.beginPath();

  let begun = false;

  for (const item of data) {
    const value = selector(item);

    if (Number.isNaN(value)) {
      begun = false;
      continue;
    }

    const x = plot.X(item.n);
    const y = plot.Y(value);

    if (!begun) {
      context.moveTo(x, y);
      begun = true;
    } else {
      context.lineTo(x, y);
    }
  }

  context.stroke();

  // Marcadores visibles incluso para un solo punto.
  for (const item of data) {
    const value = selector(item);

    if (Number.isNaN(value)) continue;

    context.beginPath();
    context.arc(
      plot.X(item.n),
      plot.Y(value),
      4,
      0,
      2 * Math.PI
    );
    context.fill();
  }
}

function drawGraphs() {
  const all = state.orbit;

  if (!all.length) {
    blankCanvas(canvases.orbit);
    blankCanvas(canvases.module);
    return;
  }

  const maxN = Math.max(
    1,
    all[all.length - 1].n
  );

  const allValues = all.flatMap(
    p => [p.x, p.y, p.m]
  );

  const extreme = allValues.some(
    v => !Number.isFinite(v) || Math.abs(v) > 200
  );

  const grid = $("showGrid").checked;

  const orbitPlot = plotFrame(
    contexts.orbit,
    canvases.orbit,
    maxN,
    all.flatMap(p => [p.x, p.y]),
    grid,
    extreme
  );

  drawSeries(
    contexts.orbit,
    all,
    orbitPlot,
    p => p.x,
    "#42e6f2"
  );

  drawSeries(
    contexts.orbit,
    all,
    orbitPlot,
    p => p.y,
    "#b177ff"
  );

  const modulePlot = plotFrame(
    contexts.module,
    canvases.module,
    maxN,
    [
      0,
      state.escapeRadius,
      ...all.map(p => p.m)
    ],
    grid,
    extreme
  );

  contexts.module.save();
  contexts.module.strokeStyle = "#ff768c";
  contexts.module.lineWidth = 2;
  contexts.module.setLineDash([7, 5]);

  contexts.module.beginPath();

  contexts.module.moveTo(
    modulePlot.X(0),
    modulePlot.Y(state.escapeRadius)
  );

  contexts.module.lineTo(
    modulePlot.X(maxN),
    modulePlot.Y(state.escapeRadius)
  );

  contexts.module.stroke();
  contexts.module.restore();

  drawSeries(
    contexts.module,
    all,
    modulePlot,
    p => p.m,
    "#ffce72"
  );
}

function updateVisibleGraphs() {
  for (const [id, card] of [
    ["showFractal", "fractalCard"],
    ["showOrbit", "orbitCard"],
    ["showModule", "moduleCard"]
  ]) {
    $(card).classList.toggle(
      "hidden-graph",
      !$(id).checked
    );
  }

  drawGraphs();
}

// BOTONES

$("startBtn").onclick = start;
$("pauseBtn").onclick = pause;
$("continueBtn").onclick = resume;

$("restartBtn").onclick = () => resetView(false);

$("defaultsBtn").onclick = () => {
  resetView(true);
  $("changesHint").textContent =
    "Parámetros originales restaurados.";
};

// DESLIZADORES DEL FRACTAL

function refreshFractalNow() {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
  }

  refreshTimer = null;
  updateOutputs();

  if ($("fractalPlaceholder").hidden) {
    start();
  } else {
    $("changesHint").textContent =
      "Pulsa Iniciar para dibujar el fractal.";
  }
}

for (const id of controlIds) {
  $(id).addEventListener("input", () => {
    updateOutputs();

    if (refreshTimer !== null) {
      clearTimeout(refreshTimer);
    }

    if (!$("fractalPlaceholder").hidden) {
      return;
    }

    if (state.task) {
      stopCurrent();
      state.phase = "ready";
    }

    previewFractal(values());

    $("changesHint").textContent =
      "Explorando: el fractal se está redibujando…";

    refreshTimer = setTimeout(
      refreshFractalNow,
      300
    );
  });

  $(id).addEventListener("change", () => {
    refreshFractalNow();
  });
}

// OPCIONES DE VISUALIZACIÓN

for (const id of [
  "showFractal",
  "showOrbit",
  "showModule",
  "showGrid"
]) {
  $(id).addEventListener(
    "change",
    updateVisibleGraphs
  );
}

// CLIC EN EL FRACTAL

canvases.fractal.addEventListener(
  "click",
  event => {
    if (
      $("fractalPlaceholder").hidden === false
    ) return;

    const rect =
      canvases.fractal.getBoundingClientRect();

    const x =
      (event.clientX - rect.left) /
      rect.width * W;

    const y =
      (event.clientY - rect.top) /
      rect.height * H;

    const c = pixelToComplex(
      x,
      y,
      state.displayParams || values()
    );

    setSelectedPoint(c.a, c.b, true);
  }
);

// EXPLORADOR DE c Y z₀

function analyzeComplexInputs() {
  const ids = [
    "cRealInput",
    "cImagInput",
    "zRealInput",
    "zImagInput"
  ];

  const numbers = ids.map(id => {
    const raw = $(id).value.trim();

    return raw === ""
      ? NaN
      : Number(raw);
  });

  if (numbers.some(n => !Number.isFinite(n))) {
    $("complexMessage").textContent =
      "Introduce cuatro números válidos.";
    return;
  }

  const [a, b, zx, zy] = numbers;

  if (
    Math.max(
      Math.abs(a),
      Math.abs(b),
      Math.abs(zx),
      Math.abs(zy)
    ) > 1000000
  ) {
    $("complexMessage").textContent =
      "Introduce valores entre −1 000 000 y 1 000 000.";
    return;
  }

  state.z0 = { x: zx, y: zy };
  setSelectedPoint(a, b, true);
}

$("analyzeComplexBtn").addEventListener(
  "click",
  analyzeComplexInputs
);

document
  .querySelectorAll(".complex-preset")
  .forEach(button => {
    button.addEventListener("click", () => {
      $("cRealInput").value = button.dataset.a;
      $("cImagInput").value = button.dataset.b;
      $("zRealInput").value = "0";
      $("zImagInput").value = "0";

      analyzeComplexInputs();
    });
  });

for (const id of [
  "cRealInput",
  "cImagInput",
  "zRealInput",
  "zImagInput"
]) {
  $(id).addEventListener("keydown", event => {
    if (event.key === "Enter") {
      analyzeComplexInputs();
    }
  });
}

let liveComplexTimer = null;

for (const id of [
  "cRealInput",
  "cImagInput",
  "zRealInput",
  "zImagInput"
]) {
  $(id).addEventListener("input", () => {
    clearTimeout(liveComplexTimer);

    liveComplexTimer = setTimeout(() => {
      const fields = [
        "cRealInput",
        "cImagInput",
        "zRealInput",
        "zImagInput"
      ].map(key => $(key).value.trim());

      if (
        fields.some(
          v =>
            v === "" ||
            v === "-" ||
            v === "." ||
            v === "-."
        )
      ) return;

      if (
        fields.every(v =>
          Number.isFinite(Number(v))
        )
      ) {
        analyzeComplexInputs();
      }
    }, 300);
  });
}

// TABLA DE RESULTADOS

function updateResultTable() {
  const tbody = $("tableBody");
  tbody.replaceChildren();

  const data = state.orbit;

  if (!data.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 5;
    cell.textContent =
      "Pulsa Iniciar para obtener resultados.";

    row.appendChild(cell);
    tbody.appendChild(row);

    $("tablePoint").textContent = "Sin calcular";
    $("tableInitial").textContent = "0 + 0i";
    $("tableCount").textContent = "0 registros";

    return;
  }

  const { a, b } = state.point;

  $("tablePoint").textContent =
    complexLabel(a, b);

  $("tableInitial").textContent =
    complexLabel(state.z0.x, state.z0.y);

  const fragment =
    document.createDocumentFragment();

  for (const item of data) {
    const row = document.createElement("tr");

    const escaped =
      !Number.isFinite(item.m) ||
      item.m > state.escapeRadius;

    if (escaped) {
      row.className = "escaped";
    }

    const columns = [
      item.n,
      fmt(item.x),
      fmt(item.y),
      fmt(item.m),
      escaped
        ? "Escapa"
        : item.n === 0
          ? "Inicial"
          : "No escapa"
    ];

    for (const value of columns) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    }

    fragment.appendChild(row);
  }

  tbody.appendChild(fragment);

  $("tableCount").textContent =
    `${data.length} registros`;
}

// EXPORTAR CSV

$("exportCSV").addEventListener("click", () => {
  if (!state.orbit.length) {
    alert(
      "Inicia la simulación o analiza un punto."
    );
    return;
  }

  const lines = [
    "Iteracion,Real,Imaginaria,Modulo,Estado"
  ];

  for (const item of state.orbit) {
    const escaped =
      !Number.isFinite(item.m) ||
      item.m > state.escapeRadius;

    const label = item.n === 0
      ? "Inicial"
      : escaped
        ? "Escapa"
        : "No escapa";

    lines.push([
      item.n,
      item.x,
      item.y,
      item.m,
      label
    ].join(","));
  }

  const blob = new Blob(
    ["\uFEFF" + lines.join("\r\n")],
    {
      type: "text/csv;charset=utf-8"
    }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "mandelbrot_resultados.csv";

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
});

// CUESTIONARIO

const quizQuestions = [
  {
    question:
      "¿Cuál es la regla iterativa del conjunto de Mandelbrot?",
    options: [
      "z(n+1) = z(n) + c",
      "z(n+1) = z(n)² + c",
      "z(n+1) = 2z(n) + c",
      "z(n+1) = c²"
    ],
    correct: 1,
    explanation:
      "La regla es z(n+1) = z(n)² + c, " +
      "comenzando con z(0) = 0."
  },
  {
    question:
      "¿Qué significa que |zₙ| sea mayor que 2?",
    options: [
      "El punto pertenece al conjunto",
      "La sucesión siempre vuelve a cero",
      "La órbita escapa: el punto está fuera del conjunto",
      "La ecuación deja de funcionar"
    ],
    correct: 2,
    explanation:
      "Con z₀ = 0, superar 2 demuestra " +
      "que el punto está fuera."
  },
  {
    question:
      "Si c = 0 y z₀ = 0, ¿qué sucede?",
    options: [
      "Todos los términos son cero",
      "Escapa en n = 3",
      "Crece sin límite",
      "Alterna entre 1 y 2"
    ],
    correct: 0,
    explanation:
      "Con c = 0, cada término es cero."
  },
  {
    question:
      "¿Qué permite aumentar las iteraciones máximas?",
    options: [
      "Cambiar la ecuación",
      "Detectar escapes tardíos",
      "Eliminar los números complejos",
      "Demostrar que todos los puntos pertenecen"
    ],
    correct: 1,
    explanation:
      "Más iteraciones permiten detectar escapes tardíos."
  },
  {
    question:
      "¿Para qué sirve el deslizador de zoom?",
    options: [
      "Cambiar la ecuación",
      "Cambiar el radio de escape",
      "Eliminar la parte imaginaria",
      "Explorar detalles fractales a diferentes escalas"
    ],
    correct: 3,
    explanation:
      "El zoom permite observar distintas escalas."
  }
];

let quizIndex = 0;
let quizScore = 0;
let quizAttempts = 0;
let quizAnswered = false;

function showQuizQuestion() {
  const q = quizQuestions[quizIndex];

  quizAttempts = 0;
  quizAnswered = false;

  $("quizCounter").textContent =
    `Pregunta ${quizIndex + 1} de ${quizQuestions.length}`;

  $("quizQuestion").textContent = q.question;
  $("quizScore").textContent = `${quizScore}/10`;

  $("quizProgress").style.width =
    `${
      quizIndex / quizQuestions.length * 100
    }%`;

  $("quizFeedback").textContent =
    "Selecciona una respuesta y pulsa Comprobar.";

  $("quizFinal").hidden = true;
  $("quizCheck").disabled = false;
  $("quizNext").disabled = true;

  const container = $("quizOptions");
  container.replaceChildren();

  q.options.forEach((option, index) => {
    const label = document.createElement("label");
    label.className = "quiz-option";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "quizAnswer";
    radio.value = String(index);

    const span = document.createElement("span");
    span.textContent = option;

    label.append(radio, span);
    container.appendChild(label);
  });
}

function checkQuizAnswer() {
  if (quizAnswered) return;

  const picked = document.querySelector(
    'input[name="quizAnswer"]:checked'
  );

  if (!picked) {
    $("quizFeedback").textContent =
      "Elige una opción antes de comprobar.";
    return;
  }

  const q = quizQuestions[quizIndex];
  const choice = Number(picked.value);
  const label = picked.closest("label");

  if (choice === q.correct) {
    quizAnswered = true;

    const points = quizAttempts === 0
      ? 2
      : 1;

    quizScore += points;
    label.classList.add("correct");

    $("quizFeedback").textContent =
      `¡Correcto! +${points} punto(s). ` +
      q.explanation;
  } else {
    quizAttempts++;
    label.classList.add("wrong");
    picked.checked = false;
    picked.disabled = true;

    if (quizAttempts === 1) {
      $("quizFeedback").textContent =
        "Tienes un segundo intento por 1 punto.";
      return;
    }

    quizAnswered = true;

    $("quizOptions")
      .children[q.correct]
      .classList.add("correct");

    $("quizFeedback").textContent =
      `Respuesta correcta: ${q.options[q.correct]}. ` +
      q.explanation;
  }

  $("quizScore").textContent =
    `${quizScore}/10`;

  $("quizCheck").disabled = true;
  $("quizNext").disabled = false;

  document
    .querySelectorAll('input[name="quizAnswer"]')
    .forEach(r => {
      r.disabled = true;
    });
}

function nextQuizQuestion() {
  if (!quizAnswered) return;

  if (quizIndex < quizQuestions.length - 1) {
    quizIndex++;
    showQuizQuestion();
    return;
  }

  $("quizProgress").style.width = "100%";
  $("quizCounter").textContent =
    "Actividad terminada";

  $("quizQuestion").textContent =
    "¡Has completado el Desafío Mandelbrot!";

  $("quizOptions").replaceChildren();

  $("quizCheck").disabled = true;
  $("quizNext").disabled = true;
  $("quizFinal").hidden = false;

  $("quizFinal").textContent =
    `Calificación final: ${quizScore}/10. ` +
    (
      quizScore >= 7
        ? "Buen trabajo: comprendiste los conceptos principales."
        : "Vuelve a explorar el simulador " +
          "y repite la actividad para mejorar."
    );

  $("quizFeedback").textContent =
    "Puedes repetir la actividad cuando quieras.";
}

$("quizCheck").addEventListener(
  "click",
  checkQuizAnswer
);

$("quizNext").addEventListener(
  "click",
  nextQuizQuestion
);

$("quizReset").addEventListener(
  "click",
  () => {
    quizIndex = 0;
    quizScore = 0;
    showQuizQuestion();
  }
);

// INICIALIZACIÓN

updateOutputs();
resetView(true);
updateVisibleGraphs();
showQuizQuestion();

console.info(
  "MANDELBROT LAB: actualización en vivo cargada (Live Server)"
);
