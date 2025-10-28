const express = require('express');
const dgram = require('dgram');
const osc = require('osc');
const app = express();
const PORT = process.env.PORT || 3000;
const UDP_PORT = 4254;

// Create UDP socket with reuseAddr option
const udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });

// UDP Server - listen for OSC messages from Ableton/Max
udpServer.on('message', (msg, rinfo) => {
  console.log(`[UDP] Received from ${rinfo.address}:${rinfo.port}`);
  
  try {
    // Debug: Show raw data for OSC format
    // console.log(`[Debug] First 20 bytes:`, Array.from(msg.slice(0, Math.min(20, msg.length))));
    // console.log(`[Debug] First as string:`, msg.toString('utf8', 0, Math.min(20, msg.length)));
    
    // Check if it's standard OSC format (starts with '/' or '#bundle')
    const firstByte = msg[0];
    
    if (firstByte === 0x2F || msg.toString('ascii', 0, 7) === '#bundle') {
      // Standard OSC format
      try {
        const data = new Uint8Array(msg);
        // osc.readPacket requires options object
        const packet = osc.readPacket(data, {});
        
        if (!packet) {
          console.log('[OSC] Packet is undefined');
        } else {
          if (packet.address) {
            console.log(`[OSC] Address: ${packet.address}`);
            console.log(`[OSC] Arguments:`, packet.args);
          } else if (packet.timeTag) {
            console.log(`[OSC] Bundle received`);
            if (packet.packets) {
              packet.packets.forEach((p, i) => {
                console.log(`[OSC] Bundle message ${i + 1}:`);
                console.log(`  Address: ${p.address}`);
                console.log(`  Arguments:`, p.args);
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
    } else {
      // Non-standard Max/OSC-like format - decode manually
      let pos = 0;
      
      // Read the "address" (e.g., "float")
      const addressEnd = msg.indexOf(0, pos);
      const address = msg.toString('utf8', pos, addressEnd);
      pos = addressEnd + 1;
      
      // Skip padding to align to 4-byte boundary
      while (pos % 4 !== 0) pos++;
      
      // Read type tag (e.g., ",f")
      const typeTagEnd = msg.indexOf(0, pos);
      const typeTag = msg.toString('utf8', pos, typeTagEnd);
      pos = typeTagEnd + 1;
      
      // Skip padding
      while (pos % 4 !== 0) pos++;
      
      console.log(`[Max/OSC] Address: ${address}`);
      console.log(`[Max/OSC] Type tag: ${typeTag}`);
      
      // Parse arguments based on type tag
      const args = [];
      for (let i = 1; i < typeTag.length; i++) {
        const type = typeTag[i];
        
        if (type === 'f') {
          // Float value
          const value = msg.readFloatBE(pos);
          args.push(value);
          pos += 4;
        } else if (type === 'i') {
          // Integer value
          const value = msg.readInt32BE(pos);
          args.push(value);
          pos += 4;
        } else if (type === 's') {
          // String value
          const stringEnd = msg.indexOf(0, pos);
          const value = msg.toString('utf8', pos, stringEnd);
          args.push(value);
          pos = stringEnd + 1;
          while (pos % 4 !== 0) pos++;
        }
      }
      
      if (args.length > 0) {
        console.log(`[Max/OSC] Arguments:`, args);
      }
    }
  } catch (err) {
    console.error(`[Error] Decoding message:`, err.message);
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

