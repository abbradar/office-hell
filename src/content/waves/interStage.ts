import { GAME_H, PLAYER_Y } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo } from '../../script/patterns';
import { markWave, waitSeconds } from '../../script/stage';
import { EntityKind, type ScriptYield } from '../../script/types';
import { CHARACTERS } from '../characters';
import { PROP_WATER_DISPENSER_KEY } from '../textures';

// Inter-stage breather: the player walks up to a water cooler at the
// centre of the playfield, the *other* MC walks down from the top, they
// exchange four lines, then the other walks off, the floor carries the
// player and cooler back to the bottom, and the player picks up the
// gameplay-normal forward walk.
//
// The "water cooler" is a 32×32 sprite from the Office-Furniture-Pixel-
// Art set, drawn behind the characters as a fixture in the corridor.

const COOLER_X = 36;
const COOLER_Y = GAME_H / 2;
// Cooler enters the scene from off-screen above and slides down to
// COOLER_Y. Starting y comfortably past the top edge so the slide is
// visible for a beat instead of popping in mid-screen. The slide is
// driven by the floor scrolling — the cooler is a fixture in the
// world, so its on-screen descent is just "the player walks forward
// and the cooler appears to come closer". Slide duration falls out of
// distance / floor speed so the cooler reads as stationary in world.
const COOLER_SLIDE_START_Y = -50;
// Offsets above / below the cooler the two characters end up at when
// they meet. Sized so neither sprite overlaps the dispenser sprite.
const PLAYER_DEST_Y = COOLER_Y + 36;
const OTHER_DEST_Y = COOLER_Y - 36;
// Walking speed (px/s). Matches the PLAYER_SPEED-derived rule of thumb
// of "half jogging" — slow enough to read as ambient walking instead of
// the gameplay run.
const WALK_SPEED = 80;
// Beat between arriving at the cooler and the dialog opening — gives
// both sprites a moment to settle into idle frames.
const SETTLE_SECONDS = 0.4;
// Where the cooler ends up sitting just above the player at PLAYER_Y.
const COOLER_REST_Y = PLAYER_Y - 36;
// Floor-scroll baseline (px/s). Mirrors GameScene.CORRIDOR_SCROLL_PX_PER_MS
// (= 0.1) × 1000. Used to time the cooler's tweens so it reads as a
// fixture sliding past at the same rate the floor texture is moving.
const FLOOR_SCROLL_PX_PER_SEC = 100;
// Where the cooler exits to once the player is walking forward again —
// past the bottom edge by enough that the cull margin / off-screen
// destruction handles cleanup.
const COOLER_EXIT_Y = GAME_H + 50;
const OTHER_EXIT_Y = COOLER_EXIT_Y;

export function* interStageWaterCooler(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'water cooler');

  const stage = self.stage;
  const scene = self.scene;
  const player = stage.player;
  const playerCh = player.character;
  // Swap roster: female → male, male → female. Two-entry roster so
  // the lookup is just "the other one".
  const otherCh = playerCh.id === 'female' ? CHARACTERS[1] : CHARACTERS[0];
  if (!otherCh) throw new Error('character roster has fewer than 2 entries');

  // ─── Cooler approach: floor scrolls forward, cooler drifts down ────
  //
  // The player keeps walking forward (walkInPlace + walkAnim) at
  // PLAYER_Y; the floor scrolls under them at gameplay-normal speed,
  // and the cooler — a fixture in the world — tweens down on screen
  // at the same rate, reading as "stationary in world, the floor is
  // dragging it past". Wait for the cooler to land at COOLER_Y before
  // the original walk-to-meeting flow takes over.
  player.lockControls();
  player.firingEnabled = false;
  player.walkAnim = true;
  player.walkInPlace = true;
  player.facing = 'up';
  player.updateAnim();
  stage.running = true;
  stage.scrollSpeedMultiplier = 1;

  // Water cooler enters from off-screen above. Depth -5 sits above the
  // floor (-10) / walls (-9) and below entities (default 0) so the
  // characters walk over the sprite visually. The 32×32 sprite renders
  // at native size.
  const cooler = scene.add.image(COOLER_X, COOLER_SLIDE_START_Y, PROP_WATER_DISPENSER_KEY).setDepth(-5);
  // Slide duration = distance ÷ floor speed, so the cooler descends in
  // lockstep with the corridor scroll.
  const slideDist = COOLER_Y - COOLER_SLIDE_START_Y;
  const slideMs = (slideDist / FLOOR_SCROLL_PX_PER_SEC) * 1000;
  scene.tweens.add({
    targets: cooler,
    y: COOLER_Y,
    duration: slideMs,
    ease: 'Linear',
  });
  yield* waitSeconds(slideMs / 1000);

  // ─── Approach + dialog (unchanged from the original) ────────────────
  //
  // Floor pauses; the two MCs walk to the cooler at the centre and
  // exchange lines, settling into idle.
  stage.running = false;
  player.walkInPlace = false;
  player.updateAnim();

  // The other MC: a one-off EntityKind wrapping their character sheet.
  // hitboxRadius = 1 (rather than 0) to keep the arcade body enabled
  // — disabled bodies don't integrate velocity, so moveTo would have
  // nothing to drive. damageClass / damagedByClass are empty so the
  // entity isn't a member of any overlap group; collision is inert.
  const otherKind = new EntityKind({
    sprite: otherCh.sprite,
    hitboxRadius: 1,
  });
  const other = self.spawn(otherKind, COOLER_X, -30, 0, 0);
  other.walkAnim = true;

  // Walk both to the cooler in parallel. Player approaches from
  // below, other from above. The `all` join waits until both moveTo
  // generators finish.
  yield {
    all: [
      moveTo(player, COOLER_X + 10, PLAYER_DEST_Y, WALK_SPEED),
      moveTo(other, COOLER_X - 10, OTHER_DEST_Y, WALK_SPEED),
    ],
  };

  // Face each other — moveTo zeroes velocity on arrival, so updateAnim
  // would otherwise read the last `facing` (which during travel was
  // 'up' for player, 'down' for other; happens to be what we want
  // already). Set explicitly to avoid relying on that coincidence.
  player.facing = 'up';
  other.facing = 'down';
  player.updateAnim();
  other.updateAnim();
  yield* waitSeconds(SETTLE_SECONDS);

  // The conversation. Greeting line uses the player's actual name so
  // it reads correctly for either MC. The MC's tail-end gripes are
  // sourced from the run-wide GameScore — counters are accumulated by
  // the engine (bullets fired, kills, HP lost, bombs used, continues
  // taken) so the lines reflect how the player actually played stage 1.
  const score = stage.score;
  const excuses = score.bullets;
  const colleagues = score.kills;
  const angry = score.bombs;
  const hits = score.hpLost;
  const continues = score.continues;
  const excusesLine =
    excuses === 1 && colleagues === 1
      ? 'I told one excuse to send one colleague away from me.'
      : excuses === 1
        ? `I told one excuse to send ${colleagues} colleagues away from me.`
        : colleagues === 1
          ? `I told ${excuses} excuses to send one colleague away from me.`
          : `I told ${excuses} excuses to send ${colleagues} colleagues away from me.`;
  const angryLine =
    angry === 0
      ? "At least I didn't get angry."
      : angry === 1
        ? 'I even got angry once.'
        : `I even got angry ${angry} times.`;
  const lines: { speaker: 'left' | 'right'; text: string }[] = [
    { speaker: 'right', text: `Evening, ${playerCh.name}. Everyone is running mad around.` },
    { speaker: 'left', text: 'Today is even more than usual. Are you not leaving?' },
    { speaker: 'right', text: 'I was going to, but ran into some colleagues.' },
    { speaker: 'left', text: 'Ah, I know the feeling.' },
    { speaker: 'left', text: excusesLine },
    { speaker: 'left', text: angryLine },
  ];
  if (hits > 0) {
    lines.push({
      speaker: 'left',
      text: hits === 1 ? 'They even got me once.' : `They even got me ${hits} times.`,
    });
  }
  if (continues >= 1) {
    lines.push({
      speaker: 'left',
      text: continues === 1 ? 'And I thought of just quitting.' : `And I thought of just quitting ${continues} times.`,
    });
  }
  lines.push({ speaker: 'right', text: 'Well, today is certainly a strange day. Try not to loose your head.' });
  lines.push({ speaker: 'left', text: 'You too. See you around, I guess?' });
  lines.push({ speaker: 'right', text: 'If there will be more of those collegues.' });
  yield self.dialogue({
    left: { sprite: playerCh.sprite, frame: playerCh.frame, name: playerCh.name },
    right: { sprite: otherCh.sprite, frame: otherCh.frame, name: otherCh.name },
    lines,
  });

  // ─── Post-dialog: other exits, floor carries player+cooler down ────
  //
  // Phase A — other walks off-screen up. Floor still not moving; the
  // player is rooted at PLAYER_DEST_Y until the next phase.
  yield* moveTo(other, COOLER_X - 10, OTHER_EXIT_Y, WALK_SPEED);
  other.die();

  // Phase B — floor scrolls, carrying the player and cooler back to the
  // gameplay-normal screen positions. Player and cooler tween in
  // lockstep with the floor so they read as fixtures the floor is
  // dragging downward.
  //
  // moveTo with `silent: true` drives the body but holds the idle frame
  // — sells "the floor is doing the moving, not the player".
  stage.running = true;
  stage.scrollSpeedMultiplier = 1;
  player.walkInPlace = false;
  const dropDist = PLAYER_Y - PLAYER_DEST_Y;
  const dropMs = (dropDist / FLOOR_SCROLL_PX_PER_SEC) * 1000;
  scene.tweens.add({
    targets: cooler,
    y: COOLER_REST_Y,
    duration: dropMs,
    ease: 'Linear',
  });
  yield* moveTo(player, player.x, PLAYER_Y, FLOOR_SCROLL_PX_PER_SEC, { silent: true });

  // Phase C — player starts moving up: corridor scroll flips back to
  // forward (gameplay-normal), the player walks-in-place at PLAYER_Y,
  // and the cooler drifts down past the bottom edge as the world rolls
  // past it.
  stage.scrollSpeedMultiplier = 1;
  player.walkInPlace = true;
  player.facing = 'up';
  player.updateAnim();
  const exitDist = COOLER_EXIT_Y - COOLER_REST_Y;
  const exitMs = (exitDist / FLOOR_SCROLL_PX_PER_SEC) * 1000;
  scene.tweens.add({
    targets: cooler,
    y: COOLER_EXIT_Y,
    duration: exitMs,
    ease: 'Linear',
    onComplete: () => cooler.destroy(),
  });
  yield* waitSeconds(exitMs / 1000);

  // Cleanup. Cooler is normally destroyed by the tween's onComplete by
  // the time we get here; explicit destroy is idempotent if the wave
  // was cut mid-flight.
  if (cooler.active) cooler.destroy();
  player.walkAnim = false;
  player.walkInPlace = false;
  player.updateAnim();
  // separateWave's finally resets controls / firing / collide-bounds.
  // Scroll multiplier stays at 1 for the next wave.
}
