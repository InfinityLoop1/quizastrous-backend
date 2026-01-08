// index.js
const express = require('express')
const cors = require('cors')

const app = express()       // <- make sure you only do this once
const PORT = process.env.PORT || 3000

// middleware
app.use(cors({ origin: '*' }))  // allow all origins for dev
app.use(express.json())

// test route
app.get('/', (req, res) => {
  res.send('Server is running!')
})

// your join route
app.post('/join', (req, res) => {
  // for now, just respond with success
  res.json({ success: true, body: req.body })
})

app.listen(PORT, () => console.log(`Server running on port ${PORT}`))


// --- CORS middleware for cross-domain frontend ---
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*") // change '*' to your frontend URL for security
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")
    if (req.method === "OPTIONS") return res.sendStatus(204)
    next()
})

// --- Game state ---
const questionBank = [
    { text: "2 + 2 = ?", options: ["3", "4", "5"], correct: "4" },
    { text: "Capital of France?", options: ["Berlin", "Paris", "Rome"], correct: "Paris" },
    { text: "Which is a programming language?", options: ["Python", "Snake", "Lion"], correct: "Python" },
]

const round = {
    players: {},        // playerId -> { name, score, answeredCurrent }
    disaster: 0,
    currentQuestionIndex: 0,
    currentQuestionStart: Date.now(),
}

// --- Helpers ---
function getCurrentQuestion() {
    const q = questionBank[round.currentQuestionIndex]
    return { text: q.text, options: q.options } // never send correct
}

// --- WebSocket server ---
const wss = new WebSocketServer({ noServer: true })

function broadcastState() {
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

// --- Timer for question rotation ---
setInterval(() => {
    const elapsed = Date.now() - round.currentQuestionStart
    if (elapsed >= 20000) { // 20s per question
        round.currentQuestionIndex = (round.currentQuestionIndex + 1) % questionBank.length
        round.currentQuestionStart = Date.now()
        // reset answeredCurrent for all players
        for (const pid in round.players) round.players[pid].answeredCurrent = false
        broadcastState()
    }
}, 1000)

// --- HTTP endpoints ---
app.post("/join", (req, res) => {
    const { name } = req.body
    const playerId = crypto.randomUUID()
    round.players[playerId] = { name, score: 0, answeredCurrent: false }
    res.json({ playerId })
    broadcastState()
})

app.post("/answer", (req, res) => {
    const { playerId, answer } = req.body
    const player = round.players[playerId]
    if (player && !player.answeredCurrent) {
        player.answeredCurrent = true
        const correct = answer === questionBank[round.currentQuestionIndex].correct
        if (correct) player.score += 1
        else round.disaster += 1
        broadcastState()
    }
    res.json({ success: true })
})

// --- WebSocket upgrade ---
const server = app.listen(PORT, () => console.log(`Quizastrous backend listening on ${PORT}`))
server.on("upgrade", (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, ws => {
        wss.emit("connection", ws, request)
        ws.send(JSON.stringify({
            type: "state",
            data: {
                players: round.players,
                disaster: round.disaster,
                currentQuestion: getCurrentQuestion()
            }
        }))
    })
})
