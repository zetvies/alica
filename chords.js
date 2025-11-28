// Chord Dictionary and Music Theory Functions for Chord Recommendations

// Note names for root notes (sharps)
const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Note names for root notes (flats)
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Combined note names (prefer sharps, but include flats for completeness)
const NOTE_NAMES = [...NOTE_NAMES_SHARP, 'Db', 'Eb', 'Gb', 'Ab', 'Bb'].filter((note, index, self) => self.indexOf(note) === index);

// Chord quality definitions - intervals relative to root (in semitones)
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

// Get chord notes as semitones (normalized to 0-11) - defined early for use in dictionary generation
// If bass is specified, it represents a slash chord (chord with different bass note)
function getChordNotes(root, quality, bass = null) {
  const rootSemitone = noteToSemitone(root);
  if (rootSemitone === null) return null;
  
  const intervals = CHORD_QUALITIES[quality];
  if (!intervals) return null;
  
  let chordNotes = intervals.map(interval => (rootSemitone + interval) % 12);
  
  // For slash chords, the bass note is already in the chord, so we just return the notes
  // The bass note will be the lowest note when arranged
  if (bass !== null) {
    const bassSemitone = noteToSemitone(bass);
    if (bassSemitone !== null && !chordNotes.includes(bassSemitone)) {
      // If bass note is not in chord, add it (for extended slash chords)
      chordNotes.push(bassSemitone);
    }
  }
  
  return chordNotes;
}

// Helper function to compare two note sets (normalized semitones)
function noteSetsEqual(notes1, notes2) {
  if (!notes1 || !notes2) return false;
  const set1 = new Set(notes1.sort((a, b) => a - b));
  const set2 = new Set(notes2.sort((a, b) => a - b));
  if (set1.size !== set2.size) return false;
  for (const note of set1) {
    if (!set2.has(note)) return false;
  }
  return true;
}

// Chord dictionary - all possible chords
const chordDictionary = [];

// Generate all chords for the dictionary (basic chords)
// Use only sharp roots to avoid duplicates
NOTE_NAMES_SHARP.forEach(root => {
  Object.keys(CHORD_QUALITIES).forEach(quality => {
    const chordNotes = getChordNotes(root, quality);
    if (chordNotes) {
      chordDictionary.push({
        root: root,
        quality: quality,
        bass: null, // null means root is bass (no slash)
        inversion: 0, // 0 = root position, 1 = first inversion, etc.
        name: `${root}-${quality}`,
        noteSet: chordNotes // Store note set for duplicate detection
      });
    }
  });
});

// Generate slash chords (chord with different bass note)
// For each chord, add versions with other chord notes as bass
NOTE_NAMES_SHARP.forEach(root => {
  Object.keys(CHORD_QUALITIES).forEach(quality => {
    const rootChordNotes = getChordNotes(root, quality);
    if (rootChordNotes && rootChordNotes.length > 0) {
      // Add slash chord versions with each note as bass (except root)
      rootChordNotes.forEach((bassSemitone, index) => {
        if (index > 0) { // Skip root (index 0)
          // Use sharp version for consistency
          const bassNoteSharp = NOTE_NAMES_SHARP[bassSemitone % 12];
          const slashChordNotes = getChordNotes(root, quality, bassNoteSharp);
          
          // Only add if the note set is different from root position
          if (slashChordNotes && !noteSetsEqual(slashChordNotes, rootChordNotes)) {
            chordDictionary.push({
              root: root,
              quality: quality,
              bass: bassNoteSharp,
              inversion: index, // Inversion number
              name: `${root}-${quality}/${bassNoteSharp}`,
              noteSet: slashChordNotes
            });
          }
        }
      });
    }
  });
});

// Remove duplicate chords (same note set, different root names)
// Keep the first occurrence (sharp version)
const seenNoteSets = new Map();
const uniqueChords = [];
chordDictionary.forEach(chord => {
  const noteSetKey = chord.noteSet.sort((a, b) => a - b).join(',');
  if (!seenNoteSets.has(noteSetKey)) {
    seenNoteSets.set(noteSetKey, true);
    uniqueChords.push(chord);
  }
});

// Replace chordDictionary with unique chords
chordDictionary.length = 0;
chordDictionary.push(...uniqueChords);

// Convert note name to semitone (C=0, C#=1, D=2, etc.)
function noteToSemitone(note) {
  const noteMap = {
    'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
    'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
  };
  return noteMap[note] !== undefined ? noteMap[note] : null;
}

// Convert semitone to note name
function semitoneToNote(semitone) {
  return NOTE_NAMES_SHARP[semitone % 12];
}

// Calculate similarity between two chords (0-1, where 1 is identical)
function calculateChordSimilarity(chord1, chord2) {
  const bass1 = chord1.bass || null;
  const bass2 = chord2.bass || null;
  const notes1 = getChordNotes(chord1.root, chord1.quality, bass1);
  const notes2 = getChordNotes(chord2.root, chord2.quality, bass2);
  
  if (!notes1 || !notes2) return 0;
  
  // Create sets for comparison
  const set1 = new Set(notes1);
  const set2 = new Set(notes2);
  
  // Calculate Jaccard similarity (intersection / union)
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  if (union.size === 0) return 0;
  
  return intersection.size / union.size;
}

// Find similar chords to a given chord
function findSimilarChords(targetChord, minSimilarity = 0, maxSimilarity = 1) {
  const targetBass = targetChord.bass || null;
  const targetNotes = getChordNotes(targetChord.root, targetChord.quality, targetBass);
  if (!targetNotes) return [];
  
  const similarities = chordDictionary.map(chord => {
    const similarity = calculateChordSimilarity(targetChord, chord);
    return {
      chord: chord,
      similarity: similarity
    };
  });
  
  // Filter by similarity range and sort by similarity (descending)
  return similarities
    .filter(item => item.similarity >= minSimilarity && item.similarity <= maxSimilarity)
    .sort((a, b) => b.similarity - a.similarity);
}

// Get scale notes from a chord (returns the scale that fits the chord)
function getScaleNotesFromChord(chord) {
  const chordNotes = getChordNotes(chord.root, chord.quality);
  if (!chordNotes) return null;
  
  // For simplicity, return the chord notes as the scale
  // In a more sophisticated implementation, this could return the full scale
  return chordNotes.map(semitone => semitoneToNote(semitone));
}

// Export for use in HTML
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    chordDictionary,
    CHORD_QUALITIES,
    NOTE_NAMES,
    getChordNotes,
    calculateChordSimilarity,
    findSimilarChords,
    getScaleNotesFromChord,
    noteToSemitone,
    semitoneToNote
  };
}

