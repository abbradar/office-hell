import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo, spread } from '../../script/patterns';
import { alignDoor, checkStageOnce, doorY, markWave, sideSpawnX, suspendRunning } from '../../script/stage';
import { HPEntityKind, type ScriptYield } from '../../script/types';
import { bullet } from '../kinds';

// Janitor: walks out of the uppermost wall door, plants, and fires a long
// horizontal sweep — a "mop swipe" that fans bullets across the screen.
// After the first swipe they shuffle a bit further down and swipe again,
// so the player has to dodge twice from a fresh angle.

const SWEEP_STEPS = 28;
const SWEEP_STEP_FRAMES = 2;
const SWEEP_FROM = Math.PI / 8; // ~22.5° — almost horizontal-right (down-right)
const SWEEP_TO = (7 * Math.PI) / 8; // ~157.5° — almost horizontal-left
const SWEEP_BULLETS_PER_STEP = 3;
const SWEEP_SPREAD = Math.PI / 22;
const SWEEP_SPEED = 160;

const ENTRY_SPEED = 110;
// Door y the wave aligns the topmost panel to before spawning. Pushed
// well below the corridor header so the "Watch the wet floor!" bubble
// fits above the sprite — the bubble manager flips below the speaker
// once `target.y < ~92`, which would put the line under the sweep
// instead of above it.
export const JANITOR_DOOR_Y = 130;
const ENTRY_X_LEFT = GAME_W * 0.3;
const ENTRY_X_RIGHT = GAME_W * 0.7;
const ADVANCE_SPEED = 70;
const ADVANCE_DY = 58;
const REST_FRAMES = 40;
// Drop off the bottom fast enough that the second janitor (spawned 1s
// after the first) is fully off-screen within the wave's 8s design
// budget. (Currently runs untimed in stage 2 part 1 pending a timing
// pass; the budget is what the pacing was sized for.) The two sweeps
// + advance + rest fill 6+ seconds on their own; the remaining budget
// is just enough for a brisk exit, not a 220 px/s drift.
const EXIT_SPEED = 380;

function* sweep(self: Entity, leftToRight: boolean): Generator<ScriptYield, void, void> {
  const from = leftToRight ? SWEEP_FROM : SWEEP_TO;
  const to = leftToRight ? SWEEP_TO : SWEEP_FROM;
  for (let i = 0; i < SWEEP_STEPS; i++) {
    const t = i / (SWEEP_STEPS - 1);
    const angle = from + (to - from) * t;
    spread(self, SWEEP_BULLETS_PER_STEP, bullet, SWEEP_SPEED, angle, SWEEP_SPREAD);
    yield SWEEP_STEP_FRAMES;
  }
}

function* janitorScript(self: Entity) {
  // Spawn x is `sideSpawnX(±1)` (just outside the wall); walk in
  // through whichever side door the wave routed us to, stopping at
  // 30%/70% of the corridor width.
  const fromLeft = self.x < GAME_W / 2;
  const targetX = fromLeft ? ENTRY_X_LEFT : ENTRY_X_RIGHT;
  yield* moveTo(self, targetX, self.y, ENTRY_SPEED);
  if (checkStageOnce(self, 'janitor:wetFloorShown')) {
    self.say('Watch the wet floor!', 110);
  }
  yield 50;

  // Sweep away from the wall the janitor came in through, so the two
  // janitors converge their mop strokes toward the corridor centre.
  const leftToRight = fromLeft;

  yield* sweep(self, leftToRight);

  // Shuffle forward a touch, rest, then second swipe from the new position.
  yield* moveTo(self, self.x, self.y + ADVANCE_DY, ADVANCE_SPEED);
  yield REST_FRAMES;

  yield* sweep(self, leftToRight);

  // Cut straight to the exit — the post-sweep beat that was here used
  // to sit inside an 11-second budget; the 8s budget can't afford it.
  self.setVelocity(0, EXIT_SPEED);
}

export const janitor = new HPEntityKind({
  sprite: 'janitor',
  hitboxRadius: 16,
  hp: 24,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: janitorScript,
});

// Demo wave: two janitors stepping out of the same uppermost wall door,
// one from each side, staggered so a player who focuses fire can drop the
// first before it sweeps and only eat the second's mop strokes. Spacing
// kept short — the wave's 8s budget has to cover entry + 2 sweeps +
// advance + exit per janitor, so the second can't afford the original
// 3s lead.
export function* janitorsWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'janitor');
  // Pin the topmost door near JANITOR_DOOR_Y before suspending so both
  // janitors emerge through the same panel — without this they'd snap to
  // whichever door happened to be closest, which on a fresh scroll could
  // be the middle or bottom slot.
  yield* alignDoor(self, JANITOR_DOOR_Y);
  yield* suspendRunning(self, function* () {
    const y = doorY(self, JANITOR_DOOR_Y);
    self.spawn(janitor, sideSpawnX(-1), y, 0, 0);
    yield 60;
    self.spawn(janitor, sideSpawnX(1), y, 0, 0);
  });
}
