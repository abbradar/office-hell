import type { Entity } from '../../entities/Entity';
import { EnemyBulletEntityKind } from '../../script/types';

// Drink bullet: rides its launch heading but oscillates laterally on a sine.
// Stream of these from a single source forms a serpent-shaped wave in space —
// the player threads between crests rather than blocking head-on.

// Lateral amplitude in pixels and angular velocity in radians per script
// frame. Peak lateral velocity (px/sec) = AMP * FREQ * SCRIPT_FPS = 225, well
// under the forward speed so the wave's "forward" direction reads cleanly.
const SINE_AMP_PX = 25;
const SINE_FREQ_PER_FRAME = 0.3;

// Phaser arcade physics integrates px/sec; this script ticks every other frame
// (yield 1 → 30Hz) so we scale the per-script-frame derivative back up to a
// per-second velocity.
const SCRIPT_FPS = 30;

function* drinkBulletScript(self: Entity) {
  const v0 = self.body.velocity;
  const speed = Math.hypot(v0.x, v0.y);
  const heading = Math.atan2(v0.y, v0.x);
  // Lateral basis = heading rotated +90°. Forward velocity stays constant;
  // the script overlays a sinusoidal lateral component on top of it.
  const lx = -Math.sin(heading);
  const ly = Math.cos(heading);
  const fx = Math.cos(heading) * speed;
  const fy = Math.sin(heading) * speed;

  let age = 0;
  while (true) {
    age++;
    const latVel = SINE_AMP_PX * SINE_FREQ_PER_FRAME * SCRIPT_FPS * Math.cos(age * SINE_FREQ_PER_FRAME);
    self.body.setVelocity(fx + lx * latVel, fy + ly * latVel);
    yield 1;
  }
}

export const drinkBullet = new EnemyBulletEntityKind({
  sprite: 'drinkBullet',
  hitboxRadius: 4,
  defaultScript: drinkBulletScript,
});
