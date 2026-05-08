import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { aimed, cluster, moveTo, ring } from '../../script/patterns';
import { checkStageOnce, markWave, suspendRunning } from '../../script/stage';
import { EntityKind, type ScriptYield } from '../../script/types';
import { bullet } from '../kinds';

// "Email" bullet — chunky envelope, deliberately larger than the round bullets
// so an inbound stack reads as a slow wall the player has to weave around
// rather than another pinprick. No script: drifts on its launch velocity.
export const emailBullet = new EntityKind({
  sprite: 'emailBullet',
  hitboxRadius: 6,
  hp: null,
  damageClass: ['player'],
  damagedByClass: [],
});

// Walks in to the top band, asks for an email check, then alternates aimed
// envelope volleys with circle-bullet rings. The envelopes track the player's
// position; the rings fill the gaps the envelope spread leaves open, so the
// player can't just hold a single safe lane.

const ENTRY_SPEED = 110;
const ENTRY_Y = 110;
const HOLD_FRAMES = 80;

const VOLLEYS = 3;
const VOLLEY_GAP = 70;
const EMAIL_COUNT = 3;
const EMAIL_SPEED = 110;
const EMAIL_SPREAD = Math.PI / 6;
const CLUSTER_COUNT = 3;
const CLUSTER_SPREAD_PX = 16;
const RING_COUNT = 10;
const RING_SPEED = 130;

const EXIT_SPEED = 220;

function* checkEmailScript(self: Entity) {
  yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);
  if (checkStageOnce(self, 'checkEmail:shown')) {
    self.say('Could you check\nthis email?', HOLD_FRAMES);
  }
  yield HOLD_FRAMES;

  for (let i = 0; i < VOLLEYS; i++) {
    // Second volley breaks the line cadence: a tight clump of envelopes
    // arriving as one wall, so the player can't ride the same lane that
    // dodged the fan on volley 1.
    if (i === 1) {
      cluster(self, CLUSTER_COUNT, emailBullet, EMAIL_SPEED, CLUSTER_SPREAD_PX);
    } else {
      aimed(self, EMAIL_COUNT, emailBullet, EMAIL_SPEED, EMAIL_SPREAD);
    }
    yield Math.round(VOLLEY_GAP * 0.5);
    ring(self, RING_COUNT, bullet, RING_SPEED, Math.random() * Math.PI * 2);
    yield VOLLEY_GAP;
  }

  self.setVelocity(0, EXIT_SPEED);
}

export const checkEmailCoworker = new EntityKind({
  sprite: 'checkEmail',
  hitboxRadius: 12,
  hp: 20,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: checkEmailScript,
});

// Demo wave: a stagger of three across the screen — first solo to telegraph
// the pattern, then a paired follow-up so the rings overlap.
export function* checkEmailWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'check email');
  yield* suspendRunning(self, function* () {
    self.spawn(checkEmailCoworker, GAME_W * 0.3, -30, 0, 0);
    yield 110;
    self.spawn(checkEmailCoworker, GAME_W * 0.7, -30, 0, 0);
    yield 220;
    self.spawn(checkEmailCoworker, GAME_W * 0.5, -30, 0, 0);
  });
}
