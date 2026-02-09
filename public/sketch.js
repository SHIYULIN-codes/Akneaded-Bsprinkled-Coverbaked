let socket;
let mochis = [];
let cursors = {};

const maxMochis = 12;

const kneadSec = 6;
const fermentSec = 20;
const bakeMaxSec = 12;

const worldW = 1200;
const worldH = 800;

const margin = 16;
const safePad = 140;

let cam = { z: 1, x: 0, y: 0 };
let holdId = null;

function setup() {
  createCanvas(windowWidth, windowHeight);

  socket = io();
  socket.emit("hello", {});

  socket.on("state", (data) => {
    mochis = (data && data.mochis) || [];
    cursors = (data && data.cursors) || {};
    keepInBounds();
  });
}

function draw() {
  background(255, 230, 240);

  updateCam();

  push();
  translate(cam.x, cam.y);
  scale(cam.z);

  keepInBounds();
  for (const m of mochis) drawMochi(m);
  drawCursors();

  pop();

  drawHelp();

  if (frameCount % 3 === 0) {
    socket.emit("cursor", { x: toWorldX(mouseX), y: toWorldY(mouseY) });
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function updateCam() {
  const wAvail = max(1, width - 2 * margin);
  const hAvail = max(1, height - 2 * margin);

  cam.z = max(wAvail / worldW, hAvail / worldH);
  cam.x = (width - worldW * cam.z) / 2;
  cam.y = (height - worldH * cam.z) / 2;
}

function toWorldX(sx) { return (sx - cam.x) / cam.z; }
function toWorldY(sy) { return (sy - cam.y) / cam.z; }
function wMouseX() { return toWorldX(mouseX); }
function wMouseY() { return toWorldY(mouseY); }

function clamp(v, a, b) { return max(a, min(b, v)); }
function clamp01(v) { return max(0, min(1, v)); }

// Safe Area
function keepInBounds() {
  for (const m of mochis) {
    const r = max((m.sizeW || 100) / 2, (m.sizeH || 80) / 2);
    const pad = max(safePad, r + 90);
    m.x = clamp(m.x, pad, worldW - pad);
    m.y = clamp(m.y, pad, worldH - pad);
  }
}

// Input
function keyPressed() {
  if (key !== "a" && key !== "A") return;
  if (mochis.length >= maxMochis) return;

  const defName = "Mochi" + (mochis.length + 1);
  const name = prompt("Name this new mochi:", defName);
  if (!name) return;

  socket.emit("add_mochi", { name: String(name).slice(0, 24) });
}

function mousePressed() {
  const hit = hitTestMochi(wMouseX(), wMouseY());
  if (!hit) return;

  const m = hit.m;

  if (m.status === "READY_TO_DECORATE") return sprinkle(m);
  if (m.status === "BAKING") return act(m, "finish_bake_click");
  if (m.status === "BAKED") return act(m, "eat_click");

  if (m.status === "IDLE" || m.status === "DAYDREAM") {
    act(m, "wake_click");
    act(m, "start_knead");
    holdId = m.id;
  }
}

function mouseReleased() {
  if (!holdId) return;
  actId(holdId, "stop_knead");
  holdId = null;
}

function doubleClicked() {
  const hit = hitTestMochi(wMouseX(), wMouseY());
  if (hit && hit.m.status === "READY_TO_DECORATE") act(hit.m, "start_bake");
}

function act(m, type, data) {
  socket.emit("action", { id: m.id, type, data });
}

function actId(id, type, data) {
  socket.emit("action", { id, type, data });
}

function sprinkle(m) {
  const mx = wMouseX();
  const my = wMouseY();

  const relX = mx - m.x;
  const relY = my - m.y;

  const cols = [
    color("#FF69B4"),
    color("#FFD700"),
    color("#00BFFF"),
    color("#7FFF00"),
    color("#FFFFFF"),
  ];
  const cc = random(cols);

  act(m, "add_candy", {
    relX,
    relY,
    w: random(6, 10),
    h: random(3, 5),
    rot: random(TWO_PI),
    c: [red(cc), green(cc), blue(cc), 255],
  });
}

function drawHelp() {
  const lines = [
    "Someone secretly left you a few soft mochi breads.",
    "After you eat yours, make some for the next visitors.",
    "",
    `Create: press A (${mochis.length}/${maxMochis})`,
    "Knead: hold the mochi",
    "Ferment: wait for the progress bar",
    "Decorate: click to sprinkle",
    "Bake: double-click",
    "Serve: click to finish baking",
    "Eat: click again",
  ];

  push();
  textAlign(LEFT, TOP);
  textSize(14);

  const x = 16, y = 16, w = 350;
  const lineH = 18;
  const h = lines.length * lineH + 18;

  noStroke();
  fill(255, 255, 255, 110);
  rect(x, y, w, h, 12);

  fill(80);
  let ty = y + 10;
  for (const s of lines) {
    text(s, x + 12, ty);
    ty += lineH;
  }
  pop();
}

function hitTestMochi(mx, my) {
  for (let i = mochis.length - 1; i >= 0; i--) {
    const m = mochis[i];
    const r = (m.sizeW || 100) / 2;
    if (dist(mx, my, m.x, m.y) < r) return { m, i };
  }
  return null;
}

function drawMochi(m) {
  const now = Date.now();
  const breathe = sin(frameCount * 0.05) * 5;
  const eatScale = (m.eatScale == null) ? 1 : m.eatScale;

  const isSleep = m.status === "DAYDREAM";
  const baseW = m.sizeW || 100;
  const baseH = m.sizeH || 80;

  const drawW = isSleep ? 140 : baseW;
  const drawH = isSleep ? 40 : baseH;

  push();
  translate(m.x, m.y);
  scale(eatScale);
  noStroke();

  drawUi(m, now, baseH);

  let bodyCol = color(255);
  if (isSleep) bodyCol = color(230, 230, 255);
  else if (m.status === "BAKING" || m.status === "BAKED") bodyCol = bakeCol(m);

  fill(bodyCol);
  ellipse(0, 0, drawW + breathe, drawH - breathe);

  rectMode(CENTER);
  for (const t of (m.toppings || [])) {
    push();
    translate(t.relX, t.relY);
    rotate(t.rot || 0);
    const c = t.c || [255, 255, 255, 255];
    fill(c[0], c[1], c[2], c[3] == null ? 255 : c[3]);
    rect(0, 0, t.w || 8, t.h || 4, 2);
    pop();
  }

  drawFace(m, isSleep);

  if (isSleep && m.dreamText && String(m.dreamText).trim()) {
    fill(120, 150, 255);
    textSize(12);
    textAlign(CENTER);
    text(`zZZ... ${m.dreamText}`, 0, -drawH - 12);
  }

  fill(100);
  textAlign(CENTER);
  textSize(11);
  if (!m.isEaten) text(m.name || "Mochi", 0, drawH / 2 + 18);

  pop();
}

function drawUi(m, now, baseH) {
  if (m.isEaten) return;

  const uiY = -baseH / 2 - 16;

  textAlign(CENTER);
  textSize(11);

  const ui = uiState(m, now);
  if (!ui.label) return;

  fill(80);
  noStroke();
  text(ui.label, 0, uiY);

  if (ui.p > 0 && ui.p < 1) {
    fill(220);
    rect(-30, uiY + 6, 60, 4, 2);
    fill(ui.col);
    rect(-30, uiY + 6, 60 * ui.p, 4, 2);
  }
}

function uiState(m, now) {
  if (m.status === "IDLE") {
    if (m.isKneading) {
      return {
        label: "Kneading…",
        p: clamp01((m.kneadAccum || 0) / kneadSec),
        col: color(100, 255, 150),
      };
    }
    return { label: "Hold to knead", p: 0, col: color(200) };
  }

  if (m.status === "FERMENTING") {
    const start = m.fermentStart || 0;
    const t = start ? (now - start) / 1000 : 0;
    return {
      label: "Fermenting…",
      p: clamp01(t / fermentSec),
      col: color(255, 180, 0),
    };
  }

  if (m.status === "READY_TO_DECORATE") {
    return { label: "Decorate — click to sprinkle\n(double-click to bake)", p: 0, col: color(200) };
  }

  if (m.status === "BAKING") {
    return {
      label: "Baking… (click to finish)",
      p: clamp01((m.bakeElapsed || 0) / bakeMaxSec),
      col: color(255, 60, 0),
    };
  }

  if (m.status === "BAKED") {
    return { label: "Freshly baked! Click to eat or leave it for the next person.", p: 0, col: color(200) };
  }

  return { label: "", p: 0, col: color(200) };
}

function drawFace(m, isSleep) {
  if (isSleep) {
    fill(80, 150);
    rect(-20, 0, 10, 2);
    rect(10, 0, 10, 2);
  } else {
    fill(0);
    const eyeSize = (m.status === "BAKING" || m.status === "BAKED") ? 10 : 7;
    circle(-15, 0, eyeSize);
    circle(15, 0, eyeSize);

    if (m.status === "BAKED") {
      noFill();
      stroke(0);
      strokeWeight(1);
      arc(0, 5, 10, 8, 0, PI);
    }
  }

  noStroke();
  fill(255, 180, 200, 150);
  ellipse(-25, 10, 15, 8);
  ellipse(25, 10, 15, 8);
}

function bakeCol(m) {
  const p = clamp01((m.bakeElapsed || 0) / bakeMaxSec);

  const c1 = color(255);
  const c2 = color(255, 160, 20);
  const c3 = color(180, 80, 10);

  if (p < 0.4) return lerpColor(c1, c2, map(p, 0, 0.4, 0, 1));
  return lerpColor(c2, c3, map(p, 0.4, 1, 0, 1));
}

function drawCursors() {
  const now = Date.now();
  for (const id in cursors) {
    const c = cursors[id];
    if (!c) continue;
    if (c.ts && now - c.ts > 5000) continue;

    push();
    noStroke();
    fill(80, 120);
    circle(c.x, c.y, 10);
    pop();
  }
}
