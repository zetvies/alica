/**
 * ALiCA - Music Theory Module
 * Provides utilities for note parsing, scale and chord generation
 */

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
  'pentatonicMajor': [0, 2, 4, 7, 9],
  'pentatonicMinor': [0, 3, 5, 7, 10],
  'pentatonicBlues': [0, 3, 5, 6, 7, 10],
  
  // Japanese scales
  'iwato': [0, 1, 5, 6, 10],
  'in': [0, 1, 5, 7, 10],  // also known as insen
  'insen': [0, 1, 5, 7, 10],
  'yo': [0, 2, 5, 7, 9],
  
  // Blues
  'bluesMajor': [0, 2, 3, 4, 7, 9],
  'bluesMinor': [0, 3, 5, 6, 7, 10],
  
  // Harmonic/Melodic
  'harmonicMinor': [0, 2, 3, 5, 7, 8, 11],
  'melodicMinor': [0, 2, 3, 5, 7, 9, 11],
  'double-harmonic': [0, 1, 4, 5, 7, 8, 11], // Byzantine/Flamenco
  
  // Synthetic
  'whole-tone': [0, 2, 4, 6, 8, 10],
  'diminished': [0, 1, 3, 4, 6, 7, 9, 10], // octatonic half-whole
  'augmented': [0, 3, 4, 7, 8, 11],
  
  // Exotic
  'enigmatic': [0, 1, 4, 6, 8, 10, 11],
  'neapolitan': [0, 1, 3, 5, 7, 8, 10],
  'hungarianMinor': [0, 2, 3, 6, 7, 8, 11],
  'persian': [0, 1, 4, 5, 6, 8, 11],
  'arabic': [0, 1, 4, 5, 7, 8, 10]
};

// Case-insensitive lookup for scale definitions
function getScaleIntervals(scaleName) {
  if (!scaleName || typeof scaleName !== 'string') return undefined;
  
  // Try direct lookup first (for exact matches)
  if (SCALE_DEFINITIONS[scaleName]) {
    return SCALE_DEFINITIONS[scaleName];
  }
  
  // Try case-insensitive lookup
  const scaleNameLower = scaleName.toLowerCase();
  for (const key in SCALE_DEFINITIONS) {
    if (key.toLowerCase() === scaleNameLower) {
      return SCALE_DEFINITIONS[key];
    }
  }
  
  return undefined;
}

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
  
  let scaleKey = scaleName;
  // Convenience aliases (case-insensitive)
  const scaleKeyLower = scaleKey.toLowerCase();
  if (scaleKeyLower === 'major') scaleKey = 'ionian';
  else if (scaleKeyLower === 'minor') scaleKey = 'aeolian';
  
  const intervals = getScaleIntervals(scaleKey);
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

// Generate scale or chord notes within a MIDI range
function generateScaleChordNotes(scaleChordStr, minMidi, maxMidi) {
  if (!scaleChordStr || typeof scaleChordStr !== 'string') return [];
  
  const scaleChordLower = scaleChordStr.toLowerCase().trim();
  
  // Parse scale(root-mode).q(quality) or scale(root-mode)
  let root = null;
  let scaleName = null;
  let quality = null;
  let intervals = null;
  
  if (scaleChordLower.startsWith('scale(')) {
    // Find matching closing parenthesis for scale(
    let parenCount = 1;
    let i = 6; // "scale(".length
    let scaleArgsEnd = -1;
    while (i < scaleChordLower.length && parenCount > 0) {
      if (scaleChordLower[i] === '(') parenCount++;
      else if (scaleChordLower[i] === ')') parenCount--;
      i++;
    }
    if (parenCount === 0) {
      scaleArgsEnd = i - 1;
      const args = scaleChordLower.substring(6, scaleArgsEnd); // Extract content inside scale(...)
      
      // Check for optional .q(...) modifier
      let qualityPart = null;
      if (scaleChordLower.length > scaleArgsEnd + 1 && scaleChordLower.substring(scaleArgsEnd + 1).startsWith('.q(')) {
        let qParenCount = 1;
        let qStart = scaleArgsEnd + 4; // ".q(".length after scale(...)
        let qEnd = -1;
        for (let j = qStart; j < scaleChordLower.length; j++) {
          if (scaleChordLower[j] === '(') qParenCount++;
          else if (scaleChordLower[j] === ')') {
            qParenCount--;
            if (qParenCount === 0) {
              qEnd = j;
              break;
            }
          }
        }
        if (qEnd !== -1) {
          qualityPart = scaleChordLower.substring(qStart, qEnd);
        }
      }
      
      const parts = args.split('-');
      if (parts.length === 2) {
        root = parts[0].trim();
        scaleName = parts[1].trim();
        quality = qualityPart ? qualityPart.trim() : null;
        
        // Get scale intervals (case-insensitive)
        const scaleNameLower = scaleName.toLowerCase();
        if (scaleNameLower === 'major') scaleName = 'ionian';
        else if (scaleNameLower === 'minor') scaleName = 'aeolian';
        intervals = getScaleIntervals(scaleName);
        
        // If quality specified, use chord intervals instead
        if (quality && CHORD_QUALITIES[quality]) {
          intervals = CHORD_QUALITIES[quality];
        }
      }
    }
  } else if (scaleChordLower.startsWith('chord(')) {
    // Find matching closing parenthesis for chord(
    let parenCount = 1;
    let i = 6; // "chord(".length
    let chordArgsEnd = -1;
    while (i < scaleChordLower.length && parenCount > 0) {
      if (scaleChordLower[i] === '(') parenCount++;
      else if (scaleChordLower[i] === ')') parenCount--;
      i++;
    }
    if (parenCount === 0) {
      chordArgsEnd = i - 1;
      const args = scaleChordLower.substring(6, chordArgsEnd); // Extract content inside chord(...)
      
      const parts = args.split('-');
      if (parts.length === 2) {
        root = parts[0].trim();
        quality = parts[1].trim().toLowerCase();
        intervals = CHORD_QUALITIES[quality];
      }
    }
  }
  
  if (!root || !intervals) return [];
  
  // Find the closest root note to the minMidi (first note in range)
  // Root can be like "c", "c#", "cb", etc.
  const baseMap = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  let rootLetter = root[0].toLowerCase();
  let accidental = '';
  if (root.length > 1 && (root[1] === '#' || root[1] === 'b')) {
    accidental = root[1];
    rootLetter = root.substring(0, 2).toLowerCase();
  }
  
  if (!(rootLetter[0] in baseMap)) return [];
  
  let rootSemitone = baseMap[rootLetter[0]];
  if (accidental === '#') rootSemitone += 1;
  if (accidental === 'b') rootSemitone -= 1;
  
  // Find the octave that puts the root closest to minMidi
  // Calculate which octave (0-10) would have this root note closest to minMidi
  let closestRootMidi = null;
  let bestDiff = Infinity;
  
  for (let octave = 0; octave <= 10; octave++) {
    const rootMidi = (octave + 1) * 12 + rootSemitone;
    const diff = Math.abs(rootMidi - minMidi);
    if (diff < bestDiff) {
      bestDiff = diff;
      closestRootMidi = rootMidi;
    }
  }
  
  if (closestRootMidi === null) return [];
  
  // Generate all notes from intervals within the range [minMidi, maxMidi]
  const notes = [];
  
  // Generate notes across multiple octaves
  for (let octaveOffset = -2; octaveOffset <= 2; octaveOffset++) {
    const baseRoot = closestRootMidi + (octaveOffset * 12);
    
    for (const interval of intervals) {
      const noteMidi = baseRoot + interval;
      if (noteMidi >= minMidi && noteMidi <= maxMidi && noteMidi >= 0 && noteMidi <= 127) {
        // Avoid duplicates
        if (!notes.find(n => n.value === noteMidi)) {
          notes.push({ type: 'note', value: noteMidi });
        }
      }
    }
  }
  
  // Sort by MIDI value
  notes.sort((a, b) => a.value - b.value);
  
  return notes;
}

module.exports = {
  noteTokenToMidi,
  SCALE_DEFINITIONS,
  CHORD_QUALITIES,
  scaleToMidiNotes,
  chordToMidiNotes,
  generateScaleChordNotes,
  getScaleIntervals
};

