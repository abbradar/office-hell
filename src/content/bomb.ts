import { GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import type { Player } from '../entities/Player';
import type { StageManager } from '../script/StageManager';
import { COLOR_BOMB_CORE, COLOR_BOMB_GLOW, COLOR_BOMB_HIGHLIGHT, COLOR_BOMB_HOT, COLOR_BOMB_RING } from '../ui/palette';

// Three-phase bomb: brief freeze (the player visibly snaps), an
// expanding shockwave that consumes anything it touches, and a flicker-
// out as the comic-book starburst dies. Total length is exported so the
// intro tutorial can wait for the effect to fully resolve before playing
// the next dialog.
const BOMB_FREEZE_MS = 200;
// Wave reaches full reach by the 1.5s mark; the burst then flickers and
// fades through the rest of the invincibility window. Fade starts well
// before the expansion finishes so the burst is already dimming as the
// wave hits its outer edge — feels like the energy bleeds out instead
// of snapping off at the boundary.
const BOMB_EXPLODE_MS = 700;
const BOMB_LINGER_MS = 1100;
export const BOMB_DURATION_MS = BOMB_FREEZE_MS + BOMB_EXPLODE_MS + BOMB_LINGER_MS;

// Panic radius around the player — half the play field width, so a bomb
// fired with the player hugging one edge still reaches projectiles at the
// centre line. The intro tutorial relies on this: the email approaches
// centred while the player has dodged to a side.
const BOMB_RADIUS = GAME_W / 2;

// Death-bomb (continue rescue): tighter radius — only what was about to
// kill the player should clear, not the whole field — paired with a much
// longer invincibility window so the player has time to reorient before
// engaging again.
const DEATH_BOMB_RADIUS = GAME_W / 4;
const DEATH_BOMB_INVINCIBLE_MS = 3500;

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

  const bullets = findBulletsInRadius(stage, cx, cy, BOMB_RADIUS);
  // freezeBullet removes entries from damages.player; we already snapshotted
  // inside findBulletsInRadius so the iteration here is safe.
  for (const { e } of bullets) freezeBullet(stage, e);

  // Punch the camera so the freeze feels like an impact, not a stutter.
  scene.cameras.main.shake(BOMB_FREEZE_MS + 250, 0.005);

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

// Continue-rescue bomb: no bark, no shockwave VFX, no camera shake. Just
// pop bullets in a tighter radius and grant a longer invincibility window
// so the revived player isn't immediately killed again by whatever was
// already on top of them. Caller is responsible for actually reviving the
// player (alive flag, body, hp); this function only handles the rescue
// effect itself.
export function activateDeathBomb(player: Player, stage: StageManager): void {
  const scene = stage.scene;
  const cx = player.x;
  const cy = player.y;

  player.pushInvincible();
  scene.time.delayedCall(DEATH_BOMB_INVINCIBLE_MS, () => player.popInvincible());

  for (const { e } of findBulletsInRadius(stage, cx, cy, DEATH_BOMB_RADIUS)) e.die();
}

// Snapshot of every live player-damaging projectile within `radius` of
// (cx, cy), with each entry's distance from the centre. Snapshots the
// damages.player group up front so callers can mutate it during iteration
// (freeze a bullet, kill it, etc.) without skipping siblings — Phaser's
// getChildren() returns a live array. Only projectile-kind entities are
// matched (`hp === null`); living enemies always have hp set so this
// partitions cleanly without a kind list.
export function findBulletsInRadius(
  stage: StageManager,
  cx: number,
  cy: number,
  radius: number,
): { e: Entity; d: number }[] {
  const candidates = stage.damages.player.getChildren().slice();
  const bullets: { e: Entity; d: number }[] = [];
  const r2 = radius * radius;
  for (const child of candidates) {
    const e = child as Entity;
    if (!e.alive) continue;
    if (e.hp !== null) continue;
    const dx = e.x - cx;
    const dy = e.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;
    bullets.push({ e, d: Math.sqrt(d2) });
  }
  return bullets;
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
    g.fillStyle(COLOR_BOMB_CORE, 0.25 + 0.55 * f);
    g.fillCircle(cx, cy, 10 + 28 * f);
    g.fillStyle(COLOR_BOMB_GLOW, 0.7 * f);
    g.fillCircle(cx, cy, 6 + 14 * f);
    return;
  }

  // After the wind-up, t maps onto a wave-expansion ramp (`waveT` 0→1
  // ending at the full-reach mark) and an alpha ramp that decouples
  // from it: the fade starts as soon as the explosion phase begins and
  // runs all the way to the end of the linger, so the burst is already
  // dimming as the wave is still pushing outward. The flicker is a
  // square wave on top of the linear fade so the burst visibly stutters
  // before vanishing instead of just dimming.
  const explodePhase = (t - freezeFrac) / (1 - freezeFrac);
  const waveT = Math.min(1, (t - freezeFrac) / (explodeEndFrac - freezeFrac));
  const flicker = Math.floor(explodePhase * 14) % 2 === 0 ? 1 : 0.45;
  const alpha = (1 - explodePhase) * flicker;

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
  g.lineStyle(8, COLOR_BOMB_CORE, ringFade);
  g.strokeCircle(cx, cy, r);
  g.lineStyle(4, COLOR_BOMB_RING, ringFade);
  g.strokeCircle(cx, cy, r * 0.92);

  // Hot core — a white-hot dot inside a yellow halo, both shrinking as
  // the wave expands.
  const coreScale = 1 - waveT * 0.7;
  g.fillStyle(COLOR_BOMB_HOT, alpha * coreScale);
  g.fillCircle(cx, cy, 50 * coreScale);
  g.fillStyle(COLOR_BOMB_HIGHLIGHT, alpha * coreScale * 0.85);
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
  g.fillStyle(COLOR_BOMB_GLOW, alpha);
  g.fillPath();
  g.lineStyle(2, COLOR_BOMB_CORE, alpha);
  g.strokePath();
}
