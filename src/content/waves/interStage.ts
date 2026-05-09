import { GAME_H, GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo } from '../../script/patterns';
import { markWave, suspendRunning, waitSeconds } from '../../script/stage';
import { EntityKind, type ScriptYield } from '../../script/types';
import { COLOR_DRINK_LIQUID } from '../../ui/palette';
import { CHARACTERS } from '../characters';

// Inter-stage breather: the player walks up to a water cooler at the
// centre of the playfield, the *other* MC walks down from the top, they
// exchange four lines, then both walk off in opposite directions. Lives
// in the practice menu for now (not in the live stage script) so the
// shape can be iterated against the rest of stage 2 without disturbing
// the main flow.
//
// The "water cooler" is a simple blue rectangle drawn behind the
// characters — placeholder until proper office-fixture art lands.

const COOLER_W = 28;
const COOLER_H = 32;
const COOLER_X = GAME_W / 2;
const COOLER_Y = GAME_H / 2;
// Offsets above / below the cooler the two characters end up at when
// they meet. Sized so neither sprite overlaps the cooler rectangle.
const PLAYER_DEST_Y = COOLER_Y + 36;
const OTHER_DEST_Y = COOLER_Y - 36;
// Walking speed (px/s). Matches the PLAYER_SPEED-derived rule of thumb
// of "half jogging" — slow enough to read as ambient walking instead of
// the gameplay run.
const WALK_SPEED = 80;
// Beat between arriving at the cooler and the dialog opening — gives
// both sprites a moment to settle into idle frames.
const SETTLE_SECONDS = 0.4;

export function* interStageWaterCooler(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'water cooler');
  yield* suspendRunning(self, function* () {
    const stage = self.stage;
    const scene = self.scene;
    const player = stage.player;
    const playerCh = player.character;
    // Swap roster: female → male, male → female. Two-entry roster so
    // the lookup is just "the other one".
    const otherCh = playerCh.id === 'female' ? CHARACTERS[1] : CHARACTERS[0];
    if (!otherCh) throw new Error('character roster has fewer than 2 entries');

    player.lockControls();
    player.walkAnim = true;

    // Water cooler at centre. Depth -5 sits above the floor (-10) /
    // walls (-9) and below entities (default 0) so the characters walk
    // over the rectangle visually.
    const cooler = scene.add.rectangle(COOLER_X, COOLER_Y, COOLER_W, COOLER_H, COLOR_DRINK_LIQUID).setDepth(-5);

    // The other MC: a one-off EntityKind wrapping their character sheet.
    // hitboxRadius = 1 (rather than 0) to keep the arcade body enabled
    // — disabled bodies don't integrate velocity, so moveTo would have
    // nothing to drive. damageClass / damagedByClass are empty so the
    // entity isn't a member of any overlap group; collision is inert.
    const otherKind = new EntityKind({
      sprite: otherCh.sprite,
      hitboxRadius: 1,
      hp: null,
      damageClass: [],
      damagedByClass: [],
    });
    const other = self.spawn(otherKind, COOLER_X, -30, 0, 0);
    other.walkAnim = true;

    // Walk both to the cooler in parallel. Player approaches from
    // below, other from above. The `all` join waits until both moveTo
    // generators finish.
    yield {
      all: [moveTo(player, COOLER_X, PLAYER_DEST_Y, WALK_SPEED), moveTo(other, COOLER_X, OTHER_DEST_Y, WALK_SPEED)],
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
    // it reads correctly for either MC.
    yield self.dialogue({
      left: { sprite: playerCh.sprite, frame: playerCh.frame, name: playerCh.name },
      right: { sprite: otherCh.sprite, frame: otherCh.frame, name: otherCh.name },
      lines: [
        { speaker: 'right', text: `Evening, ${playerCh.name}. Everyone is running mad around.` },
        { speaker: 'left', text: 'Today is even more than usual. Are you not leaving?' },
        { speaker: 'right', text: 'I was going to, but ran into some colleagues.' },
        { speaker: 'left', text: 'Ah, I know the feeling.' },
      ],
    });

    // Walk apart: player exits up, other exits down. -50 / GAME_H + 50
    // are well past the visible canvas; the entities just disappear off
    // the edge for the cull margin to handle.
    yield {
      all: [moveTo(player, COOLER_X, -50, WALK_SPEED), moveTo(other, COOLER_X, GAME_H + 50, WALK_SPEED)],
    };

    // Cleanup: drop the cooler, release the other entity to the pool,
    // clear the player's walk-anim flag. Practice mode tears the scene
    // down immediately after, but the cleanup keeps the routine safe to
    // call from anywhere (incl. a future live-stage integration).
    cooler.destroy();
    other.die();
    player.walkAnim = false;
  });
}
