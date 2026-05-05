import { GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import type { Player } from '../entities/Player';
import type { StageManager } from '../script/StageManager';

// Three-phase bomb: brief freeze (the player visibly snaps), an
// expanding shockwave that consumes anything it touches, and a short
// linger as the comic-book starburst fades. Total length is exported so
// the intro tutorial can wait for the effect to fully resolve before
// playing the next dialog.
const BOMB_FREEZE_MS = 150;
const BOMB_EXPLODE_MS = 700;
const BOMB_LINGER_MS = 200;
export const BOMB_DURATION_MS = BOMB_FREEZE_MS + BOMB_EXPLODE_MS + BOMB_LINGER_MS;

// Panic radius around the player — half the play field width, so a bomb
// fired with the player hugging one edge still reaches projectiles at the
// centre line. The intro tutorial relies on this: the email approaches
// centred while the player has dodged to a side.
const BOMB_RADIUS = GAME_W / 2;

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
  const cx = player.x;
  const cy = player.y;

  // Make the player untouchable for the duration: a stray bullet that
  // spawned mid-bomb (or one whose freeze we missed by a frame) would
  // otherwise sail straight into them. Push/pop pairs so back-to-back
  // bombs extend the window rather than ending it early.
  player.pushInvincible();
  scene.time.delayedCall(BOMB_DURATION_MS, () => player.popInvincible());

  // The intro forces barkIndex=0 so the tutorial bomb pairs with a
  // predictable line; everywhere else picks at random.
  const idx = opts?.barkIndex ?? Math.floor(Math.random() * BOMB_BARKS.length);
  // biome-ignore lint/style/noNonNullAssertion: BOMB_BARKS is a non-empty literal
  const bark = BOMB_BARKS[idx]!;
  player.say(bark, BARK_FRAMES);

  // Snapshot before iterating: freezeBullet removes entries from the group
  // mid-loop (so the bullet can't damage the player while frozen), and
  // Phaser's getChildren() returns a live reference — mutating it while
  // iterating would skip every other match.
  const candidates = stage.damages.player.getChildren().slice();
  const bullets: { e: Entity; d: number }[] = [];
  const r2 = BOMB_RADIUS * BOMB_RADIUS;
  for (const child of candidates) {
    const e = child as Entity;
    if (!e.alive) continue;
    // Skip enemies — only the projectiles ("documents/calls/etc") are
    // affected. Bullet kinds use hp=null; living enemies always have hp
    // set, so this cleanly partitions them without an explicit kind list.
    if (e.hp !== null) continue;
    const dx = e.x - cx;
    const dy = e.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;
    freezeBullet(stage, e);
    bullets.push({ e, d: Math.sqrt(d2) });
  }

  // Punch the camera so the freeze feels like an impact, not a stutter.
  scene.cameras.main.shake(BOMB_FREEZE_MS + 180, 0.005);

  // Depth 49 sits just below the touch-button band's mask (depth 50),
  // so on mobile the explosion is clipped to the playfield instead of
  // bleeding behind the buttons.
  const gfx = scene.add.graphics().setDepth(49);

  const freezeFrac = BOMB_FREEZE_MS / BOMB_DURATION_MS;
  const explodeEndFrac = (BOMB_FREEZE_MS + BOMB_EXPLODE_MS) / BOMB_DURATION_MS;

  const state = { t: 0 };
  scene.tweens.add({
    targets: state,
    t: 1,
    duration: BOMB_DURATION_MS,
    ease: 'Linear',
    onUpdate: () => drawBomb(gfx, cx, cy, state.t, bullets, freezeFrac, explodeEndFrac),
    onComplete: () => {
      gfx.destroy();
      // Failsafe: any bullet that the wave's discrete sampling skipped
      // (e.g. one parked just past the final sampled radius) still gets
      // cleared so the screen ends in the same state regardless.
      for (const { e } of bullets) if (e.alive) e.die();
    },
  });
}

function freezeBullet(stage: StageManager, bullet: Entity): void {
  // Replace the bullet's script so any in-flight homing pattern can't
  // override the velocity we set; pull it out of damages.player so a
  // frozen sprite parked on the player doesn't tick damage during the
  // bomb (player is invincible for the window, but the cleaner partition
  // keeps the bomb robust to shorter invincibility tweaks later).
  bullet.body.setVelocity(0, 0);
  stage.damages.player.remove(bullet);
  stage.runScript(bullet, function* (self) {
    while (self.alive) {
      self.body.setVelocity(0, 0);
      yield 1;
    }
  });
}

function drawBomb(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  t: number,
  bullets: { e: Entity; d: number }[],
  freezeFrac: number,
  explodeEndFrac: number,
): void {
  g.clear();

  if (t <= freezeFrac) {
    // Wind-up: a small red core swells at the player's position. Sells
    // the freeze as deliberate ("she's about to *snap*") rather than a
    // physics hiccup.
    const f = t / freezeFrac;
    g.fillStyle(0xff3322, 0.25 + 0.55 * f);
    g.fillCircle(cx, cy, 10 + 28 * f);
    g.fillStyle(0xffe066, 0.7 * f);
    g.fillCircle(cx, cy, 6 + 14 * f);
    return;
  }

  // After the wind-up, t maps onto two phases — the wave expanding to
  // full reach (`waveT` 0→1), then a linger as the burst fades.
  let waveT: number;
  let alpha: number;
  if (t <= explodeEndFrac) {
    waveT = (t - freezeFrac) / (explodeEndFrac - freezeFrac);
    alpha = 1;
  } else {
    waveT = 1;
    const linger = (t - explodeEndFrac) / (1 - explodeEndFrac);
    alpha = 1 - linger;
  }

  // Kill bullets the leading edge of the wave has reached. Once dead,
  // StageManager.update releases them from the pool on the next tick.
  const r = waveT * BOMB_RADIUS;
  for (const item of bullets) {
    if (item.e.alive && r >= item.d) item.e.die();
  }

  // Outer shockwave ring — red rim with an orange inner echo. Fades as
  // it expands so it doesn't feel like a hard line plowing across the
  // field.
  const ringFade = alpha * (1 - waveT * 0.55);
  g.lineStyle(8, 0xff3322, ringFade);
  g.strokeCircle(cx, cy, r);
  g.lineStyle(4, 0xff9933, ringFade);
  g.strokeCircle(cx, cy, r * 0.92);

  // Hot core — a white-hot dot inside a yellow halo, both shrinking as
  // the wave expands.
  const coreScale = 1 - waveT * 0.7;
  g.fillStyle(0xfff066, alpha * coreScale);
  g.fillCircle(cx, cy, 50 * coreScale);
  g.fillStyle(0xffffff, alpha * coreScale * 0.85);
  g.fillCircle(cx, cy, 22 * coreScale);

  // Comic-book anger starburst: a 16-vertex star (8 long spikes
  // alternating with 8 short ones) rotating slightly as it scales up.
  // Asymmetric spike lengths read as "BAM!"-jagged rather than a clean
  // sun.
  const longR = (38 + waveT * 60) * (1 - waveT * 0.25);
  const shortR = (16 + waveT * 28) * (1 - waveT * 0.25);
  const rotation = waveT * 0.45;
  const points = 16;
  g.beginPath();
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2 - Math.PI / 2 + rotation;
    const rr = i % 2 === 0 ? longR : shortR;
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fillStyle(0xffe066, alpha);
  g.fillPath();
  g.lineStyle(2, 0xff3322, alpha);
  g.strokePath();
}
