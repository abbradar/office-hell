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
import { type DamageClass, EntityKind, type EntityKindOpts, type ScriptYield } from './types';

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
// The death-on-zero-HP hand-off is inherited from EntityKind — the base
// `takeDamage` runs `kind.deathScript` when hp reaches zero. BossKind
// fills in `bossDeathScript` as the default so plain end-bosses get the
// standard shudder for free; phase-gated bosses override `takeDamage`
// to gate the death path on the final phase.
export class BossKind extends EntityKind {
  readonly hittableDamagedBy: DamageClass[];

  constructor(opts: EntityKindOpts) {
    super({ ...opts, damagedByClass: [], deathScript: opts.deathScript ?? bossDeathScript });
    this.hittableDamagedBy = opts.damagedByClass;
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

// --- Phased bosses ------------------------------------------------------
//
// Generic machinery for bosses with multiple HP pools. The kind owns the
// pool sizes; the runtime tracks `phaseIdx` (0-based current phase) and
// `phaseDown` (the per-phase "this pool is empty" latch) on `self.vars`.
// The takeDamage override pins HP at zero in non-final phases and
// raises the latch; the script reads the latch (via `phaseRunning` for
// while-loops or `waitPhaseDown` for race-style termination), runs a
// transition, and advances to the next pool. The final phase defers to
// the base class so the kind's `deathScript` runs on the lethal hit.

export type PhasedBossOpts = Omit<EntityKindOpts, 'hp'> & {
  // HP pool per phase, in order. The last entry is the lethal phase
  // (damage during it routes to the death path); every earlier pool is
  // capped at zero and signals `phaseDown` instead. Must be non-empty.
  phaseHps: number[];
};

export class PhasedBossKind extends BossKind {
  readonly phaseHps: readonly number[];

  constructor(opts: PhasedBossOpts) {
    const firstHp = opts.phaseHps[0];
    if (firstHp === undefined) {
      throw new Error('PhasedBossKind needs at least one phase HP entry');
    }
    super({ ...opts, hp: firstHp });
    this.phaseHps = opts.phaseHps;
  }

  override takeDamage(self: Entity, amount: number): void {
    if (self.hp === null) return;
    self.vars ??= {};
    const idx = (self.vars.phaseIdx as number | undefined) ?? 0;
    if (idx >= this.phaseHps.length - 1) {
      // Lethal phase — defer to EntityKind.takeDamage so the death
      // script fires when this pool is emptied.
      super.takeDamage(self, amount);
      return;
    }
    self.hp -= amount;
    if (self.hp <= 0) {
      self.hp = 0;
      self.vars.phaseDown = true;
      return;
    }
    self.flashDamage();
  }
}

// Open the fight: initialise phase state and arm damage. Call once
// after the entry dialogue, in place of a manual `becomeHittable(self)`
// for phased bosses. Subsequent phases come up via `advanceBossPhase`.
export function startBossPhases(self: Entity): void {
  if (!(self.kind instanceof PhasedBossKind)) {
    throw new Error(`startBossPhases called on non-phased kind: ${self.kind.sprite}`);
  }
  self.vars ??= {};
  self.vars.phaseIdx = 0;
  self.vars.phaseDown = false;
  becomeHittable(self);
}

// True while the current phase's HP pool isn't depleted yet. Use as
// the loop condition in a phase generator (`while (phaseRunning(self))
// { … }`) — when the pool empties the latch flips and the loop exits
// on its next iteration.
export function phaseRunning(self: Entity): boolean {
  return self.vars?.phaseDown !== true;
}

// Race-style termination partner: yields one frame at a time until the
// phaseDown latch is raised. Use with `race(phaseBody, waitPhaseDown(self))`
// when the phase generator can't be polled cleanly between sub-patterns.
export function* waitPhaseDown(self: Entity): Generator<ScriptYield, void, void> {
  while (self.vars?.phaseDown !== true) yield 1;
}

// Bookkeeping half of a phase change: advance `phaseIdx`, refill HP
// from the kind's pool list, clear the `phaseDown` latch, and re-arm
// damage. Pair with `bossPhaseTransition` for the visual half — either
// run them back-to-back via `nextBossPhase`, or split them around a
// boss-specific narrative beat (a declaration bubble, a re-position).
export function advanceBossPhase(self: Entity): void {
  const kind = self.kind;
  if (!(kind instanceof PhasedBossKind)) {
    throw new Error(`advanceBossPhase called on non-phased kind: ${kind.sprite}`);
  }
  self.vars ??= {};
  const next = ((self.vars.phaseIdx as number | undefined) ?? 0) + 1;
  const nextHp = kind.phaseHps[next];
  if (nextHp === undefined) {
    throw new Error(`advanceBossPhase past last phase (${next}/${kind.phaseHps.length})`);
  }
  self.vars.phaseIdx = next;
  self.vars.phaseDown = false;
  self.hp = nextHp;
  becomeHittable(self);
}

// Standard phase change: visual reset followed by phase advance. Use
// between phase generators when the boss has nothing extra to say or
// do at the seam.
export function* nextBossPhase(self: Entity): Generator<ScriptYield, void, void> {
  yield* bossPhaseTransition(self);
  advanceBossPhase(self);
}
