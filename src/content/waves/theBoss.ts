import { FINAL_BOSS_METAL_LOOP_KEY, FINAL_BOSS_METAL_OPENING_KEY } from '../../audio/keys';
import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { BossKind, becomeHittable, bossShudder } from '../../script/boss';
import { moveTo } from '../../script/patterns';
import {
  type BeatmapBeat,
  clearBullets,
  markWave,
  prepareForBoss,
  race,
  runBeatmap,
  startMusicWithIntro,
  suspendRunning,
  untilHpBelow,
  waitEntityDead,
} from '../../script/stage';
import { EntityKind, type ScriptYield } from '../../script/types';

// --- Final boss: 4 HP-gated phases, one beatmap per phase ---
//
// Music structure (see src/docs/final-boss-music.md for the full
// analysis) — 113 BPM, intro = 32 beats / 17 s, loop = 80 beats /
// 42.5 s. Beatmaps anchor at t0 = 0 (first sample of intro).
//
// Each phase races its own beatmap against an HP threshold. When HP
// crosses the threshold, the current beatmap is cancelled and the
// next phase's beatmap starts. The phase beatmaps are the four
// arrays at the bottom of this file (`phase1Beats` … `phase4Beats`)
// — currently empty; fill them in with the pattern events.
//
// Music keeps playing throughout; if the boss outlasts the first
// loop iteration, the loop body repeats and the absolute beat times
// in the beatmaps continue past the loop seam.

const BOSS_ENTRY_SPEED = 110;
const BOSS_ENTRY_Y = 87;
const BOSS_HOLD_BEFORE_TALK = 20;

const BOSS_HP = 2000;
const PHASE_2_HP = BOSS_HP * 0.75; // 1500
const PHASE_3_HP = BOSS_HP * 0.5; //  1000
const PHASE_4_HP = BOSS_HP * 0.25; //  500

// Beat math (113 BPM). Exposed for beatmap authors.
export const BPM = 113;
export const BEAT_S = 60 / BPM;
export const HALF_BEAT_S = BEAT_S / 2;
export const BAR_S = 4 * BEAT_S;
export const INTRO_BEATS = 32;
export const LOOP_BEATS = 80;

// `loopBarBeat(loopBar, beatInBar)` → absolute beat index (intro
// included). Loop bar 0 starts at beat 32; bar 19 ends at beat 111.
export const loopBarBeat = (loopBar: number, beatInBar: 1 | 2 | 3 | 4): number =>
  INTRO_BEATS + loopBar * 4 + (beatInBar - 1);

// --- Phase beatmaps (TO FILL IN) ---
//
// Each entry: `{ t: <music-time in seconds>, fire: (self) => { … } }`
// `t` is anchored to the intro's first sample (t0 = 0). Use
// `BEAT_S` / `BAR_S` / `loopBarBeat(...)` to construct beat times.
// `fire` is a sync callback — call `ring`, `aimed`, `spread`,
// `lineStroke`, or spawn entities directly. Generators (`wave` etc.)
// can't run from inside `fire`; for those, write a custom lifted
// helper outside `runBeatmap`.
//
// runBeatmap skips past beats whose `t` is already in the past, so
// these beatmaps can include events from the whole fight — only
// future-relative-to-phase-entry beats fire.

export const phase1Beats: BeatmapBeat[] = [
  // TODO: phase 1 pattern (HP 2000 → 1500).
];

export const phase2Beats: BeatmapBeat[] = [
  // TODO: phase 2 pattern (HP 1500 → 1000).
];

export const phase3Beats: BeatmapBeat[] = [
  // TODO: phase 3 pattern (HP 1000 → 500).
];

export const phase4Beats: BeatmapBeat[] = [
  // TODO: phase 4 pattern (HP 500 → 0).
];

// --- Boss script ---

function* theBossScript(self: Entity) {
  // Entry — boss flies down from above to his fight position.
  yield* moveTo(self, GAME_W / 2, BOSS_ENTRY_Y, BOSS_ENTRY_SPEED);
  yield BOSS_HOLD_BEFORE_TALK;

  // Opening dialog — short, just enough to set the tone before the
  // first pattern lands.
  const ch = self.stage.player.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    right: { sprite: 'boss', frame: 1, name: 'The Boss' },
    lines: [
      { speaker: 'right', text: 'Working hard, I see. Or hardly working?' },
      { speaker: 'left', text: "It's 11 PM. I just want to go home." },
      { speaker: 'right', text: "Let's circle back on that — after your performance review." },
    ],
  });

  // Claim the HUD header now that the fight is starting; release it
  // on death.
  self.stage.bossName = 'The Boss';
  self.onDeath(() => {
    self.stage.bossName = null;
  });
  becomeHittable(self);

  // Hard-cut to the metal track. `t0 = 0` is the first sample of the
  // intro; every beatmap timestamp below is anchored to it.
  yield* startMusicWithIntro(FINAL_BOSS_METAL_OPENING_KEY, FINAL_BOSS_METAL_LOOP_KEY);

  // Phase 1 — HP 2000 → 1500.
  self.say('Performance review.', 90);
  yield* runPhase(self, phase1Beats, PHASE_2_HP);

  // Phase 2 — HP 1500 → 1000.
  self.say('Synergy escalation!', 90);
  yield* runPhase(self, phase2Beats, PHASE_3_HP);

  // Phase 3 — HP 1000 → 500.
  self.say('Bring in the team.', 90);
  yield* runPhase(self, phase3Beats, PHASE_4_HP);

  // Phase 4 — HP 500 → 0. Runs until the boss dies.
  self.say('Final review!', 90);
  yield* race(holdAfterBeatmap(self, phase4Beats), waitEntityDead(self));
}

// Race a phase's beatmap against an HP threshold. When HP crosses
// the threshold, the race cancels the beatmap and the parent
// generator advances to the next phase. `holdAfterBeatmap` keeps
// the beatmap branch open if the events finish before the HP gate
// (e.g. a short beatmap, or an empty one) — without the hold, an
// exhausted beatmap would win the race and prematurely end the
// phase regardless of HP.
function* runPhase(
  self: Entity,
  beats: BeatmapBeat[],
  hpGate: number,
): Generator<ScriptYield, void, void> {
  yield* race(holdAfterBeatmap(self, beats), untilHpBelow(self, hpGate));
}

function* holdAfterBeatmap(self: Entity, beats: BeatmapBeat[]): Generator<ScriptYield, void, void> {
  yield* runBeatmap(self, beats);
  // Beats exhausted — hold so the outer race resolves on the HP gate
  // (or `waitEntityDead`), not on the beatmap finishing.
  while (true) yield 30;
}

// --- Death ---

function* theBossDeath(self: Entity): Generator<ScriptYield, void, void> {
  self.body.setVelocity(0, 0);
  self.body.enable = false;

  const ch = self.stage.player.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    right: { sprite: 'boss', frame: 1, name: 'The Boss' },
    lines: [{ speaker: 'right', text: 'TODO: final boss defeat line.' }],
  });

  clearBullets(self);
  yield* bossShudder(self);
  self.die();
}

// --- Assistant entity ---
//
// Reusable side-door coworker. Spawned manually from a phase
// beatmap's `fire` callback or from a custom lifted helper —
// `theBossScript` no longer wires assistants in by default.

const ASSISTANT_HP = 30;
const ASSISTANT_ENTER_SPEED = 130;

export function makeAssistantScript(side: -1 | 1) {
  return function* (self: Entity): Generator<ScriptYield, void, void> {
    const targetX = side < 0 ? GAME_W * 0.18 : GAME_W * 0.82;
    yield* moveTo(self, targetX, self.y, ASSISTANT_ENTER_SPEED);
    // Idle in place — beat-driven firing is owned by external
    // beatmap callbacks (or a custom script) that target this entity.
    while (true) yield 30;
  };
}

export const bossAssistant = new EntityKind({
  sprite: 'hr',
  hitboxRadius: 16,
  hp: ASSISTANT_HP,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
});

// --- BossKind + wave entry ---

export const theBoss = new BossKind({
  sprite: 'boss',
  // Wider hitbox than non-boss enemies so the player's two side
  // bullets actually land — see the firing-math note in the design
  // discussion: side bullets fan ±36 px by the time they reach the
  // boss row, so radius < ~36 means only the centre barrel hits.
  hitboxRadius: 36,
  hp: BOSS_HP,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: theBossScript,
  deathScript: theBossDeath,
});

export function* theBossWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'final boss');
  yield* prepareForBoss(self);
  yield* suspendRunning(self, function* () {
    const boss = self.spawn(theBoss, GAME_W / 2, -60, 0, 0);
    yield { until: boss };
  });
}
