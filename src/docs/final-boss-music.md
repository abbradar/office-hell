# Final boss music — track structure & energy contour

Reference for authoring the boss's beatmaps. Pure music analysis,
no encounter design — the boss script's beatmaps consume this as
a timing grid.

The boss starts with `startMusicWithIntro(FINAL_BOSS_METAL_OPENING_KEY,
FINAL_BOSS_METAL_LOOP_KEY)`, so the intro plays once and then the
loop iterates. Beatmaps anchor at `t0 = 0` (first sample of the
intro); every timestamp below is measured in track time.

---

## 1. Track files & dimensions

Two assets under [`src/assets/audio/loops/stage2/`](../assets/audio/loops/stage2/),
keyed as `FINAL_BOSS_METAL_OPENING_KEY` + `FINAL_BOSS_METAL_LOOP_KEY`.

| Asset    | Duration  | Beats | Bars (4/4) | Beats covered |
| -------- | --------- | ----- | ---------- | ------------- |
| Opening  | 16.991 s  | 32    | 8          | 0 … 31        |
| Loop × N | 42.478 s  | 80    | 20         | 32 … 31+80·N  |

Both lengths land **exactly** on the 113 BPM beat grid — beat
duration 0.5310 s, bar 2.124 s. Anything we put on the grid is
sample-accurate against the file because the file was cut to the
grid.

## 2. Beat math

```
BPM          = 113
BEAT_S       = 60 / 113 = 0.5310 s
HALF_BEAT_S  = BEAT_S / 2 = 0.2655 s
QUARTER_BEAT = BEAT_S / 4 = 0.1327 s
BAR_S        = 4 * BEAT_S = 2.124 s

intro_beats = 32          (bars 0 … 7)
loop_beats  = 80          (bars 0 … 19 within the loop, or
                           bars 8 … 27 in the global numbering)
```

## 3. Full timeline

```
beat:   0 ─────── 31   32 ─────── 111   112 ─────── 191   …
bar:    0 ──────── 7    8 ──────── 27    28 ──────── 47   …
        ├── INTRO ──┤   ├──  LOOP 0  ──┤  ├──  LOOP 1  ──┤
        sparse→build    20-bar body      20-bar body
                        repeats          repeats
```

The intro plays once, then the loop body repeats indefinitely while
the boss is alive.

### 3.1 Beat ↔ time conversion cheat sheet

```
INTRO              loop_idx = -1
  bar B (0..7), beat b (1..4)
    → global_beat = B * 4 + (b - 1)              (range 0..31)
    → music_time  = global_beat * BEAT_S         (range 0.000 .. 16.461 s)

LOOP iteration N   (N = 0, 1, 2, …)
  bar B (0..19), beat b (1..4)
    → global_beat = 32 + N * 80 + B * 4 + (b - 1)
    → music_time  = global_beat * BEAT_S

SUB-BEAT OFFSET   frac ∈ (0, 1)
    → music_time  = (global_beat + frac) * BEAT_S
```

Reference points:
- Intro: beats 0..31 (bars 0..7), 0.000 s .. 16.461 s.
- Loop N: beats `32 + 80·N` .. `111 + 80·N`, music time
  `16.991 + 42.478·N` .. `59.469 + 42.478·N` s.
- Loop seam (intro → loop 0): beat 32, music time 16.991 s.
- The intro's "body-start" (sustained energy ramps up):
  bar 3 beat 1 = global beat 12 = 6.371 s.
- The intro's strongest single onset (a stab):
  bar 2 beat 1 = global beat 8 = 4.246 s.
- Loop's biggest dip (bar 11 beat 3): global beat
  `32 + 80·N + 11·4 + 2 = 78 + 80·N`, music time
  `41.415 + 42.478·N` s for loop N.

---

## 4. Energy contour

Per-beat RMS sampled via `ffmpeg -af "asetnsamples=23410,astats=…"`
(one window per beat). Numbers are dB; lower is quieter. Notable
jumps tagged ↑↑/↓↓.

### 4.1 Intro (32 beats / 8 bars)

```
bar  beat→   1       2        3       4
 0   -10.7  -13.3 ↓ -18.3 ↓  -11.3 ↑    ← sparse: kick / silence / silence / kick
 1   -10.4  -17.8 ↓ -18.6   -10.7 ↑    ← same shape, bar 2 of 3
 2   -12.2  -15.1 ↓ -18.3   -11.3 ↑    ← same shape, bar 3 of 3
 3    -7.9 ↑↑  -7.3  -8.3   -8.7        ← THE BODY-START — full kit kicks in
 4    -9.3   -8.4   -8.7    -8.3        ← sustained body
 5    -9.3   -9.4   -9.1    -9.9
 6    -8.8   -8.5   -8.7    -8.6
 7    -7.9   -8.1  -15.4 ↓ -18.1 ↓     ← decay
 8   -40   (silence — loop seam, beat 32)
```

What the intro is doing:

- **Bars 0-2** (beats 0-11): a **call-and-response** — beat 1 of each
  bar is a single hit (kick or stab), beats 2-3 are silent, beat 4 is
  a smaller hit. The space between hits is the dominant sonic feature.
- **Bar 3** (beats 12-15): **the body-start** — full instrumentation
  kicks in. This is where the "fight feel" actually starts musically.
- **Bars 3-6** (beats 12-27): **sustained body** at ~-8 dB, very
  similar to the loop's average level.
- **Bar 7** (beats 28-31): **decay**, beats 30-31 fall sharply.
- **Beat 32** is silent — the seam handoff to the loop.

Onset detection independently identifies a **strong single transient
at music time 4.20 s (intro beat 8 = bar 2 beat 1)** — a stab/crash
mid-build. RMS averaging smooths it; both events are real and
correspond to different musical features (transient stab vs.
sustained density turn-on).

### 4.2 Loop (80 beats / 20 bars, repeating)

```
bar  beat→  1      2      3      4
 0    -8.3   -9.7   -8.9   -8.6
 1    -8.5  -10.1   -9.0  -10.0
 2    -8.4  -10.1   -8.4   -9.0
 3   -11.2  -12.0   -8.2 ↑ -8.2          ← end-of-phrase drop, snap-back
 4    -8.6  -13.8 ↓ -9.7 ↑ -9.4          ← single-beat hole on beat 2
 5    -7.4   -8.0   -6.9   -8.2          ← LOUDER section starts
 6    -7.7  -13.6 ↓-10.3 ↑ -8.7          ← snare or kick gap
 7    -7.1   -8.6   -7.8   -9.3
 8    -8.4   -9.7  -10.0  -10.6          ← gentle fall
 9    -7.2 ↑ -7.5   -7.3   -7.9          ← peak energy
10    -7.3  -11.6 ↓ -8.1 ↑ -9.2
11    -7.7   -7.4  -13.4 ↓-12.0          ← biggest dip in the loop
12    -8.1 ↑ -8.7   -7.7   -8.2
13    -8.6   -9.1   -8.1   -8.9
14    -7.9   -8.3   -7.4   -9.1
15    -8.8   -9.2   -8.5   -8.3
16    -8.7   -8.5   -8.5   -8.2
17    -8.7   -9.5   -8.6   -9.4
18    -8.9   -8.9   -8.4   -8.1          ← winding down
19    -7.6   -7.8   -8.1   -8.8          ← brief lift, then loop wrap
```

What the loop is doing:

- **Phrased in 4-bar blocks.** Bars 0-3, 4-7, 8-11, 12-15, 16-19. Each
  block has a slight build + a transient drop at its tail (drops at
  end of bar 3, mid bar 6, mid bar 11 are clear).
- **Bars 5-7 and 9 are the loudest** — natural homes for a denser
  pattern layer.
- **Bar 11 has the biggest dip.** Good place for a *pause* (one beat
  of relief) or a single high-contrast aimed shot.
- **Bars 12-19** are sustained mid-level — a flatter "body" section.
  Easy to hold a single layer across.
- **Bar 19 → bar 0 wrap is seamless** (Vorbis loop seam). Patterns
  that cross the boundary play through cleanly.

### 4.3 The intro → loop seam: a +10 dB hard cut

Comparing the last 500 ms of the opening against the first 500 ms
of the loop body shows the seam is a **deliberate dramatic cut**,
not a smooth crossfade:

| Measurement       | Opening end (last 500 ms) | Loop start (first 500 ms) | Δ           |
| ----------------- | ------------------------- | ------------------------- | ----------- |
| RMS               | −15.95 dBFS               | **−5.83 dBFS**            | **+10.1 dB** |
| Peak              | 0.524                     | 1.386 (limiter-hot)       | —           |
| Brightness (ZCR)  | 4 246 Hz (hat-heavy tail) | 2 148 Hz (body-heavy)     | 1.98× shift |

This is the **musical "now we fight" moment** — the seam itself is
the audible spell-card-activation. Worth marking visibly in the
boss pattern (e.g. a one-shot accent burst at beat 32 = music time
16.991 s).

The loop → loop wrap, by contrast, is empirically click-free (the
file ends at −0.290 and starts with 3 literal zero samples).
Patterns that fire across this boundary play through without
audible artifacts.

### 4.4 Onset density

Onset detection on the audio gives **~7.5 Hz onset density** in
both tracks (128 onsets in the 17-s opening, 321 in the 42-s loop —
~4 onsets per beat on average). That's the continuous 16th-note
hi-hat groove driving both tracks.

A continuous bullet stream firing at ~7.5 Hz would saturate
visually — beyond ~8 events/s, individual bullets stop reading as
discrete and merge. Useful as a ceiling for any "ambient stream"
layer; for beat-aligned patterns, fire on the beat or sub-beat,
not on every onset.
