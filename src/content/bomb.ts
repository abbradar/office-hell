import { GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import type { Player } from '../entities/Player';
import type { StageManager } from '../script/StageManager';

// How wide the panic radius is around the player. Generous on purpose — the
// bomb is a panic button, so anything that could plausibly clip the player in
// the next few seconds should get yanked.
const BOMB_RADIUS = 360;

// Travel time from a bullet's freeze position to the bin. The script paces the
// suction to land in roughly this window so the player gets a clear breather
// instead of a snap-clear.
const SUCK_TRAVEL_MS = 3000;
// How long the bin stays on screen — long enough to outlast the suction so
// the last bullet visibly lands in it.
const BIN_DISMISS_DELAY_MS = SUCK_TRAVEL_MS + 600;
// Bin sits hugging the right wall, vertically centred on the player so the
// "documents" sweep horizontally off into the can rather than diving past the
// player sprite.
const BIN_EDGE_MARGIN = 24;

// The excuse the player blurts out as they nuke the field. One picked at
// random per bomb — keeps repeated bombing from feeling robotic.
const EXCUSES = [
  'Sorry, urgent meeting!',
  "Can't now, I'm vibing.",
  'Hard stop at the top of the hour.',
  'Touching grass, brb.',
  "I'll circle back.",
  'My calendar says no.',
  'Deep work block, sorry!',
  "DND, I'm in flow.",
];
const EXCUSE_FRAMES = 90;

export function activateBomb(player: Player, stage: StageManager): void {
  const scene = stage.scene;
  const binX = GAME_W - BIN_EDGE_MARGIN;
  const binY = player.y;

  // Make the player untouchable for the duration: the suction is slow and
  // bullets that didn't land in radius (or that get spawned mid-bomb) would
  // otherwise sail straight into them. Push/pop pairs so back-to-back bombs
  // extend the window rather than ending it early.
  player.pushInvincible();
  scene.time.delayedCall(BIN_DISMISS_DELAY_MS, () => player.popInvincible());

  // biome-ignore lint/style/noNonNullAssertion: EXCUSES is a non-empty literal
  const excuse = EXCUSES[Math.floor(Math.random() * EXCUSES.length)]!;
  player.say(excuse, EXCUSE_FRAMES);

  const bin = scene.add.image(binX, binY, 'trashBin').setDepth(50).setScale(0);
  scene.tweens.add({
    targets: bin,
    scale: 1,
    duration: 150,
    ease: 'Back.easeOut',
  });

  // Snapshot the bin position — the closure outlives the bin sprite (we
  // destroy it on dismiss) and Phaser's destroyed-object property reads are
  // not something we want to depend on.
  const target = { x: binX, y: binY };

  // Snapshot before iterating: sweepBullet removes entries from the group
  // mid-loop (so the bullet can't damage the player en route), and Phaser's
  // getChildren() returns a live reference — mutating it while iterating
  // would skip every other match.
  const candidates = stage.damages.player.getChildren().slice();
  const r2 = BOMB_RADIUS * BOMB_RADIUS;
  for (const child of candidates) {
    const e = child as Entity;
    if (!e.alive) continue;
    // Skip enemies — only the projectiles ("documents/calls/etc") get sucked.
    // Bullet kinds use hp=null; living enemies always have hp set, so this
    // cleanly partitions them without an explicit kind list.
    if (e.hp !== null) continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    if (dx * dx + dy * dy > r2) continue;
    sweepBullet(stage, e, target);
  }

  scene.time.delayedCall(BIN_DISMISS_DELAY_MS, () => {
    scene.tweens.add({
      targets: bin,
      scale: 0,
      alpha: 0,
      duration: 200,
      onComplete: () => bin.destroy(),
    });
  });
}

function sweepBullet(stage: StageManager, bullet: Entity, target: { x: number; y: number }): void {
  // runScript below tears off whatever the bullet was running (homing,
  // etc.) so the old script can't override the velocity we're about to
  // set.
  bullet.setVelocity(0, 0);
  // Disarm: pull the bullet out of the player's damage group so it can't kill
  // the player while it's flying into the bin. Idempotent — release() will
  // try to remove again, that's a harmless no-op.
  stage.damages.player.remove(bullet);

  // Pace by travel time, not fixed speed: distant bullets need to arrive in
  // about the same window as nearby ones so the field clears as one breath.
  const dx0 = target.x - bullet.x;
  const dy0 = target.y - bullet.y;
  const d0 = Math.hypot(dx0, dy0);
  const speed = d0 > 1 ? d0 / (SUCK_TRAVEL_MS / 1000) : 0;

  stage.runScript(bullet, function* (self) {
    // A handful of frames of dead-stop reads as a "freeze" before the suction
    // starts — makes the bomb effect legible instead of looking like the
    // bullets just teleported.
    yield 8;
    while (self.alive) {
      const dx = target.x - self.x;
      const dy = target.y - self.y;
      const d = Math.hypot(dx, dy);
      if (d < 8) {
        self.die();
        return;
      }
      self.body.setVelocity((dx / d) * speed, (dy / d) * speed);
      yield 1;
    }
  });
}
