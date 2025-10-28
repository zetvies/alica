/*
This is a p5js sketch that uses the WebMIDI.js library to send MIDI messages

In the project folder, to the left of this coding window,
you can look at the index.html file and see the following on line 7:

<script src="https://cdn.jsdelivr.net/npm/webmidi@next/dist/iife/webmidi.iife.js"></script>

This is added to the otherwise normal p5js boilerplate,
and bring in the WebMIDI.js library, allowing our browser and JS program
to send and receive MIDI messages from all types of software and hardware

*/

let myOutput; //the variable in charge of out MIDI output
let currentBar = null;
let previousBar = null;
let ws; // WebSocket connection

// Function to send MIDI note (middle C = 60)
function sendMIDINote() {
  if (myOutput) {
    // Middle C (note 60) on channel 1 with velocity 80
    // Using sendNoteOn() instead of playNote() to avoid automatic note off
    
    myOutput.sendNoteOn(60, 1, { rawAttack: 80 });
    setTimeout(() => {
      myOutput.sendNoteOff(60, 1);
    }, 500);
  }
}

function setup() {
  ////
  //Adding MIDI functionality
  ////
  
  WebMidi
  .enable()
  .then(onEnabled)
  .catch(err => alert(err));
  
  //The function "onEnabled()" will run
  //Unless WebMidi didn't startup properly
  //In which case it will show us an error
}

function onEnabled() {
  //WebMIDI Example Output Setup:
  
  //assign that output as the one we will use later
  if (WebMidi.outputs.length > 1) {
    myOutput = WebMidi.outputs[1];
  } else if (WebMidi.outputs.length > 0) {
    myOutput = WebMidi.outputs[0];
  }
  
  // Connect to WebSocket for real-time beat updates
  connectWebSocket();
}

// Function to connect to WebSocket server
function connectWebSocket() {
  ws = new WebSocket('ws://localhost:4254');
  
  ws.onopen = function() {
  };
  
  ws.onmessage = function(event) {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'beat') {
        console.log(`[WS] Message received: {"type":"${data.type}","bar":${data.bar}}`);
        receiveBar(data.bar);
      }
    } catch (error) {
    }
  };
  
  ws.onerror = function(error) {
  };
  
  ws.onclose = function(event) {
    setTimeout(connectWebSocket, 4254);
  };
}

function draw() {
  // No drawing needed - just receiving beat data and sending MIDI
}

// Function to receive bar data from the server
// This should be called whenever new bar data arrives (from HTTP/WebSocket)
function receiveBar(newBar) {
  previousBar = currentBar;
  currentBar = newBar;
  
  // Send MIDI note if bar has changed
  if (currentBar !== previousBar && currentBar !== null) {
    sendMIDINote();
  }
}

// This function will be called automatically when WebSocket receives beat data
// No need for manual polling since WebSocket provides real-time updates

