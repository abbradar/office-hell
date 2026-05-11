// Multiplier-drop EntityKind. Carries the per-tier mult lift the drop
// applies on collect. Lives in its own module so `score.ts` doesn't
// need to import `EntityKind` as a value — that was the head of a
// cycle (types.ts imports `recordKill` from score.ts, score.ts
// imported `EntityKind` from types.ts) which tripped a temporal-dead-
// zone error when `class MultDropKind extends EntityKind` ran before
// `EntityKind` finished initialising.
//
// Mult-lift per tier — collected drops bump `score.mult` by this
// amount, keeping a chain growing past kill streaks:
//   regular   → 0  (the drop is a no-op for mult — collection only)
//   miniBoss  → +1
//   boss      → +2
// See src/docs/scoring-system.md → "Multiplier drops" for the design
// rationale.

import { EntityKind, type EntityKindOpts, type EntityTier } from './types';

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
