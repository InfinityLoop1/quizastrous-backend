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

/*
ROUND 10m [
    QUESTION [
        READING PHASE 10s
        ANSWERING PHASE 10s
    ]
    LEADERBOARD PHASE 5s
]
INTERMISSION 5m
*/

const players = {}
let answerSubmissions = {}
let disasterMeter = 0

const QUESTION_READ_DURATION = 10
const QUESTION_ANSWER_DURATION = 10
const QUESTION_DURATION = QUESTION_READ_DURATION + QUESTION_ANSWER_DURATION
const LEADERBOARD_DURATION = 5
const ROUND_DURATION = 10 * 60
const INTERMISSION_DURATION = 5 * 60
const ROUND_INTERVAL = ROUND_DURATION + INTERMISSION_DURATION


function getRoundInfo() {
    const now = new Date()
    const utc = now.getTime()
    const quarterStart = Math.floor(utc / (15 * 60 * 1000)) * 15 * 60 * 1000
    const elapsed = (utc - quarterStart) / 1000


    let inIntermission;
    if (elapsed >= ROUND_DURATION) {
        inIntermission = true;
    } else {
        inIntermission = false;
    }

    const roundNumber = Math.floor(utc / (15 * 60 * 1000)) + 1;

    let questionIndex = null;
    if (!inIntermission) {
        const slot = Math.floor(elapsed / QUESTION_DURATION);
        const seed = slot + roundNumber * 1000;
        questionIndex = Math.floor((((seed * 9301 + 49297) % 233280) / 233280) * questionBank.length);
    }

    let timeLeft;
    if (inIntermission) {
        timeLeft = ROUND_INTERVAL - elapsed;
    } else {
        timeLeft = ROUND_DURATION - elapsed;
    }
    let phase = 'intermission';
    let phaseTimeLeft = 0;
    if (!inIntermission) {
        const roundElapsed = elapsed % ROUND_DURATION;
        if (roundElapsed < QUESTION_READ_DURATION) {
            phase = 'reading';
            phaseTimeLeft = QUESTION_READ_DURATION - roundElapsed;
        } else if (roundElapsed < QUESTION_READ_DURATION + QUESTION_ANSWER_DURATION) {
            phase = 'answering';
            phaseTimeLeft = QUESTION_READ_DURATION + QUESTION_ANSWER_DURATION - roundElapsed;
        } else {
            phase = 'leaderboard';
            phaseTimeLeft = ROUND_DURATION - roundElapsed;
        }
    }

    return { inIntermission, questionIndex, timeLeft, phase, phaseTimeLeft, roundNumber }
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
    state.disaster = disasterMeter
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
    if (info.phase !== 'answering') return res.json({ success: false, error: "Not in answering phase" })

    if (!answerSubmissions[info.questionIndex]) answerSubmissions[info.questionIndex] = {}
    answerSubmissions[info.questionIndex][playerId] = answer

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

setInterval(() => {
    const info = getRoundInfo()
    if (info.phase === 'leaderboard') {
        const qIdx = info.questionIndex;
        if (answerSubmissions[qIdx]) {
            for (const playerId in answerSubmissions[qIdx]) {
                const player = players[playerId];
                if (player && !player.answeredCurrent) {
                    const answer = answerSubmissions[qIdx][playerId];
                    const correct = answer === questionBank[qIdx].correct;
                    if (correct) {
                        player.score += 1;
                    } else {
                        disasterMeter += 1;
                    }
                    player.answeredCurrent = true;
                }
            }
            delete answerSubmissions[qIdx];
            broadcastState(wss);
        }
        for (const playerId in players) {
            players[playerId].answeredCurrent = false;
        }
    }
}, 1000);
