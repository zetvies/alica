# ALiCA Architecture

## Overview

ALiCA (Ableton Live Coding Automation) is a live coding system that connects to Ableton Live via OSC and sends MIDI sequences using a domain-specific language.

## System Architecture

```
┌─────────────────┐
│  Ableton Live  │
│   (Max4Live)   │
└────────┬────────┘
         │ OSC (UDP 4254)
         │ - /tempo
         │ - /signature_numerator
         │ - /signature_denominator
         │ - /current_song_time
         ▼
┌─────────────────────────────────┐
│      ALiCA Server (Node.js)     │
│  ┌──────────────────────────┐  │
│  │   OSC Handler (UDP)       │  │
│  │   - Receives tempo/sig    │  │
│  │   - Calculates bar/beat  │  │
│  └──────────────────────────┘  │
│  ┌──────────────────────────┐  │
│  │  Sequence Parser         │  │
│  │  - Parses ALiCA syntax   │  │
│  │  - Expands scales/chords │  │
│  └──────────────────────────┘  │
│  ┌──────────────────────────┐  │
│  │  Sequence Player         │  │
│  │  - Executes sequences    │  │
│  │  - Handles randomization │  │
│  └──────────────────────────┘  │
│  ┌──────────────────────────┐  │
│  │  MIDI Handler            │  │
│  │  - Sends MIDI notes      │  │
│  └──────────────────────────┘  │
│  ┌──────────────────────────┐  │
│  │  WebSocket Server        │  │
│  │  - Broadcasts beat data  │  │
│  └──────────────────────────┘  │
└─────────┬───────────────────────┘
          │
          ├───► MIDI Output (Virtual Loop Back)
          │
          └───► WebSocket (WS 4254)
                   │
                   ▼
          ┌─────────────────┐
          │  Web Interface   │
          │  (p5.js + WS)    │
          │  - Receives beats│
          │  - Can send MIDI │
          └─────────────────┘
```

## Component Details

### 1. OSC Handler

**File:** `server.js` (UDP server section)

**Responsibilities:**
- Listens on UDP port 4254 for OSC messages
- Receives tempo, time signature, and song time updates
- Calculates current bar and beat
- Triggers sequence playback on bar changes

**Key Variables:**
- `tempo`: Current BPM
- `signatureNumerator`: Time signature numerator (e.g., 4 for 4/4)
- `signatureDenominator`: Time signature denominator (e.g., 4 for 4/4)
- `currentSongTime`: Current song position in beats
- `currentBar`: Current bar number (1-indexed)
- `currentBeat`: Current beat string (e.g., "1/4")

### 2. Music Theory Module

**File:** `src/modules/musicTheory.js`

**Functions:**
- `noteTokenToMidi(value)`: Converts note tokens to MIDI numbers
- `scaleToMidiNotes(root, scaleName, octave)`: Generates scale notes
- `chordToMidiNotes(root, quality, octave)`: Generates chord notes
- `generateScaleChordNotes(scaleChordStr, minMidi, maxMidi)`: Generates notes within range

**Data:**
- `SCALE_DEFINITIONS`: Scale interval definitions
- `CHORD_QUALITIES`: Chord interval definitions

### 3. Sequence Parser

**File:** `server.js` (parsing functions)

**Functions:**
- `parseArrayRandomizer(str, context)`: Parses `r.o{...}` syntax
- `expandScale(scaleStr)`: Expands scale syntax to note sequence
- `expandChord(chordStr)`: Expands chord syntax to note sequence
- `filterArrayByRange(array, min, max)`: Filters arrays by range
- `orderArrayByArp(array, mode)`: Orders arrays for arpeggiators
- `getArpValue(orderedArray, position)`: Gets value from arp-ordered array

**Syntax Handled:**
- Note tokens: `c4`, `c#3`, `60`
- Array randomizers: `r.o{...}`
- Scales: `scale(c-ionian)`
- Chords: `chord(c-maj7)`
- Duration tokens: `bt`, `bt/2`, `bt*2`

### 4. Sequence Player

**File:** `server.js` (playSequence, playTrack functions)

**Functions:**
- `playSequence(sequence, type, cutOff, channelOverride, sequenceMuteProbability)`: Plays a sequence
- `playTrack(cycleStr)`: Plays multiple sequences in a cycle

**Types:**
- `fit`: Fit all notes evenly into one bar
- `beat`: Each note takes one beat
- `bar`: Each note takes one bar

**Features:**
- Repeat syntax: `n(60)^4`
- Weighted durations: `.d(*2)`, `.d(/4)`
- Randomization: `r`, `r.o{...}`
- Probability: `.pm(...)`, `.pr(...)`
- Arpeggiators: `.nArp(...)`, `.dArp(...)`, `.vArp(...)`, `.pArp(...)` (independent per parameter)
- Ranges: `.nRange(...)`, `.vRange(...)`, `.pRange(...)`, `.dRange(...)`

### 5. MIDI Handler

**File:** `src/modules/midiHandler.js`

**Functions:**
- `initializeMidi()`: Initializes MIDI output
- `sendNote(note, velocity, duration, channel)`: Sends MIDI note
- `closeMidi()`: Closes MIDI output

**MIDI Output:**
- Uses `easymidi` library
- Default output: "Virtual Loop Back"
- Sends note on/off messages

### 6. Web Interface

**Files:** `index.html`, `sketch.js`

**Functionality:**
- p5.js sketch
- Connects to WebSocket server
- Receives beat/bar updates
- Can send MIDI via WebMIDI API

## Data Flow

### Sequence Execution Flow

```
1. Bar change detected
   │
   ▼
2. playTrack() called with ALiCA sequence string
   │
   ▼
3. Sequence parsed into chunks (note + parameters)
   │
   ▼
4. For each chunk:
   ├─► Expand scale/chord syntax
   ├─► Parse parameters (d, v, c, p, etc.)
   ├─► Handle randomization (r, r.o{...})
   ├─► Apply ranges (nRange, vRange, etc.)
   ├─► Apply arpeggiator ordering
   └─► Apply probability (pm, pr)
   │
   ▼
5. Calculate timing (fit/beat/bar)
   │
   ▼
6. Send MIDI notes via sendNote()
   │
   ▼
7. Wait for duration, then send note off
```

### OSC Data Flow

```
Ableton Live
   │
   ├─► /tempo ──────────────► tempo variable
   ├─► /signature_numerator ─► signatureNumerator variable
   ├─► /signature_denominator ─► signatureDenominator variable
   └─► /current_song_time ────► currentSongTime variable
                                   │
                                   ▼
                              calculateBarAndBeat()
                                   │
                                   ▼
                              Bar change?
                                   │
                                   ▼
                              playTrack(...)
```

## Sequence Syntax Processing

### Parsing Order

1. **Preprocessing**: Extract `nRange` if present
2. **Scale/Chord Expansion**: Expand `scale(...)` and `chord(...)` inside `r.o{...}`
3. **Standalone Expansion**: Expand `scale(...)` and `chord(...)` in sequence
4. **Repeat Expansion**: Expand `^N` syntax
5. **Chunk Matching**: Split into note chunks with parameters
6. **Parameter Parsing**: Parse each parameter (d, v, c, p, etc.)
7. **Array Processing**: Handle `r.o{...}` arrays
8. **Range Filtering**: Apply ranges (nRange, vRange, etc.)
9. **Arpeggiator Ordering**: Order arrays if arp mode set
10. **Execution**: Send MIDI notes with timing

## Timing Calculation

### Type: "fit"
- Default duration: `ev = barDurationMs / numNotes`
- Notes are evenly distributed across one bar
- Duration modifiers (`.d(*f)`, `.d(/f)`) act as weights

### Type: "beat"
- Default duration: `bt = barDurationMs / beatsPerBar`
- Each note takes one beat by default
- Duration tokens (`bt`, `br`, etc.) are allowed

### Type: "bar"
- Default duration: `br = barDurationMs`
- Each note takes one bar by default

## Randomization Strategies

### Continuous Random (`r`)
- Generates random value in range
- For notes: Uses `nRange` or defaults (C1-C8)
- For velocity: Uses `vRange` or defaults (0-127)
- For pan: Uses `pRange` or defaults (0-1)
- For duration: Uses `dRange` or defaults (br/32 to br)

### Array-Based Random (`r.o{...}`)
- Selects randomly from array
- Can be ordered with `.nArp(...)`, `.dArp(...)`, `.vArp(...)`, or `.pArp(...)` (each parameter independently)
- Supports notes, velocities, pans, durations
- Can contain scale/chord syntax

## Future Improvements

1. **Modularization**: Further split `server.js` into smaller modules
2. **API Endpoints**: REST API for sending sequences
3. **Sequence Editor**: Web-based sequence editor
4. **Preset System**: Save/load sequence presets
5. **Performance Optimization**: Optimize parsing and execution
6. **Error Handling**: Better error messages and validation
7. **Testing**: Unit tests for parsing and execution

