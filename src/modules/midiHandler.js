/**
 * ALiCA - MIDI Handler Module
 * Handles MIDI output using easymidi
 */

const easymidi = require('easymidi');

// MIDI output using easymidi (Node)
let midiOutput = null;

function initializeMidi() {
  try {
    const outputs = easymidi.getOutputs();
    if (outputs && outputs.length > 0) {
      const selectedName = 'Virtual Loop Back';
      midiOutput = new easymidi.Output(selectedName);
      console.log(`[MIDI] Using output: ${selectedName}`);
    } else {
      console.log('[MIDI] No MIDI outputs available');
    }
  } catch (midiErr) {
    console.log('[MIDI][ERROR] Failed to initialize MIDI output:', midiErr.message);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendNote(note, velocity = 80, duration = 500, channel = 0) {
  if (!midiOutput) return;
  if (note === undefined || note === null) return;
  try {
    midiOutput.send('noteon', { note, velocity, channel });
    if (duration > 0) {
      setTimeout(() => {
        try { midiOutput.send('noteoff', { note, velocity: 0, channel }); } catch (e) { }
      }, duration - 50);
      await sleep(duration);
    } else {
      // If duration is 0 or negative, send immediate noteoff
      setTimeout(() => {
        try { midiOutput.send('noteoff', { note, velocity: 0, channel }); } catch (e) { }
      }, 0);
    }
  } catch (e) {
  }
}

function closeMidi() {
  try {
    if (midiOutput) midiOutput.close();
  } catch (e) {
  }
}

module.exports = {
  initializeMidi,
  sendNote,
  closeMidi
};

