const express = require('express');
const dgram = require('dgram');
const osc = require('osc');
const app = express();
const PORT = process.env.PORT || 3000;
const UDP_PORT = 4254;

// Variable to store tempo value
let tempo = null;

// Create UDP socket with reuseAddr option
const udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });

// UDP Server - listen for OSC messages from Ableton/Max
udpServer.on('message', (msg, rinfo) => {
  console.log(`[UDP] Received from ${rinfo.address}:${rinfo.port}`);

  try {
    const data = new Uint8Array(msg);
    const packet = osc.readPacket(data, {});

    if (!packet) {
      console.log('[OSC] Packet is undefined');
    } else {
      if (packet.address) {
        console.log(`[OSC] Address: ${packet.address}`);
        console.log(`[OSC] Arguments:`, packet.args);
        
        // Subscribe to tempo value
        if (packet.address === '/tempo') {
          if (packet.args && packet.args.length > 0) {
            // OSC arguments can be accessed directly or via .value property
            tempo = packet.args[0].value !== undefined ? packet.args[0].value : packet.args[0];
            console.log(`[TEMPO] Updated: ${tempo}`);
          }
        }
      } else if (packet.timeTag) {
        console.log(`[OSC] Bundle received`);
        if (packet.packets) {
          packet.packets.forEach((p, i) => {
            console.log(`[OSC] Bundle message ${i + 1}:`);
            console.log(`  Address: ${p.address}`);
            console.log(`  Arguments:`, p.args);
            
            // Subscribe to tempo value in bundles
            if (p.address === '/tempo') {
              if (p.args && p.args.length > 0) {
                tempo = p.args[0];
                console.log(`[TEMPO] Updated: ${tempo}`);
              }
            }
          });
        }
      } else {
        console.log('[OSC] Unknown packet type:', packet);
      }
    }
  } catch (oscErr) {
    console.error(`[OSC] Error decoding OSC packet:`, oscErr.message);
    console.error(`[OSC] Stack:`, oscErr.stack);
  }

  console.log('---');
});

udpServer.on('listening', () => {
  const address = udpServer.address();
  console.log(`[UDP] Server listening on ${address.address}:${address.port}`);
});

udpServer.on('error', (err) => {
  console.error('[UDP] Server error:', err);
  udpServer.close();
});

// Bind UDP server
udpServer.bind(UDP_PORT);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to the Express Server!',
    status: 'running'
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Start HTTP server
app.listen(PORT, () => {
  console.log(`[HTTP] Server is running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down servers...');
  udpServer.close();
  process.exit(0);
});

