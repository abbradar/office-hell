import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { aimed, moveTo } from '../../script/patterns';
import { EntityKind, type EntityScript, type ScriptYield } from '../../script/types';
import { reportBullet } from './reportBullet';

// HR Trio: a lead HR coordinator arrives alone with a fresh stack of CVs to
// push, asks the player to review them, then two more HRs flood in claiming
// their own piles take priority. The opener phase is sequential and quiet —
// one HR speaks at a time, no fire — so each line is readable. Once the
// introductions are done the argument breaks down into bickering with
// overlapping report volleys, then a unison bombardment finale.
//
// Coordination across the three scripts is purely time-based. The lead HR
// (role 0) gets a longer solo intro and a buffed HP override so they survive
// long enough for the followers to spawn and walk in. All three scripts
// converge into the bickering loop on the same frame so turn-taking lines up.

const ENTRY_SPEED = 90;
const ENTRY_Y = 95;

// Frames moveTo takes to walk an HR from spawn (y=-30) to ENTRY_Y at ENTRY_SPEED.
// Used by the wave script to schedule follower spawns relative to HR-0's intro
// and by HR-0's own script to wait out the followers' walk-in.
const ENTRY_FRAMES = Math.round(((ENTRY_Y + 30) / ENTRY_SPEED) * 60);

// Lead HR (role 0): two-line solo intro before the others arrive. Buffed HP so
// the player can't melt them in the ~6s they're alone on screen.
const LEAD_LINE_1 = 'Fresh CVs arrived for\nthe senior janitorial\nmanagement role!';
const LEAD_LINE_2 = 'Could you review?';
const LEAD_LINE_1_SAY = 170;
const LEAD_LINE_1_SLOT = 200;
const LEAD_LINE_2_SAY = 110;
const LEAD_LINE_2_SLOT = 140;
const LEAD_HP = 100;

// Follower openers (roles 1, 2): single line each, sequential.
const FOLLOWER_SAY = 110;
const FOLLOWER_SLOT = 140;
const OPENER_TO_BICKER_GAP = 40;

// Bickering: each role takes a turn within a shared cycle.
const TURN_GAP = 36;
const CYCLE_GAP = 28;
const SAY_DURATION = 110;
const REPORTS_PER_TURN = 4;
const REPORT_SPREAD = Math.PI / 5;
const REPORT_SPEED = 145;

// Bombardment finale — gloves off, all three fire wider clouds in unison
// while shouting over each other.
const BOMBARD_VOLLEYS = 5;
const BOMBARD_GAP = 22;
const BOMBARD_COUNT = 6;
const BOMBARD_SPREAD = Math.PI / 3;

type Role = 0 | 1 | 2;

// Per-role bickering + bombardment lines. Role 0's `opener` field is unused
// (HR-0 uses LEAD_LINE_1/LEAD_LINE_2 for its solo intro instead) — kept here
// so the same record shape applies to all three roles.
const LINES_BY_ROLE = [
  {
    opener: '',
    bicker: ['Mine first —\nthree urgent files!', 'Stop pushing yours\nover mine!', 'Just glance at\nthe cover sheet!'],
    shout: 'JUST READ\nMINE!',
  },
  {
    opener: 'Could you do\nmine first?',
    bicker: ['Waiting since\nMONDAY.', 'Do not ignore\nthe queue!', 'You promised\nbefore lunch!'],
    shout: 'PICK ME!',
  },
  {
    opener: 'I have the best\ncandidates.',
    bicker: ['Senior. Role.\nNow.', 'EOW or the\noffer expires.', 'My pile is\nthe deepest!'],
    shout: 'PRIORITISE!',
  },
] as const;

function makeHrScript(role: Role): EntityScript {
  return function* (self: Entity) {
    const targetX = GAME_W * (0.2 + role * 0.3);
    yield* moveTo(self, targetX, ENTRY_Y, ENTRY_SPEED);

    const lines = LINES_BY_ROLE[role];

    if (role === 0) {
      // Solo lead intro: two consecutive lines, no fire so the player can read.
      self.say(LEAD_LINE_1, LEAD_LINE_1_SAY);
      yield LEAD_LINE_1_SLOT;
      self.say(LEAD_LINE_2, LEAD_LINE_2_SAY);
      yield LEAD_LINE_2_SLOT;
      // Wait while HR-1 + HR-2 walk in and take turns introducing themselves
      // (their "(2 - followerIndex) * SLOT + GAP" tail puts both followers at
      // 2 * FOLLOWER_SLOT + GAP after their entry, so HR-0 must match).
      yield ENTRY_FRAMES + 2 * FOLLOWER_SLOT + OPENER_TO_BICKER_GAP;
    } else {
      // Followers spawn together, take turns: HR-1 first (offset 0), HR-2
      // second (offset SLOT). Both end at 2*SLOT + GAP after entry so the
      // bickering cycle starts in lockstep with HR-0.
      const followerIndex = role - 1;
      yield followerIndex * FOLLOWER_SLOT;
      self.say(lines.opener, FOLLOWER_SAY);
      yield (2 - followerIndex) * FOLLOWER_SLOT + OPENER_TO_BICKER_GAP;
    }

    // Bickering cycles — each role contributes a line + a volley per cycle.
    for (const line of lines.bicker) {
      if (!self.alive) return;
      yield role * TURN_GAP;
      self.say(line, SAY_DURATION);
      aimed(self, REPORTS_PER_TURN, reportBullet, REPORT_SPEED, REPORT_SPREAD);
      yield (2 - role) * TURN_GAP + CYCLE_GAP;
    }

    // Bombardment finale — single shout, then synchronized volleys.
    self.say(lines.shout, BOMBARD_VOLLEYS * BOMBARD_GAP);
    for (let i = 0; i < BOMBARD_VOLLEYS; i++) {
      if (!self.alive) return;
      aimed(self, BOMBARD_COUNT, reportBullet, REPORT_SPEED, BOMBARD_SPREAD);
      yield BOMBARD_GAP;
    }
  };
}

export const hr = new EntityKind({
  sprite: 'hr',
  animKey: 'hr_walk',
  hitboxRadius: 12,
  hp: 22,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
});

export function* hrTrioWave(self: Entity): Generator<ScriptYield, void, void> {
  // Lead HR enters alone with a CV stack and the room's attention. Buffed HP
  // so the player can't kill them before the followers arrive to make this an
  // actual trio.
  self.spawn(hr, GAME_W * 0.2, -30, 0, 0, {
    script: makeHrScript(0),
    hp: LEAD_HP,
  });
  // Wait for HR-0 to walk in and deliver both intro lines before the others
  // crash the meeting.
  yield ENTRY_FRAMES + LEAD_LINE_1_SLOT + LEAD_LINE_2_SLOT;
  self.spawn(hr, GAME_W * 0.5, -30, 0, 0, { script: makeHrScript(1) });
  self.spawn(hr, GAME_W * 0.8, -30, 0, 0, { script: makeHrScript(2) });
}
