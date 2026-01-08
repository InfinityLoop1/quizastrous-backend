const express = require('express')
const cors = require('cors')
const { WebSocketServer } = require('ws')
const crypto = require('crypto')

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors({ origin: '*' }))
app.use(express.json())

// --- Question bank ---
const questionBank = [
  { text: "2 + 2 = ?", options: ["3", "4", "5"], correct: "4" },
  { text: "Capital of France?", options: ["Berlin", "Paris", "Rome"], correct: "Paris" },
  { text: "Which is a programming language?", options: ["Python", "Snake", "Lion"], correct: "Python" },
]

// --- Round state ---
const round = {
  players: {},
  disaster: 0,
  currentQuestionIndex: 0,
  currentQuestionStart: Date.now(),
}

// --- Helper to get safe question for clients ---
function getCurrentQuestion() {
  const q = questionBank[round.currentQuestionIndex]
  return { text: q.text, options: q.options }
}

// --- Broadcast state to all WebSocket clients ---
function broadcastState(wss) {
  const state = {
    players: round.players,
    disaster: round.disaster,
    currentQuestion: getCurrentQuestion(),
    currentQuestionStart: round.currentQuestionStart
  }
  const msg = JSON.stringify({ type: 'state', data: state })
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg)
  })
}

// --- Rotate question every 20 seconds ---
let wss
setInterval(() => {
  round.currentQuestionIndex = (round.currentQuestionIndex + 1) % questionBank.length
  round.currentQuestionStart = Date.now()
  for (const pid in round.players) round.players[pid].answeredCurrent = false
  if (wss) broadcastState(wss)
}, 20000)

// --- HTTP routes ---
app.get('/', (req, res) => res.send('Server running!'))

app.post('/join', (req, res) => {
  const { name } = req.body
  if (!name) return res.status(400).json({ error: 'Name required' })

  const playerId = crypto.randomUUID()
  round.players[playerId] = { name, score: 0, answeredCurrent: false }

  // send initial state along with playerId
  const state = {
    players: round.players,
    disaster: round.disaster,
    currentQuestion: getCurrentQuestion(),
    currentQuestionStart: round.currentQuestionStart
  }

  res.json({ playerId, state })
  if (wss) broadcastState(wss)
})

app.post('/answer', (req, res) => {
  const { playerId, answer } = req.body
  const player = round.players[playerId]
  if (!player) return res.status(400).json({ error: 'Invalid playerId' })
  if (player.answeredCurrent) return res.status(400).json({ error: 'Already answered' })

  player.answeredCurrent = true
  const correct = answer === questionBank[round.currentQuestionIndex].correct
  if (correct) player.score += 1
  else round.disaster += 1

  if (wss) broadcastState(wss)
  res.json({ success: true })
})

// --- Start server and WebSocket ---
const server = app.listen(PORT, () => console.log(`Quizastrous backend listening on ${PORT}`))
wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, ws => {
    wss.emit('connection', ws, request)
    // send initial state to new connection
    ws.send(JSON.stringify({
      type: 'state',
      data: {
        players: round.players,
        disaster: round.disaster,
        currentQuestion: getCurrentQuestion(),
        currentQuestionStart: round.currentQuestionStart
      }
    }))
  })
})

wss.on('connection', ws => {
  console.log('WebSocket connected')
})
