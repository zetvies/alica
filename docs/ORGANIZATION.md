# ALiCA Code Organization

## Summary

This document outlines the organization and structure improvements made to the ALiCA project.

## Changes Made

### 1. Project Branding

- ✅ Updated `package.json`:
  - Name: `alica`
  - Description: "Ableton Live Coding Automation - A live coding language for sequencing in Ableton Live"
  - Main entry: `src/server.js`
  - Updated keywords
  
- ✅ Updated `index.html`:
  - Title: "ALiCA - Ableton Live Coding Automation"

### 2. Directory Structure

Created organized directory structure:

```
.
├── docs/
│   ├── SYNTAX.md          # Complete syntax documentation
│   ├── ARCHITECTURE.md    # System architecture overview
│   └── ORGANIZATION.md    # This file
├── src/
│   └── modules/
│       ├── musicTheory.js # Music theory utilities (scales, chords, notes)
│       └── midiHandler.js # MIDI output functions
├── server.js              # Main server (to be migrated to src/server.js)
├── index.html             # Web interface
├── sketch.js              # p5.js sketch
└── package.json           # Project configuration
```

### 3. Module Organization

#### `src/modules/musicTheory.js`

Extracted music theory functions:
- `noteTokenToMidi(value)`: Converts note tokens to MIDI numbers
- `scaleToMidiNotes(root, scaleName, octave)`: Generates scale notes
- `chordToMidiNotes(root, quality, octave)`: Generates chord notes
- `generateScaleChordNotes(scaleChordStr, minMidi, maxMidi)`: Generates notes within range
- `SCALE_DEFINITIONS`: 30+ scale definitions
- `CHORD_QUALITIES`: 40+ chord quality definitions

#### `src/modules/midiHandler.js`

Extracted MIDI functionality:
- `initializeMidi()`: Initializes MIDI output
- `sendNote(note, velocity, duration, channel)`: Sends MIDI note
- `closeMidi()`: Closes MIDI output

### 4. Documentation

#### `docs/SYNTAX.md`

Comprehensive syntax documentation including:
- Basic note syntax
- Note parameters (duration, velocity, channel, pan)
- Randomization (continuous and array-based)
- Scales and chords
- Sequences and cycles
- Duration tokens
- Arpeggiators
- Probability modifiers
- Examples

#### `docs/ARCHITECTURE.md`

System architecture documentation including:
- Component overview
- Data flow diagrams
- Sequence execution flow
- OSC data flow
- Timing calculations
- Randomization strategies

#### `README.md`

Updated with:
- ALiCA branding
- Feature overview
- Quick start guide
- Syntax overview
- Project structure
- Example sequences
- Configuration options

### 5. Remaining Organization Tasks

The following components remain in `server.js` and can be further modularized in the future:

**Sequence Parser Functions:**
- `parseArrayRandomizer()` - Parses `r.o{...}` syntax
- `expandScale()` - Expands scale syntax
- `expandChord()` - Expands chord syntax
- `filterArrayByRange()` - Filters arrays by range
- `orderArrayByArp()` - Orders arrays for arpeggiators
- `getArpValue()` - Gets value from arp-ordered array
- `extractParameterValue()` - Extracts parameter values

**Sequence Player Functions:**
- `playSequence()` - Plays a sequence
- `playTrack()` - Plays multiple sequences in a cycle

**OSC Handler:**
- UDP server setup
- OSC message handlers
- Bar/beat calculation
- Sequence trigger logic

**Future Module Suggestions:**
- `src/modules/sequenceParser.js` - All parsing utilities
- `src/modules/sequencePlayer.js` - All playback logic
- `src/oscHandler.js` - OSC reception and beat calculation

## Benefits of Current Organization

1. **Separation of Concerns**: Music theory and MIDI handling are now isolated modules
2. **Documentation**: Comprehensive syntax and architecture docs
3. **Maintainability**: Clear structure for future development
4. **Discoverability**: Well-documented API and syntax
5. **Branding**: Consistent ALiCA identity throughout

## Migration Path

To complete the modularization:

1. **Move `server.js` to `src/server.js`**:
   ```bash
   mv server.js src/server.js
   ```

2. **Update imports**:
   ```javascript
   const { noteTokenToMidi, generateScaleChordNotes } = require('./modules/musicTheory');
   const { initializeMidi, sendNote, closeMidi } = require('./modules/midiHandler');
   ```

3. **Extract parser module**:
   - Create `src/modules/sequenceParser.js`
   - Move parsing functions
   - Update imports in `server.js`

4. **Extract player module**:
   - Create `src/modules/sequencePlayer.js`
   - Move playback functions
   - Update imports in `server.js`

5. **Extract OSC handler**:
   - Create `src/oscHandler.js`
   - Move OSC server setup and handlers
   - Update imports in `server.js`

## Notes

- The current `server.js` remains functional and can continue to work as-is
- Modularization can be done incrementally without breaking functionality
- All documentation is complete and ready for use
- Module structure follows Node.js CommonJS conventions

