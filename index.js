
const express = require('express')
const cors = require('cors')
const { WebSocketServer } = require('ws')
const crypto = require('crypto')

const app = express()
const PORT = process.env.PORT || 3000


app.use(cors({ origin: '*' })) 
app.use(express.json())


const questionBank = [
  { text: "2 + 2 = ?", options: ["3", "4", "5"], correct: "4" },
  { text: "Capital of France?", options: ["Berlin", "Paris", "Rome"], correct: "Paris" },
  { text: "Which is a programming language?", options: ["Python", "Snake", "Lion"], correct: "Python" },
]

const round = {
  players: {}, 
  disaster: 0,
  currentQuestionIndex: 0,
  currentQuestionStart: Date.now(),
}


function getCurrentQuestion() {
  const q = questionBank[round.currentQuestionIndex]
  return { text: q.text, options: q.options }
}

function broadcastState(wss) {
  const state = {
    players: round.players,
    disaster: round.disaster,
    currentQuestion: getCurrentQuestion(),
  }
  const msg = JSON.stringify({ type: "state", data: state })
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg)
  })
}


setInterval(() => {
  const elapsed = Date.now() - round.currentQuestionStart
  if (elapsed >= 20000) { 
    round.currentQuestionIndex = (round.currentQuestionIndex + 1) % questionBank.length
    round.currentQuestionStart = Date.now()
    for (const pid in round.players) round.players[pid].answeredCurrent = false
    if (wss) broadcastState(wss)
  }
}, 1000)


app.get('/', (req, res) => res.send('Server running!'))

app.post('/join', (req, res) => {
  const { name } = req.body
  const playerId = crypto.randomUUID()
  round.players[playerId] = { name, score: 0, answeredCurrent: false }
  res.json({ playerId })
  broadcastState(wss)
})

app.post('/answer', (req, res) => {
  const { playerId, answer } = req.body
  const player = round.players[playerId]
  if (player && !player.answeredCurrent) {
    player.answeredCurrent = true
    const correct = answer === questionBank[round.currentQuestionIndex].correct
    if (correct) player.score += 1
    else round.disaster += 1
    broadcastState(wss)
  }
  res.json({ success: true })
})


const server = app.listen(PORT, () => console.log(`Quizastrous backend listening on ${PORT}`))
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, ws => {
    wss.emit('connection', ws, request)
    ws.send(JSON.stringify({
      type: 'state',
      data: {
        players: round.players,
        disaster: round.disaster,
        currentQuestion: getCurrentQuestion()
      }
    }))
  })
})

wss.on('connection', ws => {
  console.log('WebSocket connected')
})
