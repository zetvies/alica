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

// Scale definitions - intervals relative to root (0 = root, 1 = semitone up, etc.)
const SCALE_DEFINITIONS = {
  // Modes
  'ionian': [0, 2, 4, 5, 7, 9, 11],
  'dorian': [0, 2, 3, 5, 7, 9, 10],
  'phrygian': [0, 1, 3, 5, 7, 8, 10],
  'lydian': [0, 2, 4, 6, 7, 9, 11],
  'mixolydian': [0, 2, 4, 5, 7, 9, 10],
  'aeolian': [0, 2, 3, 5, 7, 8, 10],
  'locrian': [0, 1, 3, 5, 6, 8, 10],
  
  // Pentatonic
  'pentatonic-major': [0, 2, 4, 7, 9],
  'pentatonic-minor': [0, 3, 5, 7, 10],
  'pentatonic-blues': [0, 3, 5, 6, 7, 10],
  
  // Japanese scales
  'iwato': [0, 1, 5, 6, 10],
  'in': [0, 1, 5, 7, 10],  // also known as insen
  'insen': [0, 1, 5, 7, 10],
  'yo': [0, 2, 5, 7, 9],
  
  // Blues
  'blues-major': [0, 2, 3, 4, 7, 9],
  'blues-minor': [0, 3, 5, 6, 7, 10],
  
  // Harmonic/Melodic
  'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
  'melodic-minor': [0, 2, 3, 5, 7, 9, 11],
  'double-harmonic': [0, 1, 4, 5, 7, 8, 11], // Byzantine/Flamenco
  
  // Synthetic
  'whole-tone': [0, 2, 4, 6, 8, 10],
  'diminished': [0, 1, 3, 4, 6, 7, 9, 10], // octatonic half-whole
  'augmented': [0, 3, 4, 7, 8, 11],
  
  // Exotic
  'enigmatic': [0, 1, 4, 6, 8, 10, 11],
  'neapolitan': [0, 1, 3, 5, 7, 8, 10],
  'hungarian-minor': [0, 2, 3, 6, 7, 8, 11],
  'persian': [0, 1, 4, 5, 6, 8, 11],
  'arabic': [0, 1, 4, 5, 7, 8, 10]
};

// Chord quality definitions - intervals relative to root
const CHORD_QUALITIES = {
  // Triads
  'maj': [0, 4, 7],
  'min': [0, 3, 7],
  'dim': [0, 3, 6],
  'aug': [0, 4, 8],
  'sus2': [0, 2, 7],
  'sus4': [0, 5, 7],
  
  // 7th chords
  'maj7': [0, 4, 7, 11],
  'min7': [0, 3, 7, 10],
  '7': [0, 4, 7, 10],
  'maj7#5': [0, 4, 8, 11],
  'min7b5': [0, 3, 6, 10],
  'dim7': [0, 3, 6, 9],
  
  // 9th chords
  'maj9': [0, 4, 7, 11, 14],
  'min9': [0, 3, 7, 10, 14],
  '9': [0, 4, 7, 10, 14],
  '9#5': [0, 4, 8, 10, 14],
  'min9b5': [0, 3, 6, 10, 14],
  'b9': [0, 4, 7, 10, 13],
  '#9': [0, 4, 7, 10, 15],
  
  // 11th chords
  'maj11': [0, 4, 7, 11, 14, 17],
  'min11': [0, 3, 7, 10, 14, 17],
  '11': [0, 4, 7, 10, 14, 17],
  '#11': [0, 4, 7, 10, 14, 18],
  
  // 13th chords
  'maj13': [0, 4, 7, 11, 14, 17, 21],
  'min13': [0, 3, 7, 10, 14, 17, 21],
  '13': [0, 4, 7, 10, 14, 17, 21],
  '13b9': [0, 4, 7, 10, 13, 17, 21],
  '13#9': [0, 4, 7, 10, 15, 17, 21],
  '13#11': [0, 4, 7, 10, 14, 18, 21],
  
  // Add chords
  'add9': [0, 4, 7, 14],
  'add11': [0, 4, 7, 17],
  '6': [0, 4, 7, 9],
  '69': [0, 4, 7, 9, 14],
  'min6': [0, 3, 7, 9],
  'min69': [0, 3, 7, 9, 14],
  
  // Altered
  'alt': [0, 4, 6, 8, 10, 13, 15],
  '7alt': [0, 4, 6, 8, 10, 13, 15, 18],
  'no3': [0, 7],
  'no5': [0, 4, 10],
  
  // Sus chords
  'sus9': [0, 5, 7, 10, 14],
  '7sus4': [0, 5, 7, 10]
};

// Generate MIDI notes from scale intervals
function scaleToMidiNotes(root, scaleName, octave = 4) {
  const rootMidi = noteTokenToMidi(`${root}${octave}`);
  if (rootMidi === null) return [];
  
  let scaleKey = scaleName.toLowerCase();
  // Convenience aliases
  if (scaleKey === 'major') scaleKey = 'ionian';
  if (scaleKey === 'minor') scaleKey = 'aeolian';
  
  const intervals = SCALE_DEFINITIONS[scaleKey];
  if (!intervals) return [];
  
  return intervals.map(interval => {
    const midiNote = rootMidi + interval;
    return Math.max(0, Math.min(127, midiNote));
  });
}

// Generate MIDI notes from chord quality
function chordToMidiNotes(root, quality, octave = 4) {
  const rootMidi = noteTokenToMidi(`${root}${octave}`);
  if (rootMidi === null) return [];
  
  const intervals = CHORD_QUALITIES[quality.toLowerCase()];
  if (!intervals) return [];
  
  // Normalize intervals to single octave range, then add octaves for proper voicing
  const normalized = intervals.map(interval => interval % 12);
  const midiNotes = [];
  
  // For each interval, put in reasonable octave
  intervals.forEach(interval => {
    let note = rootMidi + interval;
    // Keep within MIDI range but allow higher notes for extensions
    if (note > 127) note -= 12;
    if (note < 0) note += 12;
    note = Math.max(0, Math.min(127, note));
    midiNotes.push(note);
  });
  
  return midiNotes;
}

// Expand scale syntax: scale(c-ionian).q(maj7) or scale(c-ionian)
function expandScale(scaleStr) {
  if (!scaleStr || typeof scaleStr !== 'string') return '';
  
  // Match scale(root-mode).q(quality) or scale(root-mode)
  const scaleRegex = /scale\(([^)]+)\)(?:\.q\(([^)]+)\))?/i;
  const match = scaleStr.match(scaleRegex);
  if (!match) return scaleStr;
  
  const args = match[1].trim();
  const quality = match[2] ? match[2].trim() : null;
  
  // Parse root-mode (e.g., "c-ionian" or "d-dorian")
  const parts = args.split('-');
  if (parts.length !== 2) return scaleStr;
  
  const root = parts[0].trim();
  const mode = parts[1].trim().toLowerCase();
  
  // Get scale notes
  const scaleNotes = scaleToMidiNotes(root, mode);
  if (scaleNotes.length === 0) return scaleStr;
  
  // If quality specified, build chord on root using quality intervals
  if (quality) {
    const chordIntervals = CHORD_QUALITIES[quality.toLowerCase()];
    if (chordIntervals) {
      const rootMidi = noteTokenToMidi(`${root}4`);
      if (rootMidi !== null) {
        const chordNotes = chordIntervals.map(interval => {
          const note = rootMidi + interval;
          return Math.max(0, Math.min(127, note));
        });
        
        return chordNotes.map(n => `n(${n})`).join(' ');
      }
    }
  }
  
  // Return scale notes as note sequence
  return scaleNotes.map(n => `n(${n})`).join(' ');
}

// Expand chord syntax: chord(c-maj7)
function expandChord(chordStr) {
  if (!chordStr || typeof chordStr !== 'string') return '';
  
  // Match chord(root-quality)
  const chordRegex = /chord\(([^)]+)\)/i;
  const match = chordStr.match(chordRegex);
  if (!match) return chordStr;
  
  const args = match[1].trim();
  
  // Parse root-quality (e.g., "c-maj7" or "d-min7")
  const parts = args.split('-');
  if (parts.length !== 2) return chordStr;
  
  const root = parts[0].trim();
  const quality = parts[1].trim();
  
  // Get chord notes
  const chordNotes = chordToMidiNotes(root, quality);
  if (chordNotes.length === 0) return chordStr;
  
  // Return chord notes as note sequence
  return chordNotes.map(n => `n(${n})`).join(' ');
}

// Parse r.o{...} array syntax and return array of values
// Examples: r.o{c4, d4, e4}, r.o{60, 64, 67}, r.o{0.25, 0.5, 0.75}, r.o{bt/4, bt, bt*2}
// Duration tokens: bt, bt/even, or bt*even (even numbers only)
function parseArrayRandomizer(str, context = {}) {
  if (!str || typeof str !== 'string') return null;
  
  const match = str.match(/^r\.o\{([^\}]+)\}$/i);
  if (!match) return null;
  
  const arrayStr = match[1].trim();
  const items = arrayStr.split(',').map(s => s.trim());
  const result = [];
  
  for (const item of items) {
    // Handle duration tokens: bt, bt/even, or bt*even (even numbers only)
    const normItem = item.replace(/\s+/g, '').toLowerCase();
    
    // Check for standalone bt first
    if (normItem === 'bt') {
      if (context.bt) {
        result.push({ type: 'duration', value: Math.round(context.bt), token: 'bt' });
      }
    } else {
      const mDiv = normItem.match(/^bt\/(\d+)$/);
      const mMul = normItem.match(/^bt\*(\d+)$/);
      
      if (mDiv && mDiv[1]) {
        const divisor = parseInt(mDiv[1], 10);
        if (context.bt && !isNaN(divisor) && divisor > 0 && divisor % 2 === 0) {
          result.push({ type: 'duration', value: Math.round(context.bt / divisor), token: `bt/${divisor}` });
        }
      } else if (mMul && mMul[1]) {
        const multiplier = parseInt(mMul[1], 10);
        if (context.bt && !isNaN(multiplier) && multiplier > 0 && multiplier % 2 === 0) {
          result.push({ type: 'duration', value: Math.round(context.bt * multiplier), token: `bt*${multiplier}` });
        }
      } else {
        // Try to parse as note token first (e.g., "c4", "c#3")
        const noteMidi = noteTokenToMidi(item);
        if (noteMidi !== null) {
          result.push({ type: 'note', value: noteMidi });
        } else {
          // Try as MIDI note number (0-127)
          const midiNum = parseInt(item, 10);
          if (!isNaN(midiNum) && midiNum >= 0 && midiNum <= 127) {
            result.push({ type: 'note', value: midiNum });
          } else {
            // Parse as regular number (for velocity, pan, etc.)
            const num = parseFloat(item);
            if (!isNaN(num)) {
              result.push({ type: 'number', value: num });
            }
          }
        }
      }
    }
  }
  
  return result.length > 0 ? result : null;
}

// Filter array by range [min, max] and return filtered array
function filterArrayByRange(array, min, max) {
  if (!array || array.length === 0) return array;
  
  return array.filter(item => {
    const value = item.value !== undefined ? item.value : item;
    return value >= min && value <= max;
  });
}

// Extract parameter value from string like "d(r.o{bt})" - handles nested braces
function extractParameterValue(str, paramName) {
  const regex = new RegExp(`\\.${paramName}\\(([^)]*(?:\\([^)]*\\)[^)]*)*)\\)`, 'g');
  const match = regex.exec(str);
  if (match) {
    return match[1];
  }
  // Fallback: try simple extraction with balanced parentheses
  const startPattern = `.${paramName}(`;
  const startIdx = str.indexOf(startPattern);
  if (startIdx === -1) return null;
  
  let parenCount = 1;
  let i = startIdx + startPattern.length;
  let result = '';
  
  while (i < str.length && parenCount > 0) {
    if (str[i] === '(') parenCount++;
    else if (str[i] === ')') parenCount--;
    else if (parenCount === 1) result += str[i];
    i++;
  }
  
  return parenCount === 0 ? result : null;
}

// Play a sequence like: "n(60).d(500) n(61).d(500)"
// Default duration per note: one beat duration divided by number of notes
async function playSequence(sequence, type = "fit", cutOff = null, channelOverride = null, sequenceMuteProbability = null) {
  console.log('[PLAY_SEQUENCE] Called with:', sequence);
  if (!sequence || typeof sequence !== 'string') return;
  
  // Expand scale and chord syntax first
  let processedSequence = sequence;
  
  // Expand scale syntax: scale(root-mode).q(quality) or scale(root-mode)
  // Handle nested parentheses properly
  let tempSequence = '';
  let i = 0;
  while (i < processedSequence.length) {
    const scaleIndex = processedSequence.toLowerCase().indexOf('scale(', i);
    if (scaleIndex === -1) {
      tempSequence += processedSequence.substring(i);
      break;
    }
    tempSequence += processedSequence.substring(i, scaleIndex);
    
    // Find the matching closing parenthesis for scale(
    let parenCount = 1;
    let j = scaleIndex + 6; // "scale(".length
    while (j < processedSequence.length && parenCount > 0) {
      if (processedSequence[j] === '(') parenCount++;
      if (processedSequence[j] === ')') parenCount--;
      j++;
    }
    
    // Now find optional .q() modifier after the closing paren
    let modifierEnd = j;
    while (modifierEnd < processedSequence.length) {
      const modMatch = processedSequence.substring(modifierEnd).match(/^\s*\.q\([^)]*\)/);
      if (modMatch) {
        modifierEnd += modMatch[0].length;
      } else {
        break;
      }
    }
    
    const scaleStr = processedSequence.substring(scaleIndex, modifierEnd);
    const expanded = expandScale(scaleStr);
    tempSequence += expanded;
    i = modifierEnd;
  }
  processedSequence = tempSequence;
  
  // Expand chord syntax: chord(root-quality)
  // Handle nested parentheses properly
  tempSequence = '';
  i = 0;
  while (i < processedSequence.length) {
    const chordIndex = processedSequence.toLowerCase().indexOf('chord(', i);
    if (chordIndex === -1) {
      tempSequence += processedSequence.substring(i);
      break;
    }
    tempSequence += processedSequence.substring(i, chordIndex);
    
    // Find the matching closing parenthesis for chord(
    let parenCount = 1;
    let j = chordIndex + 6; // "chord(".length
    while (j < processedSequence.length && parenCount > 0) {
      if (processedSequence[j] === '(') parenCount++;
      if (processedSequence[j] === ')') parenCount--;
      j++;
    }
    
    const chordStr = processedSequence.substring(chordIndex, j);
    const expanded = expandChord(chordStr);
    tempSequence += expanded;
    i = j;
  }
  processedSequence = tempSequence;
  
  // Expand repeat syntax (^N) before matching chunks
  // n(r)^4 becomes n(r) n(r) n(r) n(r)
  let expandedSequence = processedSequence;
  const repeatPattern = /n\([^)]+\)(\^\d+)((?:\.(?:d|v|p|c|pm|pr|pmRange|prRange|nRange|vRange|pRange|dRange)\([^)]*\))*)/g;
  let repeatMatch;
  let lastIndex = 0;
  let newSequence = '';
  while ((repeatMatch = repeatPattern.exec(processedSequence)) !== null) {
    newSequence += processedSequence.substring(lastIndex, repeatMatch.index);
    const notePattern = repeatMatch[0].replace(repeatMatch[1], ''); // Remove ^N
    const repeatCount = parseInt(repeatMatch[1].substring(1), 10); // Extract number from ^N
    if (!isNaN(repeatCount) && repeatCount > 0) {
      // Repeat the note pattern N times
      const repeated = Array(repeatCount).fill(notePattern).join(' ');
      newSequence += repeated;
    } else {
      newSequence += repeatMatch[0];
    }
    lastIndex = repeatMatch.index + repeatMatch[0].length;
  }
  if (lastIndex < processedSequence.length) {
    newSequence += processedSequence.substring(lastIndex);
  }
  if (newSequence) {
    expandedSequence = newSequence;
  }
  
  const chunkRegex = /n\([^\)]+\)(?:\.(?:d|v|p|c|pm|pr|pmRange|prRange|nRange|vRange|pRange|dRange)\([^)]*\))*/g;
  const allChunks = expandedSequence.match(chunkRegex) || [];
  
  // For type=fit, filter out removed chunks BEFORE calculating weights
  let chunks = allChunks;
  if (type === 'fit') {
    chunks = allChunks.filter((chunk) => {
      // Check if this chunk has remove probability
      const paramRegex = /\.(pr)\(([^)]+)\)/g;
      let removeProbability = null;
      let m;
      while ((m = paramRegex.exec(chunk)) !== null) {
        const raw = m[2].trim();
        const prob = parseFloat(raw);
        if (!isNaN(prob) && prob >= 0 && prob <= 1) {
          removeProbability = prob;
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

  // Check if any chunk uses dRange, and if so, override type to 'beat'
  let usesDRange = false;
  for (const chunk of chunks) {
    if (chunk.includes('dRange(')) {
      usesDRange = true;
      break;
    }
  }
  if (usesDRange) {
    type = 'beat';
  }

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
      // Repeat syntax already expanded, each chunk is weight 1
      return weight;
    });
    totalWeight = weights.reduce((a, b) => a + b, 0);
    if (!isFinite(totalWeight) || totalWeight <= 0) totalWeight = numNotes;
  }

  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    const noteMatch = chunk.match(/n\(([^)]+)\)/);
    if (!noteMatch) continue;
    const noteArg = noteMatch[1].trim();
    // Repeat syntax is already expanded at sequence level, so repeatCount is always 1
    const repeatCount = 1;
    let velocity = 80;
    let duration = null; // if not provided, use defaultDurationMs
    let channel = 1; // user-facing 1-16
    let muteProbability = null; // probability to mute (0-1)
    let removeProbability = null; // probability to remove note (0-1)
    // Track which parameters were explicitly set in the note
    let hasNoteVelocity = false;
    let hasNoteChannel = false;
    let hasNoteDuration = false;
    // Randomization flags and range values
    let randomizeNote = false;
    let randomizeVelocity = false;
    let randomizeMuteProbability = false;
    let randomizeRemoveProbability = false;
    let randomizeDuration = false;
    let randomizeChannel = false;
    let randomizePan = false;
    // Note range (MIDI values: [minMidi, maxMidi] or null)
    let nRange = null;
    // Velocity range (0-1 float: [min, max], scales to 0-127)
    let vRange = [0, 1];
    // Pan range (0-1 float: [min, max])
    let pRange = null;
    // Mute probability range (0-1 float: [min, max])
    let pmRange = [0, 1];
    // Remove probability range (0-1 float: [min, max])
    let prRange = [0, 1];
    // Duration range (duration tokens: [minToken, maxToken] or null)
    let dRange = null;
    // Array-based randomizers
    let noteArray = null;
    let velocityArray = null;
    let panArray = null;
    let durationArray = null;
    let pan = 0.5; // Default pan (center)
    
    // Check if note argument is 'r' or 'r.o{...}' for randomization
    const noteArgLower = noteArg.toLowerCase();
    if (noteArgLower === 'r') {
      randomizeNote = true;
    } else {
      const parsedArray = parseArrayRandomizer(noteArg, { bt, br });
      if (parsedArray) {
        noteArray = parsedArray.filter(item => item.type === 'note');
        randomizeNote = noteArray.length > 0;
      }
    }
    
    const midiNote = noteTokenToMidi(noteArg);
    if (midiNote === null && !randomizeNote) continue;
    // Repeat syntax is already expanded at sequence level, so repeatCount is always 1 (already set above)
    // Use a more sophisticated approach to handle nested brackets in parameters
    const paramRegex = /\.(d|v|p|c|pm|pr|pmRange|prRange|nRange|vRange|pRange|dRange)\((.*?)\)/g;
    let lastIndex = 0;
    let m;
    const params = [];
    
    // First pass: extract all parameter matches
    while ((m = paramRegex.exec(chunk)) !== null) {
      params.push({ key: m[1], raw: m[2], index: m.index });
      lastIndex = paramRegex.lastIndex;
    }
    
    // If regex didn't catch nested braces properly, manually parse
    if (params.length === 0 || params.some(p => p.raw.includes('{') && !p.raw.match(/r\.o\{.+\}/))) {
      // Try manual extraction for complex cases
      let chunkPos = 0;
      while (chunkPos < chunk.length) {
        const dotPos = chunk.indexOf('.', chunkPos);
        if (dotPos === -1) break;
        
        const paramMatch = chunk.substring(dotPos + 1).match(/^(d|v|p|c|pm|pr|pmRange|prRange|nRange|vRange|pRange|dRange)\(/);
        if (paramMatch) {
          const key = paramMatch[1];
          const startPos = dotPos + 1 + key.length + 1;
          let parenCount = 1;
          let i = startPos;
          let paramValue = '';
          
          while (i < chunk.length && parenCount > 0) {
            if (chunk[i] === '(') parenCount++;
            else if (chunk[i] === ')') parenCount--;
            else if (parenCount === 1) paramValue += chunk[i];
            i++;
          }
          
          if (parenCount === 0) {
            params.push({ key, raw: paramValue, index: dotPos });
            chunkPos = i;
          } else {
            chunkPos = dotPos + 1;
          }
        } else {
          chunkPos = dotPos + 1;
        }
      }
    }
    
    // Process each parameter
    for (const param of params) {
      const key = param.key;
      const raw = param.raw.trim();
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
        } else if (norm === 'r') {
          // Random duration
          randomizeDuration = true;
          hasNoteDuration = true;
        } else {
          // Check for array syntax: r.o{...}
          console.log('[DURATION_PARSE] Parsing duration:', raw);
          const parsedArray = parseArrayRandomizer(raw, { bt, br });
          console.log('[DURATION_PARSE] Parsed array:', parsedArray);
          if (parsedArray) {
            durationArray = parsedArray.filter(item => item.type === 'duration');
            console.log('[DURATION_PARSE] Duration array:', durationArray);
            randomizeDuration = durationArray.length > 0;
            hasNoteDuration = true;
          }
          // Any other form is ignored per spec; leave duration as-is (null => defaults)
        }
        
        // Mark duration as set only if it was actually changed from null
        if (duration !== prevDuration && duration !== null || randomizeDuration) {
          hasNoteDuration = true;
        }
      }
      if (key === 'v') {
        const rawLower = raw.toLowerCase();
        if (rawLower === 'r') {
          randomizeVelocity = true;
          hasNoteVelocity = true;
        } else {
          const parsedArray = parseArrayRandomizer(raw, { bt, br });
          if (parsedArray) {
            velocityArray = parsedArray.filter(item => item.type === 'number');
            randomizeVelocity = velocityArray.length > 0;
            hasNoteVelocity = true;
          } else {
            const v = parseInt(raw, 10);
            if (!isNaN(v)) {
              velocity = Math.max(0, Math.min(127, v));
              hasNoteVelocity = true;
            }
          }
        }
      }
      if (key === 'c') {
        if (raw.toLowerCase() === 'r') {
          randomizeChannel = true;
          hasNoteChannel = true;
        } else {
          const ch = parseInt(raw, 10);
          if (!isNaN(ch)) {
            channel = Math.max(1, Math.min(16, ch));
            hasNoteChannel = true;
          }
        }
      }
      if (key === 'p') {
        const rawLower = raw.toLowerCase();
        if (rawLower === 'r') {
          randomizePan = true;
        } else {
          const parsedArray = parseArrayRandomizer(raw, { bt, br });
          if (parsedArray) {
            panArray = parsedArray.filter(item => item.type === 'number');
            randomizePan = panArray.length > 0;
          } else {
            const p = parseFloat(raw);
            if (!isNaN(p)) {
              pan = Math.max(0, Math.min(1, p));
            }
          }
        }
      }
      if (key === 'nRange') {
        // Parse note range: nRange(minNote, maxNote) - e.g. nRange(c3, c4)
        // Used for filtering note arrays or continuous random range
        const parts = raw.split(',').map(s => s.trim());
        if (parts.length === 2) {
          const minMidi = noteTokenToMidi(parts[0]);
          const maxMidi = noteTokenToMidi(parts[1]);
          if (minMidi !== null && maxMidi !== null && maxMidi >= minMidi) {
            nRange = [minMidi, maxMidi];
            // Filter note array if it exists
            if (noteArray) {
              noteArray = filterArrayByRange(noteArray, minMidi, maxMidi);
              randomizeNote = noteArray.length > 0;
            }
          }
        }
      }
      if (key === 'vRange') {
        // Parse velocity range: vRange(min, max) - e.g. vRange(0.5, 1.0)
        // Used for filtering velocity arrays or continuous random range
        const parts = raw.split(',').map(s => s.trim());
        if (parts.length === 2) {
          const min = parseFloat(parts[0]);
          const max = parseFloat(parts[1]);
          if (!isNaN(min) && !isNaN(max) && min >= 0 && min <= 1 && max >= 0 && max <= 1 && max >= min) {
            vRange = [min, max];
            // Filter velocity array if it exists
            if (velocityArray) {
              velocityArray = filterArrayByRange(velocityArray, min, max);
              randomizeVelocity = velocityArray.length > 0;
            }
          }
        }
      }
      if (key === 'pRange') {
        // Parse pan range: pRange(min, max) - e.g. pRange(0.4, 0.8)
        // Used for filtering pan arrays
        const parts = raw.split(',').map(s => s.trim());
        if (parts.length === 2) {
          const min = parseFloat(parts[0]);
          const max = parseFloat(parts[1]);
          if (!isNaN(min) && !isNaN(max) && min >= 0 && min <= 1 && max >= 0 && max <= 1 && max >= min) {
            pRange = [min, max];
            // Filter pan array if it exists
            if (panArray) {
              panArray = filterArrayByRange(panArray, min, max);
              randomizePan = panArray.length > 0;
            }
          }
        }
      }
      if (key === 'pm') {
        // Parse mute probability: pm(value) or pm(r) for randomization
        const norm = raw.replace(/\s+/g, '').toLowerCase();
        if (norm === 'r') {
          randomizeMuteProbability = true;
        } else {
          const prob = parseFloat(raw);
          if (!isNaN(prob) && prob >= 0 && prob <= 1) {
            muteProbability = prob;
          }
        }
      }
      if (key === 'pr') {
        // Parse remove probability: pr(value) or pr(r) for randomization
        const norm = raw.replace(/\s+/g, '').toLowerCase();
        if (norm === 'r') {
          randomizeRemoveProbability = true;
        } else {
          const prob = parseFloat(raw);
          if (!isNaN(prob) && prob >= 0 && prob <= 1) {
            removeProbability = prob;
          }
        }
      }
      if (key === 'pmRange') {
        // Parse mute probability range: pmRange(min, max) - e.g. pmRange(0.2, 0.8)
        const parts = raw.split(',').map(s => s.trim());
        if (parts.length === 2) {
          const min = parseFloat(parts[0]);
          const max = parseFloat(parts[1]);
          if (!isNaN(min) && !isNaN(max) && min >= 0 && min <= 1 && max >= 0 && max <= 1 && max > min) {
            pmRange = [min, max];
          }
        }
      }
      if (key === 'prRange') {
        // Parse remove probability range: prRange(min, max) - e.g. prRange(0.2, 0.8)
        const parts = raw.split(',').map(s => s.trim());
        if (parts.length === 2) {
          const min = parseFloat(parts[0]);
          const max = parseFloat(parts[1]);
          if (!isNaN(min) && !isNaN(max) && min >= 0 && min <= 1 && max >= 0 && max <= 1 && max > min) {
            prRange = [min, max];
          }
        }
      }
      if (key === 'dRange') {
        // Parse duration range: dRange(minToken, maxToken) - e.g. dRange(bt/16, bt/4) or dRange(bt/2, bt*2)
        const parts = raw.split(',').map(s => s.trim());
        if (parts.length === 2) {
          // Helper to parse duration token
          const parseDurationToken = (tokenStr) => {
            const norm = tokenStr.replace(/\s+/g, '').toLowerCase();
            // Special case: 'bt' means exactly 1 beat
            if (norm === 'bt') {
              return { type: 'unit', value: 1 };
            }
            // Patterns: bt/even or bt*even (even numbers only)
            const mDiv = norm.match(/^bt\/(\d+)$/);
            const mMul = norm.match(/^bt\*(\d+)$/);
            if (mDiv && mDiv[1]) {
              const divisor = parseInt(mDiv[1], 10);
              if (!isNaN(divisor) && divisor > 0 && divisor % 2 === 0) {
                return { type: 'div', value: divisor };
              }
            } else if (mMul && mMul[1]) {
              const multiplier = parseInt(mMul[1], 10);
              if (!isNaN(multiplier) && multiplier > 0 && multiplier % 2 === 0) {
                return { type: 'mul', value: multiplier };
              }
            }
            return null;
          };
          
          const minToken = parseDurationToken(parts[0]);
          const maxToken = parseDurationToken(parts[1]);
          if (minToken !== null && maxToken !== null) {
            dRange = [minToken, maxToken];
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
    // Note: Remove probability is now handled per-repeat in the loop below
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
    // Each repeat gets its own probability check and randomization
    for (let r = 0; r < repeatCount; r++) {
      // Generate random values for this repeat if needed
      let useMidiNote = midiNote;
      let useVelocity = velocity;
      let useChannel = channel;
      let useMuteProbability = muteProbability;
      let useRemoveProbability = removeProbability;
      let useDurationValue = useDuration;
      
      // Randomize remove probability (0-1) - must be done first as it can skip the note
      if (randomizeRemoveProbability) {
        const random = Math.random();
        useRemoveProbability = prRange[0] + random * (prRange[1] - prRange[0]);
        useRemoveProbability = Math.max(0, Math.min(1, useRemoveProbability));
      }
      
      // Apply remove probability: if random < useRemoveProbability, skip this note instance
      if (useRemoveProbability !== null && useRemoveProbability > 0) {
        const random = Math.random();
        if (random < useRemoveProbability) {
          continue; // Skip this note instance - it's removed
        }
      }
      
      // Randomize note
      if (randomizeNote) {
        if (noteArray && noteArray.length > 0) {
          // Use array-based randomization: randomly select from array
          const randomIndex = Math.floor(Math.random() * noteArray.length);
          useMidiNote = noteArray[randomIndex].value;
        } else {
          // Use continuous randomization with range
          // Use nRange if provided, otherwise use defaults
          const minMidi = nRange !== null ? nRange[0] : 24; // C1 default
          const maxMidi = nRange !== null ? nRange[1] : 108; // C8 default
          // Randomly select within the MIDI range
          const random = Math.random();
          useMidiNote = Math.round(minMidi + random * (maxMidi - minMidi));
          useMidiNote = Math.max(0, Math.min(127, useMidiNote));
        }
      }
      
      // Randomize velocity (0-127)
      if (randomizeVelocity) {
        if (velocityArray && velocityArray.length > 0) {
          // Use array-based randomization: randomly select from array
          const randomIndex = Math.floor(Math.random() * velocityArray.length);
          const scaled = velocityArray[randomIndex].value;
          useVelocity = Math.round(scaled * 127);
          useVelocity = Math.max(0, Math.min(127, useVelocity));
        } else {
          // Use continuous randomization with range
          const random = Math.random();
          const scaled = vRange[0] + random * (vRange[1] - vRange[0]);
          useVelocity = Math.round(scaled * 127);
          useVelocity = Math.max(0, Math.min(127, useVelocity));
        }
      }
      
      // Randomize pan (0-1)
      if (randomizePan) {
        if (panArray && panArray.length > 0) {
          // Use array-based randomization: randomly select from array
          const randomIndex = Math.floor(Math.random() * panArray.length);
          pan = Math.max(0, Math.min(1, panArray[randomIndex].value));
        } else {
          // Use continuous randomization with range
          const random = Math.random();
          const minPan = pRange !== null ? pRange[0] : 0;
          const maxPan = pRange !== null ? pRange[1] : 1;
          pan = minPan + random * (maxPan - minPan);
          pan = Math.max(0, Math.min(1, pan));
        }
      }
      
      // Randomize mute probability (0-1)
      if (randomizeMuteProbability) {
        const random = Math.random();
        useMuteProbability = pmRange[0] + random * (pmRange[1] - pmRange[0]);
        useMuteProbability = Math.max(0, Math.min(1, useMuteProbability));
      }
      
      // Randomize duration
      if (randomizeDuration) {
        console.log('[DURATION_RAND] randomizeDuration is true');
        // Helper to calculate duration from token (bt/even or bt*even, or 'unit' for bt)
        const durationFromToken = (token) => {
          if (!token) return null;
          if (token.type === 'div') {
            return Math.round(bt / token.value);
          } else if (token.type === 'mul') {
            return Math.round(bt * token.value);
          } else if (token.type === 'unit') {
            return Math.round(bt * token.value); // bt * 1 = bt
          }
          return null;
        };
        
        // Check if we have a duration array
        if (durationArray && durationArray.length > 0) {
          console.log('[DURATION_RAND] Duration array found, length:', durationArray.length);
          // Create canonical array of all valid durations from bt/64 to bt*64
          // This includes: bt/64, bt/32, ..., bt/4, bt/2, bt, bt*2, bt*4, ..., bt*64
          // Store as { token: "bt", value: ms, index: idx }
          const canonicalDurations = [];
          
          // Generate division durations (bt/64, bt/32, ..., bt/4, bt/2) - even numbers only
          for (let div = 64; div >= 2; div -= 2) {
            const dur = Math.round(bt / div);
            if (dur >= 1) { // Only add if duration is at least 1ms
              canonicalDurations.push({ token: `bt/${div}`, value: dur });
            }
          }
          
          // Add bt itself
          canonicalDurations.push({ token: 'bt', value: Math.round(bt) });
          
          // Generate multiplication durations (bt*2, bt*4, ..., bt*64) - even numbers only
          for (let mul = 2; mul <= 64; mul += 2) {
            const dur = Math.round(bt * mul);
            canonicalDurations.push({ token: `bt*${mul}`, value: dur });
          }
          
          // Remove duplicates based on token and sort by value
          const seen = new Set();
          const uniqueCanonical = canonicalDurations
            .filter(item => {
              if (seen.has(item.token)) return false;
              seen.add(item.token);
              return true;
            })
            .sort((a, b) => a.value - b.value);
          
          // Map duration array tokens to indices in canonical array (by string matching)
          const arrayIndices = [];
          durationArray.forEach(item => {
            const token = item.token;
            if (token) {
              // Find index by token string match
              const index = uniqueCanonical.findIndex(canon => canon.token === token);
              if (index !== -1) {
                arrayIndices.push(index);
              }
            }
          });
          
          console.log('[DURATION_ARRAY] Array indices:', arrayIndices);
          console.log('[DURATION_ARRAY] Array tokens:', durationArray.map(item => item.token));
          console.log('[DURATION_ARRAY] Array values:', durationArray.map(item => item.value));
          console.log('[DURATION_ARRAY] Canonical array length:', uniqueCanonical.length);
          
          // If dRange is provided, filter by range
          let validIndices = arrayIndices;
          if (dRange !== null && arrayIndices.length > 0) {
            const minDurationMs = durationFromToken(dRange[0]);
            const maxDurationMs = durationFromToken(dRange[1]);
            
            console.log('[DURATION_ARRAY] dRange:', { minDurationMs, maxDurationMs });
            
            if (minDurationMs !== null && maxDurationMs !== null && maxDurationMs >= minDurationMs) {
              // Find range indices in canonical array
              // minIndex: first index where value >= minDurationMs
              let minIndex = uniqueCanonical.findIndex(canon => canon.value >= minDurationMs);
              // maxIndex: first index where value > maxDurationMs, then subtract 1 for <= comparison
              let maxIndex = uniqueCanonical.findIndex(canon => canon.value > maxDurationMs);
              const rangeMaxIndex = maxIndex === -1 ? uniqueCanonical.length - 1 : maxIndex - 1;
              
              console.log('[DURATION_ARRAY] minIndex:', minIndex, 'rangeMaxIndex:', rangeMaxIndex);
              
              if (minIndex !== -1 && rangeMaxIndex >= minIndex) {
                // Filter array indices - only include indices that are within the range
                validIndices = arrayIndices.filter(idx => {
                  return idx >= minIndex && idx <= rangeMaxIndex;
                });
                console.log('[DURATION_ARRAY] Array indices:', arrayIndices);
                console.log('[DURATION_ARRAY] Valid indices after filter:', validIndices);
              } else {
                validIndices = [];
              }
            }
          }
          
          // Randomly select from valid indices
          if (validIndices.length > 0) {
            const randomIndex = Math.floor(Math.random() * validIndices.length);
            const selectedCanonicalIndex = validIndices[randomIndex];
            useDurationValue = uniqueCanonical[selectedCanonicalIndex].value;
          } else if (arrayIndices.length > 0) {
            // If range filtering eliminated all, but we had array indices, use them without range
            // (This shouldn't happen with correct range, but safety fallback)
            const randomIndex = Math.floor(Math.random() * arrayIndices.length);
            const selectedCanonicalIndex = arrayIndices[randomIndex];
            useDurationValue = uniqueCanonical[selectedCanonicalIndex].value;
          } else if (durationArray.length > 0) {
            // If canonical matching failed, use array values directly
            const randomIndex = Math.floor(Math.random() * durationArray.length);
            useDurationValue = durationArray[randomIndex].value;
          } else {
            // Fallback to default if no valid durations found
            useDurationValue = Math.max(1, defaultDurationMs || bt);
          }
        } else if (dRange !== null) {
          // If dRange is provided, use it (original behavior)
          const minDurationMs = durationFromToken(dRange[0]);
          const maxDurationMs = durationFromToken(dRange[1]);
          
          if (minDurationMs !== null && maxDurationMs !== null && maxDurationMs > minDurationMs) {
            // Generate all valid durations (bt/even or bt*even, or bt itself) between min and max
            const validDurations = [];
            const btDuration = Math.round(bt);
            
            // Check if bt itself (1 beat) is in range
            if (btDuration >= minDurationMs && btDuration <= maxDurationMs) {
              validDurations.push(btDuration);
            }
            
            // Generate division durations (bt/2, bt/4, bt/6, ...)
            for (let div = 2; div <= 128; div += 2) {
              const dur = Math.round(bt / div);
              if (dur >= minDurationMs && dur <= maxDurationMs) {
                validDurations.push(dur);
              }
              if (dur < minDurationMs) break; // No point checking smaller divisions
            }
            
            // Generate multiplication durations (bt*2, bt*4, bt*6, ...)
            for (let mul = 2; mul <= 16; mul += 2) {
              const dur = Math.round(bt * mul);
              if (dur >= minDurationMs && dur <= maxDurationMs) {
                validDurations.push(dur);
              }
              if (dur > maxDurationMs) break; // No point checking larger multiplications
            }
            
            // Remove duplicates and sort
            const uniqueDurations = [...new Set(validDurations)].sort((a, b) => a - b);
            
            if (uniqueDurations.length > 0) {
              // Randomly select one valid duration
              const randomIndex = Math.floor(Math.random() * uniqueDurations.length);
              useDurationValue = uniqueDurations[randomIndex];
            } else {
              // Fallback to default if no valid durations found
              useDurationValue = Math.max(1, defaultDurationMs || bt);
            }
          } else {
            // Invalid minD/maxD, fall back to default
            useDurationValue = Math.max(1, defaultDurationMs || bt);
          }
        } else {
          // No minD/maxD, use default random behavior (br/32 to br)
          const random = Math.random();
          const minDuration = br / 32;
          const maxDuration = br;
          useDurationValue = Math.round(minDuration + random * (maxDuration - minDuration));
          useDurationValue = Math.max(1, useDurationValue);
        }
      }
      
      // Randomize channel (1-16) - uses default 0-1 range
      if (randomizeChannel) {
        const random = Math.random();
        useChannel = Math.round(1 + random * 15);
        useChannel = Math.max(1, Math.min(16, useChannel));
      }
      
      let shouldMute = false;
      
      // Check note-level mute probability (randomized if applicable)
      if (useMuteProbability !== null && useMuteProbability > 0) {
        const random = Math.random();
        if (random < useMuteProbability) {
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
      
      const useZeroBasedChannel = useChannel - 1;
      await sendNote(useMidiNote, useVelocity, useDurationValue, useZeroBasedChannel);
    }
  }
}

// Play multiple sequences in a cycle with per-block modifiers.
// Example: [n(60)^2 n(70)^3.d(/5) n(70).d(*4)].t(fit).c(2).co(2br) [n(60)^2].t(beat).c(3)
async function playCycle(cycleStr) {
  console.log('[PLAY_CYCLE] Called with:', cycleStr);
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
        playCycle("[n(r.o{d4, e4})^3.nRange(c4, c5).d(r.o{bt*2}).dRange(bt, bt*2)].c(1)");
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

