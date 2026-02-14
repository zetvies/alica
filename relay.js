const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;

const express = require('express');

const app = express();
const server = http.createServer(app);

// Serve static files from the root directory
app.use(express.static(__dirname));

// Default route
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

const wss = new WebSocket.Server({ server });

// Shared State
let currentCode = ""; // Empty by default to allow client hydration
let currentSequencerState = null; // Will be populated by the first client connecting or sending updates
let currentFadersState = null; // Fader/XY pad configurations
let characters = {}; // characterId -> { id, name, x, y, avatar }

wss.on('connection', (ws) => {
    console.log('Client connected');
    ws.characterId = null; // Track which character this connection owns

    // Send the current shared state to the new client immediately
    ws.send(JSON.stringify({
        type: 'sharedState',
        code: currentCode,
        sequencerState: currentSequencerState,
        fadersState: currentFadersState
    }));

    // Send all existing characters to the new client
    if (Object.keys(characters).length > 0) {
        ws.send(JSON.stringify({
            type: 'characterSync',
            characters: characters
        }));
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // Handle Code Changes
            if (data.type === 'codeChange') {
                currentCode = data.code;
                // Broadcast to others
                broadcastToOthers(ws, message);
            }
            // Handle Sequencer Changes
            else if (data.type === 'sequencerChange') {
                currentSequencerState = data.state;
                // Broadcast to others
                broadcastToOthers(ws, message);
            }
            // Handle Character Join
            else if (data.type === 'characterJoin') {
                ws.characterId = data.character.id;
                characters[data.character.id] = data.character;
                console.log(`Character joined: ${data.character.name} (${data.character.id})`);
                broadcastToOthers(ws, JSON.stringify(data));
            }
            // Handle Character Move
            else if (data.type === 'characterMove') {
                if (characters[data.id]) {
                    characters[data.id].x = data.x;
                    characters[data.id].y = data.y;
                    if (data.facing) characters[data.id].facing = data.facing;
                    if (data.nx !== undefined) characters[data.id].nx = data.nx;
                    if (data.ny !== undefined) characters[data.id].ny = data.ny;
                }
                broadcastToOthers(ws, JSON.stringify(data));
            }
            // Handle Faders Changes
            else if (data.type === 'fadersChange') {
                currentFadersState = data.state;
                // Broadcast to others
                broadcastToOthers(ws, message);
            }
            // Handle Get State Request (Explicit)
            else if (data.type === 'getSharedState') {
                 ws.send(JSON.stringify({
                    type: 'sharedState',
                    code: currentCode,
                    sequencerState: currentSequencerState,
                    fadersState: currentFadersState
                }));
            }
            // Handle 'code' action (Play button / Ctrl+S)
            // This is meant for the Backend Server (server.js).
            // We broadcast it so server.js receives it.
            // Browsers should ignore 'action: code' messages if they don't process them.
            if (data.action === 'code') {
                 broadcastToOthers(ws, message);
            }
            // Default: Broadcast everything else
            else {
                broadcastToOthers(ws, message);
            }

        } catch (e) {
            console.error("Error processing message:", e);
            // If it's not JSON, just broadcast it raw (fallback)
            broadcastToOthers(ws, message);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        // Remove character on disconnect
        if (ws.characterId && characters[ws.characterId]) {
            const charId = ws.characterId;
            console.log(`Character left: ${characters[charId].name} (${charId})`);
            delete characters[charId];
            // Broadcast removal to all remaining clients
            broadcastToOthers(ws, JSON.stringify({
                type: 'characterLeave',
                id: charId
            }));
        }
    });

    // Keep connection alive
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });
});

function broadcastToOthers(senderWs, message) {
    wss.clients.forEach((client) => {
        if (client !== senderWs && client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}


// Heartbeat
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();

        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});

server.listen(PORT, () => {
    console.log(`Relay server listening on port ${PORT}`);
});
