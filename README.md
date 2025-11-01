# ALiCA

**Ableton Live Coding Automation**

ALiCA is a powerful live coding system for Ableton Live that provides a domain-specific language for sequencing MIDI notes with advanced randomization, scale/chord generation, and probability controls.

## Features

- 🎹 **Musical Syntax**: Intuitive note, scale, and chord notation
- 🎲 **Advanced Randomization**: Array-based and continuous random selection
- 🎚️ **Parameter Control**: Velocity, pan, channel, duration, and more
- 🎵 **Scale & Chord Generation**: Support for 30+ scales and 40+ chord qualities
- 🔄 **Arpeggiators**: Multiple arpeggio patterns (up, down, up-down, down-up)
- 📊 **Probability Modifiers**: Mute and remove probability controls
- ⚡ **Real-time OSC**: Synchronized with Ableton Live tempo and time signature
- 🔌 **MIDI Output**: Direct MIDI communication with Ableton Live

## Installation

```bash
npm install
```

## Quick Start

### 1. Start the Server

```bash
npm run dev
```

The server will start on `http://localhost:4254`

### 2. Configure Ableton Live/Max4Live

Set up OSC output to send the following messages to `localhost:4254`:

- `/tempo` - Current BPM (float)
- `/signature_numerator` - Time signature numerator (e.g., 4 for 4/4)
- `/signature_denominator` - Time signature denominator (e.g., 4 for 4/4)
- `/current_song_time` - Current song time in beats (float)

### 3. Open the Web Interface

Open `index.html` in a web browser. The p5.js sketch will connect to the server via WebSocket and display real-time beat information.

### 4. Code Your Sequences

Edit the sequence in `src/server.js` (or create an API endpoint) to send ALiCA sequences.

## Syntax Overview

ALiCA uses a concise, expressive syntax for musical sequences:

```javascript
// Basic note
n(60).d(500).v(80)

// Random note from scale
n(r.o{scale(c-ionian)}).nRange(c3,c5).v(r).d(bt/4)

// Complex sequence with probability
[n(r.o{scale(c-ionian)})^6.nRange(c3,c4)].c(1) 
[n(r.o{scale(c-iwato)})^16.v(r).pm(r).arp(up-down)].c(1)
```

**Full syntax documentation**: See [docs/SYNTAX.md](docs/SYNTAX.md)

## Project Structure

```
.
├── src/
│   ├── modules/
│   │   ├── musicTheory.js      # Note parsing, scales, chords
│   │   ├── midiHandler.js       # MIDI output functions
│   │   ├── sequenceParser.js    # Sequence parsing utilities
│   │   └── sequencePlayer.js    # Sequence execution
│   ├── oscHandler.js            # OSC reception and beat calculation
│   └── server.js                # Main server setup
├── docs/
│   └── SYNTAX.md                # Complete syntax documentation
├── index.html                   # Web interface (p5.js)
├── sketch.js                    # p5.js sketch code
└── package.json
```

## Components

### Server (`src/server.js`)

Node.js Express server that:
- Receives OSC messages from Ableton Live
- Calculates bars and beats from tempo/time signature
- Parses and executes ALiCA sequences
- Sends MIDI notes to Ableton Live
- Broadcasts beat data via WebSocket

### Web Interface (`index.html` + `sketch.js`)

p5.js application that:
- Connects to the server via WebSocket
- Receives real-time beat/bar updates
- Can send MIDI messages (via WebMIDI)

### Music Theory Module (`src/modules/musicTheory.js`)

Handles:
- Note token to MIDI conversion
- Scale definitions and generation
- Chord quality definitions and generation
- Scale/chord expansion within note ranges

### MIDI Handler (`src/modules/midiHandler.js`)

Manages:
- MIDI output initialization
- Note on/off sending
- MIDI channel management

### Sequence Parser (`src/modules/sequenceParser.js`)

Parses:
- Note syntax and parameters
- Array randomizers (`r.o{...}`)
- Scale and chord syntax
- Duration tokens
- Range constraints

### Sequence Player (`src/modules/sequencePlayer.js`)

Executes:
- Sequence playback
- Randomization and probability
- Arpeggiator patterns
- Timing calculations (fit/beat/bar)

### OSC Handler (`src/oscHandler.js`)

Manages:
- UDP server for OSC messages
- Tempo and time signature updates
- Song time tracking
- Bar/beat calculation

## API Endpoints

- `GET /` - Web interface (index.html)
- `WS://localhost:4254` - WebSocket connection for real-time updates

## Development

### Development Mode (with auto-reload)

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

## Configuration

### MIDI Output

By default, ALiCA uses the MIDI output named `"Virtual Loop Back"`. To change this, edit `src/modules/midiHandler.js`:

```javascript
const selectedName = 'Your MIDI Output Name';
```

### Port Configuration

Default ports:
- HTTP/WebSocket: `4254`
- UDP/OSC: `4254`

To change, edit `src/server.js`:

```javascript
const HTTP_PORT = process.env.PORT || 4254;
const UDP_PORT = 4254;
```

## Example Sequences

### Simple Scale Sequence

```javascript
n(r.o{scale(c-ionian)}).nRange(c3,c5).d(bt/4).v(80)^16
```

### Chord Arpeggio

```javascript
n(r.o{chord(c-maj7)}).arp(up-down).d(bt/8).v(r).vRange(0.5,1.0)^8
```

### Probability-Based Pattern

```javascript
[n(r.o{scale(c-dorian)})^8.nRange(c3,c4).pm(0.3).d(bt/4)].c(1)
[n(r.o{scale(d-mixolydian)})^16.nRange(c4,c5).v(r).pr(0.2)].c(2)
```

See [docs/SYNTAX.md](docs/SYNTAX.md) for complete documentation.

## Dependencies

- **express**: Web framework for Node.js
- **easymidi**: MIDI output library
- **osc**: OSC protocol library
- **ws**: WebSocket library
- **nodemon** (dev): Auto-reloads during development

## License

ISC

## Contributing

Contributions welcome! Please ensure code follows existing style and includes documentation.

---

**ALiCA** - Make music with code.
