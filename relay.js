const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;

// Create HTTP server (required for some PaaS to bind to port)
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('ALiCA Relay Server Running');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (message) => {
        // Broadcast to all other clients
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
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
