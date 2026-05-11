import {
  KAEDALUS_FIGHT_BAR_S,
  KAEDALUS_HODGE_DIALOG_KEY,
  KAEDALUS_HODGE_FIGHT_KEY,
  KAEDALUS_SHORT_KEY,
  KAEDALUS_STAGE2_INTRO_KEY,
} from '../../audio/keys';
import { getCurrentTrackInfo, getMusicTime } from '../../audio/music/loop';
import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import {
  BossKind,
  becomeHittable,
  bossShudder,
  FLICKER_INTERVAL_FRAMES,
  FLICKER_TOGGLES,
  POST_FLICKER_HOLD_FRAMES,
} from '../../script/boss';
import { aimed, arc, moveTo, ring } from '../../script/patterns';
import { addMult } from '../../script/score';
import {
  markWave,
  prepareForBoss,
  race,
  startMusicLoop,
  suspendRunning,
  waitAudioTimeAtLeast,
  waitMusicComplete,
} from '../../script/stage';
import type { HPVars, ScriptYield } from '../../script/types';
import { bullet } from '../kinds';
import { reportBullet } from './reportBullet';

// Stage boss: a sad, retired old man "shrunk" from the company. Security is
// already on his shoulder — he just wants to pass his pile of unfinished
// tasks to someone before he's escorted out. Patterns lean slow and tired —
// drifting paperwork rather than aggressive volleys, but enough of it that
// standing still is not an option.

const ENTRY_SPEED = 60;
const ENTRY_Y = 100;

const PHASE_GAP = 50;

// Phase A — "old reports": tired homing paperwork aimed at the player. Wide
// spread so a single sidestep doesn't dodge the whole cloud, but the homing
// rate is the reportBullet default — drift laterally and they go past.
const PHASE_A_REPEATS = 5;
const PHASE_A_GAP = 32;
const PHASE_A_COUNT = 5;
const PHASE_A_SPEED = 130;
const PHASE_A_SPREAD = Math.PI / 4;

// Phase B — "the filing cabinet": slow rings nudging round a pivot. Bullet
// type, not paper, so the ring reads as office clutter rather than a second
// homing wave on top of phase A's.
const PHASE_B_REPEATS = 5;
const PHASE_B_GAP = 38;
const PHASE_B_RING_COUNT = 16;
const PHASE_B_RING_SPEED = 105;

// Phase C — "the long hand-off": wide downward arcs of paperwork. Slower
// than phase A, no homing (already past the launch window), so this is the
// "safe" phase where the player can mostly drill damage.
const PHASE_C_REPEATS = 5;
const PHASE_C_GAP = 36;
const PHASE_C_COUNT = 9;
const PHASE_C_SPEED = 115;

// Beat between Hodges's bubble going up and the shudder starting, so
// the line has time to read before he begins juddering.
const DEFEAT_PRE_SHUDDER_FRAMES = 24;
const DEFEAT_BUBBLE_FRAMES =
  DEFEAT_PRE_SHUDDER_FRAMES + FLICKER_TOGGLES * FLICKER_INTERVAL_FRAMES + POST_FLICKER_HOLD_FRAMES + 14;

// How close to the end of the 75-f fight track Hodge gets force-killed if
// the player hasn't put him down yet. The fight's pacing is gated on the
// music's natural end (see chain in content/stage.ts → fromHrTrio), so
// leaving Hodge alive past the music finish would leak into the next
// section. 3 s gives the shudder room to land before the track wraps.
const HODGE_FIGHT_TIMEOUT_PAD_S = 3;

// Per-spawn vars for Hodge. `timedOut` is raised by the music-time killer
// when the fight track is about to end; the death script reads it to
// suppress the mult-drop payout — the player didn't earn it.
type HodgeVars = HPVars & { timedOut: boolean };

// Whether this Hodge instance was set up under the stage-2 chain (i.e.
// the wave kicked off with the kaedalus stage-2 intro or already swapped
// into the dialog loop). Reused at multiple transition points, so
// factored out as a music-key probe.
function inKaedalusChain(): boolean {
  const key = getMusicTime()?.key;
  return key === KAEDALUS_HODGE_DIALOG_KEY || key === KAEDALUS_STAGE2_INTRO_KEY;
}

// Hodges's lethal-hit script. Visuals only — the 75-f fight track keeps
// playing through the shudder so the music can wrap naturally and hand
// off to crack_short via the chain. The mult drop is scheduled here
// (rather than up-front in the wave) so the timed-out variant can skip
// it without having to surgery the carrier's onDeath queue.
function* shrunkOldManDeath(self: Entity): Generator<ScriptYield, void, void> {
  self.body.setVelocity(0, 0);
  self.body.enable = false;
  self.say('Thirty-one years… all gone…', DEFEAT_BUBBLE_FRAMES);
  yield DEFEAT_PRE_SHUDDER_FRAMES;
  yield* bossShudder(self);
  const vars = self.vars as HodgeVars;
  if (!vars.timedOut) self.stage.scheduleMultDrop('boss');
  self.die();
}

// Music-time gate: if the player still hasn't killed Hodge with
// HODGE_FIGHT_TIMEOUT_PAD_S left on the 75-f track, replace his pattern
// loop with the death script. The timeout path tags `vars.timedOut` so
// the death script knows to skip the mult drop. Only fires while the
// fight track itself is active — practice runs that spawn Hodge under a
// different track skip the timeout entirely.
function* hodgeFightTimeout(self: Entity): Generator<ScriptYield, void, void> {
  const info = getCurrentTrackInfo();
  if (info === null || info.loopDuration <= HODGE_FIGHT_TIMEOUT_PAD_S) return;
  const triggerT = info.loopDuration - HODGE_FIGHT_TIMEOUT_PAD_S;
  yield* waitAudioTimeAtLeast(triggerT);
  if (!self.alive) return;
  const vars = self.vars as HodgeVars;
  vars.timedOut = true;
  // Lock damage off so a stray bullet that lands a frame later can't
  // re-enter takeDamage and re-fire the death script.
  self.setDamagedByClasses([]);
  self.stage.runScript(self, shrunkOldManDeath);
}

function* shrunkOldManPatterns(self: Entity): Generator<ScriptYield, void, void> {
  while (true) {
    self.say('Could you finish these reports?', 100);
    for (let i = 0; i < PHASE_A_REPEATS; i++) {
      aimed(self, PHASE_A_COUNT, reportBullet, PHASE_A_SPEED, PHASE_A_SPREAD);
      yield PHASE_A_GAP;
    }
    yield PHASE_GAP;

    self.say('And these go in the filing cabinet…', 110);
    let baseAngle = Math.random() * Math.PI * 2;
    for (let i = 0; i < PHASE_B_REPEATS; i++) {
      ring(self, PHASE_B_RING_COUNT, bullet, PHASE_B_RING_SPEED, baseAngle);
      baseAngle += Math.PI / PHASE_B_RING_COUNT;
      yield PHASE_B_GAP;
    }
    yield PHASE_GAP;

    self.say('I never did get to these…', 120);
    for (let i = 0; i < PHASE_C_REPEATS; i++) {
      arc(self, PHASE_C_COUNT, reportBullet, PHASE_C_SPEED, Math.PI / 6, (5 * Math.PI) / 6);
      yield PHASE_C_GAP;
    }
    yield PHASE_GAP;
  }
}

function* shrunkOldManScript(self: Entity) {
  // Initialise the timeout latch on every spawn.
  (self.vars as HodgeVars).timedOut = false;

  // Slow shuffle to anchor. BossKind makes him unhittable on spawn so
  // the player can't melt him before he's said his piece; becomeHittable
  // below opts back into damage after the dialogue.
  yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);
  yield 30;

  // Music-key probe: gate the kaedalus-specific music swaps to runs
  // that actually entered through the stage-2 chain. Defensive guard —
  // a future reuser that spawns Hodge under different music keeps its
  // own context instead of having it overwritten.
  const kaedalusChain = inKaedalusChain();
  if (kaedalusChain) yield* startMusicLoop(KAEDALUS_HODGE_DIALOG_KEY);

  const ch = self.stage.player.character;
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    right: { sprite: 'geezer', frame: 1, name: 'Mr. Hodges' },
    lines: [
      { speaker: 'right', text: 'Excuse me… do you have a minute?' },
      { speaker: 'left', text: 'Who are you?' },
      {
        speaker: 'right',
        text: "Hodges. Thirty-one years with the firm. They 'shrunk' my position this morning.",
      },
      {
        speaker: 'right',
        text: 'Security gave me ten minutes to clear my desk. There are still… a few things to hand over.',
      },
      { speaker: 'left', text: "I'm not staying late for someone else's backlog." },
      { speaker: 'right', text: 'Please. I have nowhere else to leave them.' },
    ],
  });

  // Claim the HUD header now that the fight is actually starting; release it
  // on death (covers both natural defeat and forced cleanup via release(),
  // which calls die() too). Also stash the boss entity reference so the
  // debug HUD's bossHp readout can read off it without scanning groups.
  self.stage.bossName = 'Mr. Hodges';
  self.stage.bossEntity = self;
  self.onDeath(() => {
    self.stage.bossName = null;
    self.stage.bossEntity = null;
  });

  // Switch from the 71 dialog loop to the 75-f one-shot fight track.
  // becomeHittable is delayed until after the swap so the damaging flag
  // and the fight music kick in together.
  if (kaedalusChain) yield* startMusicLoop(KAEDALUS_HODGE_FIGHT_KEY, { loop: false });

  becomeHittable(self);
  self.say('Just a few old tasks…', 110);
  yield 60;

  // Patterns loop until the lethal hit lands (takeDamage routes through
  // shrunkOldManDeath) or, in the chain run, until the 75-f track is
  // ~3 s from ending — the timeout racer then force-swaps Hodge into
  // the death script with `timedOut` set.
  if (kaedalusChain) {
    yield* race(shrunkOldManPatterns(self), hodgeFightTimeout(self));
  } else {
    yield* shrunkOldManPatterns(self);
  }
}

export const shrunkOldMan = new BossKind({
  sprite: 'geezer',
  hitboxRadius: 22,
  hp: 72,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
  defaultScript: shrunkOldManScript,
  deathScript: shrunkOldManDeath,
});

export function* shrunkOldManWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'mr. hodges');
  // Music + mult-drop are deferred to the boss script itself: the dialog
  // loop is started just before the dialogue beat (so the cue lines up
  // with the user's mental model of "music starts on dialog"), and the
  // drop is scheduled inside the death script so the timeout-kill variant
  // can suppress it.
  // Same opening beat as the final-boss wave: don't bring him on while
  // leftover enemies are still drifting around, sweep stragglers, brief
  // pause for funereal tone, then he shuffles in. BossKind keeps him
  // unhittable on spawn; his script calls becomeHittable after the
  // dialogue.
  yield* prepareForBoss(self);
  let boss: Entity | null = null;
  yield* suspendRunning(self, function* () {
    boss = self.spawn(shrunkOldMan, GAME_W / 2, -30, 0, 0);
    yield { until: boss };
  });

  // Post-death music routing. The 74+75-f fight track is a one-shot, so
  // the kill point splits two ways:
  //   - Player kill (vars.timedOut === false): round the current music
  //     timestamp up to the next 3-second bar boundary, award one mult
  //     floor lift per bar of fight track skipped from there to the
  //     natural end, then hard-cut to crack_short.
  //   - Timeout kill (vars.timedOut === true): the fight track is
  //     already within a few seconds of its natural end. Let it run out
  //     and `waitMusicComplete` triggers crack_short on the seam — no
  //     bonus, since the player didn't actually finish the fight.
  if (getMusicTime()?.key === KAEDALUS_HODGE_FIGHT_KEY && boss !== null) {
    yield* finishHodgeMusic(self, boss);
  }
}

function* finishHodgeMusic(self: Entity, boss: Entity): Generator<ScriptYield, void, void> {
  const vars = boss.vars as HodgeVars | null;
  const timedOut = vars?.timedOut === true;
  if (timedOut) {
    yield* waitMusicComplete();
    yield* startMusicLoop(KAEDALUS_SHORT_KEY);
    return;
  }
  const m = getMusicTime();
  const info = getCurrentTrackInfo();
  if (m === null || info === null) {
    yield* startMusicLoop(KAEDALUS_SHORT_KEY);
    return;
  }
  const totalDur = info.loopDuration;
  const barAlignedT = Math.ceil(m.time / KAEDALUS_FIGHT_BAR_S) * KAEDALUS_FIGHT_BAR_S;
  yield* waitAudioTimeAtLeast(barAlignedT);
  const barsSkipped = Math.max(0, Math.floor((totalDur - barAlignedT) / KAEDALUS_FIGHT_BAR_S));
  if (barsSkipped > 0) addMult(self.stage.score, barsSkipped);
  yield* startMusicLoop(KAEDALUS_SHORT_KEY);
}
