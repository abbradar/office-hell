// Shared base class for boss EntityKinds. Adds two things over
// EntityKind: a default death script (the standard flicker-and-die
// shudder) and a "spawn unhittable" gate. The death-script hand-off is
// the same machinery EntityKind exposes for any kind — a hit that drops
// the boss below 1 HP doesn't call die() right away; the kind's
// `deathScript` runs in its place, locked off from further damage. That
// means any wave script parked on `{ until: boss }` resumes at the
// *visual* end of the encounter rather than the moment HP hit zero,
// which is what gives the boss room to fade.
//
// Time and physics keep ticking through the animation (the death
// script is just another entity script — `stage.update` ticks it like
// any other). Bullets in flight, the player, and other entities all
// keep moving normally.
//
// Mid-bosses that need a richer defeat (final words, music halt for a
// dramatic beat, etc.) pass their own `deathScript` to the BossKind
// constructor; phase-gated bosses additionally override `takeDamage`
// to keep early phases from triggering the death path before the
// final phase is reached.

import { getMusicTime, playMusicLoop, stopMusicLoop } from '../audio/music/loop';
import { playBossDeath } from '../audio/sfx/events';
import type { Entity } from '../entities/Entity';
import { clearBullets } from './stage';
import {
  type DamageClass,
  type EntityScript,
  HPEntityKind,
  type HPEntityKindOpts,
  type HPSpawnOpts,
  type HPVars,
  type ScriptYield,
} from './types';

// Exported so per-boss death scripts can match the timing of the
// standard shudder when sizing pre-shudder beats / bubble lifetimes.
export const FLICKER_TOGGLES = 10;
export const FLICKER_INTERVAL_FRAMES = 10;
export const POST_FLICKER_HOLD_FRAMES = 12;

// The standard boss-death visual: stop motion, disable the body, play
// the death sfx, flicker out, hold. Doesn't call die() — callers do
// that after any post-shudder work (e.g. restarting music for the next
// sub-stage). Use as the visual building block in a per-boss death
// script that prefaces the shudder with a bubble or a real dialogue.
// Idempotent w.r.t. body.setVelocity / body.enable, so it composes
// cleanly with pre-shudder beats that already locked the body down.
export function* bossShudder(self: Entity): Generator<ScriptYield, void, void> {
  playBossDeath();
  self.body.setVelocity(0, 0);
  self.body.enable = false;
  for (let i = 0; i < FLICKER_TOGGLES; i++) {
    self.setVisible(i % 2 === 0);
    yield FLICKER_INTERVAL_FRAMES;
  }
  self.setVisible(false);
  yield POST_FLICKER_HOLD_FRAMES;
}

// Mid-boss helper: stop the active music for a defeat beat, hand back
// a closure that re-starts the loop at `restartKey` from t=0. The
// caller decides exactly when to call `restart()` — typically right
// before `self.die()` so the next sub-stage observes a music clock
// that's already ticking from zero. When no track is playing
// (practice-menu runs that didn't start a stage track), the snapshot
// makes both ops no-ops, so the same death script behaves correctly
// whether it runs from the live stage or a standalone wave drill.
export function pauseMusicForDefeat(restartKey: string): { restart: () => void } {
  const wasPlaying = getMusicTime() !== null;
  if (wasPlaying) stopMusicLoop();
  return {
    restart: () => {
      if (wasPlaying) playMusicLoop(restartKey);
    },
  };
}

// Default death script for end-bosses — bare shudder + die. Mid-bosses
// supply their own (composed from `bossShudder` plus whatever narrative
// beat the boss has) by passing `deathScript` to the BossKind
// constructor.
export function* bossDeathScript(self: Entity): Generator<ScriptYield, void, void> {
  yield* bossShudder(self);
  self.die();
}

// Bosses always spawn unhittable — the player should never be able to
// chip damage off during the entry slide or pre-fight dialogue. The
// kind's `damagedByClass` is forced to `[]` at construction and the
// requested classes are stashed as `hittableDamagedBy`; the boss script
// opts in by calling `becomeHittable(self)` after the intro. This
// removes the need for every wave spawn site to remember a per-call
// `damagedByClass: []` override and removes the matching foot-gun where
// a script forgets to flip damage on at all (the original Coach bug).
//
// The death-on-zero-HP hand-off is inherited from HPEntityKind — the
// base `takeDamage` runs `kind.deathScript` when hp reaches zero.
// BossKind fills in `bossDeathScript` as the default so plain end-
// bosses get the standard shudder for free; phase-gated bosses
// override `takeDamage` to gate the death path on the final phase.
export class BossKind extends HPEntityKind {
  readonly hittableDamagedBy: DamageClass[];

  constructor(opts: HPEntityKindOpts) {
    super({
      ...opts,
      damagedByClass: [],
      deathScript: opts.deathScript ?? bossDeathScript,
      // Boss tier is mandatory for the score/drop system; opts.tier is
      // ignored if the caller tried to set anything else.
      tier: 'boss',
    });
    this.hittableDamagedBy = opts.damagedByClass ?? [];
  }
}

// Default visual pre-amble for a phase-gated boss switching phases:
// lock damage off so the next pool isn't chipped while the silhouette
// is still resetting, stop motion, flicker, sweep the in-flight
// bullets, hold a beat. Leaves `damagedByClass` cleared on exit —
// callers stage their per-phase setup (new hp pool, repositioning,
// dialogue, vars flags) after this returns and finish with
// `becomeHittable(self)` to re-arm damage. Bosses that need extra
// beats (e.g. a phase-2 declaration bubble + slide) interleave them
// between this helper and `becomeHittable`.
export const PHASE_TRANSITION_FLASHES = 5;
export const PHASE_TRANSITION_FLASH_GAP = 10;
export const PHASE_TRANSITION_HOLD = 20;

export function* bossPhaseTransition(self: Entity): Generator<ScriptYield, void, void> {
  self.setDamagedByClasses([]);
  self.body.setVelocity(0, 0);
  for (let i = 0; i < PHASE_TRANSITION_FLASHES; i++) {
    self.flashDamage();
    yield PHASE_TRANSITION_FLASH_GAP;
  }
  clearBullets(self);
  yield PHASE_TRANSITION_HOLD;
}

// Flip a boss into its hittable state — i.e. apply the damage classes
// the kind was originally constructed with. Call after the entry +
// dialogue intro is done.
export function becomeHittable(self: Entity): void {
  const kind = self.kind;
  if (!(kind instanceof BossKind)) {
    throw new Error(`becomeHittable called on non-boss kind: ${kind.sprite}`);
  }
  self.setDamagedByClasses(kind.hittableDamagedBy);
}

// Per-entity vars shape for `PhasedBossKind`-spawned entities. `init`
// seeds all three at spawn time, so cast `self.vars` to this in any
// helper that reads / writes phase state — no defensive `??` needed.
export type PhasedBossVars = HPVars & {
  phaseIdx: number;
  phaseDown: boolean;
};

// --- Phased bosses ------------------------------------------------------
//
// Generic machinery for bosses with multiple HP pools. Each phase is a
// `{ hp, script }` pair: `hp` sizes the pool, `script` is the entity
// generator that runs while that phase is active. The runtime tracks
// `phaseIdx` (0-based current phase) and `phaseDown` (the per-phase
// "this pool is empty" latch) on `self.vars`; the `init` hook primes
// both for the kind's `startPhaseIdx` so a practice spawn can drop the
// boss straight into the middle of the fight.
//
// The takeDamage override pins HP at zero in non-final phases and
// raises the latch; the phase script reads the latch (via
// `phaseRunning` for while-loops or `waitPhaseDown` for race-style
// termination), runs a transition, and `yield*`s into the next phase
// script — chaining all the way to the lethal phase, whose damage
// routes to the kind's `deathScript`. Phase scripts therefore look
// like the `from<Wave>` chain in `content/stage.ts`: each one ends
// either by handing off to its successor or by being replaced by the
// death script on the killing blow.

export type BossPhase = {
  // HP pool for this phase. The kind's last phase is the lethal one
  // (damage routes to deathScript when this pool empties); every
  // earlier pool is capped at zero and raises `phaseDown` instead.
  hp: number;
  // Entity script that runs while this phase is active. Must chain
  // into the next phase via `yield* nextPhaseScript(self)` (or the
  // boss-specific transition) when the latch fires; the lethal phase
  // loops forever and is taken down by the death script swap.
  script: EntityScript;
};

export type PhasedBossOpts = Omit<HPEntityKindOpts, 'hp' | 'defaultScript'> & {
  phases: BossPhase[];
  // Which phase a fresh spawn drops into. Defaults to 0 (the full
  // fight starts at phase 1). Practice-menu entries instantiate
  // additional kinds with startPhaseIdx > 0 so the boss skips earlier
  // phases entirely — `init` seeds vars + hp accordingly and
  // `defaultScript` enters the chain at `phases[startPhaseIdx].script`.
  startPhaseIdx?: number;
};

export class PhasedBossKind extends BossKind {
  readonly phases: readonly BossPhase[];
  readonly startPhaseIdx: number;

  constructor(opts: PhasedBossOpts) {
    const startIdx = opts.startPhaseIdx ?? 0;
    const startPhase = opts.phases[startIdx];
    if (startPhase === undefined) {
      throw new Error(`PhasedBossKind startPhaseIdx ${startIdx} out of bounds (phases=${opts.phases.length})`);
    }
    super({
      ...opts,
      hp: startPhase.hp,
      // The defaultScript is just the entry-phase script — it chains
      // into successors via `yield*` internally, all the way to the
      // lethal phase. Cold-starting at phase N means we drop into
      // phases[N].script directly.
      defaultScript: startPhase.script,
    });
    this.phases = opts.phases;
    this.startPhaseIdx = startIdx;
  }

  // Seed phase tracking on every spawn so the entity lands in the
  // right state for `startPhaseIdx`. `super.init` (HPEntityKind) seeds
  // `vars.hp` from the kind's hp (= phases[startPhaseIdx].hp). We
  // deliberately strip `opts.hp` before delegating — HP is owned by
  // the active phase, so a per-spawn override would desync the phase
  // tracking from the actual pool.
  override init(self: Entity, opts: HPSpawnOpts): void {
    super.init(self, { ...opts, hp: undefined });
    const vars = self.vars as PhasedBossVars;
    vars.phaseIdx = this.startPhaseIdx;
    vars.phaseDown = false;
  }

  override takeDamage(self: Entity, amount: number): void {
    const vars = self.vars as PhasedBossVars;
    if (vars.phaseIdx >= this.phases.length - 1) {
      // Lethal phase — defer to HPEntityKind.takeDamage so the death
      // script fires when this pool is emptied.
      super.takeDamage(self, amount);
      return;
    }
    const next = vars.hp - amount;
    if (next <= 0) {
      vars.hp = 0;
      vars.phaseDown = true;
      return;
    }
    vars.hp = next;
    self.flashDamage();
  }
}

// True while the current phase's HP pool isn't depleted yet. Use as
// the loop condition in a phase generator (`while (phaseRunning(self))
// { … }`) — when the pool empties the latch flips and the loop exits
// on its next iteration.
export function phaseRunning(self: Entity): boolean {
  return (self.vars as PhasedBossVars).phaseDown !== true;
}

// Race-style termination partner: yields one frame at a time until the
// phaseDown latch is raised. Use with `race(phaseBody, waitPhaseDown(self))`
// when the phase generator can't be polled cleanly between sub-patterns.
export function* waitPhaseDown(self: Entity): Generator<ScriptYield, void, void> {
  const vars = self.vars as PhasedBossVars;
  while (vars.phaseDown !== true) yield 1;
}

// Bookkeeping half of a phase change: advance `phaseIdx`, refill HP
// from the kind's phase list, clear the `phaseDown` latch, and re-arm
// damage. Pair with `bossPhaseTransition` for the visual half — either
// run them back-to-back via `nextBossPhase`, or split them around a
// boss-specific narrative beat (a declaration bubble, a re-position).
export function advanceBossPhase(self: Entity): void {
  const kind = self.kind;
  if (!(kind instanceof PhasedBossKind)) {
    throw new Error(`advanceBossPhase called on non-phased kind: ${kind.sprite}`);
  }
  const vars = self.vars as PhasedBossVars;
  const next = vars.phaseIdx + 1;
  const nextPhase = kind.phases[next];
  if (nextPhase === undefined) {
    throw new Error(`advanceBossPhase past last phase (${next}/${kind.phases.length})`);
  }
  vars.phaseIdx = next;
  vars.phaseDown = false;
  vars.hp = nextPhase.hp;
  becomeHittable(self);
}

// Standard phase change: visual reset followed by phase advance. Use
// between phase generators when the boss has nothing extra to say or
// do at the seam.
export function* nextBossPhase(self: Entity): Generator<ScriptYield, void, void> {
  yield* bossPhaseTransition(self);
  advanceBossPhase(self);
}
