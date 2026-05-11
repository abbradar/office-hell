import { GAME_W, SCRIPT_FPS } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo, ring } from '../../script/patterns';
import { alignDoor, doorY, markWave, sideSpawnX, suspendRunning } from '../../script/stage';
import { type EntityScript, HPEntityKind, type ScriptYield } from '../../script/types';
import { nextOrdinaryCoworkerSprite } from '../characters';
import { pillBullet } from './pillBullet';

// Work-Is-Fun: a stream of ordinary coworkers piles out of the upper left
// wall door, jogs to the western edge of a shared loop, and spends the
// rest of the wave running laps around the corridor centre while
// shouting team-spirit nothings and flinging randomly-aimed rings of
// vitamin pills. They all enter at the same orbit phase, so the squad
// fans out around the loop naturally: a fresh body steps onto the
// circle every SPAWN_GAP frames behind whoever joined last, which at
// the orbit's angular speed leaves them spaced ~50° apart by the time
// the sixth lands.
//
// Threat identity: motion-coupled bullet spam. The orbiters are always
// moving across the field, so the rings spawn from a continuously
// shifting locus — there's no "park here and read the pattern" answer,
// the safe lane keeps moving with the firers.

const COWORKER_COUNT = 6;
const COWORKER_HP = 8;

// Spawn cadence — one coworker every SPAWN_GAP frames so they read as a
// trickle of bodies out of the same door rather than a single burst.
const SPAWN_GAP = 38;

// Entry: walk in from the left wall to the orbit's western edge, then
// hand off to the orbit loop. Brisk so a six-body queue doesn't eat
// the wave's front half.
const ENTRY_SPEED = 140;

// Orbit geometry. Centre is the corridor mid-x and a bit above mid-y,
// so the loop's southern arc reaches into the player's parking band
// without the firers ever quite landing on top of the player. Radius
// is well clear of the side walls (corridor width 364 px between the
// 18 px walls; ±110 leaves ~72 px gap each side).
const ORBIT_CENTER_X = GAME_W * 0.5;
const ORBIT_CENTER_Y = 290;
const ORBIT_RADIUS = 110;

// Angular speed in rad/sec. 2π / period. ~4s/lap → tangent speed ~173
// px/s — faster than a casual jog, slower than the player's 280 px/s
// top speed so a determined chase still catches up.
const ORBIT_PERIOD_SEC = 4;
const ORBIT_ANGULAR_SPEED = (2 * Math.PI) / ORBIT_PERIOD_SEC;

// Entry phase = west (left side of the orbit). That's the closest orbit
// point to the left-wall door, so the visible "join the loop" beat is a
// short straight walk across the corridor instead of a diagonal cut.
const ORBIT_ENTRY_PHASE = Math.PI;
const ORBIT_ENTRY_X = ORBIT_CENTER_X + Math.cos(ORBIT_ENTRY_PHASE) * ORBIT_RADIUS;
const ORBIT_ENTRY_Y = ORBIT_CENTER_Y + Math.sin(ORBIT_ENTRY_PHASE) * ORBIT_RADIUS;

// Firing cadence per orbiter. Each rolls its own gap inside
// [FIRE_GAP_MIN, FIRE_GAP_MAX] after every shot, so the squad's rings
// stay desynced over time even if two orbiters happen to fire on the
// same frame at the start. Six orbiters firing on this cadence puts a
// new ring on the field roughly every 4-5 frames — "often", per the
// brief, without the floor being a literal solid wall.
const FIRE_GAP_MIN = 22;
const FIRE_GAP_MAX = 40;
const RING_COUNT = 9;
const RING_SPEED = 110;

// Shouting cadence. Each orbiter cycles its own shout timer, staggered
// by index so the bubbles don't all stack at frame 0. SHOUT_GAP is
// generous — the line is short and a wall of bubbles would just obscure
// the bullet field.
const SHOUT_LINE = 'Work is fun!';
const SHOUT_DURATION = 70;
const SHOUT_GAP_MIN = 140;
const SHOUT_GAP_MAX = 220;

// Door y the wave aligns to before suspending — picks the upper-corridor
// door slot, which the stream uses for its straight walk to the orbit
// entry. ORBIT_ENTRY_Y is the orbit's western point (same y as the
// centre), so aligning the door near there keeps the entry walk
// approximately horizontal.
const ENTRY_DOOR_Y = ORBIT_ENTRY_Y;

function randInRange(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function makeCoworkerScript(orbiterIndex: number): EntityScript {
  return function* (self: Entity) {
    // Walk to the shared orbit entry. spawnY (set by the caller) is the
    // door y, which is close to but not exactly ORBIT_ENTRY_Y after the
    // alignDoor snap; moveTo bridges any residual offset.
    yield* moveTo(self, ORBIT_ENTRY_X, ORBIT_ENTRY_Y, ENTRY_SPEED);

    // Drive the orbit with a one-frame velocity bridge: each tick the
    // velocity is sized so a single physics step lands the body
    // exactly on the next phase's circle point. The animation reads
    // off body.velocity, so the running anim picks the correct facing
    // (left/right/up/down) from the tangent direction.
    let phase = ORBIT_ENTRY_PHASE;
    const phasePerFrame = ORBIT_ANGULAR_SPEED / SCRIPT_FPS;
    let fireCounter = Math.floor(Math.random() * FIRE_GAP_MAX);
    // Stagger the first shout per orbiter so the squad's catchphrases
    // ripple rather than all firing on the same frame.
    let shoutCounter = orbiterIndex * 40 + Math.floor(Math.random() * SHOUT_GAP_MIN);
    while (true) {
      phase += phasePerFrame;
      const tx = ORBIT_CENTER_X + Math.cos(phase) * ORBIT_RADIUS;
      const ty = ORBIT_CENTER_Y + Math.sin(phase) * ORBIT_RADIUS;
      self.setVelocity((tx - self.x) * SCRIPT_FPS, (ty - self.y) * SCRIPT_FPS);

      if (fireCounter <= 0) {
        ring(self, RING_COUNT, pillBullet, RING_SPEED, Math.random() * Math.PI * 2);
        fireCounter = randInRange(FIRE_GAP_MIN, FIRE_GAP_MAX);
      } else {
        fireCounter--;
      }

      if (shoutCounter <= 0) {
        self.say(SHOUT_LINE, SHOUT_DURATION);
        shoutCounter = randInRange(SHOUT_GAP_MIN, SHOUT_GAP_MAX);
      } else {
        shoutCounter--;
      }

      yield 1;
    }
  };
}

export const workIsFunCoworker = new HPEntityKind({
  sprite: 'whiteMale1',
  hitboxRadius: 16,
  hp: COWORKER_HP,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
});

export function* workIsFunWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'work is fun');
  self.stage.scheduleMultDrop('regular');
  // Pin a door near the orbit's western point so every orbiter walks
  // out of the same panel; without this they'd snap to whichever door
  // happened to be closest at spawn time, splitting the entry line
  // across two panels.
  yield* alignDoor(self, ENTRY_DOOR_Y);
  yield* suspendRunning(self, function* () {
    const spawnY = doorY(self, ENTRY_DOOR_Y);
    for (let i = 0; i < COWORKER_COUNT; i++) {
      self.spawn(workIsFunCoworker, sideSpawnX(-1), spawnY, 0, 0, {
        script: makeCoworkerScript(i),
        sprite: nextOrdinaryCoworkerSprite(self.stage),
      });
      if (i < COWORKER_COUNT - 1) yield SPAWN_GAP;
    }
  });
}
