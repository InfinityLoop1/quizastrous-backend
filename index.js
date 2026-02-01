const express = require('express')
const { WebSocketServer } = require('ws')
const WebSocket = require('ws')



const app = express()
const PORT = 3000
const players = {}


const questionBank = [
    { text: '2 + 2 = ?', correct: '4' },
    { text: 'capital of france ?', correct: 'paris' },
    { text: 'which is a programming language ?', correct: 'python' }
]


const PHASES = {
    READING: 'reading',
    ANSWERING: 'answering',
    LEADERBOARD: 'leaderboard'
}

const clients = new Set()

let state = {
    mode: 'waiting',
    phase: null,
    phaseEndsAt: 0,
    gameEndsAt: 0,
    currentQuestion: null
}

function nextQuarterHour() {
    const now = Date.now()
    return Math.ceil(now / (15 * 60 * 1000)) * 15 * 60 * 1000
}

function startGame() {
    console.log('game started')
    state.mode = 'game'
    state.gameEndsAt = Date.now() + 10 * 60 * 1000
    startQuestion()
    broadcastState()
}

function startQuestion() {
    const q = questionBank[Math.floor(Math.random() * questionBank.length)]
    const words = q.text.split(' ').length
    const readingMs = words * 100

    state.currentQuestion = q
    state.phase = PHASES.READING
    state.phaseEndsAt = Date.now() + readingMs

    for (const name in players) {
        players[name].answer = null
    }


    console.log('reading:', q.text)


    broadcastState()
}

function advancePhase() {

    if (state.mode === 'waiting') {
        startGame()
        return
    }
    if (state.mode === 'game') {
        if (Date.now() >= state.gameEndsAt) {
            startIntermission()
            broadcastState()
            return
        }

        if (state.phase === PHASES.READING) {
            state.phase = PHASES.ANSWERING
            state.phaseEndsAt = Date.now() + 5000
            console.log('answering')
            broadcastState()
            return
        }

        if (state.phase === PHASES.ANSWERING) {
            state.phase = PHASES.LEADERBOARD
            state.phaseEndsAt = Date.now() + 5000
            console.log('leaderboard')

            const correct = state.currentQuestion.correct
            for (const name in players) {
                if (players[name].answer?.trim().toLowerCase() === correct.toLowerCase()) {
                    players[name].score += 1
                }
                // reset answer for next round
                players[name].answer = null
            }

            broadcastState()
            return
        }


        if (state.phase === PHASES.LEADERBOARD) {
            startQuestion()
            return
        }
    }

    if (state.mode === 'intermission') {
        scheduleNextGame()
    }

}

function startIntermission() {
    console.log('intermission')
    state.mode = 'intermission'
    state.phase = null
    state.phaseEndsAt = Date.now() + 5 * 60 * 1000
    broadcastState()
}

function scheduleNextGame() {
    const startAt = nextQuarterHour()
    console.log('next game at', new Date(startAt).toLocaleTimeString())

    state.mode = 'waiting'
    state.phase = null
    state.phaseEndsAt = startAt
}

setInterval(() => {
    if (Date.now() >= state.phaseEndsAt) {
        advancePhase()
    }
}, 100)


app.get('/state', (req, res) => {
    res.json(state)
})

const server = app.listen(PORT, () => {
    console.log('server up')
    scheduleNextGame()
})

const wss = new WebSocketServer({ server })

wss.on('connection', (ws) => {
    clients.add(ws)

    // send state immediately on connect
    ws.send(JSON.stringify({
        type: 'state',
        data: state
    }))

    ws.on('close', () => {
        clients.delete(ws)
    })
})

function broadcastState() {
    const payload = JSON.stringify({
        type: 'state',
        data: {
            ...state,
            players
        }
    })

    for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(payload)
        }
    }
}


app.post('/join', (req, res) => {
    const { name } = req.body
    if (!name) return res.status(400).json({ error: 'missing name' })

    if (players[name]) return res.status(400).json({ error: 'name taken' })

    players[name] = { score: 0, answer: null }

    broadcastState() // everyone sees new player

    res.json({ success: true, name })
})


app.post('/answer', (req, res) => {
    const { name, answer } = req.body
    if (!name || !answer) return res.status(400).json({ error: 'missing data' })

    if (!players[name]) return res.status(400).json({ error: 'player not found' })

    if (state.mode !== 'game' || state.phase !== PHASES.ANSWERING) {
        return res.status(400).json({ error: 'not accepting answers now' })
    }

    players[name].answer = answer
    res.json({ success: true })
})



