const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const fs = require("fs")
const path = require("path")

const app = express()
const server = http.createServer(app)
const io = new Server(server)

app.use(express.static("public"))

const port = process.env.PORT || 3000

const worldW = 1200
const worldH = 800

const maxMochis = 12

const kneadSec = 6
const fermentSec = 20
const bakeMaxSec = 12

const cursorTtlMs = 5000

const dreamLines = [
  "…want some sugar…",
  "…so sleepy…",
  "is it raining?",
  "…so squishy…",
  "…floating away…",
  "I'm a tiny cloud…",
  "please knead me…",
  "five more seconds…",
  "dreaming of warm oven light…",
  "will someone hold me?",
  "I'm glowing today…",
  "take it slow today…",
  "dreaming in cream flavor…",
  "growing… softly…",
  "sweet little nap…",
]

const nowMs = () => Date.now()
const rand = (minValue, maxValue) => minValue + Math.random() * (maxValue - minValue)
const clamp = (value, minValue, maxValue) => Math.max(minValue, Math.min(maxValue, value))
const lerp = (start, end, t) => start + (end - start) * t
const smooth01 = t => t * t * (3 - 2 * t)
const pick = arr => arr[(Math.random() * arr.length) | 0]

const hasCjk = text => {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(String(text || ""))
}

function makeId() {
  const t = nowMs().toString(36)
  return "m_" + Math.random().toString(36).slice(2) + "_" + t
}

const dataDir = path.join(process.cwd(), "data")
const statePath = path.join(dataDir, "state.json")

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

function loadState() {
  try {
    if (!fs.existsSync(statePath)) return []

    const arr = JSON.parse(fs.readFileSync(statePath, "utf-8"))
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function saveState(mochis) {
  try {
    fs.writeFileSync(statePath, JSON.stringify(mochis, null, 2), "utf-8")
  } catch (error) {
    console.log("saveState error:", error?.message || error)
  }
}

// normalize loaded data so old or incomplete state can still work
// This function was debugged with the assistance of ChatGPT.
function normalizeMochi(m) {
  const now = nowMs()

  m.id = m.id || makeId()
  m.x = Number.isFinite(m.x) ? m.x : rand(150, 1050)
  m.y = Number.isFinite(m.y) ? m.y : rand(150, 650)

  m.sizeW = Number.isFinite(m.sizeW) ? m.sizeW : 100
  m.sizeH = Number.isFinite(m.sizeH) ? m.sizeH : 80

  m.status = m.status || "IDLE"

  m.kneadAccum = Number.isFinite(m.kneadAccum) ? m.kneadAccum : 0
  m.isKneading = !!m.isKneading

  m.fermentStart = Number.isFinite(m.fermentStart) ? m.fermentStart : 0
  m.bakeElapsed = Number.isFinite(m.bakeElapsed) ? m.bakeElapsed : 0

  m.lastActive = Number.isFinite(m.lastActive) ? m.lastActive : now

  m.dreamText = m.dreamText ? String(m.dreamText) : ""
  if (hasCjk(m.dreamText)) {
    m.dreamText = ""
  }

  m.toppings = Array.isArray(m.toppings) ? m.toppings : []

  m.isEaten = !!m.isEaten
  m.eatScale = Number.isFinite(m.eatScale) ? m.eatScale : 1

  m.name = (m.name == null ? "Mochi" : String(m.name)).slice(0, 24)

  return m
}

function makeMochi(name) {
  const now = nowMs()
  const pos = findSpot()

  return normalizeMochi({
    id: makeId(),
    x: pos.x,
    y: pos.y,
    name: String(name).slice(0, 24),

    sizeW: 100,
    sizeH: 80,
    status: "IDLE",
    lastActive: now,
    dreamText: "",

    kneadAccum: 0,
    isKneading: false,
    fermentStart: 0,
    bakeElapsed: 0,

    toppings: [],
    isEaten: false,
    eatScale: 1,
  })
}

let mochis = loadState().map(normalizeMochi)

// remote cursor state by socket id
const cursors = {}

let dirty = false
let lastSaveAt = 0

function markDirty() {
  dirty = true
}

// find a spawn position that avoids overlapping nearby mochis
function findSpot() {
  const pad = 110

  for (let tries = 0; tries < 80; tries++) {
    const x = rand(pad, worldW - pad)
    const y = rand(pad, worldH - pad)

    let isValid = true

    for (const m of mochis) {
      if (Math.hypot(x - m.x, y - m.y) < 130) {
        isValid = false
        break
      }
    }

    if (isValid) {
      return { x, y }
    }
  }

  return {
    x: rand(150, 1050),
    y: rand(150, 650),
  }
}

// advance all mochi states on the server
function stepSim(dtSec) {
  const now = nowMs()

  for (let i = mochis.length - 1; i >= 0; i--) {
    const m = mochis[i]

    if (stepEat(m, i)) continue

    stepDream(m, now)
    stepKnead(m, now, dtSec)
    stepFerment(m, now)
    stepBake(m, dtSec)
  }
}

function stepEat(m, index) {
  if (!m.isEaten) return false

  m.eatScale += (0 - m.eatScale) * 0.15

  if (m.eatScale <= 0.01) {
    mochis.splice(index, 1)
    markDirty()
  }

  return true
}

function stepDream(m, now) {
  if (m.status !== "IDLE") return
  if (m.isKneading) return

  // idle mochis fall asleep after a while
  if (now - m.lastActive > 8000) {
    m.status = "DAYDREAM"

    if (!m.dreamText || hasCjk(m.dreamText)) {
      m.dreamText = pick(dreamLines)
    }

    markDirty()
  }
}

function stepKnead(m, now, dtSec) {
  if (!(m.status === "IDLE" || m.status === "DAYDREAM")) return
  if (!m.isKneading) return

  // kneading wakes the mochi up and clears the dream text
  if (m.status === "DAYDREAM") {
    m.status = "IDLE"
    m.dreamText = ""
  }

  m.kneadAccum += dtSec
  m.lastActive = now

  if (m.kneadAccum >= kneadSec) {
    m.kneadAccum = kneadSec
    m.isKneading = false
    m.status = "FERMENTING"
    m.fermentStart = now
  }

  markDirty()
}

function stepFerment(m, now) {
  if (m.status !== "FERMENTING") return

  const elapsed = (now - (m.fermentStart || now)) / 1000
  const progress = Math.min(elapsed / fermentSec, 1)
  const eased = smooth01(progress)

  m.sizeW = lerp(100, 145, eased)
  m.sizeH = lerp(80, 120, eased)

  if (progress >= 1) {
    m.status = "READY_TO_DECORATE"
    markDirty()
  }
}

function stepBake(m, dtSec) {
  if (m.status !== "BAKING") return

  m.bakeElapsed = Math.min(m.bakeElapsed + dtSec, bakeMaxSec)
  markDirty()
}

// only send recent cursors to clients
function liveCursors() {
  const now = nowMs()
  const out = {}

  for (const id in cursors) {
    const c = cursors[id]

    if (c && now - (c.ts || 0) < cursorTtlMs) {
      out[id] = c
    }
  }

  return out
}

function broadcastState() {
  io.emit("state", {
    mochis,
    cursors: liveCursors(),
  })
}

function findMochi(id) {
  return mochis.find(m => m.id === id)
}

function touch(m) {
  m.lastActive = nowMs()
}

// apply one interaction sent from the client
function applyAction(m, type, data) {
  touch(m)

  if (type === "start_knead") {
    if (m.status === "IDLE" || m.status === "DAYDREAM") {
      m.isKneading = true
    }
    return
  }

  if (type === "stop_knead") {
    m.isKneading = false
    return
  }

  if (type === "wake_click") {
    if (m.status === "DAYDREAM") {
      m.status = "IDLE"
      m.dreamText = ""
    }
    return
  }

  if (type === "add_candy") {
    if (m.status !== "READY_TO_DECORATE" || !data) return

    const relX = clamp(data.relX, -200, 200)
    const relY = clamp(data.relY, -200, 200)
    const w = clamp(data.w, 6, 10)
    const h = clamp(data.h, 3, 5)
    const rot = clamp(data.rot, 0, Math.PI * 2)

    const c = Array.isArray(data.c)
      ? data.c.map(value => clamp(value, 0, 255))
      : [255, 255, 255, 255]

    // only allow toppings inside the mochi body area
    if (Math.hypot(relX, relY) < m.sizeW / 2.5) {
      m.toppings.push({ relX, relY, w, h, rot, c })
    }

    return
  }

  if (type === "start_bake") {
    if (m.status === "READY_TO_DECORATE") {
      m.status = "BAKING"
      m.bakeElapsed = 0
    }
    return
  }

  if (type === "finish_bake_click") {
    if (m.status === "BAKING") {
      m.status = "BAKED"
    }
    return
  }

  if (type === "eat_click") {
    if (m.status === "BAKED") {
      m.isEaten = true
    }
  }
}

io.on("connection", socket => {
  cursors[socket.id] = { x: 0, y: 0, ts: nowMs() }

  socket.emit("state", {
    mochis,
    cursors: liveCursors(),
  })

  socket.on("hello", () => {})

  socket.on("cursor", ({ x, y }) => {
    cursors[socket.id] = {
      x: clamp(Number(x) || 0, 0, worldW),
      y: clamp(Number(y) || 0, 0, worldH),
      ts: nowMs(),
    }
  })

  socket.on("add_mochi", ({ name }) => {
    if (!name) return
    if (mochis.length >= maxMochis) return

    mochis.push(makeMochi(name))
    markDirty()
    broadcastState()
  })

  socket.on("action", ({ id, type, data } = {}) => {
    const m = id && findMochi(id)
    if (!m) return

    applyAction(m, type, data)
    markDirty()
    broadcastState()
  })

  socket.on("disconnect", () => {
    delete cursors[socket.id]
    broadcastState()
  })
})

let lastStepMs = nowMs()

setInterval(() => {
  const now = nowMs()
  const dtSec = Math.min((now - lastStepMs) / 1000, 0.2)

  lastStepMs = now

  stepSim(dtSec)
  broadcastState()

  // save periodically instead of on every small change
  if (dirty && now - lastSaveAt > 2000) {
    dirty = false
    lastSaveAt = now
    saveState(mochis)
  }
}, 100)

server.listen(port, () => {
  console.log("listening on:", port)
})