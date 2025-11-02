# ALiCA Syntax Documentation

**Ableton Live Coding Automation**

ALiCA provides a powerful domain-specific language for live coding musical sequences in Ableton Live.

## Table of Contents

1. [Basic Note Syntax](#basic-note-syntax)
2. [Note Parameters](#note-parameters)
3. [Randomization](#randomization)
4. [Scales and Chords](#scales-and-chords)
5. [Sequences and Cycles](#sequences-and-cycles)
6. [Duration Tokens](#duration-tokens)
7. [Arpeggiators](#arpeggiators)
8. [Probability Modifiers](#probability-modifiers)
9. [Examples](#examples)

---

## Basic Note Syntax

### Note Declaration

```
n(value)
```

**Parameters:**
- `value`: MIDI note number (0-127), note token (e.g., `c4`, `c#3`), or randomization token

**Examples:**
```
n(60)           // Middle C (MIDI 60)
n(c4)           // C in octave 4
n(c#4)          // C# in octave 4
n(r)            // Random note
n(r.o{c4,d4,e4}) // Random from array
```

### Note Tokens

ALiCA supports scientific pitch notation:
- Format: `[note][accidental][octave]`
- Notes: `c`, `d`, `e`, `f`, `g`, `a`, `b`
- Accidentals: `#` (sharp), `b` (flat)
- Octaves: `0-10` (C4 = MIDI 60)

**Examples:**
```
c4     // C in octave 4 (MIDI 60)
c#3    // C# in octave 3 (MIDI 49)
db4    // Db in octave 4 (MIDI 61, same as C#4)
f5     // F in octave 5 (MIDI 77)
```

---

## Note Parameters

Notes can be modified with various parameters using dot notation:

```
n(value).d(duration).v(velocity).c(channel)
```

### Duration (`.d(...)`)

Controls note length in milliseconds or using duration tokens.

**Syntax:**
```
.d(value)
```

**Values:**
- Number: Duration in milliseconds
- `*f`: Multiply default duration (e.g., `*2`, `*1.5`)
- `/f`: Divide default duration (e.g., `/2`, `/4`)
- `bt`: One beat duration
- `br`: One bar duration
- `bt*n`: Multiply beat duration by even number (e.g., `bt*2`, `bt*4`)
- `bt/n`: Divide beat duration by even number (e.g., `bt/2`, `bt/4`)
- `r`: Random duration
- `r.o{...}`: Random from duration array (see Arrays)

**Examples:**
```
n(60).d(500)        // 500ms duration
n(60).d(bt)        // One beat
n(60).d(bt/2)       // Half beat
n(60).d(bt*2)       // Two beats
n(60).d(*2)         // Double default duration
n(60).d(/4)         // Quarter default duration
n(60).d(r)          // Random duration
n(60).d(r.o{bt/4,bt/2,bt}) // Random from array
```

### Velocity (`.v(...)`)

Controls note velocity (0-127).

**Syntax:**
```
.v(value)
```

**Values:**
- Number: Velocity value (0-127)
- `r`: Random velocity (0-127)
- `r.o{...}`: Random from velocity array (see Arrays)
- Range: Use with `.vRange(min, max)` for continuous randomization

**Examples:**
```
n(60).v(80)         // Velocity 80
n(60).v(127)        // Maximum velocity
n(60).v(r)          // Random velocity
n(60).v(r.o{0.3,0.5,0.7}) // Random from normalized values (scaled to 0-127)
n(60).v(r).vRange(0.5,1.0) // Random between 50% and 100% velocity
```

### Channel (`.c(...)`)

Sets MIDI channel (1-16).

**Syntax:**
```
.c(value)
```

**Values:**
- Number: Channel (1-16)
- `r`: Random channel (1-16)

**Examples:**
```
n(60).c(1)          // Channel 1
n(60).c(16)         // Channel 16
n(60).c(r)          // Random channel
```

---

## Randomization

### Random Value (`r`)

Use `r` for continuous randomization:

```
n(r)                // Random note (C1-C8 default)
n(r).v(r)            // Random note and velocity
```

### Array Randomizer (`r.o{...}`)

Select randomly from an array of values.

**Syntax:**
```
r.o{item1, item2, item3, ...}
```

**Examples:**
```
n(r.o{c4,d4,e4})                    // Random note from array
n(60).v(r.o{60,80,100,127})        // Random velocity from array
n(60).d(r.o{bt/4,bt/2,bt})         // Random duration from array
n(r.o{scale(c-ionian)})            // Random note from scale
n(r.o{chord(c-maj7)})              // Random note from chord
```

### Range Constraints

Limit randomization to a range:

#### Note Range (`.nRange(...)`)
```
.nRange(minNote, maxNote)
```

**Examples:**
```
n(r).nRange(c3, c5)                 // Random note between C3 and C5
n(r.o{c4,d4,e4}).nRange(c3,c5)     // Random from array, filtered by range
```

#### Velocity Range (`.vRange(...)`)
```
.vRange(min, max)
```
- `min`, `max`: Normalized values (0-1), automatically scaled to 0-127

**Examples:**
```
n(60).v(r).vRange(0.5, 1.0)        // Random velocity between 50% and 100%
```

#### Duration Range (`.dRange(...)`)
```
.dRange(minToken, maxToken)
```

**Examples:**
```
n(60).d(r).dRange(bt/8, bt*2)       // Random duration between 1/8 beat and 2 beats
```

---

## Scales and Chords

### Scale Syntax

Generate notes from musical scales.

**Syntax:**
```
scale(root-mode)
scale(root-mode).q(quality)
```

**Parameters:**
- `root`: Root note (e.g., `c`, `d#`, `f`)
- `mode`: Scale mode (see [Supported Scales](#supported-scales))
- `quality` (optional): Chord quality for `.q()` modifier (e.g., `maj7`, `min7`)

**Examples:**
```
scale(c-ionian)                     // C major scale
scale(d-dorian)                     // D dorian mode
scale(c-iwato)                      // C iwato (Japanese scale)
scale(c-ionian).q(maj7)            // C major 7th chord (built from scale)
```

**Using in sequences:**
```
n(r.o{scale(c-ionian)})            // Random note from C major scale
```

### Chord Syntax

Generate notes from chords.

**Syntax:**
```
chord(root-quality)
```

**Parameters:**
- `root`: Root note (e.g., `c`, `d#`, `f`)
- `quality`: Chord quality (see [Supported Chords](#supported-chords))

**Examples:**
```
chord(c-maj7)                       // C major 7th
chord(d-min7)                       // D minor 7th
chord(f-9)                          // F dominant 9th
```

**Using in sequences:**
```
n(r.o{chord(c-maj7)})              // Random note from C major 7th chord
```

### Supported Scales

**Modes:**
- `ionian` (major)
- `dorian`
- `phrygian`
- `lydian`
- `mixolydian`
- `aeolian` (minor)
- `locrian`

**Pentatonic:**
- `pentatonicMajor`
- `pentatonic-minor`
- `pentatonic-blues`

**Japanese:**
- `iwato`
- `in` / `insen`
- `yo`

**Blues:**
- `bluesMajor`
- `blues-minor`

**Harmonic/Melodic:**
- `harmonic-minor`
- `melodic-minor`
- `double-harmonic`

**Synthetic:**
- `whole-tone`
- `diminished`
- `augmented`

**Exotic:**
- `enigmatic`
- `neapolitan`
- `hungarian-minor`
- `persian`
- `arabic`

### Supported Chords

**Triads:**
- `maj`, `min`, `dim`, `aug`, `sus2`, `sus4`

**7th Chords:**
- `maj7`, `min7`, `7`, `maj7#5`, `min7b5`, `dim7`

**9th Chords:**
- `maj9`, `min9`, `9`, `9#5`, `min9b5`, `b9`, `#9`

**11th Chords:**
- `maj11`, `min11`, `11`, `#11`

**13th Chords:**
- `maj13`, `min13`, `13`, `13b9`, `13#9`, `13#11`

**Add Chords:**
- `add9`, `add11`, `6`, `69`, `min6`, `min69`

**Altered:**
- `alt`, `7alt`, `no3`, `no5`

**Sus Chords:**
- `sus9`, `7sus4`

---

## Sequences and Cycles

### Sequence Syntax

Multiple notes form a sequence:

```
n(60).d(500) n(62).d(500) n(64).d(500)
```

### Repeat Syntax

Repeat a note multiple times:

```
n(60)^4              // Play note 60 four times
n(60).d(500).v(80)^3 // Repeat with parameters
```

### Cycle Syntax

Play multiple sequences in a cycle with block modifiers:

```
[sequence].t(type).c(channel).co(cutoff).p(probability)
```

**Block Modifiers:**

#### Type (`.t(...)`)
- `fit`: Fit all notes evenly into one bar
- `beat`: Each note takes one beat
- `bar`: Each note takes one bar

#### Channel Override (`.c(...)`)
- Sets MIDI channel for all notes in the block (1-16)

#### Cutoff (`.co(...)`)
- Duration token for cutoff (future use)

#### Probability (`.p(...)`)
- `r0.4` or `r.0.4`: Remove probability (0-1)
- `m0.7` or `m.0.7`: Mute probability (0-1)

**Examples:**
```
[n(60)^4].t(fit).c(1) [n(62)^8].t(fit).c(2)
[n(r).v(r).nRange(c3,c5)]^16.t(fit).c(1).p(m0.3)
```

---

## Duration Tokens

Duration tokens are relative to the current tempo and time signature.

### Basic Tokens

- `bt`: One beat duration
- `br`: One bar duration

### Beat Multipliers

- `bt*n`: Multiply beat by even number (e.g., `bt*2`, `bt*4`, `bt*8`)
- `bt/n`: Divide beat by even number (e.g., `bt/2`, `bt/4`, `bt/8`)

**Valid multipliers/divisors:** Even numbers only (2, 4, 6, 8, 10, 12, 14, 16, ..., 64)

**Examples:**
```
bt/16               // Sixteenth note
bt/8                // Eighth note
bt/4                // Quarter note
bt/2                // Half note
bt                  // Whole note (one beat)
bt*2                // Two beats
bt*4                // Four beats
```

---

## Arpeggiators

Arpeggiators control how array values are selected when using `r.o{...}`, providing ordered patterns instead of random selection. Each parameter has its own independent arpeggiator, allowing complex polyrhythmic patterns.

### Arpeggiator Syntax

Each parameter can have its own arpeggiator:

```
.nArp(mode)    // Note arpeggiator
.dArp(mode)    // Duration arpeggiator
.vArp(mode)    // Velocity arpeggiator
.pmArp(mode)   // Mute probability arpeggiator
.prArp(mode)   // Remove probability arpeggiator
```

**Modes:**
- `random`: Random selection (default when no arpeggiator is specified)
- `up`: Ascending order (lowest to highest)
- `down`: Descending order (highest to lowest)
- `up-down`: Ascending then descending (cyclic, seamless loop)
- `down-up`: Descending then ascending (cyclic, seamless loop)

### How Arpeggiators Work

When an arpeggiator mode is set, the array values are first sorted by their numeric value, then reordered according to the mode:

1. **Array Sorting**: Arrays are sorted by value:
   - Notes: Sorted by MIDI number (or lowest note for chords)
   - Velocities/Durations: Sorted numerically
   - Chords: Sorted by the lowest MIDI note in each chord

2. **Mode Application**: The sorted array is reordered based on the mode:
   - `up`: Keep ascending order
   - `down`: Reverse to descending order
   - `up-down`: Ascending, then reverse (excluding duplicates for seamless cycling)
   - `down-up`: Descending, then reverse (excluding duplicates for seamless cycling)

3. **Position Cycling**: Each time a value is needed, the arpeggiator cycles through the ordered array based on the position in the sequence. Positions increment across chunks and repeats, ensuring continuous patterns.

### What Each Modulates

- **`.nArp(mode)`**: Controls note arrays `n(r.o{...})` including chords
- **`.dArp(mode)`**: Controls duration arrays `.d(r.o{...})`
- **`.vArp(mode)`**: Controls velocity arrays `.v(r.o{...})`
- **`.pmArp(mode)`**: Controls mute probability arrays `.pm(r.o{...})`
- **`.prArp(mode)`**: Controls remove probability arrays `.pr(r.o{...})`

Each arpeggiator operates independently, allowing different patterns for each parameter simultaneously.

### Examples

#### Basic Note Arpeggio
```
// Play C-E-G ascending, then cycle
n(r.o{c4,e4,g4}).nArp(up)           // C, E, G, C, E, G, ...
```

#### Velocity Arpeggio
```
// Velocity ascending through array
n(60).v(r.o{0.2,0.5,0.8}).vArp(up) // Velocity: 20%, 50%, 80%, 20%, ...
```

#### Duration Arpeggio
```
// Duration decreases through array
n(60).d(r.o{bt/4,bt/2,bt}).dArp(down) // Duration: bt, bt/2, bt/4, bt, ...
```

#### Chord Arpeggios
```
// Cycle through chord progressions
n(r.o{<chord(c-maj)>,<chord(f-maj)>,<chord(g-maj)>}).nArp(up)
// Plays: C-maj chord, F-maj chord, G-maj chord, then repeats

// With repeat syntax - cycles through chords over multiple repeats
n(r.o{<chord(c-maj)>,<chord(f-maj)>,<chord(g-maj)>})^3.nArp(up)
// Position 0: C-maj, Position 1: F-maj, Position 2: G-maj
```

#### Multiple Independent Arpeggiators
```
// Notes go up, velocity goes down - all independently
n(r.o{c4,e4,g4}).nArp(up).v(r.o{0.3,0.6,0.9}).vArp(down)
// Notes: C, E, G, C, E, G, ...
// Velocity: 90%, 60%, 30%, 90%, 60%, 30%, ...
```

#### Arpeggio Modes
```
// Up-down pattern (seamless cycling)
n(r.o{c4,e4,g4}).nArp(up-down)
// Plays: C, E, G, E, C, E, G, E, ... (cycles seamlessly)

// Down-up pattern (seamless cycling)
n(r.o{c4,e4,g4}).nArp(down-up)
// Plays: G, E, C, E, G, E, C, E, ... (cycles seamlessly)
```

#### Combined with Repeat Syntax
```
// Arpeggiator position cycles across repeated chunks
n(r.o{c4,e4,g4})^3.nArp(up)
// Chunk 0: C, Chunk 1: E, Chunk 2: G
// Next cycle: Chunk 0: C, Chunk 1: E, Chunk 2: G, ...

// Chord progression with repeats
n(r.o{<chord(c-maj)>,<chord(f-maj)>,<chord(g-maj)>})^3.nArp(up).c(2)
// Each repeat plays the next chord in sequence: C-maj → F-maj → G-maj
```

### Important Notes

- **Chords in Arrays**: When using chord syntax `<chord(c-maj)>` in arrays, arpeggiators sort by the lowest MIDI note in each chord
- **Position Cycling**: Arpeggiator positions increment across chunks and repeats, ensuring continuous patterns even with repeat syntax (`^N`)
- **Parameter Order**: Arpeggiators can appear before or after repeat syntax (`^N`). Both `n(...).nArp(up)^3` and `n(...)^3.nArp(up)` work correctly
- **Independence**: Each parameter's arpeggiator works independently, allowing complex polyrhythmic patterns

---

## Probability Modifiers

Control the probability of muting or removing notes.

### Mute Probability (`.pm(...)`)

Probability that a note will be muted (velocity = 0).

**Syntax:**
```
.pm(value)
.pmRange(min, max)
```

**Values:**
- Number: Mute probability (0-1)
- `r`: Random mute probability
- `.pmRange(min, max)`: Random mute probability within range

**Examples:**
```
n(60).pm(0.3)                      // 30% chance to mute
n(60).pm(r).pmRange(0.2, 0.5)     // Random mute probability between 20% and 50%
```

### Remove Probability (`.pr(...)`)

Probability that a note will be completely removed from the sequence.

**Syntax:**
```
.pr(value)
.prRange(min, max)
```

**Values:**
- Number: Remove probability (0-1)
- `r`: Random remove probability
- `.prRange(min, max)`: Random remove probability within range

**Examples:**
```
n(60).pr(0.4)                      // 40% chance to remove
n(60).pr(r).prRange(0.1, 0.3)     // Random remove probability between 10% and 30%
```

**Note:** In `fit` mode, removed notes are filtered out before calculating timing weights.

---

## Examples

### Basic Sequence

```
n(60).d(500).v(80) n(62).d(500).v(80) n(64).d(500).v(80)
```

### Random Sequence

```
n(r).nRange(c3,c5).v(r).vRange(0.5,1.0).d(r.o{bt/4,bt/2,bt})
```

### Scale-Based Sequence

```
n(r.o{scale(c-ionian)}).nRange(c3,c5).v(80).d(bt/4)^16
```

### Chord Arpeggio with Multiple Chords

```
// Cycle through chord progression
n(r.o{<chord(c-maj)>,<chord(f-maj)>,<chord(g-maj)>})^3.nArp(up)
// Each repeat plays the next chord: C-maj → F-maj → G-maj

// Arpeggiate single chord notes
n(r.o{chord(c-maj7)}).nArp(up-down).d(bt/8)^8
// Random note from C-maj7 chord, arpeggiated up-down pattern
```

### Complex Cycle

```
[n(r.o{scale(c-ionian)})^6.nRange(c3,c4)].c(1) 
[n(r.o{scale(c-iwato)})^16.nRange(c4,c5).v(r).vRange(0,1).d(r.o{bt/4,bt/2}).pm(r).pmRange(0,0.3).dRange(bt/8,bt*2).nArp(up-down)].c(1)
```

### Probability-Based Sequence

```
n(60).pm(0.3).d(bt/4) n(62).pr(0.2).d(bt/4) n(64).d(bt/4)
```

---

## Notes

- All timing is relative to the current tempo and time signature received from Ableton Live
- Duration tokens (`bt`, `br`) are calculated dynamically based on OSC tempo updates
- Randomization uses JavaScript's `Math.random()` - each note gets a fresh random value
- Arpeggiator position cycles through sequences, allowing patterns across multiple notes
- Scale/chord generation respects note ranges when used with `.nRange()`

