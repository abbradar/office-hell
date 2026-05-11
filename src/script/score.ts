// Per-stage scoreboard. Lives on `StageManager` for the manager's
// lifetime — switching scenes constructs a new manager, which is the
// reset. Wave / boss scripts read these counters to drive end-of-fight
// quips (e.g. coach's "you got angry N times…"); future stats can land
// here without re-plumbing.
//
// The `score` / `mult` fields drive the player-visible score×mult
// readout — see src/docs/scoring-system.md for the full design.
// Mutators below (`recordKill`, `recordAliveTick`, `onPlayerHit`,
// `onPlayerDeath`, `onContinue`, `addMult`) are the only paths that
// should touch those fields; reading the values directly is fine.

import type { Entity } from '../entities/Entity';
import { EntityKind, type EntityKindOpts, type EntityTier } from './types';

// Per-tier kill base. Multiplied by `mult` (and the point-blank bonus
// if the killing hit lands within POINT_BLANK_RADIUS) before being
// accumulated. Values picked so kills dominate idle income at any
// reasonable chain length.
export const KILL_BASE_BY_TIER: Record<EntityTier, number> = {
  regular: 10,
  miniBoss: 200,
  boss: 2000,
};

// Killing within this radius (logical px, player-center to enemy-center)
// flags the kill as point-blank and applies a 1.5× bonus before mult.
// 40px ≈ slightly larger than a typical enemy sprite — has to be a
// committed close-pass, not a stray brush.
export const POINT_BLANK_RADIUS = 40;
export const POINT_BLANK_MULT = 1.5;

// Chain cap. 16× is a soft ceiling — high enough to feel rewarding for
// clean play, low enough that the HUD digit width stays bounded.
export const MAX_MULT = 16;
export const ALIVE_TICK_FRAMES = 6; // +1 per 0.1s @ 60fps

export class GameScore {
  // Telemetry counters used by inter-stage dialog quips. Not
  // player-visible; kept as plain numbers so future stats can be added
  // without re-plumbing.
  bullets = 0;
  kills = 0;
  bombs = 0;
  hpLost = 0;
  continues = 0;

  // Player-visible scoreboard. `score` is the accumulated total (already
  // × mult at each increment — no re-multiplication at render time).
  // `mult` is the live chain multiplier — bumped by kills and drops,
  // reset only on player death / continue.
  score = 0;
  mult = 1;
}

// Accumulate a kill's score and bump the chain. Reads tier off the
// dying entity's kind, applies the point-blank bonus based on distance
// to the player at the moment of death, and multiplies by the current
// chain mult.
export function recordKill(score: GameScore, self: Entity): void {
  const base = KILL_BASE_BY_TIER[self.kind.tier];
  const player = self.stage.player;
  const dist = Math.hypot(player.x - self.x, player.y - self.y);
  const pb = dist < POINT_BLANK_RADIUS ? POINT_BLANK_MULT : 1;
  score.score += Math.floor(base * pb * score.mult);
  if (score.mult < MAX_MULT) score.mult += 1;
}

// One alive-tick's worth of score (= 1 × current mult). Called from
// StageManager.update at ALIVE_TICK_FRAMES cadence, gated on the
// simulation pause flag so dialogue / ESC freezes don't accrue.
export function recordAliveTick(score: GameScore): void {
  score.score += score.mult;
}

// A non-killing hit on the player. Kept callable for symmetry / future
// stats — currently a no-op for the multiplier. The chain only collapses
// on actual death (see `onPlayerDeath`). See
// src/docs/scoring-system.md.
export function onPlayerHit(_score: GameScore): void {
  // intentionally empty — mult survives non-killing hits
}

// Player death: collapses the live chain to 1. Score survives — the
// scoreboard still reflects everything the player banked up to this
// point — but the next run / continue starts a fresh chain climb.
export function onPlayerDeath(score: GameScore): void {
  score.mult = 1;
}

// Continue penalty: wipe the run's score back to 0 alongside the chain
// reset. The scoreboard only reflects untainted runs.
export function onContinue(score: GameScore): void {
  score.score = 0;
  score.mult = 1;
}

// Bump the live mult by `delta` (bounded by MAX_MULT). Used when
// collecting a tiered drop or banking the bar-bonus from a music-time
// kill. The bump survives across waves but is wiped on continue /
// player death.
export function addMult(score: GameScore, delta: number): void {
  score.mult = Math.min(MAX_MULT, score.mult + delta);
}

// Multiplier-drop EntityKind. Carries the per-tier mult lift the drop
// applies on collect. Lives here rather than in content/kinds.ts so
// StageManager can `instanceof`-check it without a circular import
// (StageManager already imports from this module for GameScore).
//
// Mult-lift per tier — collected drops bump `score.mult` by this
// amount, keeping a chain growing past kill streaks:
//   regular   → 0  (the drop is a no-op for mult — collection only)
//   miniBoss  → +1
//   boss      → +2
// See src/docs/scoring-system.md → "Multiplier drops" for the design
// rationale.
export const MULT_LIFT_BY_TIER: Record<EntityTier, number> = {
  regular: 0,
  miniBoss: 1,
  boss: 2,
};

export class MultDropKind extends EntityKind {
  // Captured at construction from the kind's tier; collection reads it
  // off the kind without needing a tier→delta lookup at runtime.
  readonly multLift: number;
  constructor(opts: EntityKindOpts) {
    super(opts);
    this.multLift = MULT_LIFT_BY_TIER[this.tier];
  }
}
