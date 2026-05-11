// Per-stage scoreboard. Lives on `StageManager` for the manager's
// lifetime — switching scenes constructs a new manager, which is the
// reset. Wave / boss scripts read these counters to drive end-of-fight
// quips (e.g. coach's "you got angry N times…"); future stats can land
// here without re-plumbing.
//
// The `score` / `mult` / `multFloor` / `chainTimer` fields drive the
// player-visible score×mult readout — see src/docs/scoring-system.md
// for the full design. Mutators below (`recordKill`, `recordAliveTick`,
// `tickChain`, `onPlayerHit`, `onContinue`) are the only paths that
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

// Chain cap and decay. 16× is a soft ceiling — high enough to feel
// rewarding for clean play, low enough that the HUD digit width stays
// bounded. 120 frames = 2s at 60fps — Cave's canonical chain window.
export const MAX_MULT = 16;
export const CHAIN_DECAY_FRAMES = 120;
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
  // `mult` is the live chain multiplier; `multFloor` is the per-stage
  // baseline lifted by collected drops; `chainTimer` is the frame
  // countdown to the next chain break.
  score = 0;
  mult = 1;
  multFloor = 1;
  chainTimer = 0;
}

// Accumulate a kill's score and bump the chain. Reads tier off the
// dying entity's kind, applies the point-blank bonus based on distance
// to the player at the moment of death, multiplies by the current
// chain mult, and refreshes the chain decay timer.
export function recordKill(score: GameScore, self: Entity): void {
  const base = KILL_BASE_BY_TIER[self.kind.tier];
  const player = self.stage.player;
  const dist = Math.hypot(player.x - self.x, player.y - self.y);
  const pb = dist < POINT_BLANK_RADIUS ? POINT_BLANK_MULT : 1;
  score.score += Math.floor(base * pb * score.mult);
  if (score.mult < MAX_MULT) score.mult += 1;
  score.chainTimer = CHAIN_DECAY_FRAMES;
}

// One alive-tick's worth of score (= 1 × current mult). Called from
// StageManager.update at ALIVE_TICK_FRAMES cadence, gated on the
// simulation pause flag so dialogue / ESC freezes don't accrue.
export function recordAliveTick(score: GameScore): void {
  score.score += score.mult;
}

// Per-frame chain decay. Counts down the chain timer; when it reaches
// zero, drops `mult` back to `multFloor` (not all the way to 1 — drops
// the player collected stay banked). Idempotent when mult is already
// at or below the floor.
export function tickChain(score: GameScore): void {
  if (score.chainTimer > 0) {
    score.chainTimer -= 1;
  } else if (score.mult > score.multFloor) {
    score.mult = score.multFloor;
  }
}

// Reset the chain on any player hit. Score and multFloor survive — the
// player keeps their accumulated total and any drops they already
// banked — but the live chain collapses to 1 and the next kill has to
// start the streak over. See the reset-trigger table in
// src/docs/scoring-system.md.
export function onPlayerHit(score: GameScore): void {
  score.mult = 1;
  score.chainTimer = 0;
}

// Continue penalty: wipe the run's score back to 0 alongside the chain
// reset. The scoreboard only reflects untainted runs.
export function onContinue(score: GameScore): void {
  score.score = 0;
  score.mult = 1;
  score.multFloor = 1;
  score.chainTimer = 0;
}

// Lift the per-stage mult floor by `delta` (bounded by MAX_MULT). Used
// when collecting a tiered drop. The floor lift survives chain breaks
// but is wiped on continue.
export function liftMultFloor(score: GameScore, delta: number): void {
  score.multFloor = Math.min(MAX_MULT, score.multFloor + delta);
  // If the live mult was already below the new floor, raise it — a
  // collected floor-lift should immediately make the player feel
  // wealthier, not lurk silently until the next kill.
  if (score.mult < score.multFloor) score.mult = score.multFloor;
}

// Refresh the chain timer to its full window. Called when a drop is
// collected — keeps a chain alive through quiet beats between waves.
export function refreshChainTimer(score: GameScore): void {
  score.chainTimer = CHAIN_DECAY_FRAMES;
}

// Multiplier-drop EntityKind. Carries the per-tier floor lift the drop
// applies on collect. Lives here rather than in content/kinds.ts so
// StageManager can `instanceof`-check it without a circular import
// (StageManager already imports from this module for GameScore).
//
// Floor-lift per tier — collected drops bump `score.multFloor` by this
// amount, keeping a chain "alive" past its decay window:
//   regular   → 0  (the drop only refreshes the chain timer)
//   miniBoss  → +1
//   boss      → +2
// See src/docs/scoring-system.md → "Multiplier drops" for the design
// rationale.
export const FLOOR_LIFT_BY_TIER: Record<EntityTier, number> = {
  regular: 0,
  miniBoss: 1,
  boss: 2,
};

export class MultDropKind extends EntityKind {
  // Captured at construction from the kind's tier; collection reads it
  // off the kind without needing a tier→delta lookup at runtime.
  readonly floorLift: number;
  constructor(opts: EntityKindOpts) {
    super(opts);
    this.floorLift = FLOOR_LIFT_BY_TIER[this.tier];
  }
}
