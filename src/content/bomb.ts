import { GAME_W } from '../config';
import type { Entity } from '../entities/Entity';
import type { Player } from '../entities/Player';
import type { StageManager } from '../script/StageManager';
import { EnemyBulletEntityKind, EntityKind } from '../script/types';
import { COLOR_BOMB_CORE, COLOR_BOMB_GLOW } from '../ui/palette';
import { BOMB_EXPAND_ANIM, BOMB_EXPLOSION_KEY, BOMB_FADE_ANIM } from './textures';

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

// Continuous bomb collider. Lives in `damagedBy.player` so any enemy bullet
// that overlaps its hitbox runs the standard bullet → target collision
// path: the bullet's `EntityKind.targetCollision` calls our `takeDamage`
// (a no-op) and then `self.die()`s the bullet. Hitbox is full-size from
// the moment of activation, so a bullet that enters the radius at any
// point during the bomb window gets eaten before it can reach the
// (invincible-anyway) player.
class BombFieldKind extends EntityKind {
  override takeDamage(_self: Entity, _amount: number): void {
    // No-op. The bullet kills itself in EntityKind.targetCollision; the
    // field just needs to absorb the damage call without throwing.
  }
}

const bombField = new BombFieldKind({
  sprite: null,
  hitboxRadius: BOMB_RADIUS,
  damagedByClass: ['player'],
});

// Death-bomb (continue rescue): tighter radius — only what was about to
// kill the player should clear, not the whole field — paired with a much
// longer invincibility window so the player has time to reorient before
// engaging again.
const DEATH_BOMB_RADIUS = GAME_W / 4;
export const DEATH_BOMB_INVINCIBLE_MS = 3500;

// Passive-aggressive office-speak the player snaps out as they "get angry"
// and nuke the field. One picked at random per bomb — keeps repeated bombing
// from feeling robotic.
// Sprite scale: the largest expand-row fireball is ~77 px wide inside its
// 96×91 cell, so 3× lands the explosion at ~230 px on screen — slightly
// overshoots the bomb's kill radius (BOMB_RADIUS × 2 = 200 px) so the
// VFX visually "fills the field" rather than reading as a tight aura.
const BOMB_SPRITE_SCALE = 3;

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

  stage.score.bombs++;

  // Make the player untouchable for the duration. The field collider
  // catches anything that wanders into the radius later, but the player
  // is invincible regardless as a belt-and-braces guard. Push/pop pairs
  // so back-to-back bombs extend the window rather than ending it early.
  player.pushInvincible();
  scene.time.delayedCall(BOMB_DURATION_MS, () => player.popInvincible());

  // The intro forces barkIndex=0 so the tutorial bomb pairs with a
  // predictable line; everywhere else picks at random.
  const idx = opts?.barkIndex ?? Math.floor(Math.random() * BOMB_BARKS.length);
  // biome-ignore lint/style/noNonNullAssertion: BOMB_BARKS is a non-empty literal
  const bark = BOMB_BARKS[idx]!;
  player.say(bark, BARK_FRAMES);

  // Punch the camera so the freeze feels like an impact, not a stutter.
  scene.cameras.main.shake(BOMB_FREEZE_MS + 250, 0.005);

  // Spawn the bomb field — a sprite-less entity in damagedBy.player at
  // full BOMB_RADIUS from this frame on, so a fast bullet near the edge
  // can't slip past before the collider grows to meet it.
  const field = stage.spawn(bombField, cx, cy, 0, 0, { script: null });

  // Clear every bullet currently inside the radius up front. The collider
  // would catch them on the next physics step anyway, but the snapshot
  // kill happens before any further integration — bullets at point-blank
  // don't get a frame to drift onto the player before invincibility
  // kicks in for the wider engine pipeline.
  for (const { e } of findBulletsInRadius(stage, cx, cy, BOMB_RADIUS)) e.die();

  // Render the explosion BELOW the player sprite (depth 0) and the
  // red-dot hitbox indicator (depth 1) so the player can still track
  // their hurtbox through the blast. -0.5 keeps the VFX above bullets
  // (depth -9.5) and bg (depth -10), and well below the touch-button
  // band's mask (depth 50) so on mobile the explosion stays clipped to
  // the playfield.
  const BOMB_DEPTH = -0.5;
  const windup = scene.add.graphics().setDepth(BOMB_DEPTH);

  const freezeFrac = BOMB_FREEZE_MS / BOMB_DURATION_MS;

  const state = { t: 0 };
  scene.tweens.add({
    targets: state,
    t: 1,
    duration: BOMB_DURATION_MS,
    ease: 'Linear',
    onUpdate: () => updateBomb(windup, state.t, freezeFrac, cx, cy),
    onComplete: () => {
      windup.destroy();
      if (field.alive) field.die();
    },
  });

  // Spawn the explosion sprite at the freeze end so the wind-up core has
  // a beat alone before the fireball blooms. expand → fade chain matches
  // BOMB_EXPLODE_MS / BOMB_LINGER_MS exactly (durations declared in
  // textures.ts → registerBombAnims), so the sprite always finishes on
  // the same beat the field tween disposes the collider.
  scene.time.delayedCall(BOMB_FREEZE_MS, () => {
    const sprite = scene.add.sprite(cx, cy, BOMB_EXPLOSION_KEY).setDepth(BOMB_DEPTH).setScale(BOMB_SPRITE_SCALE);
    sprite.play(BOMB_EXPAND_ANIM);
    sprite.chain(BOMB_FADE_ANIM);
    sprite.on(`animationcomplete-${BOMB_FADE_ANIM}`, () => sprite.destroy());
  });
}

// Death-bomb rescue: no bark, no shockwave VFX, no camera shake. Just
// pop bullets in a tighter radius and grant a longer invincibility window
// so the player isn't immediately killed again by whatever was already
// on top of them. Used for both the continue revive and the non-fatal
// on-hit auto-rescue; the caller (continue path) is responsible for
// actually reviving the player (alive flag, body, hp) when applicable.
export function activateDeathBomb(player: Player, stage: StageManager): void {
  const scene = stage.scene;
  const cx = player.x;
  const cy = player.y;

  player.pushInvincible();
  scene.time.delayedCall(DEATH_BOMB_INVINCIBLE_MS, () => player.popInvincible());

  for (const { e } of findBulletsInRadius(stage, cx, cy, DEATH_BOMB_RADIUS)) e.die();

  // Sprite alpha pulses at ~10 Hz across the invincibility window so the
  // rescue reads visually as "you got saved" — death-bomb has no field
  // VFX of its own, so this is the only feedback the player gets that
  // the rescue happened.
  scene.tweens.add({
    targets: player,
    alpha: 0.3,
    duration: 100,
    yoyo: true,
    repeat: Math.floor(DEATH_BOMB_INVINCIBLE_MS / 200) - 1,
    onComplete: () => {
      player.setAlpha(1);
    },
    onStop: () => {
      player.setAlpha(1);
    },
  });
}

// Snapshot of every live enemy bullet within `radius` of (cx, cy),
// with each entry's distance from the centre. Snapshots the
// damages.player group up front so callers can mutate it during
// iteration (freeze a bullet, kill it, etc.) without skipping siblings
// — Phaser's getChildren() returns a live array. Bullet identification
// is `kind instanceof EnemyBulletEntityKind` — the marker class every
// player-damaging projectile kind extends.
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
    if (!(e.kind instanceof EnemyBulletEntityKind)) continue;
    const dx = e.x - cx;
    const dy = e.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;
    bullets.push({ e, d: Math.sqrt(d2) });
  }
  return bullets;
}

function updateBomb(g: Phaser.GameObjects.Graphics, t: number, freezeFrac: number, cx: number, cy: number): void {
  g.clear();
  if (t > freezeFrac) return;
  // Wind-up: a small red core swells at the player's position. Sells
  // the freeze as deliberate ("she's about to *snap*") rather than a
  // physics hiccup. The fireball sprite takes over once freeze ends.
  const f = t / freezeFrac;
  g.fillStyle(COLOR_BOMB_CORE, 0.25 + 0.55 * f);
  g.fillCircle(cx, cy, 10 + 28 * f);
  g.fillStyle(COLOR_BOMB_GLOW, 0.7 * f);
  g.fillCircle(cx, cy, 6 + 14 * f);
}
