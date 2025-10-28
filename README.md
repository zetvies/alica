# Live Coding for Ableton - MIDI Beat Sender

A p5.js application that receives beat information from Ableton Live via OSC and sends MIDI messages on beat changes using WebMIDI.

## Components

- **server.js**: Node.js server that receives OSC messages from Ableton Live and broadcasts beat data via WebSocket
- **sketch.js**: p5.js sketch that connects to the server and sends MIDI notes when beats change
- **index.html**: HTML page hosting the p5.js sketch

## Installation

```bash
npm install
```

## Running the Server

### Development mode (with auto-reload)
```bash
npm run dev
```

### Production mode
```bash
npm start
```

The server will start on `http://localhost:3000`

## How It Works

1. **OSC Reception**: The server receives OSC messages from Ableton Live on UDP port 4254
2. **Beat Calculation**: The server calculates current bar and beat from tempo, time signature, and song time
3. **WebSocket Broadcasting**: When a beat changes, the server broadcasts it to all connected clients
4. **MIDI Sending**: The p5.js sketch receives beat updates via WebSocket and sends MIDI notes (Middle C) on every beat change

## Setup

1. **Start the server**:
   ```bash
   npm run dev
   ```

2. **Open the p5.js sketch**:
   - Open `index.html` in a web browser
   - Allow WebMIDI access when prompted
   - The sketch will automatically connect to the WebSocket server

3. **Configure Ableton Live/Max**:
   - Send OSC messages to `localhost:4254` with the following addresses:
     - `/tempo` - Current BPM
     - `/signature_numerator` - Time signature numerator (e.g., 4 for 4/4)
     - `/signature_denominator` - Time signature denominator (e.g., 4 for 4/4)
     - `/current_song_time` - Current song time in seconds

## Endpoints

- `GET /` - Welcome message
- `GET /api/health` - Server health check
- `GET /api/beat` - Get current beat and bar information
- `WS://localhost:3000` - WebSocket connection for real-time beat updates

## Dependencies

- **express**: Web framework for Node.js
- **osc**: OSC protocol library
- **ws**: WebSocket library
- **nodemon** (dev): Auto-reloads the server during development

