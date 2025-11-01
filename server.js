const express = require('express');
const dgram = require('dgram');
const osc = require('osc');
const http = require('http');
const { WebSocketServer } = require('ws');
const { 
  noteTokenToMidi, 
  SCALE_DEFINITIONS, 
  CHORD_QUALITIES, 
  scaleToMidiNotes, 
  chordToMidiNotes, 
  generateScaleChordNotes,
  getScaleIntervals
} = require('./src/modules/musicTheory');
const { initializeMidi, sendNote, closeMidi } = require('./src/modules/midiHandler');
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

// Queue for tracks/cycles to play on next bar change
// Format: [{id: id, function: ()=> playTrack(params)}, ...]
let queue = [];

// Active cycles that are currently running
// Format: [{id: id, function: ()=> playCycle(params), intervalId: intervalId}, ...]
let activeCycle = [];


function checkInitialization() {
  if (!initialized && tempo !== null && signatureNumerator !== null && signatureDenominator !== null) {
    initialized = true;
    console.log('[INITIALIZATION] Connected to Max4Live');
  }
}

// Store connected WebSocket clients (will be initialized later)
let clients = null;

// Initialize MIDI output (using midiHandler module)
initializeMidi();

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

// sendNote is imported from ./src/modules/midiHandler 

// Convert note tokens like "c3", "c3#", "c3b", "c#3" to MIDI number.
// Uses scientific pitch: C4 = 60, so C3 = 48
// Music theory functions and definitions are imported from ./src/modules/musicTheory

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

// generateScaleChordNotes is imported from ./src/modules/musicTheory

// Parse chord syntax: <c4,e4,g6> returns array of MIDI note numbers
function parseChord(chordStr) {
  if (!chordStr || typeof chordStr !== 'string') return null;
  
  const match = chordStr.match(/^<([^>]+)>$/);
  if (!match) return null;
  
  const notesStr = match[1].trim();
  const noteItems = notesStr.split(',').map(s => s.trim());
  const midiNotes = [];
  
  for (const item of noteItems) {
    const midiNote = noteTokenToMidi(item);
    if (midiNote !== null) {
      midiNotes.push(midiNote);
    } else {
      // Try as MIDI note number
      const midiNum = parseInt(item, 10);
      if (!isNaN(midiNum) && midiNum >= 0 && midiNum <= 127) {
        midiNotes.push(midiNum);
      }
    }
  }
  
  return midiNotes.length > 0 ? midiNotes : null;
}

// Parse r.o{...} array syntax and return array of values
// Examples: r.o{c4, d4, e4}, r.o{60, 64, 67}, r.o{0.25, 0.5, 0.75}, r.o{bt/4, bt, bt*2}
// Duration tokens: bt, bt/even, or bt*even (even numbers only)
// Also supports: r.o{scale(...)}, r.o{chord(...)}, r.o{<c4,e4,g4>,<f4,a4,c5>} (chords)
function parseArrayRandomizer(str, context = {}) {
  if (!str || typeof str !== 'string') return null;
  
  const match = str.match(/^r\.o\{([^\}]+)\}$/i);
  if (!match) return null;
  
  const arrayStr = match[1].trim();
  
  // Check if the entire content is a scale/chord (no commas)
  // This handles: r.o{scale(c-iwato)} or r.o{scale(c-ionian).q(maj7)}
  // Use balanced parentheses matching
  const scaleChordMatch = arrayStr.match(/^(scale\(.+?\)(?:\.q\(.+?\))?|chord\(.+?\))$/i);
  if (scaleChordMatch) {
    // This will be expanded later when nRange is available
    return [{ type: 'scaleChord', value: arrayStr, original: arrayStr }];
  }
  
  // Handle comma-separated items, but be careful with nested angle brackets
  // Parse items by splitting on commas, but preserve chord syntax <...>
  const items = [];
  let currentItem = '';
  let angleBracketDepth = 0;
  
  for (let i = 0; i < arrayStr.length; i++) {
    const char = arrayStr[i];
    if (char === '<') {
      angleBracketDepth++;
      currentItem += char;
    } else if (char === '>') {
      angleBracketDepth--;
      currentItem += char;
    } else if (char === ',' && angleBracketDepth === 0) {
      items.push(currentItem.trim());
      currentItem = '';
    } else {
      currentItem += char;
    }
  }
  if (currentItem.trim()) {
    items.push(currentItem.trim());
  }
  
  const result = [];
  
  for (const item of items) {
    // Check for chord syntax: <c4,e4,g6>
    const chord = parseChord(item);
    if (chord) {
      result.push({ type: 'chord', value: chord, original: item });
      continue;
    }
    
    // Check for scale/chord syntax in individual items
    const scaleChordItemMatch = item.match(/^(scale\(.+?\)(?:\.q\(.+?\))?|chord\(.+?\))$/i);
    if (scaleChordItemMatch) {
      // This will be expanded later when nRange is available
      result.push({ type: 'scaleChord', value: item, original: item });
      continue;
    }
    
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
// For chords, include if any note in the chord is within the range
function filterArrayByRange(array, min, max) {
  if (!array || array.length === 0) return array;
  
  return array.filter(item => {
    const value = item.value !== undefined ? item.value : item;
    
    // Handle chord type (array of MIDI notes)
    if (item.type === 'chord' && Array.isArray(value)) {
      // Include chord if ANY note is within range
      return value.some(note => note >= min && note <= max);
    }
    
    // Handle single note (number)
    return value >= min && value <= max;
  });
}

// Order array based on arpeggiator mode
function orderArrayByArp(array, mode) {
  if (!array || array.length === 0) return array;
  if (mode === null) return array; // random - return as is
  
  // Create a copy to avoid mutating original
  const ordered = [...array];
  
  // Sort by value (for numbers) or keep as is (for objects with value property)
  // For chords, sort by the lowest note in the chord
  const getValue = (item) => {
    if (typeof item === 'number') return item;
    if (item.value !== undefined) {
      // Handle chord type (array of MIDI notes)
      if (item.type === 'chord' && Array.isArray(item.value)) {
        // Sort by lowest note in chord
        return Math.min(...item.value);
      }
      return item.value;
    }
    return item;
  };
  
  ordered.sort((a, b) => getValue(a) - getValue(b));
  
  if (mode === 'up') {
    // start to end (already sorted ascending)
    return ordered;
  } else if (mode === 'down') {
    // end to start (reverse)
    return ordered.reverse();
  } else if (mode === 'up-down') {
    // up-down pattern: up, then down excluding both start and end to avoid duplicates
    // Example: [c4, e4, g4] -> [c4, e4, g4, e4] which cycles as: c4, e4, g4, e4, c4, e4, g4, e4...
    // This ensures seamless cycling: each cycle goes up then back down, meeting at the start
    const up = [...ordered];
    const down = [...ordered].reverse().slice(1, -1); // reverse and exclude first and last
    return up.concat(down);
  } else if (mode === 'down-up') {
    // down-up pattern: down, then up excluding both start and end to avoid duplicates
    // Example: [c4, e4, g4] -> [g4, e4, c4, e4] which cycles as: g4, e4, c4, e4, g4, e4, c4...
    // This ensures seamless cycling: each cycle goes down then back up, meeting at the end
    const down = [...ordered].reverse();
    const up = ordered.slice(1, -1); // exclude first (start) and last (end) elements
    return down.concat(up);
  }
  
  return array; // fallback
}

// Get next value from ordered array based on arp position
function getArpValue(orderedArray, position) {
  if (!orderedArray || orderedArray.length === 0) return null;
  const index = position % orderedArray.length;
  return orderedArray[index];
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
async function playSequence(sequence, type = "fit", cutOff = null, channelOverride = null, sequenceMuteProbability = null, tempoParam = null, signatureNumeratorParam = null, signatureDenominatorParam = null) {

  if (!sequence || typeof sequence !== 'string') return;
  
  // Preprocessing: Expand scale/chord inside r.o{...} based on nRange
  // This must happen BEFORE repeat expansion so expanded notes are available for repeats
  let processedSequence = sequence;
  
  // First, extract nRange from the sequence if it exists
  // Look for .nRange(min, max) pattern
  const nRangeMatch = processedSequence.match(/\.nRange\(([^,]+),\s*([^)]+)\)/);
  let nRangeMin = null;
  let nRangeMax = null;
  if (nRangeMatch) {
    nRangeMin = noteTokenToMidi(nRangeMatch[1].trim());
    nRangeMax = noteTokenToMidi(nRangeMatch[2].trim());
  }
  
  // If we have nRange, expand r.o{scale(...)} and r.o{chord(...)}
  if (nRangeMin !== null && nRangeMax !== null) {
    // Find all r.o{...} patterns and check if they contain scale/chord
    let searchIdx = 0;
    let replacements = [];
    
    while (searchIdx < processedSequence.length) {
      const rOIndex = processedSequence.indexOf('r.o{', searchIdx);
      if (rOIndex === -1) break;
      
      // Find matching closing brace
      let braceCount = 1;
      let braceIdx = rOIndex + 4; // "r.o{".length
      let contentStart = braceIdx;
      let contentEnd = -1;
      
      while (braceIdx < processedSequence.length && braceCount > 0) {
        if (processedSequence[braceIdx] === '{') braceCount++;
        else if (processedSequence[braceIdx] === '}') {
          braceCount--;
          if (braceCount === 0) {
            contentEnd = braceIdx;
            break;
          }
        }
        braceIdx++;
      }
      
      if (contentEnd !== -1) {
        const content = processedSequence.substring(contentStart, contentEnd);
        
        // Check if content is a scale or chord
        const trimmedContent = content.trim();
        if (trimmedContent.startsWith('scale(') || trimmedContent.startsWith('chord(')) {
          // This is a scale or chord - expand it
          const generatedNotes = generateScaleChordNotes(trimmedContent, nRangeMin, nRangeMax);
          
          if (generatedNotes.length > 0) {
            // Convert MIDI notes to note tokens (e.g., 61 -> "c#4")
            const noteTokens = generatedNotes.map(item => {
              const midi = item.value;
              // Convert MIDI to note token
              const octave = Math.floor(midi / 12) - 1;
              const noteInOctave = midi % 12;
              const noteNames = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
              const noteName = noteNames[noteInOctave];
              return `${noteName}${octave}`;
            });
            
            // Create replacement: r.o{note1, note2, note3, ...}
            const fullMatch = processedSequence.substring(rOIndex, contentEnd + 1);
            const replacement = `r.o{${noteTokens.join(', ')}}`;
            replacements.push({ from: fullMatch, to: replacement, index: rOIndex });
          }
        }
      }
      
      searchIdx = contentEnd !== -1 ? contentEnd + 1 : rOIndex + 1;
    }
    
    // Apply replacements (in reverse order to maintain indices)
    replacements.sort((a, b) => b.index - a.index);
    for (const replacement of replacements) {
      processedSequence = processedSequence.substring(0, replacement.index) + 
                         replacement.to + 
                         processedSequence.substring(replacement.index + replacement.from.length);
    }
  }
  
  // Expand scale and chord syntax first (for sequences outside r.o{...})
  // This handles standalone scale(...) or chord(...) in sequences
  
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
  const repeatPattern = /n\([^)]+\)(\^\d+)((?:\.(?:d|v|p|c|pm|pr|pmRange|prRange|nRange|vRange|pRange|dRange|nArp|dArp|vArp|pmArp|prArp)\([^)]*\))*)/g;
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
  
  const chunkRegex = /n\([^\)]+\)(?:\.(?:d|v|p|c|pm|pr|pmRange|prRange|nRange|vRange|pRange|dRange|nArp|dArp|vArp|pmArp|prArp)\([^)]*\))*/g;
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

  // Use provided parameters or fall back to server variables
  const useTempo = tempoParam !== null ? tempoParam : tempo;
  const useSignatureNumerator = signatureNumeratorParam !== null ? signatureNumeratorParam : signatureNumerator;
  const useSignatureDenominator = signatureDenominatorParam !== null ? signatureDenominatorParam : signatureDenominator;

  const beatsPerBar = useSignatureNumerator;
  const barDurationMs = (typeof useTempo === 'number' && useTempo > 0) ? (60000 / useTempo) * beatsPerBar : 500;

  const ev = Math.max(1, Math.round(barDurationMs / numNotes))
  const bt = Math.max(1, Math.round(barDurationMs / beatsPerBar))
  const br = barDurationMs
  
  // Parse cutoff token and convert to milliseconds
  // Supports: br, br*i, br/even, bt, bt*i, bt/even (where i is a number, even is even number)
  let cutoffDurationMs = null;
  if (cutOff) {
    const cutoffNorm = cutOff.trim().toLowerCase();
    const brMatch = cutoffNorm.match(/^br(?:\*(\d+(?:\.\d+)?))?$/);
    const brDivMatch = cutoffNorm.match(/^br\/(\d+)$/);
    const btMatch = cutoffNorm.match(/^bt(?:\*(\d+(?:\.\d+)?))?$/);
    const btDivMatch = cutoffNorm.match(/^bt\/(\d+)$/);
    
    if (brMatch) {
      const multiplier = brMatch[1] ? parseFloat(brMatch[1]) : 1;
      if (!isNaN(multiplier) && multiplier > 0) {
        cutoffDurationMs = Math.round(br * multiplier);
      }
    } else if (brDivMatch) {
      const divisor = parseInt(brDivMatch[1], 10);
      if (!isNaN(divisor) && divisor > 0 && divisor % 2 === 0) {
        cutoffDurationMs = Math.round(br / divisor);
      }
    } else if (btMatch) {
      const multiplier = btMatch[1] ? parseFloat(btMatch[1]) : 1;
      if (!isNaN(multiplier) && multiplier > 0) {
        cutoffDurationMs = Math.round(bt * multiplier);
      }
    } else if (btDivMatch) {
      const divisor = parseInt(btDivMatch[1], 10);
      if (!isNaN(divisor) && divisor > 0 && divisor % 2 === 0) {
        cutoffDurationMs = Math.round(bt / divisor);
      }
    }
  }

  // Check if any chunk uses duration settings (dRange, d(r), duration array, or explicit durations), 
  // and if so, override type to 'beat'
  let usesDurationSetting = false;
  for (const chunk of chunks) {
    if (chunk.includes('dRange(')) {
      usesDurationSetting = true;
      break;
    }
    // Check for d(...) parameter - handle nested braces/parentheses
    let chunkPos = 0;
    while (chunkPos < chunk.length) {
      const dotPos = chunk.indexOf('.d(', chunkPos);
      if (dotPos === -1) break;
      
      const startPos = dotPos + 3; // ".d(".length
      let parenCount = 1;
      let i = startPos;
      let dValue = '';
      
      while (i < chunk.length && parenCount > 0) {
        if (chunk[i] === '(') parenCount++;
        else if (chunk[i] === ')') parenCount--;
        else if (parenCount === 1) dValue += chunk[i];
        i++;
      }
      
      if (parenCount === 0) {
        const normalized = dValue.trim().toLowerCase();
        // Check for d(r) or d(r.o{...}) - random duration or duration array
        if (normalized === 'r' || normalized.includes('r.o{')) {
          usesDurationSetting = true;
          break;
        }
        // Check for explicit duration tokens like bt, br, bt/2, bt*2, or numbers
        if (normalized.includes('bt') || normalized.includes('br') || /^\d+$/.test(normalized)) {
          usesDurationSetting = true;
          break;
        }
        chunkPos = i;
      } else {
        chunkPos = dotPos + 1;
      }
      
      if (usesDurationSetting) break;
    }
    if (usesDurationSetting) break;
  }
  if (usesDurationSetting) {
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

  // Track cumulative duration for cutoff
  let cumulativeDurationMs = 0;
  
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
    let muteProbabilityArray = null;
    let removeProbabilityArray = null;
    let pan = 0.5; // Default pan (center)
    // Arpeggiator modes (null = random, 'up', 'down', 'up-down', 'down-up')
    let nArpMode = null; // Note arpeggiator mode
    let dArpMode = null; // Duration arpeggiator mode
    let vArpMode = null; // Velocity arpeggiator mode
    let pmArpMode = null; // Mute probability arpeggiator mode
    let prArpMode = null; // Remove probability arpeggiator mode
    // Track arp position per chunk (for ordered selection)
    let arpPosition = 0;
    
    // Check for chord syntax: n(<c4,e4,g6>)
    let isDirectChord = false;
    let directChordNotes = null;
    const chordMatch = parseChord(noteArg);
    if (chordMatch) {
      isDirectChord = true;
      directChordNotes = chordMatch;
    }
    
    // Check if note argument is 'r' or 'r.o{...}' for randomization
    const noteArgLower = noteArg.toLowerCase();
    if (noteArgLower === 'r') {
      randomizeNote = true;
    } else if (!isDirectChord) {
      const parsedArray = parseArrayRandomizer(noteArg, { bt, br });
      if (parsedArray) {
        // Handle both single notes and chords in the array
        noteArray = parsedArray.filter(item => item.type === 'note' || item.type === 'chord');
        randomizeNote = noteArray.length > 0;
      }
    }
    
    // For direct chord or single note, check if it's valid
    const midiNote = isDirectChord ? null : noteTokenToMidi(noteArg);
    if (midiNote === null && !randomizeNote && !isDirectChord) continue;
    // Repeat syntax is already expanded at sequence level, so repeatCount is always 1 (already set above)
    // Use a more sophisticated approach to handle nested brackets in parameters
      const paramRegex = /\.(d|v|p|c|pm|pr|pmRange|prRange|nRange|vRange|pRange|dRange|nArp|dArp|vArp|pmArp|prArp)\((.*?)\)/g;
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
        
        const paramMatch = chunk.substring(dotPos + 1).match(/^(d|v|p|c|pm|pr|pmRange|prRange|nRange|vRange|pRange|dRange|nArp|dArp|vArp|pmArp|prArp)\(/);
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
            // Expand scale/chord items in note array if it exists
            if (noteArray) {
              const expandedArray = [];
              for (const item of noteArray) {
                if (item.type === 'scaleChord') {
                  // Expand scale/chord to notes within range
                  const scaleChordNotes = generateScaleChordNotes(item.value, minMidi, maxMidi);
                  expandedArray.push(...scaleChordNotes);
                } else {
                  expandedArray.push(item);
                }
              }
              noteArray = expandedArray;
              // Filter note array by range
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
        // Parse mute probability: pm(value), pm(r), or pm(r.o{...}) for array randomization
        const norm = raw.replace(/\s+/g, '').toLowerCase();
        if (norm === 'r') {
          randomizeMuteProbability = true;
        } else {
          const parsedArray = parseArrayRandomizer(raw, { bt, br });
          if (parsedArray) {
            muteProbabilityArray = parsedArray.filter(item => item.type === 'number');
            randomizeMuteProbability = muteProbabilityArray.length > 0;
          } else {
            const prob = parseFloat(raw);
            if (!isNaN(prob) && prob >= 0 && prob <= 1) {
              muteProbability = prob;
            }
          }
        }
      }
      if (key === 'pr') {
        // Parse remove probability: pr(value), pr(r), or pr(r.o{...}) for array randomization
        const norm = raw.replace(/\s+/g, '').toLowerCase();
        if (norm === 'r') {
          randomizeRemoveProbability = true;
        } else {
          const parsedArray = parseArrayRandomizer(raw, { bt, br });
          if (parsedArray) {
            removeProbabilityArray = parsedArray.filter(item => item.type === 'number');
            randomizeRemoveProbability = removeProbabilityArray.length > 0;
          } else {
            const prob = parseFloat(raw);
            if (!isNaN(prob) && prob >= 0 && prob <= 1) {
              removeProbability = prob;
            }
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
      if (key === 'nArp') {
        // Parse note arpeggiator mode: nArp(up), nArp(down), nArp(up-down), nArp(down-up), nArp(random)
        const mode = raw.toLowerCase().trim();
        if (mode === 'up' || mode === 'down' || mode === 'up-down' || mode === 'down-up' || mode === 'random') {
          nArpMode = mode === 'random' ? null : mode; // null means random
        }
      }
      if (key === 'dArp') {
        // Parse duration arpeggiator mode: dArp(up), dArp(down), dArp(up-down), dArp(down-up), dArp(random)
        const mode = raw.toLowerCase().trim();
        if (mode === 'up' || mode === 'down' || mode === 'up-down' || mode === 'down-up' || mode === 'random') {
          dArpMode = mode === 'random' ? null : mode; // null means random
        }
      }
      if (key === 'vArp') {
        // Parse velocity arpeggiator mode: vArp(up), vArp(down), vArp(up-down), vArp(down-up), vArp(random)
        const mode = raw.toLowerCase().trim();
        if (mode === 'up' || mode === 'down' || mode === 'up-down' || mode === 'down-up' || mode === 'random') {
          vArpMode = mode === 'random' ? null : mode; // null means random
        }
      }
      if (key === 'pmArp') {
        // Parse mute probability arpeggiator mode: pmArp(up), pmArp(down), pmArp(up-down), pmArp(down-up), pmArp(random)
        const mode = raw.toLowerCase().trim();
        if (mode === 'up' || mode === 'down' || mode === 'up-down' || mode === 'down-up' || mode === 'random') {
          pmArpMode = mode === 'random' ? null : mode; // null means random
        }
      }
      if (key === 'prArp') {
        // Parse remove probability arpeggiator mode: prArp(up), prArp(down), prArp(up-down), prArp(down-up), prArp(random)
        const mode = raw.toLowerCase().trim();
        if (mode === 'up' || mode === 'down' || mode === 'up-down' || mode === 'down-up' || mode === 'random') {
          prArpMode = mode === 'random' ? null : mode; // null means random
        }
      }
    }
    
    // Final expansion pass: expand any remaining scaleChord items in noteArray
    // This handles cases where nRange was parsed before noteArray, or if scale/chord is used without nRange
    if (noteArray && noteArray.some(item => item.type === 'scaleChord')) {
      // Use nRange if available, otherwise use default range (C1 to C8)
      const minMidi = nRange ? nRange[0] : 24; // C1
      const maxMidi = nRange ? nRange[1] : 108; // C8
      
      const expandedArray = [];
      for (const item of noteArray) {
        if (item.type === 'scaleChord') {
          // Expand scale/chord to notes within range
          const scaleChordNotes = generateScaleChordNotes(item.value, minMidi, maxMidi);
          expandedArray.push(...scaleChordNotes);
        } else {
          expandedArray.push(item);
        }
      }
      noteArray = expandedArray;
      
      // If nRange was set, filter by range
      if (nRange) {
        noteArray = filterArrayByRange(noteArray, nRange[0], nRange[1]);
      }
      
      randomizeNote = noteArray.length > 0;
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
    
    // Calculate duration for this chunk (used for both playback and cutoff calculation)
    // For "fit" type: calculate from weights
    // For "beat"/"bar" type: use explicit duration or default
    let chunkDurationPerRepeat = null;
    if (type === 'fit' && weights) {
      const weightedTotalForChunk = weights[idx] || 1;
      const perInstanceWeight = weightedTotalForChunk / repeatCount;
      chunkDurationPerRepeat = Math.max(1, Math.round(barDurationMs * (perInstanceWeight / totalWeight)));
    } else {
      // For beat/bar type, use explicit duration or default
      // We'll calculate the actual duration after randomization in the repeat loop
      // For cutoff, use the duration value or defaultDurationMs
      chunkDurationPerRepeat = (duration === null) ? defaultDurationMs : duration;
    }
    
    let useDuration = chunkDurationPerRepeat;
    // Apply mute probability: if random < muteProbability, set velocity to 0
    // Note-level mute probability OR sequence-level mute probability can mute the note
    // Apply arp ordering to arrays if arp mode is set (each parameter has its own mode)
    let orderedNoteArray = noteArray;
    let orderedVelocityArray = velocityArray;
    let orderedPanArray = panArray;
    let orderedDurationArray = durationArray;
    let orderedMuteProbabilityArray = muteProbabilityArray;
    let orderedRemoveProbabilityArray = removeProbabilityArray;
    
    if (nArpMode !== null && noteArray) {
      orderedNoteArray = orderArrayByArp(noteArray, nArpMode);
    }
    if (vArpMode !== null && velocityArray) {
      orderedVelocityArray = orderArrayByArp(velocityArray, vArpMode);
    }
    if (dArpMode !== null && durationArray) {
      orderedDurationArray = orderArrayByArp(durationArray, dArpMode);
    }
    if (pmArpMode !== null && muteProbabilityArray) {
      orderedMuteProbabilityArray = orderArrayByArp(muteProbabilityArray, pmArpMode);
    }
    if (prArpMode !== null && removeProbabilityArray) {
      orderedRemoveProbabilityArray = orderArrayByArp(removeProbabilityArray, prArpMode);
    }
    
    // Each repeat gets its own probability check and randomization
    for (let r = 0; r < repeatCount; r++) {
      // Generate random values for this repeat if needed
      // Determine which notes to play (can be a single note or a chord)
      let useMidiNotes = []; // Array of MIDI notes to play simultaneously
      let useVelocity = velocity;
      let useChannel = channel;
      let useMuteProbability = muteProbability;
      let useRemoveProbability = removeProbability;
      let useDurationValue = useDuration;
      
      // Handle direct chord: n(<c4,e4,g6>)
      if (isDirectChord && directChordNotes) {
        useMidiNotes = [...directChordNotes];
      }
      // Handle single note (non-randomized)
      else if (midiNote !== null) {
        useMidiNotes = [midiNote];
      }
      
      // Calculate arp position (chunk index * repeat count + repeat index)
      const currentArpPosition = idx * repeatCount + r;
      
      // Randomize remove probability (0-1) - must be done first as it can skip the note
      if (randomizeRemoveProbability) {
        if (orderedRemoveProbabilityArray && orderedRemoveProbabilityArray.length > 0) {
          // Use array-based selection: arp ordered or random
          if (prArpMode !== null) {
            const arpItem = getArpValue(orderedRemoveProbabilityArray, currentArpPosition);
            useRemoveProbability = arpItem ? Math.max(0, Math.min(1, arpItem.value)) : removeProbabilityArray[0].value;
          } else {
            const randomIndex = Math.floor(Math.random() * removeProbabilityArray.length);
            useRemoveProbability = Math.max(0, Math.min(1, removeProbabilityArray[randomIndex].value));
          }
        } else {
          // Use continuous randomization with range
          const random = Math.random();
          useRemoveProbability = prRange[0] + random * (prRange[1] - prRange[0]);
          useRemoveProbability = Math.max(0, Math.min(1, useRemoveProbability));
        }
      }
      
      // Apply remove probability: if random < useRemoveProbability, skip this note instance
      if (useRemoveProbability !== null && useRemoveProbability > 0) {
        const random = Math.random();
        if (random < useRemoveProbability) {
          continue; // Skip this note instance - it's removed
        }
      }
      
      // Randomize note (including chords)
      if (randomizeNote) {
        if (noteArray && noteArray.length > 0) {
          // Use array-based selection: arp ordered or random
          let selectedItem;
          if (nArpMode !== null && orderedNoteArray) {
            const arpItem = getArpValue(orderedNoteArray, currentArpPosition);
            selectedItem = arpItem || noteArray[0];
          } else {
            const randomIndex = Math.floor(Math.random() * noteArray.length);
            selectedItem = noteArray[randomIndex];
          }
          
          // Check if selected item is a chord or single note
          if (selectedItem.type === 'chord') {
            useMidiNotes = [...selectedItem.value]; // Array of MIDI notes
          } else {
            useMidiNotes = [selectedItem.value]; // Single MIDI note
          }
        } else {
          // Use continuous randomization with range
          // Use nRange if provided, otherwise use defaults
          const minMidi = nRange !== null ? nRange[0] : 24; // C1 default
          const maxMidi = nRange !== null ? nRange[1] : 108; // C8 default
          // Randomly select within the MIDI range
          const random = Math.random();
          const singleNote = Math.round(minMidi + random * (maxMidi - minMidi));
          useMidiNotes = [Math.max(0, Math.min(127, singleNote))];
        }
      }
      
      // Randomize velocity (0-127)
      if (randomizeVelocity) {
        if (orderedVelocityArray && orderedVelocityArray.length > 0) {
          // Use array-based selection: arp ordered or random
          let scaled;
          if (vArpMode !== null) {
            const arpItem = getArpValue(orderedVelocityArray, currentArpPosition);
            scaled = arpItem ? arpItem.value : velocityArray[0].value;
          } else {
            const randomIndex = Math.floor(Math.random() * velocityArray.length);
            scaled = velocityArray[randomIndex].value;
          }
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
        if (orderedPanArray && orderedPanArray.length > 0) {
          // Use array-based selection: random only (no arpeggiator for pan)
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
        if (orderedMuteProbabilityArray && orderedMuteProbabilityArray.length > 0) {
          // Use array-based selection: arp ordered or random
          if (pmArpMode !== null) {
            const arpItem = getArpValue(orderedMuteProbabilityArray, currentArpPosition);
            useMuteProbability = arpItem ? Math.max(0, Math.min(1, arpItem.value)) : muteProbabilityArray[0].value;
          } else {
            const randomIndex = Math.floor(Math.random() * muteProbabilityArray.length);
            useMuteProbability = Math.max(0, Math.min(1, muteProbabilityArray[randomIndex].value));
          }
        } else {
          // Use continuous randomization with range
          const random = Math.random();
          useMuteProbability = pmRange[0] + random * (pmRange[1] - pmRange[0]);
          useMuteProbability = Math.max(0, Math.min(1, useMuteProbability));
        }
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
          
          // Select from valid indices (arp ordered or random)
          if (validIndices.length > 0) {
            let selectedCanonicalIndex;
            if (dArpMode !== null && orderedDurationArray) {
              // Get the duration value from ordered array at current position
              const arpItem = getArpValue(orderedDurationArray, currentArpPosition);
              if (arpItem) {
                // Find the canonical index for this duration value
                const valueIndex = uniqueCanonical.findIndex(canon => Math.abs(canon.value - arpItem.value) <= 1);
                if (valueIndex !== -1 && validIndices.includes(valueIndex)) {
                  selectedCanonicalIndex = valueIndex;
                } else {
                  // Fallback to first valid index
                  selectedCanonicalIndex = validIndices[0];
                }
              } else {
                selectedCanonicalIndex = validIndices[0];
              }
            } else {
              const randomIndex = Math.floor(Math.random() * validIndices.length);
              selectedCanonicalIndex = validIndices[randomIndex];
            }
            useDurationValue = uniqueCanonical[selectedCanonicalIndex].value;
          } else if (arrayIndices.length > 0) {
            // If range filtering eliminated all, but we had array indices, use them without range
            // (This shouldn't happen with correct range, but safety fallback)
            let selectedCanonicalIndex;
            if (dArpMode !== null && orderedDurationArray) {
              const arpItem = getArpValue(orderedDurationArray, currentArpPosition);
              if (arpItem) {
                const valueIndex = uniqueCanonical.findIndex(canon => Math.abs(canon.value - arpItem.value) <= 1);
                selectedCanonicalIndex = valueIndex !== -1 && arrayIndices.includes(valueIndex) ? valueIndex : arrayIndices[0];
              } else {
                selectedCanonicalIndex = arrayIndices[0];
              }
            } else {
              const randomIndex = Math.floor(Math.random() * arrayIndices.length);
              selectedCanonicalIndex = arrayIndices[randomIndex];
            }
            useDurationValue = uniqueCanonical[selectedCanonicalIndex].value;
          } else if (durationArray.length > 0) {
            // If canonical matching failed, use array values directly
            if (dArpMode !== null && orderedDurationArray) {
              const arpItem = getArpValue(orderedDurationArray, currentArpPosition);
              useDurationValue = arpItem ? arpItem.value : durationArray[0].value;
            } else {
              const randomIndex = Math.floor(Math.random() * durationArray.length);
              useDurationValue = durationArray[randomIndex].value;
            }
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
      
      // Check cutoff: if note would exceed cutoff, truncate duration to end at cutoff
      let finalDuration = useDurationValue || useDuration || defaultDurationMs || bt;
      let shouldBreakAfterPlay = false;
      
      if (cutoffDurationMs !== null) {
        const remainingTime = cutoffDurationMs - cumulativeDurationMs;
        if (remainingTime <= 0) {
          // Already at or past cutoff, don't play and break
          break;
        }
        if (finalDuration > remainingTime) {
          // Would exceed cutoff, truncate duration to end exactly at cutoff
          finalDuration = remainingTime;
          shouldBreakAfterPlay = true;
        }
      }
      
      const useZeroBasedChannel = useChannel - 1;
      
      // Play all notes in the chord simultaneously (or single note)
      // All notes use the same velocity, duration, and channel settings
      if (useMidiNotes.length > 0) {
        const notePromises = useMidiNotes.map(note => 
          sendNote(note, useVelocity, finalDuration, useZeroBasedChannel)
        );
        await Promise.all(notePromises);
        
        // Update cumulative duration after playing (use actual duration used)
        cumulativeDurationMs += finalDuration;
        
        // If we truncated the note or reached/exceeded cutoff, stop processing
        if (shouldBreakAfterPlay || (cutoffDurationMs !== null && cumulativeDurationMs >= cutoffDurationMs)) {
          // Reached or exceeded cutoff, stop processing remaining chunks
          break;
        }
      }
    }
    
    // If cutoff was exceeded in the inner loop, break from outer loop
    if (cutoffDurationMs !== null && cumulativeDurationMs >= cutoffDurationMs) {
      break;
    }
  }
}

// Play multiple sequences in a cycle with per-block modifiers.
// Example: [n(60)^2 n(70)^3.d(/5) n(70).d(*4)].t(fit).c(2).co(2br) [n(60)^2].t(beat).c(3)
async function playTrack(cycleStr, tempoParam = null, signatureNumeratorParam = null, signatureDenominatorParam = null) {
  if (!cycleStr || typeof cycleStr !== 'string') return;
  
  // Capture global variables before parameter shadowing (using closure)
  const globalTempo = tempo;
  const globalSignatureNumerator = signatureNumerator;
  const globalSignatureDenominator = signatureDenominator;
  
  // Use provided parameters or fall back to server variables
  const useTempo = tempoParam !== null ? tempoParam : globalTempo;
  const useSignatureNumerator = signatureNumeratorParam !== null ? signatureNumeratorParam : globalSignatureNumerator;
  const useSignatureDenominator = signatureDenominatorParam !== null ? signatureDenominatorParam : globalSignatureDenominator;
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
    plays.push(playSequence(seq, type, cutOff, channelOverride, sequenceMuteProbability, useTempo, useSignatureNumerator, useSignatureDenominator));
  }
  if (plays.length > 0) await Promise.all(plays);
}

// Play a track in a cycle (repeatedly at bar intervals)
// Returns interval ID that can be cleared with clearInterval()
function playCycle(cycleStr, tempoParam = null, signatureNumeratorParam = null, signatureDenominatorParam = null) {
  if (!cycleStr || typeof cycleStr !== 'string') return null;
  
  // Capture global variables before parameter shadowing
  const globalTempo = tempo;
  const globalSignatureNumerator = signatureNumerator;
  const globalSignatureDenominator = signatureDenominator;
  
  // Use provided parameters or fall back to server variables
  const useTempo = tempoParam !== null ? tempoParam : globalTempo;
  const useSignatureNumerator = signatureNumeratorParam !== null ? signatureNumeratorParam : globalSignatureNumerator;
  const useSignatureDenominator = signatureDenominatorParam !== null ? signatureDenominatorParam : globalSignatureDenominator;
  
  // Calculate bar duration in milliseconds
  const beatsPerBar = useSignatureNumerator;
  const barDurationMs = (typeof useTempo === 'number' && useTempo > 0) ? (60000 / useTempo) * beatsPerBar : 500;
  
  // Call playTrack immediately, then set up interval
  playTrack(cycleStr, tempoParam, signatureNumeratorParam, signatureDenominatorParam);
  
  // Set up interval to call playTrack at bar duration intervals
  const intervalId = setInterval(() => {
    // Check if there's a pending update for this cycle by looking it up in activeCycle
    const cycleEntry = activeCycle.find(c => c.intervalId === intervalId);
    if (cycleEntry && cycleEntry.pendingUpdate) {
      const update = cycleEntry.pendingUpdate;
      // Clear this interval
      clearInterval(intervalId);
      // Start new cycle with updated parameters
      const newIntervalId = playCycle(
        update.cycleStr,
        update.tempoParam,
        update.signatureNumeratorParam,
        update.signatureDenominatorParam
      );
      // Update activeCycle entry
      cycleEntry.intervalId = newIntervalId;
      cycleEntry.function = () => playCycle(
        update.cycleStr,
        update.tempoParam,
        update.signatureNumeratorParam,
        update.signatureDenominatorParam
      );
      // Clear the pending update
      delete cycleEntry.pendingUpdate;
      return; // Exit without playing current cycle
    }
    // Normal play
    playTrack(cycleStr, tempoParam, signatureNumeratorParam, signatureDenominatorParam);
  }, barDurationMs);
  
  return intervalId;
}

// Example queue items - add to queue to play on next bar change
// Usage: queue.push(...exampleQueue);
const exampleQueue = [
  {
    id: 'track1',
    function: () => playTrack("[n(60)^2 n(65)^2].c(1)", 120, 4, 4)
  },
  {
    id: 'cycle1',
    function: () => playCycle("[n(70)^4].c(2)", 100, 4, 4)
  },
  {
    id: 'cycle2',
    function: () => playCycle("[n(r.o{<c4,e4,g4>,<f4,a4,c5>})^3.nArp(up)].c(3)", 80, 3, 4)
  }
];

// queue.push(...exampleQueue);

// Update an existing playCycle by id - waits for current interval to finish before switching
function updateCycleById(id, cycleStr, tempoParam = null, signatureNumeratorParam = null, signatureDenominatorParam = null) {
  if (!id || typeof id !== 'string') {
    console.log('[UPDATE CYCLE] Invalid id provided');
    return false;
  }
  
  // Find the cycle in activeCycle by id
  const existingIndex = activeCycle.findIndex(cycle => cycle.id === id);
  
  if (existingIndex === -1) {
    console.log(`[UPDATE CYCLE] Cycle with id '${id}' not found in activeCycle`);
    return false;
  }
  
  const cycleEntry = activeCycle[existingIndex];
  
  // Store pending update info on the cycle entry
  // This will be checked on the next interval tick (after current interval completes)
  cycleEntry.pendingUpdate = {
    cycleStr: cycleStr,
    tempoParam: tempoParam,
    signatureNumeratorParam: signatureNumeratorParam,
    signatureDenominatorParam: signatureDenominatorParam
  };
  
  console.log(`[UPDATE CYCLE] Update queued for cycle '${id}' - will apply after current interval completes`);
  return true;
}

// Clear a cycle by id - stops the interval and removes from activeCycle
function clearCycleById(id) {
  if (!id || typeof id !== 'string') {
    console.log('[CLEAR CYCLE] Invalid id provided');
    return false;
  }
  
  // Find the cycle in activeCycle by id
  const existingIndex = activeCycle.findIndex(cycle => cycle.id === id);
  
  if (existingIndex === -1) {
    console.log(`[CLEAR CYCLE] Cycle with id '${id}' not found in activeCycle`);
    return false;
  }
  
  const cycleEntry = activeCycle[existingIndex];
  
  // Clear the interval
  clearInterval(cycleEntry.intervalId);
  
  // Remove from activeCycle
  activeCycle.splice(existingIndex, 1);
  
  console.log(`[CLEAR CYCLE] Successfully cleared cycle with id '${id}'`);
  return true;
}

// Clear all active cycles - stops all intervals and clears activeCycle array
function clearAllCycles() {
  if (activeCycle.length === 0) {
    console.log('[CLEAR ALL CYCLES] No active cycles to clear');
    return 0;
  }
  
  // Count how many will be cleared
  const count = activeCycle.length;
  
  // Clear all intervals
  activeCycle.forEach(cycle => {
    if (cycle.intervalId) {
      clearInterval(cycle.intervalId);
    }
  });
  
  // Clear the activeCycle array (use length = 0 to preserve reference)
  activeCycle.length = 0;
  
  console.log(`[CLEAR ALL CYCLES] Successfully cleared ${count} active cycle(s)`);
  return count;
}

// Process queue on bar change - run queued tracks/cycles
function onBarChange() {
  
  // Process all items in queue (all items are removed as they're processed)
  while (queue.length > 0) {
    const item = queue.shift(); // Remove and get first item from queue
    
    if (item && item.function) {
      // Execute the function
      const result = item.function();
      console.log(`[QUEUE] Processing item id '${item.id}', result type: ${typeof result}, result:`, result);
      
      // If it's a playCycle, it will return a Timeout object (Node.js setInterval)
      // Cycles loop automatically via setInterval - no need to re-add to queue
      // If it's a playTrack, it returns a Promise (async function)
      // Tracks play once and don't loop
      // Check if result is a Timeout object (has _onTimeout property) or a number
      if (result !== null && result !== undefined && (typeof result === 'number' || (typeof result === 'object' && result._onTimeout))) {
        // This is a playCycle - check if id already exists in activeCycle
        const existingIndex = activeCycle.findIndex(cycle => cycle.id === item.id);
        if (existingIndex !== -1) {
          // If cycle with same id exists, clear the old interval and replace
          clearInterval(activeCycle[existingIndex].intervalId);
          activeCycle[existingIndex] = {
            id: item.id,
            function: item.function,
            intervalId: result
          };
          console.log(`[QUEUE] Replaced cycle '${item.id}' in activeCycle`);
        } else {
          // Add new cycle to activeCycle (id is unique)
          // Cycle will loop by itself via setInterval
          activeCycle.push({
            id: item.id,
            function: item.function,
            intervalId: result
          });
          console.log(`[QUEUE] Added cycle '${item.id}' to activeCycle with intervalId ${result}`);
        }
      } else {
        console.log(`[QUEUE] Item '${item.id}' result is not a number (likely a track that plays once)`);
      }
      // playTrack runs once and completes - no special handling needed
    }
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


    // Calculate total beats elapsed
    const totalBeats = currentSongTime ;

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
        onBarChange();
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

  // Handle incoming messages from client
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('[WS] Received action:', data.action, data);
      
      switch (data.action) {
        case 'playTrack':
          playTrack(
            data.cycleStr || "[n(60)^2 n(65)^2].c(1)",
            data.tempo || null,
            data.signatureNumerator || null,
            data.signatureDenominator || null
          );
          console.log('[WS] playTrack called');
          break;
          
        case 'playCycle':
          const playCycleId = data.id || 'cycle_' + Date.now();
          const playCycleIntervalId = playCycle(
            data.cycleStr || "[n(70)^4].c(2)",
            data.tempo || null,
            data.signatureNumerator || null,
            data.signatureDenominator || null
          );
          if (playCycleIntervalId !== null) {
            // Check if cycle with same id already exists
            const existingIndex = activeCycle.findIndex(cycle => cycle.id === playCycleId);
            if (existingIndex !== -1) {
              // Replace existing cycle
              clearInterval(activeCycle[existingIndex].intervalId);
              activeCycle[existingIndex] = {
                id: playCycleId,
                function: () => playCycle(
                  data.cycleStr || "[n(70)^4].c(2)",
                  data.tempo || null,
                  data.signatureNumerator || null,
                  data.signatureDenominator || null
                ),
                intervalId: playCycleIntervalId
              };
            } else {
              // Add new cycle to activeCycle
              activeCycle.push({
                id: playCycleId,
                function: () => playCycle(
                  data.cycleStr || "[n(70)^4].c(2)",
                  data.tempo || null,
                  data.signatureNumerator || null,
                  data.signatureDenominator || null
                ),
                intervalId: playCycleIntervalId
              });
            }
            console.log(`[WS] playCycle called - added to activeCycle with id '${playCycleId}'`);
          } else {
            console.log('[WS] playCycle failed to start');
          }
          break;
          
        case 'addTrackToQueue':
          const trackId = data.id || 'track_' + Date.now();
          queue.push({
            id: trackId,
            function: () => playTrack(
              data.cycleStr || "[n(60)^2 n(65)^2].c(1)",
              data.tempo || null,
              data.signatureNumerator || null,
              data.signatureDenominator || null
            )
          });
          console.log(`[WS] Added track '${trackId}' to queue`);
          break;
          
        case 'addCycleToQueue':
          const cycleId = data.id || 'cycle_' + Date.now();
          queue.push({
            id: cycleId,
            function: () => playCycle(
              data.cycleStr || "[n(70)^4].c(2)",
              data.tempo || null,
              data.signatureNumerator || null,
              data.signatureDenominator || null
            )
          });
          console.log(`[WS] Added cycle '${cycleId}' to queue`);
          break;
          
        case 'updateCycleById':
          updateCycleById(
            data.id,
            data.cycleStr || "[n(70)^4].c(2)",
            data.tempo || null,
            data.signatureNumerator || null,
            data.signatureDenominator || null
          );
          console.log(`[WS] Update cycle '${data.id}' requested`);
          break;
          
        case 'clearCycleById':
          if (!data.id) {
            console.log('[WS] clearCycleById requires an id');
            break;
          }
          const cleared = clearCycleById(data.id);
          console.log(`[WS] Clear cycle '${data.id}' requested - ${cleared ? 'success' : 'failed'}`);
          break;
          
        case 'clearAllCycles':
          const clearedCount = clearAllCycles();
          console.log(`[WS] Clear all cycles requested - cleared ${clearedCount} cycle(s)`);
          break;
          
        default:
          console.log(`[WS] Unknown action: ${data.action}`);
      }
    } catch (error) {
      console.error('[WS] Error processing message:', error);
    }
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
  closeMidi();
  process.exit(0);
});

