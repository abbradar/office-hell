import Phaser from 'phaser';
import { gameW } from '../config';
import type { Entity } from '../entities/Entity';
import { FONT_DIALOGUE_SM } from './fonts';
import { COLOR_BUBBLE, COLOR_TEXT_INVERSE_STR } from './palette';

const BUBBLE_DEPTH = 50;
const PADDING_X = 8;
const PADDING_Y = 5;
const TAIL_HEIGHT = 8;
const TAIL_HALF_WIDTH = 5;
const OFFSET_Y = 30;
const CORNER_RADIUS = 6;
const BUBBLE_FILL = COLOR_BUBBLE;
const BUBBLE_ALPHA = 0.95;
// Bubble fill stays cream regardless of theme — text always dark to read.
const TEXT_COLOR = COLOR_TEXT_INVERSE_STR;
const SCREEN_PAD = 4;

type Bubble = {
  target: Entity;
  // Snapshot of target.gen at show time. If the entity dies and is reused (gen bumps),
  // we drop the bubble instead of pinning it to a stranger that took over the slot.
  gen: number;
  framesLeft: number;
  container: Phaser.GameObjects.Container;
  graphics: Phaser.GameObjects.Graphics;
  width: number;
  height: number;
};

export class BubbleManager {
  private readonly scene: Phaser.Scene;
  private readonly active: Bubble[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  show(target: Entity, text: string, frames: number): void {
    this.removeFor(target);

    const txt = this.scene.add
      .text(0, 0, text, {
        ...FONT_DIALOGUE_SM,
        color: TEXT_COLOR,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const w = Math.ceil(txt.width) + PADDING_X * 2;
    const h = Math.ceil(txt.height) + PADDING_Y * 2;
    const gfx = this.scene.add.graphics();
    const container = this.scene.add.container(0, 0, [gfx, txt]).setDepth(BUBBLE_DEPTH);

    const bubble: Bubble = {
      target,
      gen: target.gen,
      framesLeft: Math.max(1, frames),
      container,
      graphics: gfx,
      width: w,
      height: h,
    };
    this.active.push(bubble);
    this.reposition(bubble);
  }

  private removeFor(target: Entity): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by active.length
      const b = this.active[i]!;
      if (b.target === target) {
        b.container.destroy();
        const last = this.active.length - 1;
        // biome-ignore lint/style/noNonNullAssertion: bounded by active.length - 1
        if (i !== last) this.active[i] = this.active[last]!;
        this.active.pop();
      }
    }
  }

  private reposition(b: Bubble): void {
    const cx = Phaser.Math.Clamp(b.target.x, b.width / 2 + SCREEN_PAD, gameW() - b.width / 2 - SCREEN_PAD);
    let cy = b.target.y - OFFSET_Y - b.height / 2;
    let tailUp = false;
    if (cy - b.height / 2 - TAIL_HEIGHT < SCREEN_PAD) {
      cy = b.target.y + OFFSET_Y + b.height / 2;
      tailUp = true;
    }
    b.container.setPosition(cx, cy);
    drawBubbleShape(b.graphics, b.width, b.height, b.target.x - cx, tailUp);
  }

  update(): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by active.length
      const b = this.active[i]!;
      b.framesLeft--;
      const targetGone = !b.target.alive || b.target.gen !== b.gen;
      if (b.framesLeft <= 0 || targetGone) {
        b.container.destroy();
        const last = this.active.length - 1;
        // biome-ignore lint/style/noNonNullAssertion: bounded by active.length - 1
        if (i !== last) this.active[i] = this.active[last]!;
        this.active.pop();
        continue;
      }
      this.reposition(b);
    }
  }
}

function drawBubbleShape(g: Phaser.GameObjects.Graphics, w: number, h: number, tailDx: number, tailUp: boolean): void {
  g.clear();
  g.fillStyle(BUBBLE_FILL, BUBBLE_ALPHA);
  g.fillRoundedRect(-w / 2, -h / 2, w, h, CORNER_RADIUS);

  const minTx = -w / 2 + CORNER_RADIUS + TAIL_HALF_WIDTH;
  const maxTx = w / 2 - CORNER_RADIUS - TAIL_HALF_WIDTH;
  const tx = Phaser.Math.Clamp(tailDx, minTx, maxTx);

  g.beginPath();
  if (tailUp) {
    g.moveTo(tx - TAIL_HALF_WIDTH, -h / 2);
    g.lineTo(tx + TAIL_HALF_WIDTH, -h / 2);
    g.lineTo(tx, -h / 2 - TAIL_HEIGHT);
  } else {
    g.moveTo(tx - TAIL_HALF_WIDTH, h / 2);
    g.lineTo(tx + TAIL_HALF_WIDTH, h / 2);
    g.lineTo(tx, h / 2 + TAIL_HEIGHT);
  }
  g.closePath();
  g.fillPath();
}
