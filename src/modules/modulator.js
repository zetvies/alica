/**
 * ALiCA - Modulation/Interpolation Module
 * Provides utilities for smoothly transitioning values over time
 */

/**
 * Creates a modulator function that interpolates from startValue to endValue over duration
 * 
 * @param {number} startValue - The initial value
 * @param {number} endValue - The target value
 * @param {number} duration - Duration in milliseconds
 * @param {string} easing - Easing function type: 'linear', 'easeIn', 'easeOut', 'easeInOut' (default: 'linear')
 * @returns {Function} A function that takes currentTime (ms) and returns the current interpolated value
 * 
 * @example
 * const modulator = createModulator(0, 100, 2000, 'easeInOut');
 * const startTime = Date.now();
 * // Later...
 * const currentValue = modulator(Date.now() - startTime); // Gets value at current time
 */
function createModulator(startValue, endValue, duration, easing = 'linear') {
  if (duration <= 0) {
    return () => endValue;
  }

  const range = endValue - startValue;

  // Easing functions (t should be normalized 0-1)
  const easingFunctions = {
    linear: (t) => t,
    easeIn: (t) => t * t,
    easeOut: (t) => t * (2 - t),
    easeInOut: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
    easeInQuad: (t) => t * t,
    easeOutQuad: (t) => t * (2 - t),
    easeInOutQuad: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
    easeInCubic: (t) => t * t * t,
    easeOutCubic: (t) => --t * t * t + 1,
    easeInOutCubic: (t) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1
  };

  const easingFunc = easingFunctions[easing] || easingFunctions.linear;

  return (currentTime) => {
    // Clamp time to [0, duration]
    const t = Math.max(0, Math.min(1, currentTime / duration));
    
    // Apply easing
    const easedT = easingFunc(t);
    
    // Interpolate
    return startValue + (range * easedT);
  };
}

/**
 * Modulates a variable object from startValue to endValue over duration
 * This directly modifies a variable and requires periodic updates
 * 
 * @param {Object} variableObj - An object with a 'value' property to modulate (e.g., { value: 0 })
 * @param {number} startValue - The initial value
 * @param {number} endValue - The target value
 * @param {number} duration - Duration in milliseconds
 * @param {string} easing - Easing function type (default: 'linear')
 * @returns {Object} An object with methods: start(), stop(), update(), isComplete()
 * 
 * @example
 * const myVar = { value: 0 };
 * const modulation = modulateVariable(myVar, 0, 100, 2000, 'easeInOut');
 * modulation.start();
 * // In your update loop:
 * modulation.update(Date.now());
 */
function modulateVariable(variableObj, startValue, endValue, duration, easing = 'linear') {
  if (!variableObj || typeof variableObj !== 'object') {
    throw new Error('variableObj must be an object');
  }

  const modulator = createModulator(startValue, endValue, duration, easing);
  let startTime = null;
  let isRunning = false;

  return {
    start() {
      startTime = Date.now();
      isRunning = true;
      variableObj.value = startValue;
    },

    update(currentTime = Date.now()) {
      if (!isRunning || startTime === null) return;
      
      const elapsed = currentTime - startTime;
      const newValue = modulator(elapsed);
      variableObj.value = newValue;

      if (elapsed >= duration) {
        variableObj.value = endValue;
        isRunning = false;
      }

      return variableObj.value;
    },

    stop() {
      isRunning = false;
    },

    isComplete() {
      if (!isRunning || startTime === null) return true;
      return (Date.now() - startTime) >= duration;
    },

    getProgress() {
      if (!isRunning || startTime === null) return 1;
      const elapsed = Date.now() - startTime;
      return Math.max(0, Math.min(1, elapsed / duration));
    }
  };
}

/**
 * Simple linear interpolation between two values
 * 
 * @param {number} startValue - Starting value
 * @param {number} endValue - Ending value
 * @param {number} t - Progress (0 to 1)
 * @param {string} easing - Optional easing function (default: 'linear')
 * @returns {number} Interpolated value
 */
function lerp(startValue, endValue, t, easing = 'linear') {
  const easingFunctions = {
    linear: (t) => t,
    easeIn: (t) => t * t,
    easeOut: (t) => t * (2 - t),
    easeInOut: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
  };

  const easingFunc = easingFunctions[easing] || easingFunctions.linear;
  const easedT = easingFunc(Math.max(0, Math.min(1, t)));
  return startValue + (endValue - startValue) * easedT;
}

module.exports = {
  createModulator,
  modulateVariable,
  lerp
};

