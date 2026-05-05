import { GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import type { Player } from '../entities/Player';
import type { StageManager } from '../script/StageManager';

// Panic radius around the player — half the play field width, so a bomb
// fired with the player hugging one edge still reaches projectiles at the
// centre line. The intro tutorial relies on this: the email approaches
// centred while the player has dodged to a side.
const BOMB_RADIUS = GAME_W / 2;

// Travel time from a bullet's freeze position to the bin. The script paces the
// suction to land in roughly this window so the player gets a clear breather
// instead of a snap-clear.
const SUCK_TRAVEL_MS = 3000;
// Total bomb duration — long enough to outlast the suction so the last bullet
// visibly lands in the bin. Exported so callers (e.g. the intro tutorial)
// can wait for a bomb to be truly finished before moving on.
export const BOMB_DURATION_MS = SUCK_TRAVEL_MS + 600;
const BIN_DISMISS_DELAY_MS = BOMB_DURATION_MS;
// Bin sits hugging the right wall, vertically centred on the player so the
// "documents" sweep horizontally off into the can rather than diving past the
// player sprite.
const BIN_EDGE_MARGIN = 24;

// Passive-aggressive office-speak the player snaps out as they "get angry"
// and nuke the field. One picked at random per bomb — keeps repeated bombing
// from feeling robotic.
const BOMB_BARKS = [
  'Enough of this, please.',
  "I'm trying to work here.",
  'Could we be professional about this?',
  'This is really inappropriate.',
  'Per my last email — busy.',
  'Some of us have deadlines.',
  "Let's discuss this offline.",
  "I'll have to escalate this.",
];
const BARK_FRAMES = 90;

export function activateBomb(player: Player, stage: StageManager, opts?: { barkIndex?: number }): void {
  const scene = stage.scene;
  const binX = GAME_W - BIN_EDGE_MARGIN;
  const binY = player.y;

  // Make the player untouchable for the duration: the suction is slow and
  // bullets that didn't land in radius (or that get spawned mid-bomb) would
  // otherwise sail straight into them. Push/pop pairs so back-to-back bombs
  // extend the window rather than ending it early.
  player.pushInvincible();
  scene.time.delayedCall(BIN_DISMISS_DELAY_MS, () => player.popInvincible());

  // The intro forces barkIndex=0 so the tutorial bomb pairs with a
  // predictable line; everywhere else picks at random.
  const idx = opts?.barkIndex ?? Math.floor(Math.random() * BOMB_BARKS.length);
  // biome-ignore lint/style/noNonNullAssertion: BOMB_BARKS is a non-empty literal
  const bark = BOMB_BARKS[idx]!;
  player.say(bark, BARK_FRAMES);

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
