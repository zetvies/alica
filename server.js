const express = require('express');
const dgram = require('dgram');
const osc = require('osc');
const http = require('http');
const { WebSocketServer } = require('ws');
const easymidi = require('easymidi');
const app = express();
const HTTP_PORT = process.env.PORT || 4254;
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
    console.log('[INITIALIZATION] Connected to Max4Live');
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
      setTimeout(() => {
        try { midiOutput.send('noteoff', { note, velocity: 0, channel }); } catch (e) { }
      }, duration - 50);
      await sleep(duration);
    } else {
      // If duration is 0 or negative, send immediate noteoff
      setTimeout(() => {
        try { midiOutput.send('noteoff', { note, velocity: 0, channel }); } catch (e) { }
      }, 0);
    }
  } catch (e) {
  }
} 

// Convert note tokens like "c3", "c3#", "c3b", "c#3" to MIDI number.
// Uses scientific pitch: C4 = 60, so C3 = 48
function noteTokenToMidi(value) {
  if (value === undefined || value === null) return null;
  // Numeric MIDI already
  const maybeNum = Number(value);
  if (!Number.isNaN(maybeNum)) {
    const n = Math.max(0, Math.min(127, Math.round(maybeNum)));
    return n;
  }
  const raw = String(value).trim().toLowerCase();
  // Accept ONLY scientific pitch: letter + optional accidental + octave, e.g. c#3, cb3, c3
  let letter = null, accidental = '', octaveStr = '';
  const m1 = raw.match(/^([a-g])(#[b]?|b)?(\d+)$/);
  if (m1) {
    letter = m1[1];
    accidental = (m1[2] || '');
    octaveStr = m1[3];
  } else {
    return null;
  }
  const baseMap = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  if (!(letter in baseMap)) return null;
  let semitone = baseMap[letter];
  if (accidental === '#') semitone += 1;
  if (accidental === 'b') semitone -= 1;
  const octave = parseInt(octaveStr, 10);
  if (Number.isNaN(octave)) return null;
  let midi = (octave + 1) * 12 + semitone; // C4 (octave 4) -> 60
  midi = Math.max(0, Math.min(127, midi));
  return midi;
}

// Play a sequence like: "n(60).d(500) n(61).d(500)"
// Default duration per note: one beat duration divided by number of notes
async function playSequence(sequence, type = "fit", cutOff = null, channelOverride = null, sequenceMuteProbability = null) {
  if (!sequence || typeof sequence !== 'string') return;
  const chunkRegex = /n\([^\)]+\)(?:\^\d+)?(?:\.(?:d|v|c|p)\([^)]*\))*/g;
  const allChunks = sequence.match(chunkRegex) || [];
  
  // For type=fit, filter out removed chunks BEFORE calculating weights
  let chunks = allChunks;
  if (type === 'fit') {
    chunks = allChunks.filter((chunk) => {
      // Check if this chunk has remove probability
      const paramRegex = /\.(p)\(([^)]+)\)/g;
      let removeProbability = null;
      let m;
      while ((m = paramRegex.exec(chunk)) !== null) {
        const raw = m[2].trim();
        const norm = raw.replace(/\s+/g, '').toLowerCase();
        const removeMatch = norm.match(/^r(\.)?(0?\.\d+|1(?:\.0+)?|0)$/);
        if (removeMatch) {
          const probStr = removeMatch[1] ? norm.substring(2) : norm.substring(1);
          const prob = parseFloat(probStr);
          if (!isNaN(prob) && prob >= 0 && prob <= 1) {
            removeProbability = prob;
          }
        }
      }
      // Apply remove probability: if random < removeProbability, remove this chunk
      if (removeProbability !== null && removeProbability > 0) {
        const random = Math.random();
        if (random < removeProbability) {
          return false; // Remove this chunk
        }
      }
      return true; // Keep this chunk
    });
  }

  const numNotes = Math.max(1, chunks.length);

  const beatsPerBar = signatureNumerator;
  const barDurationMs = (typeof tempo === 'number' && tempo > 0) ? (60000 / tempo) * beatsPerBar : 500;

  const ev = Math.max(1, Math.round(barDurationMs / numNotes))
  const bt = Math.max(1, Math.round(barDurationMs / beatsPerBar))
  const br = barDurationMs

  let defaultDurationMs = null;
  if (type === "fit") {
    defaultDurationMs = ev;
  } else if (type === "beat") {
    defaultDurationMs = bt;
  }
  // Fallback default to fit if not set
  if (defaultDurationMs === null) defaultDurationMs = ev;
  const disallowBtBr = (type === 'fit');

  // For type=fit, pre-compute weights from d(*f) / d(/f). Default weight=1.
  let weights = null;
  let totalWeight = 0;
  if (type === 'fit') {
    weights = chunks.map((chunk) => {
      let weight = 1;
      const paramRegexW = /\.(d)\(([^)]+)\)/g;
      let mw;
      while ((mw = paramRegexW.exec(chunk)) !== null) {
        const rawW = (mw[2] || '').trim();
        const normW = rawW.replace(/\s+/g, '').toLowerCase();
        const wMul = normW.match(/^\*(\d*(?:\.\d+)?)$/);
        const wDiv = normW.match(/^\/(\d*(?:\.\d+)?)$/);
        if (wMul && wMul[1] !== '') {
          const f = parseFloat(wMul[1]);
          if (!isNaN(f) && f > 0) weight = f;
        } else if (wDiv && wDiv[1] !== '') {
          const f = parseFloat(wDiv[1]);
          if (!isNaN(f) && f > 0) weight = 1 / f;
        }
      }
      const repMatch = chunk.match(/n\(\d+\)\^(\d+)/);
      const repeatCount = repMatch ? Math.max(1, parseInt(repMatch[1], 10)) : 1;
      return weight * repeatCount;
    });
    totalWeight = weights.reduce((a, b) => a + b, 0);
    if (!isFinite(totalWeight) || totalWeight <= 0) totalWeight = numNotes;
  }

  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    const noteMatch = chunk.match(/n\(([^)]+)\)/);
    if (!noteMatch) continue;
    const noteArg = noteMatch[1].trim();
    const midiNote = noteTokenToMidi(noteArg);
    if (midiNote === null) continue;
    const repeatMatch = chunk.match(/\^(\d+)/);
    const repeatCount = repeatMatch ? Math.max(1, parseInt(repeatMatch[1], 10)) : 1;
    let velocity = 80;
    let duration = null; // if not provided, use defaultDurationMs
    let channel = 1; // user-facing 1-16
    let muteProbability = null; // probability to mute (0-1)
    let removeProbability = null; // probability to remove note (0-1)
    // Track which parameters were explicitly set in the note
    let hasNoteVelocity = false;
    let hasNoteChannel = false;
    let hasNoteDuration = false;
    const paramRegex = /\.(d|v|c|p)\(([^)]+)\)/g;
    let m;
    while ((m = paramRegex.exec(chunk)) !== null) {
      const key = m[1];
      const raw = m[2].trim();
      if (key === 'd') {
        let f = null;
        const norm = raw.replace(/\s+/g, '').toLowerCase();
        const prevDuration = duration; // Save previous state

        // Helpers to get base durations
        const baseFromToken = (tok) => (tok === 'bt' ? bt : tok === 'br' ? br : null);

        // Allowed patterns ONLY:
        // d(*f) or d(/f)
        const mMul = norm.match(/^\*(\d*(?:\.\d+)?)$/);
        const mDiv = norm.match(/^\/(\d*(?:\.\d+)?)$/);
        // d(bt) | d(br)
        const mAbs = norm.match(/^(bt|br)$/);
        // d(bt*f) | d(br*f) — require explicit '*'
        const mTokMul = norm.match(/^(bt|br)\*(\d*(?:\.\d+)?)$/);
        // d(bt/f) | d(br/f)
        const mTokDiv = norm.match(/^(bt|br)\/(\d*(?:\.\d+)?)$/);

        if (mMul && mMul[1] !== '') {
          f = parseFloat(mMul[1]);
          if (type !== 'fit' && !isNaN(f) && f > 0) duration = Math.max(0, Math.round(defaultDurationMs * f));
        } else if (mDiv && mDiv[1] !== '') {
          f = parseFloat(mDiv[1]);
          if (type !== 'fit' && !isNaN(f) && f > 0) duration = Math.max(0, Math.round(defaultDurationMs / f));
        } else if (mAbs) {
          if (!(disallowBtBr && (mAbs[1] === 'bt' || mAbs[1] === 'br'))) {
            const base = baseFromToken(mAbs[1]);
            if (base !== null) duration = Math.max(0, Math.round(base));
          }
        } else if (mTokMul && mTokMul[2] !== '') {
          if (!(disallowBtBr && (mTokMul[1] === 'bt' || mTokMul[1] === 'br'))) {
            const base = baseFromToken(mTokMul[1]);
            f = parseFloat(mTokMul[2]);
            if (base !== null && !isNaN(f) && f > 0) duration = Math.max(0, Math.round(base * f));
          }
        } else if (mTokDiv && mTokDiv[2] !== '') {
          if (!(disallowBtBr && (mTokDiv[1] === 'bt' || mTokDiv[1] === 'br'))) {
            const base = baseFromToken(mTokDiv[1]);
            f = parseFloat(mTokDiv[2]);
            if (base !== null && !isNaN(f) && f > 0) duration = Math.max(0, Math.round(base / f));
          }
        } else {
          // Any other form is ignored per spec; leave duration as-is (null => defaults)
        }
        
        // Mark duration as set only if it was actually changed from null
        if (duration !== prevDuration && duration !== null) {
          hasNoteDuration = true;
        }
      }
      if (key === 'v') {
        const v = parseInt(raw, 10);
        if (!isNaN(v)) {
          velocity = Math.max(0, Math.min(127, v));
          hasNoteVelocity = true;
        }
      }
      if (key === 'c') {
        const ch = parseInt(raw, 10);
        if (!isNaN(ch)) {
          channel = Math.max(1, Math.min(16, ch));
          hasNoteChannel = true;
        }
      }
      if (key === 'p') {
        // Parse probability: m0.7 (mute) or r0.4 (remove)
        const norm = raw.replace(/\s+/g, '').toLowerCase();
        // Match m0.7, m.0.7, m1, m0, etc.
        const muteMatch = norm.match(/^m(\.)?(0?\.\d+|1(?:\.0+)?|0)$/);
        if (muteMatch) {
          const probStr = muteMatch[1] ? norm.substring(2) : norm.substring(1); // Remove 'm' or 'm.' prefix
          const prob = parseFloat(probStr);
          if (!isNaN(prob) && prob >= 0 && prob <= 1) {
            muteProbability = prob;
          }
        }
        // Match r0.4, r.0.4, r1, r0, etc.
        const removeMatch = norm.match(/^r(\.)?(0?\.\d+|1(?:\.0+)?|0)$/);
        if (removeMatch) {
          const probStr = removeMatch[1] ? norm.substring(2) : norm.substring(1); // Remove 'r' or 'r.' prefix
          const prob = parseFloat(probStr);
          if (!isNaN(prob) && prob >= 0 && prob <= 1) {
            removeProbability = prob;
          }
        }
      }
    }
    // Apply sequence-level override only if note doesn't have its own setting
    if (typeof channelOverride === 'number' && !hasNoteChannel) {
      const coerced = Math.max(1, Math.min(16, channelOverride));
      channel = coerced;
    }
    
    // If note doesn't have a channel and sequence doesn't have channel override, mute the note
    // (Notes without channels in a sequence without a channel override are muted)
    let shouldMuteNoChannel = false;
    if (!hasNoteChannel && channelOverride === null) {
      shouldMuteNoChannel = true;
    }
    // Also ensure we use a valid channel even if muted (default to 1)
    if (shouldMuteNoChannel) {
      channel = 1; // Use default channel for muted notes
    }
    // Apply remove probability: if random < removeProbability, skip this note entirely
    // (For type=fit, this was already handled before weight calculation, but we check again for other types)
    if (type !== 'fit') {
      if (removeProbability !== null && removeProbability > 0) {
        const random = Math.random();
        if (random < removeProbability) {
          continue; // Skip this note - it's removed from the sequence
        }
      }
    }
    const zeroBasedChannel = channel - 1;
    let useDuration = null;
    if (type === 'fit' && weights) {
      const weightedTotalForChunk = weights[idx] || 1;
      const perInstanceWeight = weightedTotalForChunk / repeatCount;
      useDuration = Math.max(1, Math.round(barDurationMs * (perInstanceWeight / totalWeight)));
    } else {
      useDuration = (duration === null) ? defaultDurationMs : duration;
    }
    // Apply mute probability: if random < muteProbability, set velocity to 0
    // Note-level mute probability OR sequence-level mute probability can mute the note
    // Each repeat gets its own probability check
    for (let r = 0; r < repeatCount; r++) {
      let useVelocity = velocity;
      let shouldMute = false;
      
      // Check note-level mute probability
      if (muteProbability !== null && muteProbability > 0) {
        const random = Math.random();
        if (random < muteProbability) {
          shouldMute = true;
        }
      }
      
      // Check sequence-level mute probability (if note wasn't already muted)
      if (!shouldMute && sequenceMuteProbability !== null && sequenceMuteProbability > 0) {
        const random = Math.random();
        if (random < sequenceMuteProbability) {
          shouldMute = true;
        }
      }
      
      // Mute note if it doesn't have a channel
      if (shouldMuteNoChannel) {
        shouldMute = true;
      }
      
      if (shouldMute) {
        useVelocity = 0;
      }
      
      await sendNote(midiNote, useVelocity, useDuration, zeroBasedChannel);
    }
  }
}

// Play multiple sequences in a cycle with per-block modifiers.
// Example: [n(60)^2 n(70)^3.d(/5) n(70).d(*4)].t(fit).c(2).co(2br) [n(60)^2].t(beat).c(3)
async function playCycle(cycleStr) {
  if (!cycleStr || typeof cycleStr !== 'string') return;
  // Match blocks: [sequence] then optional .t(...).c(...).co(...).p(...)
  const blockRegex = /\[([^\]]+)\]\s*((?:\.(?:t|c|co|p)\([^)]*\))*)/g;
  const modifierRegex = /\.(t|c|co|p)\(([^)]+)\)/g;
  let m;
  const plays = [];
  while ((m = blockRegex.exec(cycleStr)) !== null) {
    const seq = m[1].trim();
    const mods = m[2] || '';
    let type = 'fit';
    let channelOverride = null;
    let cutOff = null;
    let removeProbability = null;
    let sequenceMuteProbability = null;
    let mm;
    while ((mm = modifierRegex.exec(mods)) !== null) {
      const key = mm[1];
      const rawVal = (mm[2] || '').trim();
      if (key === 't') {
        const t = rawVal.toLowerCase();
        if (t === 'fit' || t === 'beat' || t === 'bar') type = t;
      } else if (key === 'c') {
        const ch = parseInt(rawVal, 10);
        if (!isNaN(ch)) channelOverride = Math.max(1, Math.min(16, ch));
      } else if (key === 'co') {
        // Pass through cutoff token for future use
        cutOff = rawVal;
      } else if (key === 'p') {
        // Parse remove probability: r0.4 or r.0.4
        const norm = rawVal.replace(/\s+/g, '').toLowerCase();
        // Match r0.4, r.0.4, r1, r0, etc.
        const removeMatch = norm.match(/^r(\.)?(0?\.\d+|1(?:\.0+)?|0)$/);
        if (removeMatch) {
          const probStr = removeMatch[1] ? norm.substring(2) : norm.substring(1); // Remove 'r' or 'r.' prefix
          const prob = parseFloat(probStr);
          if (!isNaN(prob) && prob >= 0 && prob <= 1) {
            removeProbability = prob;
          }
        }
        // Parse mute probability: m0.7 or m.0.7
        const muteMatch = norm.match(/^m(\.)?(0?\.\d+|1(?:\.0+)?|0)$/);
        if (muteMatch) {
          const probStr = muteMatch[1] ? norm.substring(2) : norm.substring(1); // Remove 'm' or 'm.' prefix
          const prob = parseFloat(probStr);
          if (!isNaN(prob) && prob >= 0 && prob <= 1) {
            sequenceMuteProbability = prob;
          }
        }
      }
    }
    // Apply remove probability: if random < removeProbability, skip this sequence
    if (removeProbability !== null && removeProbability > 0) {
      const random = Math.random();
      if (random < removeProbability) {
        continue; // Skip this sequence
      }
    }
    plays.push(playSequence(seq, type, cutOff, channelOverride, sequenceMuteProbability));
  }
  if (plays.length > 0) await Promise.all(plays);
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
        playCycle("[n(c3).p(m0.6) n(e3).p(r0.7) n(f3) n(g3)].c(1) [n(c3)].p(m0).c(2)");
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

// Create WebSocket server attached to the same HTTP server
const wss = new WebSocketServer({ server });

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

// Start HTTP and WebSocket server on the same port
server.listen(HTTP_PORT, () => {
  console.log(`[HTTP] Server is running on http://localhost:${HTTP_PORT}`);
  console.log(`[WS] WebSocket server is running on ws://localhost:${HTTP_PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  udpServer.close();
  server.close();
  try { if (midiOutput) midiOutput.close(); } catch (e) { }
  process.exit(0);
});

