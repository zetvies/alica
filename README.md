# ALiCA

**Ableton Live Coding Automation**

ALiCA is a powerful live coding system for Ableton Live that provides a domain-specific language for sequencing MIDI notes with advanced randomization, scale/chord generation, and probability controls.

## Requirements

- **Node.js** - JavaScript runtime environment
  - Download and install from [nodejs.org](https://nodejs.org/)
  - Verify installation: `node --version`

- **MIDI Loopback** - Virtual MIDI ports for Windows
  - **loopMIDI** - Download from [Tobias Erichsen's website](https://www.tobias-erichsen.de/software/loopmidi.html)
  - **Installation:**
    1. Download the installer from the link above
    2. Run the installer and follow the setup wizard
    3. After installation, launch loopMIDI from the Start menu
    4. Click the "+" button to add new MIDI ports
    5. Add exactly these two ports (names are case-sensitive):
       - `Sequence Loop Back`
       - `Automation Loop Back`
    6. Keep loopMIDI running while using ALiCA

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure loopMIDI

Open loopMIDI and add the following MIDI ports (names must be exact, case-sensitive):
- `Sequence Loop Back`
- `Automation Loop Back`

### 3. Add ALiCA Max4Live Device to Ableton

1. Open Ableton Live
2. Add the `ALiCA Max4Live.amxd` file to the main track
3. Configure the device as needed

### 4. Start the Server

```bash
npm run dev
```

The server will start on `http://localhost:4254`

### 5. Try the Syntax and Have Fun!

Open `index.html` in a web browser and start coding your sequences. See Hints in the bottom right of the editor.

## Features

- 🎹 **Musical Syntax**: Intuitive note, scale, and chord notation
- 🎲 **Advanced Randomization**: Array-based and continuous random selection
- 🎚️ **Parameter Control**: Velocity, pan, channel, duration, and more
- 🎵 **Scale & Chord Generation**: Support for 30+ scales and 40+ chord qualities
- 🔄 **Arpeggiators**: Multiple arpeggio patterns (up, down, up-down, down-up)
- 📊 **Probability Modifiers**: Mute and remove probability controls
- ⚡ **Real-time OSC**: Synchronized with Ableton Live tempo and time signature
- 🔌 **MIDI Output**: Direct MIDI communication with Ableton Live

## Quick Start

Follow the [Setup Instructions](#setup-instructions) above first, then:

### Configure Ableton Live/Max4Live

Set up OSC output to send the following messages to `localhost:4254`:

- `/tempo` - Current BPM (float)
- `/signature_numerator` - Time signature numerator (e.g., 4 for 4/4)
- `/signature_denominator` - Time signature denominator (e.g., 4 for 4/4)
- `/current_song_time` - Current song time in beats (float)

### Open the Web Interface

Open `index.html` in a web browser. The p5.js sketch will connect to the server via WebSocket and display real-time beat information.

### Code Your Sequences

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
[n(r.o{scale(c-iwato)})^16.v(r).pm(r).nArp(up-down)].c(1)
```

**Full syntax documentation**: See [docs/SYNTAX.md](docs/SYNTAX.md)

## Project Structure

```
.
├── src/
│   └── modules/
│       ├── musicTheory.js      # Note parsing, scales, chords
│       ├── midiHandler.js      # MIDI output functions (notes & CC automation)
│       └── modulator.js        # Modulation/interpolation utilities
├── server.js                   # Main server (OSC, parsing, playback)
├── docs/
│   └── SYNTAX.md                # Complete syntax documentation
├── index.html                   # Web interface (p5.js)
├── sketch.js                    # p5.js sketch code
└── package.json
```

## Components

### Server (`server.js`)

Node.js Express server that:
- Receives OSC messages from Ableton Live
- Calculates bars and beats from tempo/time signature
- Parses and executes ALiCA sequences
- Sends MIDI notes to Ableton Live
- Handles MIDI CC automation and streaming
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
- MIDI output initialization (separate outputs for sequences and automation)
- Note on/off sending
- MIDI Control Change (CC) messages
- CC value streaming with smooth interpolation
- MIDI channel management

### Modulator Module (`src/modules/modulator.js`)

Provides:
- Value interpolation functions
- Easing functions (linear, easeIn, easeOut, easeInOut, etc.)
- Variable modulation over time
- Used by MIDI handler for smooth CC automation

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

### MIDI Outputs

ALiCA uses two separate MIDI outputs for independent control:
- **Sequence Loop Back**: For sending MIDI notes
- **Automation Loop Back**: For sending CC automation messages

To change these, edit `src/modules/midiHandler.js`:

```javascript
const sequenceOutputName = 'Your Sequence MIDI Output';
const automationOutputName = 'Your Automation MIDI Output';
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
n(r.o{chord(c-maj7)}).nArp(up-down).d(bt/8).v(r).vRange(0.5,1.0)^8
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
