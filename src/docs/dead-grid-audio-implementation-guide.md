# DEAD GRID — Audio System Implementation Guide
### For use with Claude Code

This document describes the full audio architecture for DEAD GRID: a browser-based bullet hell shmup built on Phaser 3. Hand this file to Claude Code and it will be able to implement the complete audio system from scratch.

---

## Project context

- **Engine:** Phaser 3 (3.60+)
- **Audio:** Phaser Sound Manager (SFX) + Tone.js (music scheduling and beat sync)
- **No Howler.js** — Phaser's sound manager replaces it entirely
- **No manual AudioContext bootstrap** — Phaser owns and manages the AudioContext
- **Audio files:** OGG Vorbis (primary), MP3 fallback
- **SFX files live in:** `assets/audio/sfx/`
- **Music files live in:** `assets/audio/music/`

---

## 1. Audio context — Phaser owns this

Do **not** create an `AudioContext` manually. Do **not** write `context.js`. Phaser creates and manages the AudioContext internally, and handles the browser autoplay unlock automatically via its own `unlockAudioContext` mechanism.

Access the context after Phaser has initialised:

```js
// Inside any Scene method (create, update, etc.)
const ctx = this.sound.context;
```

Pass it to Tone.js immediately in your audio bootstrap scene's `create()`:

```js
Tone.setContext(this.sound.context);
```

This is the only AudioContext in the entire application. Never call `new AudioContext()` anywhere.

---

## 2. Bus architecture

Build the node graph once at startup in `AudioPreloadScene.create()`. The key difference from a vanilla setup: you connect into Phaser's master volume node rather than directly to `ctx.destination`.

```
Phaser SFX sounds
    └─► Phaser internal graph
            └─► sfxBus (GainNode)  ← you insert this
                    └─► compressor (DynamicsCompressor)
                                └─► phaserMaster (Phaser's masterVolumeNode)
                                            └─► ctx.destination

Music (Tone.js)
    └─► musicBus (GainNode)
            └─► compressor (same node)
```

```js
// audio/buses.js
export let sfxBus, musicBus, compressor;

export function initBuses(phaserSoundManager) {
  const ctx = phaserSoundManager.context;

  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.ratio.value     = 4;
  compressor.attack.value    = 0.005;   // 5ms
  compressor.release.value   = 0.3;     // 300ms

  sfxBus           = ctx.createGain();
  sfxBus.gain.value = 1.0;

  musicBus           = ctx.createGain();
  musicBus.gain.value = 0.8;

  // Phaser 3.60+: masterVolumeNode. Older versions: use .destination
  const phaserMaster = phaserSoundManager.masterVolumeNode
                    ?? phaserSoundManager.destination;

  sfxBus.connect(compressor);
  musicBus.connect(compressor);
  compressor.connect(phaserMaster);

  // Route Tone.js output through musicBus
  Tone.setContext(ctx);
  Tone.getDestination().connect(musicBus);
}
```

Call `initBuses(this.sound)` inside `AudioPreloadScene.create()`.

---

## 3. Audio preload scene

Phaser requires all assets to be declared in a `preload()` method before use. Create a dedicated scene for this. Music files are **not** declared here — Tone.js loads them directly via fetch.

```js
// scenes/AudioPreloadScene.js
import { initBuses } from '../audio/buses.js';
import { setSFXScene } from '../audio/sfx/events.js';

export class AudioPreloadScene extends Phaser.Scene {
  constructor() { super({ key: 'AudioPreload' }); }

  preload() {
    // SFX — one file per sound, Phaser manages loading
    this.load.audio('playerShot',    'assets/audio/sfx/player_shot.ogg');
    this.load.audio('graze',         'assets/audio/sfx/graze.ogg');
    this.load.audio('enemyHit',      'assets/audio/sfx/enemy_hit.ogg');
    this.load.audio('bulletCancel',  'assets/audio/sfx/bullet_cancel.ogg');
    this.load.audio('explosionPop',  'assets/audio/sfx/explosion_pop.ogg');
    this.load.audio('explosionMid',  'assets/audio/sfx/explosion_mid.ogg');
    this.load.audio('explosionMega', 'assets/audio/sfx/explosion_mega.ogg');
    this.load.audio('bombCharge',    'assets/audio/sfx/bomb_charge.ogg');
    this.load.audio('deathSting',    'assets/audio/sfx/death_sting.ogg');
    this.load.audio('victorySting',  'assets/audio/sfx/victory_sting.ogg');
    this.load.audio('bossChord',     'assets/audio/sfx/boss_chord.ogg');
    this.load.audio('chainTick',     'assets/audio/sfx/chain_tick.ogg');
    this.load.audio('powerUp',       'assets/audio/sfx/power_up.ogg');
    this.load.audio('invincibility', 'assets/audio/sfx/invincibility.ogg');

    // Music files: do NOT load here — Tone.js handles these via fetch
  }

  create() {
    initBuses(this.sound);
    setSFXScene(this);
    this.scene.start('TitleScene');
  }
}
```

---

## 4. SFX system (Phaser Sound Manager)

Howler.js is not used. All SFX goes through `scene.sound.add()` which wraps Phaser's WebAudioSound, which in turn sits on top of Web Audio.

### 4.1 Voice pool manager

```js
// audio/sfx/pool.js
const voiceCounts = {};
const voiceCaps = {
  playerShot:   4,
  graze:        6,
  enemyHit:     6,
  explosionPop: 3,
  explosionMid: 6,
  cascade:      32,
};

let _scene = null;
export function setSFXScene(scene) { _scene = scene; }
export function getScene()         { return _scene; }

export function playPooled(key, options = {}) {
  const cap = voiceCaps[key] ?? 8;
  voiceCounts[key] = voiceCounts[key] ?? 0;

  if (voiceCounts[key] >= cap) return null;  // at voice cap — drop this trigger

  voiceCounts[key]++;
  const snd = _scene.sound.add(key, {
    volume: options.volume ?? 1,
    detune: options.detune ?? 0,
  });

  snd.once('complete', () => {
    voiceCounts[key] = Math.max(0, voiceCounts[key] - 1);
  });

  snd.play();

  // Apply stereo pan via Web Audio StereoPannerNode
  if (options.pan && snd.source) {
    const ctx    = _scene.sound.context;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.5, Math.min(0.5, options.pan));
    snd.volumeNode?.disconnect();
    snd.volumeNode?.connect(panner);
    panner.connect(sfxBus);
  }

  return snd;
}
```

### 4.2 Individual SFX calls

```js
// audio/sfx/events.js
import { playPooled, setSFXScene, getScene } from './pool.js';
import { musicBus } from '../buses.js';

export { setSFXScene };

// Player shot — pitch variation ±30 cents, panned to firing position
export function playShot(panX = 0) {
  playPooled('playerShot', {
    detune: (Math.random() - 0.5) * 60,
    pan:    panX,
  });
}

// Graze — high bell, rewarding not alarming
export function playGraze() {
  playPooled('graze', {
    detune: (Math.random() - 0.5) * 40,
  });
}

// Enemy hit tick — quiet, 1-3kHz, subordinate to everything
export function playEnemyHit() {
  playPooled('enemyHit', {
    volume: 0.25,
    detune: (Math.random() - 0.5) * 100,
  });
}

// Bullet-cancel cascade — 10-40 bells, pitch rising 0.92→1.18
// Rate expressed as cents: (rate - 1) * 1200
export function playCascade(count = 24, stagger = 14) {
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const ratio  = i / (count - 1);
      const rate   = 0.92 + (0.26 * ratio);
      const detune = Math.round((rate - 1) * 1200);
      playPooled('bulletCancel', { detune });
    }, i * stagger + Math.random() * stagger * 0.4);
  }
}

// Explosion — three-tier hierarchy
export function playExplosion(tier = 'pop', duckMusic = false) {
  const keyMap  = { pop: 'explosionPop', mid: 'explosionMid', mega: 'explosionMega' };
  const poolKey = tier === 'mega' ? 'explosionMid' : 'explosionPop';
  playPooled(keyMap[tier] ?? 'explosionPop', { volume: tier === 'mega' ? 1 : 0.7 });
  if (duckMusic) duckMusicBus(tier === 'mega' ? -12 : -6, 400);
}

// Bomb — 3-stage: charge → detonate → roar
export function playBombSequence() {
  getScene().sound.play('bombCharge');
  setTimeout(() => playExplosion('mega', true), 200);
}

// Duck music bus on heavy SFX hits
function duckMusicBus(dbDelta, releaseMs) {
  const ctx    = getScene().sound.context;
  const now    = ctx.currentTime;
  const cur    = musicBus.gain.value;
  const target = cur * Math.pow(10, dbDelta / 20);
  musicBus.gain.setTargetAtTime(target, now, 0.005);
  musicBus.gain.setTargetAtTime(cur, now + releaseMs / 1000, 0.1);
}

// Stingers — one-shot events, not pooled
export function playDeathSting()    { getScene().sound.play('deathSting'); }
export function playVictorySting()  { getScene().sound.play('victorySting'); }
export function playBossChord()     { getScene().sound.play('bossChord'); }
export function playPowerUp()       { getScene().sound.play('powerUp'); }
export function playInvincibility() { getScene().sound.play('invincibility'); }

// Chain tick — pitch rises with chain level
export function playChainTick(chainLevel = 0) {
  const snd = getScene().sound.add('chainTick', { detune: chainLevel * 100 });
  snd.play();
}
```

---

## 5. Music system (Tone.js — unchanged from vanilla)

Tone.js does not interact with Phaser at all beyond sharing the AudioContext (set once in `initBuses`). The entire music module is identical to a vanilla setup.

### 5.1 Track definitions

```js
// audio/music/tracks.js
export const TRACKS = {
  stage1: {
    bpm: 100,
    key: 'D minor',
    stems: [
      { file: 'assets/audio/music/stage1_drums.ogg', layer: 'drums' },
      { file: 'assets/audio/music/stage1_bass.ogg',  layer: 'bass'  },
      { file: 'assets/audio/music/stage1_lead.ogg',  layer: 'lead'  },
      { file: 'assets/audio/music/stage1_top.ogg',   layer: 'top'   },
    ],
    intensityMap: {
      0.0: ['drums'],
      0.3: ['drums', 'bass'],
      0.6: ['drums', 'bass', 'lead'],
      0.9: ['drums', 'bass', 'lead', 'top'],
    }
  },
  boss1: {
    bpm: 120,
    key: 'C minor',
    loopStart: 8.0,   // bar 5 in seconds — loop back here after first play
    stems: [
      { file: 'assets/audio/music/boss1_loop.ogg', layer: 'full' },
    ],
    intensityMap: { 0.0: ['full'] }
  }
};
```

If you only have single-file loops (not stems), set `stems` to one entry with `layer: 'full'` and `intensityMap: { 0.0: ['full'] }`. The system degrades gracefully.

### 5.2 Music player

```js
// audio/music/player.js
import { musicBus } from '../buses.js';

let players = [];
let currentTrack = null;
let intensity = 0;
const crossfadeDur = 2;

export async function loadTrack(trackDef) {
  await stopTrack();
  currentTrack = trackDef;
  Tone.Transport.bpm.value = trackDef.bpm;

  players = await Promise.all(trackDef.stems.map(async stem => {
    const player = new Tone.Player({
      url:       stem.file,
      loop:      true,
      loopStart: trackDef.loopStart ?? 0,
    }).sync().start(0);

    // Tone.js → raw Web Audio GainNode → musicBus
    const gainNode = Tone.getContext().rawContext.createGain();
    gainNode.gain.value = 0;
    player.connect(gainNode);
    gainNode.connect(musicBus);

    return { player, layer: stem.layer, gainNode };
  }));

  applyIntensity(intensity, true);  // snap to current intensity, no fade
  Tone.Transport.start();
}

export async function stopTrack() {
  Tone.Transport.stop();
  players.forEach(p => { p.player.stop(); p.player.dispose(); });
  players = [];
  currentTrack = null;
}

export function setIntensity(val) {
  intensity = Math.max(0, Math.min(1, val));
  applyIntensity(intensity, false);
}

export function bumpIntensity(delta) { setIntensity(intensity + delta); }

function applyIntensity(val, snap = false) {
  if (!currentTrack) return;
  const now = Tone.getContext().rawContext.currentTime;
  const thresholds = Object.keys(currentTrack.intensityMap)
    .map(Number).sort((a, b) => a - b);
  const active = currentTrack.intensityMap[
    thresholds.filter(t => t <= val).pop() ?? thresholds[0]
  ];
  players.forEach(({ layer, gainNode }) => {
    const target = active.includes(layer) ? 1 : 0;
    if (snap) gainNode.gain.setValueAtTime(target, now);
    else      gainNode.gain.linearRampToValueAtTime(target, now + crossfadeDur);
  });
}
```

### 5.3 Bar-boundary transitions

```js
// audio/music/transitions.js
import { loadTrack, stopTrack } from './player.js';

export function transitionTo(trackDef, { silence = 0, stinger = null } = {}) {
  // '@1m' = next 1-measure boundary in Tone.js notation
  Tone.Transport.scheduleOnce(async () => {
    await stopTrack(0.2);
    if (silence > 0) await sleep(silence * 1000);
    if (stinger) stinger();
    await loadTrack(trackDef);
  }, '@1m');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
```

### 5.4 Boss entry sequence (TLB)

```js
// audio/music/boss-entry.js
import { stopTrack, loadTrack } from './player.js';
import { sfxBus } from '../buses.js';

export async function playBossEntry(bossTrackDef) {
  const ctx = Tone.getContext().rawContext;

  await stopTrack();          // 1. music cuts over 200ms

  playAlarm(ctx, 1.5);        // 2. alarm klaxon (1.5s)
  await sleep(1500);

  await sleep(300);           // 3. full silence — this is the dramatic moment

  playSubRumble(ctx, 0.5);    // 4. sub-bass rumble (500ms)
  await sleep(500);

  await loadTrack(bossTrackDef); // 5. boss music — hard cut, no crossfade
}

function playAlarm(ctx, duration) {
  const osc  = ctx.createOscillator();
  const lfo  = ctx.createOscillator();
  const lfoG = ctx.createGain();
  const g    = ctx.createGain();
  osc.type = 'sawtooth'; osc.frequency.value = 880;
  lfo.type = 'square';   lfo.frequency.value = 6;
  lfoG.gain.value = 0.4;
  g.gain.value    = 0.3;
  lfo.connect(lfoG); lfoG.connect(g.gain);
  osc.connect(g);    g.connect(sfxBus);
  const now = ctx.currentTime;
  osc.start(now); lfo.start(now);
  osc.stop(now + duration); lfo.stop(now + duration);
}

function playSubRumble(ctx, duration) {
  const osc = ctx.createOscillator();
  const g   = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(40, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(25, ctx.currentTime + duration);
  g.gain.setValueAtTime(0.5, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(g); g.connect(sfxBus);
  osc.start(); osc.stop(ctx.currentTime + duration + 0.05);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
```

---

## 6. Beat-sync scoring feedback

```js
// audio/beat.js
let onBeatCallbacks = [];

export function initBeatSync(bpm) {
  Tone.Transport.bpm.value = bpm;
  Tone.Transport.scheduleRepeat(() => {
    onBeatCallbacks.forEach(cb => cb(Tone.now()));
  }, '4n');
}

export function onBeat(cb) { onBeatCallbacks.push(cb); }

// Returns 0.0 (on beat) → 0.5 (halfway between beats)
export function getBeatPhase() {
  const ticks = Tone.Transport.ticks;
  const ppq   = Tone.Transport.PPQ;
  return (ticks % ppq) / ppq;
}

// Beat window: 50% of beat duration (±234ms at 128 BPM)
export function isOnBeat(windowFraction = 0.5) {
  const phase = getBeatPhase();
  return phase <= windowFraction / 2 || phase >= 1 - windowFraction / 2;
}
```

---

## 7. Gameplay → audio events

Wire these calls from your Phaser Scene's `update()` or event handlers. The game loop never touches Web Audio or Tone.js directly — always through the audio module API.

| Game event | Audio call |
|---|---|
| Player fires | `playShot(sprite.x / this.scale.width * 2 - 1)` |
| Bullet grazes hitbox | `playGraze()` |
| Player bullet hits enemy | `playEnemyHit()` |
| Enemy dies (small) | `playExplosion('pop')` |
| Enemy dies (mid) | `playExplosion('mid')` |
| Boss hit / phase end | `playExplosion('mega', true)` |
| Bomb activated | `playBombSequence()` |
| Player death | `playDeathSting(); stopTrack()` |
| Stage cleared | `playVictorySting(); transitionTo(TRACKS.intermediate)` |
| Boss appears | `playBossChord(); playBossEntry(TRACKS.boss1)` |
| Chain multiplier up | `playChainTick(chainLevel)` |
| Power level up | `playPowerUp()` |
| Post-death invincibility | `playInvincibility()` |
| Enemy count rises | `bumpIntensity(+0.1)` |
| Screen cleared / safe | `bumpIntensity(-0.15)` |

---

## 8. LUFS normalisation (pre-processing, not runtime)

Before shipping, normalise all music files to -14 LUFS so boss tracks don't blow out relative to stage music:

```bash
# Requires ffmpeg
for f in assets/audio/music/*.wav; do
  ffmpeg -i "$f" \
    -af loudnorm=I=-14:TP=-1:LRA=11 \
    -c:a libvorbis -q:a 5 \
    "${f%.wav}.ogg"
done
```

---

## 9. File structure

```
assets/
└── audio/
    ├── music/
    │   ├── stage1_drums.ogg
    │   ├── stage1_bass.ogg
    │   ├── stage1_lead.ogg
    │   ├── stage1_top.ogg
    │   ├── boss1_loop.ogg
    │   └── ...
    └── sfx/
        ├── player_shot.ogg
        ├── graze.ogg
        ├── enemy_hit.ogg
        ├── bullet_cancel.ogg
        ├── explosion_pop.ogg
        ├── explosion_mid.ogg
        ├── explosion_mega.ogg
        ├── bomb_charge.ogg
        ├── death_sting.ogg
        ├── victory_sting.ogg
        ├── boss_chord.ogg
        ├── chain_tick.ogg
        ├── power_up.ogg
        └── invincibility.ogg

src/
├── scenes/
│   └── AudioPreloadScene.js   ← Phaser scene; declares SFX assets, calls initBuses
└── audio/
    ├── buses.js               ← node graph; takes phaserSoundManager as argument
    ├── beat.js                ← Tone.js beat clock and window checker
    ├── music/
    │   ├── tracks.js          ← track and stem definitions
    │   ├── player.js          ← Tone.js playback and intensity system
    │   ├── transitions.js     ← bar-boundary scheduled cuts
    │   └── boss-entry.js      ← TLB alarm / silence / rumble / drop sequence
    └── sfx/
        ├── pool.js            ← voice counting and scene reference
        └── events.js          ← all SFX wrapper functions
```

---

## 10. Implementation order for Claude Code

Do these in order. Each step is independently testable before moving on.

1. `AudioPreloadScene.js` — Phaser scene skeleton with all SFX keys in `preload()`. Test: scene loads and transitions to TitleScene without errors.
2. `audio/buses.js` — node graph wired into `phaserSoundManager.masterVolumeNode`. Test: `sfxBus` and `musicBus` exist, no console errors.
3. `audio/sfx/pool.js` — voice counter and scene reference. Test: `playPooled('playerShot', {})` plays a sound after preload.
4. `audio/sfx/events.js` — all SFX wrapper functions. Test each from browser console: `playShot()`, `playGraze()`, `playCascade()`.
5. `audio/music/player.js` — single-stem loop via Tone.js. Test: `loadTrack(TRACKS.boss1)` plays and loops cleanly.
6. `audio/music/tracks.js` + intensity map — multi-stem setup. Test: `setIntensity(0.9)` brings all stems in over 2 seconds.
7. `audio/beat.js` — beat clock. Test: `onBeat(() => console.log('beat'))` fires every quarter note in sync with music.
8. `audio/music/transitions.js` — bar-boundary scheduling. Test: call `transitionTo()` mid-bar, verify it waits until the next bar before cutting.
9. `audio/music/boss-entry.js` — full TLB sequence. Test end to end, log timestamps for each phase.
10. Wire all event calls into Phaser Scenes via the gameplay → audio event table above.

---

## 11. Dependencies

```html
<!-- In index.html, before your game scripts -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/phaser/3.60.0/phaser.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/tone/14.7.77/Tone.js"></script>
```

Phaser replaces Howler.js entirely. Tone.js is still required for music scheduling, beat sync, and bar-boundary transitions. No other audio dependencies needed.

---

## 12. Key differences from a vanilla (no Phaser) setup

| Concern | Vanilla | Phaser |
|---|---|---|
| AudioContext creation | `new AudioContext()` in `context.js` | `this.sound.context` — Phaser owns it |
| Autoplay unlock | Manual gesture handler required | Phaser handles automatically |
| SFX playback | Howler.js sprite | `scene.sound.add(key).play()` |
| SFX asset loading | Howler `src` array | `this.load.audio()` in `preload()` |
| Bus insertion point | Direct to `ctx.destination` | Into `phaserSoundManager.masterVolumeNode` |
| Voice pooling | Howler `pool` option | Manual count in `pool.js` |
| Stereo panning | `Howl.stereo()` | Manual `StereoPannerNode` via `snd.volumeNode` |
| Music playback | Tone.js (unchanged) | Tone.js (unchanged) |
| Beat sync | Tone.js (unchanged) | Tone.js (unchanged) |
| Bar-boundary transitions | Tone.js (unchanged) | Tone.js (unchanged) |
| Boss entry sequence | Tone.js + raw Web Audio (unchanged) | Tone.js + raw Web Audio (unchanged) |
