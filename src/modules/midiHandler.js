/**
 * ALiCA - MIDI Handler Module
 * Handles MIDI output using easymidi
 */

const easymidi = require('easymidi');
const { createModulator } = require('./modulator');

// Separate MIDI outputs for sequences and automation
let sequenceMidiOutput = null;  // For note sequences - "Sequence Loop Back"
let automationMidiOutput = null; // For CC automation - "Automation Loop Back"

// Active CC streams for tracking and stopping them
const activeCCStreams = new Map();

function initializeMidi() {
  try {
    const outputs = easymidi.getOutputs();
    if (outputs && outputs.length > 0) {
      // Initialize sequence MIDI output (for notes)
      const sequenceOutputName = 'Sequence Loop Back';
      if (outputs.includes(sequenceOutputName)) {
        sequenceMidiOutput = new easymidi.Output(sequenceOutputName);
        console.log(`[MIDI] Sequence output initialized: ${sequenceOutputName}`);
      } else {
        console.log(`[MIDI][WARN] Sequence output '${sequenceOutputName}' not found. Available outputs:`, outputs);
      }
      
      // Initialize automation MIDI output (for CC)
      const automationOutputName = 'Automation Loop Back';
      if (outputs.includes(automationOutputName)) {
        automationMidiOutput = new easymidi.Output(automationOutputName);
        console.log(`[MIDI] Automation output initialized: ${automationOutputName}`);
      } else {
        console.log(`[MIDI][WARN] Automation output '${automationOutputName}' not found. Available outputs:`, outputs);
      }
      
      if (!sequenceMidiOutput && !automationMidiOutput) {
        console.log('[MIDI] No matching MIDI outputs found');
      }
    } else {
      console.log('[MIDI] No MIDI outputs available');
    }
  } catch (midiErr) {
    console.log('[MIDI][ERROR] Failed to initialize MIDI outputs:', midiErr.message);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendNote(note, velocity = 80, duration = 500, channel = 0) {
  if (!sequenceMidiOutput) return;
  if (note === undefined || note === null) return;
  try {
    sequenceMidiOutput.send('noteon', { note, velocity, channel });
    if (duration > 0) {
      setTimeout(() => {
        try { sequenceMidiOutput.send('noteoff', { note, velocity: 0, channel }); } catch (e) { }
      }, duration - 50);
      await sleep(duration);
    } else {
      // If duration is 0 or negative, send immediate noteoff
      setTimeout(() => {
        try { sequenceMidiOutput.send('noteoff', { note, velocity: 0, channel }); } catch (e) { }
      }, 0);
    }
  } catch (e) {
  }
}

function closeMidi() {
  try {
    // Stop all active CC streams
    activeCCStreams.forEach(stream => {
      if (stream.intervalId) {
        clearInterval(stream.intervalId);
      }
      if (stream.timeoutId) {
        clearTimeout(stream.timeoutId);
      }
    });
    activeCCStreams.clear();
    
    if (sequenceMidiOutput) {
      sequenceMidiOutput.close();
      sequenceMidiOutput = null;
    }
    if (automationMidiOutput) {
      automationMidiOutput.close();
      automationMidiOutput = null;
    }
  } catch (e) {
  }
}

/**
 * Send a MIDI Control Change (CC) message
 * Useful for controlling faders, knobs, and other parameters in Ableton Live
 * 
 * @param {number} controller - CC number (0-127). Common ones: 1=Modulation, 7=Volume, 10=Pan, etc.
 * @param {number} value - CC value (0-127)
 * @param {number} channel - MIDI channel (0-15, where 0 = channel 1)
 * @param {boolean} debug - Optional: if true, logs the CC message (default: false)
 */
function sendCC(controller, value, channel = 0, debug = false) {
  if (!automationMidiOutput) {
    if (debug) console.warn('[MIDI][DEBUG] Cannot send CC: Automation MIDI output not initialized');
    return;
  }
  
  // Validate and clamp values
  controller = Math.max(0, Math.min(127, Math.round(controller)));
  value = Math.max(0, Math.min(127, Math.round(value)));
  channel = Math.max(0, Math.min(15, Math.round(channel)));
  
  try {
    automationMidiOutput.send('cc', { controller, value, channel });
    if (debug) {
      const ccNames = {
        1: 'Modulation', 7: 'Volume', 10: 'Pan', 11: 'Expression',
        71: 'Resonance', 74: 'Filter Cutoff', 91: 'Reverb', 93: 'Chorus'
      };
      const name = ccNames[controller] ? ` (${ccNames[controller]})` : '';
      console.log(`[MIDI][DEBUG] CC${controller}${name} = ${value} on channel ${channel + 1}`);
    }
  } catch (e) {
    console.error('[MIDI][ERROR] Failed to send CC:', e.message);
  }
}

/**
 * Stream a MIDI CC value, smoothly modulating from startValue to endValue over duration
 * This is perfect for automating faders and other parameters in Ableton Live
 * 
 * @param {number} controller - CC number (0-127)
 * @param {number} startValue - Starting CC value (0-127)
 * @param {number} endValue - Target CC value (0-127)
 * @param {number} duration - Duration in milliseconds
 * @param {number} channel - MIDI channel (0-15, where 0 = channel 1)
 * @param {string} easing - Easing function: 'linear', 'easeIn', 'easeOut', 'easeInOut' (default: 'linear')
 * @param {number} updateInterval - Update interval in milliseconds (default: 20ms for smooth 50fps updates)
 * @param {string} streamId - Optional ID for this stream (for stopping it later)
 * @returns {Object} Stream control object with stop(), getProgress(), and getCurrentValue() methods
 * 
 * @example
 * // Automate volume fader (CC 7) from 0 to 127 over 2 seconds
 * const stream = streamCC(7, 0, 127, 2000, 0, 'easeInOut');
 * 
 * // Stop it early if needed
 * stream.stop();
 */
function streamCC(controller, startValue, endValue, duration, channel = 0, easing = 'linear', updateInterval = 20, streamId = null) {
  if (!automationMidiOutput) {
    console.warn('[MIDI] Cannot stream CC: Automation MIDI output not initialized');
    return null;
  }

  // Clamp values to valid MIDI ranges
  controller = Math.max(0, Math.min(127, Math.round(controller)));
  startValue = Math.max(0, Math.min(127, Math.round(startValue)));
  endValue = Math.max(0, Math.min(127, Math.round(endValue)));
  channel = Math.max(0, Math.min(15, Math.round(channel)));
  updateInterval = Math.max(10, Math.min(1000, updateInterval)); // Reasonable update rate (10ms = 100fps for smooth automation)

  // Generate unique stream ID if not provided
  const id = streamId || `cc_${controller}_${channel}_${Date.now()}`;

  // Stop any existing stream with the same ID
  if (activeCCStreams.has(id)) {
    activeCCStreams.get(id).stop();
  }

  const modulator = createModulator(startValue, endValue, duration, easing);
  const startTime = Date.now();
  let intervalId = null;
  let timeoutId = null;
  let currentValue = startValue;
  let isActive = true;

  // Send initial value
  sendCC(controller, startValue, channel);

  // Create stop function that can be called before streamControl is created
  const stop = () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    isActive = false;
    activeCCStreams.delete(id);
  };

  // Create update function
  const update = () => {
    if (!isActive) return;

    const elapsed = Date.now() - startTime;
    
    // Check if duration is complete
    if (elapsed >= duration) {
      // Send final value to ensure we end exactly at target
      sendCC(controller, endValue, channel);
      stop();
      return;
    }

    // Calculate current value based on elapsed time
    currentValue = modulator(elapsed);

    // Send CC value (round to ensure valid MIDI value)
    const roundedValue = Math.round(currentValue);
    sendCC(controller, roundedValue, channel);
  };

  // Start interval with immediate first update for smoother start
  update(); // Send initial value immediately
  intervalId = setInterval(update, updateInterval);
  
  // Set a timeout to ensure we hit the exact end time (more accurate than relying on interval)
  timeoutId = setTimeout(() => {
    if (isActive) {
      sendCC(controller, endValue, channel);
      stop();
    }
  }, duration);

  // Create stream control object
  const streamControl = {
    id,
    controller,
    channel,
    startValue,
    endValue,
    duration,
    easing,
    
    stop,

    getProgress() {
      if (!isActive) return 1;
      const elapsed = Date.now() - startTime;
      return Math.max(0, Math.min(1, elapsed / duration));
    },

    getCurrentValue() {
      return Math.round(currentValue);
    },

    isComplete() {
      if (!isActive) return true;
      return (Date.now() - startTime) >= duration;
    }
  };

  // Store stream
  activeCCStreams.set(id, {
    ...streamControl,
    intervalId,
    timeoutId
  });

  return streamControl;
}

/**
 * Stream multiple MIDI CC values simultaneously
 * 
 * @param {Array} ccStreams - Array of stream configs: [{controller, startValue, endValue, duration, channel?, easing?, updateInterval?, streamId?}, ...]
 * @returns {Array} Array of stream control objects
 * 
 * @example
 * // Automate multiple faders at once
 * streamMultipleCC([
 *   {controller: 7, startValue: 0, endValue: 127, duration: 2000, channel: 0}, // Volume
 *   {controller: 10, startValue: 64, endValue: 127, duration: 2000, channel: 0} // Pan
 * ]);
 */
function streamMultipleCC(ccStreams) {
  if (!Array.isArray(ccStreams) || ccStreams.length === 0) {
    return [];
  }

  return ccStreams.map(config => {
    const {
      controller,
      startValue,
      endValue,
      duration,
      channel = 0,
      easing = 'linear',
      updateInterval = 20,
      streamId = null
    } = config;

    return streamCC(controller, startValue, endValue, duration, channel, easing, updateInterval, streamId);
  });
}

/**
 * Stop a CC stream by ID
 * 
 * @param {string} streamId - The ID of the stream to stop
 */
function stopCCStream(streamId) {
  if (activeCCStreams.has(streamId)) {
    activeCCStreams.get(streamId).stop();
  }
}

/**
 * Stop all active CC streams
 */
function stopAllCCStreams() {
  activeCCStreams.forEach(stream => stream.stop());
}

/**
 * Get list of active CC stream IDs
 * 
 * @returns {Array} Array of active stream IDs
 */
function getActiveCCStreams() {
  return Array.from(activeCCStreams.keys());
}

module.exports = {
  initializeMidi,
  sendNote,
  sendCC,
  streamCC,
  streamMultipleCC,
  stopCCStream,
  stopAllCCStreams,
  getActiveCCStreams,
  closeMidi
};

