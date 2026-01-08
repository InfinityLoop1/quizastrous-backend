const express = require('express')
const cors = require('cors')
const { WebSocketServer } = require('ws')
const crypto = require('crypto')

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors({ origin: '*' }))
app.use(express.json())

/* =======================
   CONFIG
======================= */

const ROUND_LENGTH = 10 * 60 * 1000
const INTERMISSION_LENGTH = 5 * 60 * 1000
const QUESTION_LENGTH = 20 * 1000
const CYCLE_LENGTH = ROUND_LENGTH + INTERMISSION_LENGTH

const MAX_SCORE_PER_QUESTION = 100

/* =======================
   QUESTIONS
======================= */

const questionBank = [
  { text: "2 + 2 = ?", options: ["3", "4", "5"], correct: "4" },
  { text: "Capital of France?", options: ["Berlin", "Paris", "Rome"], correct: "Paris" },
  { text: "Which is a programming language?", options: ["Python", "Snake", "Lion"], correct: "Python" },
]

/* =======================
   STATE
======================= */

const round = {
  players: {},
  disaster: 0,
  pendingResults: null
}

/* =======================
   TIME HELPERS
======================= */

function getQuarterHourAnchor() {
  const d = new Date()
  d.setSeconds(0)
  d.setMilliseconds(0)
  d.setMinutes(d.getMinutes() - (d.getMinutes() % 15))
  return d.getTime()
}

const GAME_EPOCH = getQuarterHourAnchor()

function getRoundState() {
  const now = Date.now()
  const elapsed = (now - GAME_EPOCH) % CYCLE_LENGTH

  if (elapsed < ROUND_LENGTH) {
    return {
      inIntermission: false,
      timeLeft: ROUND_LENGTH - elapsed,
      elapsed
    }
  }

  return {
    inIntermission: true,
    timeLeft: CYCLE_LENGTH - elapsed,
    elapsed
  }
}

function getQuestionState() {
  const rs = getRoundState()
  if (rs.inIntermission) return null

  const index = Math.floor(rs.elapsed / QUESTION_LENGTH) % questionBank.length
  const questionElapsed = rs.elapsed % QUESTION_LENGTH

  return {
    index,
    timeLeft: QUESTION_LENGTH - questionElapsed
  }
}

/* =======================
   BROADCAST
======================= */

function broadcastState(wss) {
  const rs = getRoundState()
  const qs = getQuestionState()

  const state = {
    players: round.players,
    disaster: round.disaster,
    inIntermission: rs.inIntermission,
    roundTimeLeft: rs.timeLeft,
    currentQuestion: qs
      ? {
          text: questionBank[qs.index].text,
          options: questionBank[qs.index].options,
          timeLeft: qs.timeLeft
        }
      : null
  }

  const msg = JSON.stringify({ type: 'state', data: state })

  wss.clients.forEach(c => {
    if (c.readyState === 1) c.send(msg)
  })
}

/* =======================
   APPLY QUESTION RESULTS
======================= */

function finalizeQuestion(index) {
  if (!round.pendingResults) return

  for (const pid in round.pendingResults) {
    const r = round.pendingResults[pid]
    const player = round.players[pid]
    if (!player) continue

    if (r.correct) {
      player.score += r.score
    } else {
      round.disaster++
    }
  }

  round.pendingResults = null
}

/* =======================
   HEARTBEAT
======================= */

let lastQuestionIndex = null

setInterval(() => {
  const qs = getQuestionState()

  if (qs) {
    if (lastQuestionIndex !== qs.index) {
      finalizeQuestion(lastQuestionIndex)
      lastQuestionIndex = qs.index
    }
  } else {
    finalizeQuestion(lastQuestionIndex)
    lastQuestionIndex = null
  }

  if (wss) broadcastState(wss)
}, 1000)

/* =======================
   ROUTES
======================= */

app.get('/', (_, res) => res.send('quizastrous backend running'))

app.post('/join', (req, res) => {
  const { name } = req.body
  const playerId = crypto.randomUUID()

  const qs = getQuestionState()

  round.players[playerId] = {
    name,
    score: 0,
    joinedQuestionIndex: qs ? qs.index : null,
    answeredIndex: null
  }

  res.json({ playerId })
})

app.post('/answer', (req, res) => {
  const { playerId, answer } = req.body
  const player = round.players[playerId]
  if (!player) return res.json({ success: false })

  const qs = getQuestionState()
  if (!qs) return res.json({ success: false })

  if (player.joinedQuestionIndex === qs.index) {
    return res.json({ success: false })
  }

  if (player.answeredIndex === qs.index) {
    return res.json({ success: true })
  }

  player.answeredIndex = qs.index

  if (!round.pendingResults) round.pendingResults = {}

  const correct = answer === questionBank[qs.index].correct
  const decay = qs.timeLeft / QUESTION_LENGTH
  const score = Math.floor(MAX_SCORE_PER_QUESTION * decay)

  round.pendingResults[playerId] = {
    correct,
    score
  }

  res.json({ success: true })
})

/* =======================
   SERVER + WS
======================= */

const server = app.listen(PORT, () =>
  console.log(`listening on ${PORT}`)
)

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => {
    wss.emit('connection', ws)
  })
})

wss.on('connection', ws => {
  ws.send(JSON.stringify({
    type: 'state',
    data: {
      players: round.players,
      disaster: round.disaster,
      inIntermission: getRoundState().inIntermission,
      roundTimeLeft: getRoundState().timeLeft,
      currentQuestion: getQuestionState()
        ? {
            text: questionBank[getQuestionState().index].text,
            options: questionBank[getQuestionState().index].options,
            timeLeft: getQuestionState().timeLeft
          }
        : null
    }
  }))
})
