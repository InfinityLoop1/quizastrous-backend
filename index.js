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


const players = {}
let disaster = 0


const QUESTION_DURATION = 20
const ROUND_DURATION = 10 * 60
const INTERMISSION_DURATION = 5 * 60
const ROUND_INTERVAL = ROUND_DURATION + INTERMISSION_DURATION


function getRoundInfo() {
    const now = new Date()
    const utc = now.getTime()
    const quarterStart = Math.floor(utc / (15 * 60 * 1000)) * 15 * 60 * 1000
    const elapsed = (utc - quarterStart) / 1000

    const inIntermission = elapsed >= ROUND_DURATION
    const roundNumber = Math.floor(utc / (15 * 60 * 1000)) + 1

    const questionIndex = inIntermission
        ? null
        : Math.floor(elapsed / QUESTION_DURATION) % questionBank.length

    const timeLeft = inIntermission
        ? ROUND_INTERVAL - elapsed
        : ROUND_DURATION - elapsed

    return { roundNumber, inIntermission, questionIndex, timeLeft }
}

function getCurrentQuestion() {
    const info = getRoundInfo()
    if (info.inIntermission) return null
    const q = questionBank[info.questionIndex]
    return { text: q.text, options: q.options }
}

function broadcastState(wss) {
    const state = getRoundInfo()
    state.players = players
    state.disaster = disaster
    state.currentQuestion = getCurrentQuestion()
    const msg = JSON.stringify({ type: 'state', data: state })
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(msg)
    })
}


app.get('/', (req, res) => res.send('Quizastrous backend running!'))

app.post('/join', (req, res) => {
    const { name } = req.body
    const playerId = crypto.randomUUID()
    players[playerId] = { name, score: 0, answeredCurrent: false }
    res.json({ playerId })
    broadcastState(wss)
})

app.post('/answer', (req, res) => {
    const { playerId, answer } = req.body
    const info = getRoundInfo()
    if (info.inIntermission) return res.json({ success: false, error: "Intermission" })

    const player = players[playerId]
    if (player && !player.answeredCurrent) {
        player.answeredCurrent = true
        const correct = answer === questionBank[info.questionIndex].correct
        if (correct) player.score += 1
        else disaster += 1
        broadcastState(wss)
    }
    res.json({ success: true })
})


const server = app.listen(PORT, () => console.log(`Quizastrous backend on ${PORT}`))
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, ws => {
        wss.emit('connection', ws, req)

        const info = getRoundInfo()
        ws.send(JSON.stringify({
            type: 'state',
            data: {
                players,
                disaster,
                currentQuestion: getCurrentQuestion(),
                roundNumber: info.roundNumber,
                inIntermission: info.inIntermission,
                timeLeft: info.timeLeft
            }
        }))
    })
})

wss.on('connection', ws => console.log('WebSocket connected'))


setInterval(() => broadcastState(wss), 1000)
