const express = require('express');
const dgram = require('dgram');
const osc = require('osc');
const http = require('http');
const { WebSocketServer } = require('ws');
const easymidi = require('easymidi');
const app = express();
const HTTP_PORT = process.env.PORT || 3000;
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

// Initialization flag - becomes true once tempo, numerator, and denominator are set
let initialized = false;

function checkInitialization() {
  if (!initialized && tempo !== null && signatureNumerator !== null && signatureDenominator !== null) {
    initialized = true;
  }
}

// Store connected WebSocket clients (will be initialized later)
let clients = null;

// MIDI output using easymidi (Node)
let midiOutput = null;
try {
  const outputs = easymidi.getOutputs();
  if (outputs && outputs.length > 0) {
    const selectedName = 'Virtual Loop Back';
    midiOutput = new easymidi.Output(selectedName);
    console.log(`[MIDI] Using output: ${selectedName}`);
  } else {
    console.log('[MIDI] No MIDI outputs available');
  }
} catch (midiErr) {
  console.log('[MIDI][ERROR] Failed to initialize MIDI output:', midiErr.message);
}

// UDP sender to 127.0.0.1:4254 on bar change
const udpOut = dgram.createSocket('udp4');
function initializeMax4Live() {
  try {
    const packet = { address: '/initialize', args: [0] };
    const bytes = osc.writePacket(packet);
    const buf = Buffer.from(bytes);
    udpOut.send(buf, 4255, '127.0.0.1');
  } catch (e) {
  }
}

initializeMax4Live();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendNote(note, velocity = 80, duration = 500, channel = 0) {
  if (!midiOutput) return;
  if (note === undefined || note === null) return;
  try {
    midiOutput.send('noteon', { note, velocity, channel });
    if (duration > 0) {
      await sleep(duration);
      try { midiOutput.send('noteoff', { note, velocity: 0, channel }); } catch (e) { }
    } else {
      // If duration is 0 or negative, send immediate noteoff
      try { midiOutput.send('noteoff', { note, velocity: 0, channel }); } catch (e) { }
    }
  } catch (e) {
  }
}

// Play a sequence like: "n(60).d(500) n(61).d(500)"
// Default duration per note: one beat duration divided by number of notes
async function playSequence(sequence) {
  if (!sequence || typeof sequence !== 'string') return;
  const chunkRegex = /n\(\d+\)(?:\.(?:d|v|c)\(\d+\))*/g;
  const chunks = sequence.match(chunkRegex) || [];
  const numNotes = Math.max(1, chunks.length);

  const beatsPerBar = signatureNumerator;
  const barDurationMs = (typeof tempo === 'number' && tempo > 0) ? (60000 / tempo) * beatsPerBar : 500;
  const defaultDurationMs = Math.max(1, Math.round(barDurationMs / numNotes));

  for (const chunk of chunks) {
    const noteMatch = chunk.match(/n\((\d+)\)/);
    if (!noteMatch) continue;
    const note = parseInt(noteMatch[1], 10);
    let velocity = 80;
    let duration = null; // if not provided, use defaultDurationMs
    let channel = 1; // user-facing 1-16
    const paramRegex = /\.(d|v|c)\((\d+)\)/g;
    let m;
    while ((m = paramRegex.exec(chunk)) !== null) {
      const key = m[1];
      const val = parseInt(m[2], 10);
      if (key === 'd') duration = Math.max(0, val);
      if (key === 'v') velocity = Math.max(0, Math.min(127, val));
      if (key === 'c') channel = Math.max(1, Math.min(16, val));
    }
    const zeroBasedChannel = channel - 1;
    const useDuration = (duration === null) ? defaultDurationMs : duration;
    await sendNote(note, velocity, useDuration, zeroBasedChannel);
  }
}

// Function to calculate current bar and beat
function calculateBarAndBeat() {

  if (!initialized) {
    return;
  }

  try {
    // Use the numerator and denominator directly
    const beatsPerBar = signatureNumerator;
    const beatValue = signatureDenominator;

    // Calculate beats per second
    const beatsPerSecond = beatValue / beatsPerBar;

    // Calculate total beats elapsed
    const totalBeats = currentSongTime * beatsPerSecond;

    // Calculate current bar (1-indexed)
    const newBar = Math.floor(totalBeats / beatsPerBar) + 1;

    // Calculate current beat in the bar (1-indexed)
    const newBeat = Math.floor(totalBeats % beatsPerBar) + 1;

    // Store beat as string "a/b"
    const beatString = `${newBeat}/${beatValue}`;

    // Only log when bar or beat changes
    if (newBar !== previousBar || beatString !== previousBeat) {
      const oldBar = currentBar;
      currentBar = newBar;
      currentBeat = beatString;
      previousBar = newBar;
      previousBeat = beatString;

      // Detect when the bar changes
      if (currentBar !== oldBar) {
        console.log('[BAR/BEAT] Bar changed:', currentBar);
        playSequence("n(60) n(70) n(90) n(70)");
      }
    }
  } catch (error) {
    // Silent error handling
  }
}

// Create UDP socket with reuseAddr option
const udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });

// UDP Server - listen for OSC messages from Ableton/Max
udpServer.on('message', (msg, rinfo) => {

  try {
    const data = new Uint8Array(msg);
    const packet = osc.readPacket(data, {});

    if (packet) {
      if (packet.address) {
        // Subscribe to tempo value
        if (packet.address === '/tempo') {
          if (packet.args && packet.args.length > 0) {
            tempo = packet.args[0].value !== undefined ? packet.args[0].value : packet.args[0];
            console.log(`[TEMPO] Updated: ${tempo}`);
            checkInitialization();
          }
        }

        // Subscribe to signature numerator value
        if (packet.address === '/signature_numerator') {
          if (packet.args && packet.args.length > 0) {
            signatureNumerator = packet.args[0].value !== undefined ? packet.args[0].value : packet.args[0];
            console.log(`[NUMERATOR] Updated: ${signatureNumerator}`);
            checkInitialization();
          }
        }

        // Subscribe to signature denominator value
        if (packet.address === '/signature_denominator') {
          if (packet.args && packet.args.length > 0) {
            signatureDenominator = packet.args[0].value !== undefined ? packet.args[0].value : packet.args[0];
            console.log(`[DENOMINATOR] Updated: ${signatureDenominator}`);
            checkInitialization();
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
        if (packet.packets) {
          packet.packets.forEach((p) => {
            // Subscribe to tempo value in bundles
            if (p.address === '/tempo') {
              if (p.args && p.args.length > 0) {
                tempo = p.args[0];
                console.log(`[TEMPO] Updated: ${tempo}`);
                checkInitialization()
              }
            }

            // Subscribe to signature numerator value in bundles
            if (p.address === '/signature_numerator') {
              if (p.args && p.args.length > 0) {
                signatureNumerator = p.args[0];
                console.log(`[NUMERATOR] Updated: ${signatureNumerator}`);
                checkInitialization();
              }
            }

            // Subscribe to signature denominator value in bundles
            if (p.address === '/signature_denominator') {
              if (p.args && p.args.length > 0) {
                signatureDenominator = p.args[0];
                console.log(`[DENOMINATOR] Updated: ${signatureDenominator}`);
                checkInitialization();
              }
            }

            // Subscribe to current song time in bundles
            if (p.address === '/current_song_time') {
              if (p.args && p.args.length > 0) {
                currentSongTime = p.args[0];
                calculateBarAndBeat();
              }
            }
          });
        }
      }
    }
  } catch (oscErr) {
    // Silent error handling
  }

});

udpServer.on('listening', () => {
  const address = udpServer.address();
  console.log(`[UDP] Server listening on ${address.address}:${address.port}`);
});

udpServer.on('error', (err) => {
  udpServer.close();
});

// Bind UDP server
udpServer.bind(UDP_PORT);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.')); // Serve static files from current directory

// Routes
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});


// HTTP server
const server = http.createServer(app);

// Create WebSocket server on port 4254
const wsServer = http.createServer();
const wss = new WebSocketServer({ server: wsServer });

// Initialize clients Set
clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);

  ws.on('close', () => {
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    // Silent error handling
  });

  // Send current state immediately when client connects
  const initMessage = JSON.stringify({
    type: 'beat',
    beat: currentBeat,
    bar: currentBar
  });
  ws.send(initMessage);
});

// Start HTTP server
server.listen(HTTP_PORT, () => {
  console.log(`[HTTP] Server is running on http://localhost:${HTTP_PORT}`);
});

// Start WebSocket server on port 4254
wsServer.listen(4254, () => {
  console.log(`[WS] WebSocket server is running on ws://localhost:4254`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  udpServer.close();
  wsServer.close();
  try { if (midiOutput) midiOutput.close(); } catch (e) { }
  process.exit(0);
});

