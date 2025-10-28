const express = require('express');
const dgram = require('dgram');
const osc = require('osc');
const app = express();
const PORT = process.env.PORT || 3000;
const UDP_PORT = 4254;

// Variable to store tempo value
let tempo = null;

// Variables to store time signature components
let signatureNumerator = null;
let signatureDenominator = null;

// Variable to store current song time
let currentSongTime = null;

// Variables to store calculated bar and beat
let currentBar = null;
let currentBeat = null;
let previousBar = null;
let previousBeat = null;

// Function to calculate current bar and beat
function calculateBarAndBeat() {

  // console.log(`[BAR/BEAT] currentSongTime: ${currentSongTime}, tempo: ${tempo}, signatureNumerator: ${signatureNumerator}, signatureDenominator: ${signatureDenominator}`);
  if (currentSongTime === null || tempo === null || signatureNumerator === null || signatureDenominator === null) {
    console.log('[BAR/BEAT] Not enough data to calculate.');
    return;
  }

  try {
    // Use the numerator and denominator directly
    const beatsPerBar = signatureNumerator;
    const beatValue = signatureDenominator;

    // Calculate beats per second
    const beatsPerSecond =  beatValue / 4;

    // Calculate total beats elapsed
    const totalBeats = currentSongTime * beatsPerSecond;

    // Calculate current bar (1-indexed)
    const newBar = Math.floor(totalBeats / beatsPerBar) + 1;

    // Calculate current beat in the bar (1-indexed)
    const newBeat = Math.floor(totalBeats % beatsPerBar) + 1;

    // Store beat as string "a/b"
    const beatString = `${newBeat}/${beatValue}`;

    // console.log(`[DEBUG] Calculated - Bar: ${newBar}, Beat: ${beatString}`);

    // Only log when bar or beat changes
    if (newBar !== previousBar || beatString !== previousBeat) {
      currentBar = newBar;
      currentBeat = beatString;
      previousBar = newBar;
      previousBeat = beatString;
      console.log(`[BAR/BEAT] Bar: ${currentBar}, Beat: ${currentBeat}`);
    }
  } catch (error) {
    console.error(`[BAR/BEAT] Calculation error:`, error.message);
  }
}

// Create UDP socket with reuseAddr option
const udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });

// UDP Server - listen for OSC messages from Ableton/Max
udpServer.on('message', (msg, rinfo) => {

  try {
    const data = new Uint8Array(msg);
    const packet = osc.readPacket(data, {});

    if (!packet) {
      console.log('[OSC] Packet is undefined');
    } else {
      if (packet.address) {
        if (packet.address !== '/current_song_time') {
          console.log(`[UDP] Received from ${rinfo.address}:${rinfo.port}`);
          console.log(`[OSC] Address: ${packet.address}`);
          console.log(`[OSC] Arguments:`, packet.args);
        }

        // Subscribe to tempo value
        if (packet.address === '/tempo') {
          if (packet.args && packet.args.length > 0) {
            // OSC arguments can be accessed directly or via .value property
            tempo = packet.args[0].value !== undefined ? packet.args[0].value : packet.args[0];
            console.log(`[TEMPO] Updated: ${tempo}`);
          }
        }

        // Subscribe to signature numerator value
        if (packet.address === '/signature_numerator') {
          if (packet.args && packet.args.length > 0) {
            signatureNumerator = packet.args[0].value !== undefined ? packet.args[0].value : packet.args[0];
            console.log(`[NUMERATOR] Updated: ${signatureNumerator}`);
          }
        }

        // Subscribe to signature denominator value
        if (packet.address === '/signature_denominator') {
          if (packet.args && packet.args.length > 0) {
            signatureDenominator = packet.args[0].value !== undefined ? packet.args[0].value : packet.args[0];
            console.log(`[DENOMINATOR] Updated: ${signatureDenominator}`);
          }
        }

        // Subscribe to current song time
        if (packet.address === '/current_song_time') {
          if (packet.args && packet.args.length > 0) {
            currentSongTime = packet.args[0].value !== undefined ? packet.args[0].value : packet.args[0];
            calculateBarAndBeat();
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
                calculateBarAndBeat();
              }
            }

            // Subscribe to signature numerator value in bundles
            if (p.address === '/signature_numerator') {
              if (p.args && p.args.length > 0) {
                signatureNumerator = p.args[0];
                console.log(`[NUMERATOR] Updated: ${signatureNumerator}`);
                calculateBarAndBeat();
              }
            }

            // Subscribe to signature denominator value in bundles
            if (p.address === '/signature_denominator') {
              if (p.args && p.args.length > 0) {
                signatureDenominator = p.args[0];
                console.log(`[DENOMINATOR] Updated: ${signatureDenominator}`);
                calculateBarAndBeat();
              }
            }

            // Subscribe to current song time in bundles
            if (p.address === '/current_song_time') {
              if (p.args && p.args.length > 0) {
                currentSongTime = p.args[0];
                calculateBarAndBeat();
              }
            }

            if (packet.address !== '/current_song_time') {
              console.log('---');
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

