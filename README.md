# ALiCA

**Ableton Live Coding and Automation**

ALiCA is a powerful live coding system for Ableton Live that provides a domain-specific language for sequencing MIDI notes with advanced randomization, scale/chord generation, and probability controls.

## Requirements

- **Node.js** - JavaScript runtime environment
  - Download and install from [nodejs.org](https://nodejs.org/)
  - Verify installation: `node --version`

- **MIDI Loopback** - Virtual MIDI ports
  - **Windows: loopMIDI**
    - Download from [Tobias Erichsen's website](https://www.tobias-erichsen.de/software/loopmidi.html)
    - **Installation:**
      1. Download the installer from the link above
      2. Run the installer and follow the setup wizard
      3. After installation, launch loopMIDI from the Start menu
      4. Click the "+" button to add new MIDI ports
      5. Add exactly these two ports (names are case-sensitive):
         - `Sequence Loop Back`
         - `Automation Loop Back`
      6. Keep loopMIDI running while using ALiCA
  
  - **macOS: IAC Driver** (built-in, no installation needed)
    - **Setup:**
      1. Open **Audio MIDI Setup** (Applications > Utilities > Audio MIDI Setup)
      2. Click **Window** → **Show MIDI Studio**
      3. Double-click **IAC Driver**
      4. Check **Device is online**
      5. Click the **+** button to add ports if needed
      6. Add exactly these two ports (names are case-sensitive):
         - `Sequence Loop Back`
         - `Automation Loop Back`

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure MIDI Loopback

**Windows:**
- Open loopMIDI and add the following MIDI ports (names must be exact, case-sensitive):
  - `Sequence Loop Back`
  - `Automation Loop Back`

**macOS:**
- Open Audio MIDI Setup (Applications > Utilities > Audio MIDI Setup)
- Click Window → Show MIDI Studio
- Double-click IAC Driver and check "Device is online"
- Add the following MIDI ports (names must be exact, case-sensitive):
  - `Sequence Loop Back`
  - `Automation Loop Back`

### 3. Start the Server

```bash
npm run dev
```

The server will start on `http://localhost:4254`

### 4. Add ALiCA Max4Live Device to Ableton

1. Open Ableton Live
2. Add the `ALiCA Max4Live.amxd` file to the main track
3. Click the **Initialize** button in the device
4. Click Play button in Ableton and make sure the track is playing


### 5. Try the Syntax and Have Fun!

Open `http://localhost:4254` in a web browser and start coding your sequences. Click the **?** button in the bottom right corner to view keyboard shortcuts and complete syntax documentation.

> **Important:** Before executing ALiCA syntax, make sure the track in Ableton Live is playing. ALiCA needs Ableton's playback to be active to receive tempo and timing information.

## Features

- 🎹 **Musical Syntax**: Intuitive note, scale, and chord notation
- 🎲 **Advanced Randomization**: Array-based and continuous random selection
- 🎚️ **Parameter Control**: Velocity, pan, channel, duration, and more
- 🎵 **Scale & Chord Generation**: Support for 30+ scales and 40+ chord qualities
- 🔄 **Arpeggiators**: Multiple arpeggio patterns (up, down, up-down, down-up)
- 📊 **Probability Modifiers**: Mute and remove probability controls
- 🎛️ **MIDI Automation**: Smooth CC parameter control with easing functions
- 🎯 **Track System**: Named tracks/cycles with tempo overrides and delay start
- ⚡ **Real-time OSC**: Synchronized with Ableton Live tempo and time signature
- 🔌 **MIDI Output**: Direct MIDI communication with Ableton Live via loopMIDI
- 💻 **Web Editor**: Built-in code editor with syntax highlighting and interactive hints panel

## Quick Start

Follow the [Setup Instructions](#setup-instructions) above first, then:

### Configure Ableton Live/Max4Live

Set up OSC output to send the following messages to `localhost:4254`:

- `/tempo` - Current BPM (float)
- `/signature_numerator` - Time signature numerator (e.g., 4 for 4/4)
- `/signature_denominator` - Time signature denominator (e.g., 4 for 4/4)
- `/current_song_time` - Current song time in beats (float)

### Open the Web Interface

Open `http://localhost:4254` in a web browser. The web interface provides a code editor where you can write ALiCA sequences.

### Code Your Sequences

> **Important:** Make sure Ableton Live is playing before executing ALiCA syntax. The system needs active playback to receive tempo and timing information.

Type your ALiCA code in the editor and use keyboard shortcuts to execute:
- **Ctrl+Enter** - Queue the sequence to play on the next bar
- **Ctrl+Shift+Enter** - Play the sequence immediately
- **Ctrl+S** - Loop track in next cycle
- **Ctrl+Shift+S** - Loop track immediately
- **Ctrl+H** - Stop all loops
- **Ctrl+/** - Toggle comment

See the hints panel (click **?** button) for the complete list of keyboard shortcuts and syntax reference.

The editor supports multiple tracks/cycles - select specific tracks or all text to control what gets executed.

## Syntax Overview

ALiCA uses a concise, expressive syntax for musical sequences:

### Track Syntax

```javascript
// Basic track with notes
t(mainLoop).play([n(60) n(65) n(67)].c(1))

// Track with tempo override and delay
t(bass).bpm(120).sn(4).sd(4).ds(bt*2).play([n(48) n(52)].c(3))

// Track with automation
t(automation).play([
  [n(60)^4].c(1),
  [a(7).from(0).to(127).d(bt).e(easeInOut)].c(1)
])

// Track with chord syntax
t(name).play([
  [n(r.o{<chord(c4-maj7),g3>,<chord(g4-maj13)>,chord(a2-min)})].c(1),
  [a(1).c(1).from(0).to(127)]
])
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
├── index.html                   # Web interface (code editor)
└── package.json
```

## Components

### Server (`server.js`)

Node.js Express server that:
- Receives OSC messages from Ableton Live (tempo, time signature, song time)
- Calculates bars and beats from tempo/time signature
- Parses and executes ALiCA sequences (both new and legacy syntax)
- Manages tracks/cycles with queue system for bar-synchronized playback
- Sends MIDI notes to Ableton Live via loopMIDI
- Handles MIDI CC automation and streaming with smooth interpolation
- Broadcasts tempo and time signature updates via WebSocket
- Supports track-level tempo overrides and delay start

### Web Interface (`index.html`)

Full-featured code editor that:
- Provides syntax highlighting for ALiCA code
- Connects to the server via WebSocket
- Receives real-time tempo and time signature updates
- Sends ALiCA sequences to the server for execution
- Supports keyboard shortcuts (Ctrl+Enter to queue, Ctrl+Shift+Enter to play immediately)
- Includes interactive hints panel (click **?** button) with keyboard shortcuts and complete syntax reference

### Music Theory Module (`src/modules/musicTheory.js`)

Handles:
- Note token to MIDI conversion
- Scale definitions and generation
- Chord quality definitions and generation
- Scale/chord expansion within note ranges

### MIDI Handler (`src/modules/midiHandler.js`)

Manages:
- MIDI output initialization (separate outputs for sequences and automation)
- Note on/off sending with velocity and channel control
- MIDI Control Change (CC) messages for automation
- CC value streaming with smooth interpolation at 50fps (20ms intervals)
- MIDI channel management (1-16)
- Multiple concurrent CC streams with independent control

### Modulator Module (`src/modules/modulator.js`)

Provides:
- Value interpolation functions
- Easing functions (linear, easeIn, easeOut, easeInOut, etc.)
- Variable modulation over time
- Used by MIDI handler for smooth CC automation

## API Endpoints

### HTTP
- `GET /` - Web interface (index.html)

### WebSocket (`ws://localhost:4254`)

The server accepts WebSocket messages with the following actions:

- **`playTrack`** - Play a sequence immediately
- **`playCycle`** - Start a repeating cycle immediately
- **`addTrackToQueue`** - Queue a track to play on next bar
- **`addCycleToQueue`** - Queue a cycle to start on next bar
- **`updateCycleById`** - Update an existing cycle
- **`removeCycleById`** - Stop and remove a cycle
- **`stopCycle`** - Stop a cycle using `t(cycleId).stop()` syntax

Message format:
```json
{
  "action": "playCycle",
  "cycleStr": "t(main).play([n(60)^4].c(1))",
  "tempo": 120,
  "signatureNumerator": 4,
  "signatureDenominator": 4
}
```

The server broadcasts tempo and time signature updates to all connected clients.

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

### Simple Track with Notes

```javascript
t(main).play([n(60) n(65) n(67) n(72)].c(1))
```

### Track with Scale-Based Random Notes

```javascript
t(melody).play([
  [n(r.o{scale(c-ionian)}).nRange(c3,c5).d(bt/4).v(80)^16].c(1)
])
```

### Track with Automation

```javascript
t(automation).play([
  [n(60)^4].c(1),
  [a(7).from(0).to(127).d(bt).e(easeInOut)].c(1),
  [a(74).from(127).to(0).d(br).e(easeOut)].c(1)
])
```

### Track with Delay Start

```javascript
t(bass).ds(bt*2).play([n(48) n(52)].c(3))
```

### Chord Arpeggio

```javascript
t(chords).play([
  [n(r.o{chord(c-maj7)}).nArp(up-down).d(bt/8).v(r).vRange(0.5,1.0)^8].c(1)
])
```

### Probability-Based Pattern

```javascript
t(pattern).play([
  [n(r.o{scale(c-dorian)})^8.nRange(c3,c4).pm(0.3).d(bt/4)].c(1),
  [n(r.o{scale(d-mixolydian)})^16.nRange(c4,c5).v(r).pr(0.2)].c(2)
])
```

### Complex Multi-Track Example

```javascript
t(mainLoop).bpm(120).sn(4).sd(4).play([
  [n(r.o{scale(c-ionian)})^6.nRange(c3,c4)].c(1),
  [n(r.o{scale(c-iwato)})^16.v(r).pm(r).nArp(up-down)].c(2),
  [a(7).from(64).to(127).d(br).e(easeInOut)].c(1)
])
```

See [docs/SYNTAX.md](docs/SYNTAX.md) for complete documentation.

## Dependencies

- **express**: Web framework for Node.js
- **easymidi**: MIDI output library
- **osc**: OSC protocol library
- **ws**: WebSocket library
- **nodemon** (dev): Auto-reloads during development

## License

ISC (Internet Systems Consortium License)

A permissive open-source license similar to MIT and BSD. You are free to use, modify, and distribute this software for any purpose, including commercial use, with minimal restrictions (maintain copyright notice and license text).

## Contributing

Contributions welcome! Please ensure code follows existing style and includes documentation.

---

**ALiCA** - Make music with code.
