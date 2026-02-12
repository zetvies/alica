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

wss.on('connection', (ws) => {
    console.log('Client connected');

    // Send the current shared state to the new client immediately
    ws.send(JSON.stringify({
        type: 'sharedState',
        code: currentCode,
        sequencerState: currentSequencerState
    }));

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
            // Handle Get State Request (Explicit)
            else if (data.type === 'getSharedState') {
                 ws.send(JSON.stringify({
                    type: 'sharedState',
                    code: currentCode,
                    sequencerState: currentSequencerState
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
