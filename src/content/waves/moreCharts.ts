import { shoot } from '../../audio/sfx/events';
import { GAME_W, PLAYER_SPEED, SCRIPT_FPS } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo, ring } from '../../script/patterns';
import { checkStageOnce, markWave, suspendRunning } from '../../script/stage';
import { EntityKind, type ScriptYield } from '../../script/types';
import { CHART_TINTS } from '../../ui/palette';
import { bullet } from '../kinds';

// Chart-cell bullet — small tinted tile used to compose pie wedges (Slide 1).
// Square hitbox so the corners hit honestly; the tint is applied per spawn
// from CHART_TINTS to flag wedge identity.
export const chartCellBullet = new EntityKind({
  sprite: 'chartCell',
  hitboxRadius: 3,
  hitboxShape: 'square',
  hp: null,
  damageClass: ['player'],
  damagedByClass: [],
});

// Slide-deck colleagues come in one after another, each unveiling a chart
// that flies at the player. The first throws barrages of three pies at
// once, each fanning out at a slightly different angle around the
// colleague's aim. The second packs a near-full-screen wall of bar-chart
// columns with exactly one open slot, then re-fires three more times —
// the gap moves to a random new slot each volley, so the player has to
// navigate the maze instead of standing in one alley. Each column is
// itself composed of small round bullets pitched too tightly for the
// player to squeeze between them.

const ENTRY_SPEED = 200;
const ENTRY_Y = 110;
const EXIT_SPEED = 350;

// Time bullets take to travel from the firer to their formation slot.
// 18 frames ≈ 0.3s — long enough to read as "the colleague is spraying
// bullets out into a chart shape" rather than the chart popping into
// existence, short enough that the player isn't waiting to be shot at.
const FORMATION_FRAMES = 18;
const FORMATION_SECONDS = FORMATION_FRAMES / SCRIPT_FPS;
// Beat between volleys — covers the say-bubble and lets the previous
// formation descend out of the firer's spawn area before the next one
// builds in the same spot.
const VOLLEY_GAP_FRAMES = 40;
const SAY_FRAMES = 80;

// Spawn a chart-cell bullet at the firer's current position, aimed at
// (tx, ty) so it arrives there after FORMATION_FRAMES script frames.
// Returns the bullet plus its target so the caller can snap-and-redirect
// the whole batch at the end of the formation phase.
type FormingBullet = { entity: Entity; tx: number; ty: number };
function spawnFormingCell(self: Entity, tx: number, ty: number, tint: number): FormingBullet {
  const vx = (tx - self.x) / FORMATION_SECONDS;
  const vy = (ty - self.y) / FORMATION_SECONDS;
  const entity = self.spawn(chartCellBullet, self.x, self.y, vx, vy);
  entity.setTint(tint);
  return { entity, tx, ty };
}

// Spawn a single tinted round bullet for a column-block grid. Same forming
// kinematics as `spawnFormingCell`: it physically spawns at the firer and
// flies to (tx, ty) over FORMATION_SECONDS, so the whole block reads as
// the colleague spraying bullets out into a column shape.
function spawnFormingBlockBullet(self: Entity, tx: number, ty: number, tint: number): FormingBullet {
  const vx = (tx - self.x) / FORMATION_SECONDS;
  const vy = (ty - self.y) / FORMATION_SECONDS;
  const entity = self.spawn(bullet, self.x, self.y, vx, vy);
  entity.setTint(tint);
  return { entity, tx, ty };
}

// Snap each formed bullet to its exact target slot (eats sub-pixel drift
// from frame-time integration) and assign the launch velocity. Skips
// bullets that died mid-formation (e.g. clipped by a bomb).
function launchFormed(bullets: FormingBullet[], vx: number, vy: number): void {
  for (const { entity, tx, ty } of bullets) {
    if (!entity.alive) continue;
    entity.body.reset(tx, ty);
    entity.body.setVelocity(vx, vy);
  }
}

// --- Pie chart -----------------------------------------------------------
//
// Six 60° wedges. The pie's outer rim is always present — three tinted
// bullets per wedge at r=PIE_RIM_R offset by -20°, 0°, +20° from each
// wedge's bisector — so the disc reads as a colored ring divided into six
// slices. One wedge per pie is randomly chosen as "highlighted": its
// interior is filled with extra bullets at multiple radii within the
// wedge's angular range, making that slice stand out as the one being
// called out in the slide. All of one pie's bullets share a single launch
// velocity so the pie translates rigidly — the player dodges the whole
// disc, not individual bullets.
//
// A barrage spawns three pies side-by-side around the colleague. Each
// pie launches with its own small random angular offset around the
// colleague's aim at the player, so the trio fans out as it travels and
// the player can't just sidestep a single block.

const PIE_WEDGE_COUNT = 6;
const PIE_WEDGE_RAD = (Math.PI * 2) / PIE_WEDGE_COUNT;
const PIE_RIM_R = 36;
const PIE_RIM_OFFSETS = [-Math.PI / 9, 0, Math.PI / 9] as const;
// Interior fill ring radii + per-radius angular offsets, applied only to
// the highlighted wedge so the slice reads as solid. Layered inward: a
// single bullet on the bisector at r=10, then three each at r=20 and r=28
// fanning out toward the rim.
const PIE_FILL_LAYERS = [
  { r: 10, offsets: [0] },
  { r: 20, offsets: [-Math.PI / 12, 0, Math.PI / 12] },
  { r: 28, offsets: [-Math.PI / 10, 0, Math.PI / 10] },
] as const;
const PIE_FLY_SPEED = 342;
// Three pies spawn around the colleague: one centre, one left, one right.
// 90px lateral offset is wider than a pie's diameter (2 × PIE_RIM_R = 72)
// so the discs read as separate charts rather than overlapping blobs.
const PIE_BARRAGE_OFFSETS_X = [-90, 0, 90] as const;
// Half-width of the per-pie aim jitter around the base aim. ~14° each
// side spreads the trio enough that one straight-line dodge no longer
// clears all three.
const PIE_AIM_JITTER = Math.PI / 13;

// Build a single pie at (cx, cy) and return its bullets. Bullets all
// physically spawn at the colleague's position and fly out to their
// formation slots — it's the (cx, cy) center that defines where the pie
// ends up after the formation phase.
function spawnPie(self: Entity, cx: number, cy: number): FormingBullet[] {
  const bullets: FormingBullet[] = [];
  const highlighted = Math.floor(Math.random() * PIE_WEDGE_COUNT);
  for (let w = 0; w < PIE_WEDGE_COUNT; w++) {
    const bisector = w * PIE_WEDGE_RAD;
    const tint = CHART_TINTS[w] ?? 0xffffff;
    for (const off of PIE_RIM_OFFSETS) {
      const a = bisector + off;
      bullets.push(spawnFormingCell(self, cx + Math.cos(a) * PIE_RIM_R, cy + Math.sin(a) * PIE_RIM_R, tint));
    }
    if (w !== highlighted) continue;
    for (const layer of PIE_FILL_LAYERS) {
      for (const off of layer.offsets) {
        const a = bisector + off;
        bullets.push(spawnFormingCell(self, cx + Math.cos(a) * layer.r, cy + Math.sin(a) * layer.r, tint));
      }
    }
  }
  return bullets;
}

function* firePieBarrage(self: Entity): Generator<ScriptYield, void, void> {
  // Pre-roll each pie's aim jitter at spawn time and stash it. The base
  // aim is recomputed at launch (so player movement during the formation
  // phase is tracked); the per-pie jitter just shifts off that base.
  const pies: { bullets: FormingBullet[]; jitter: number }[] = [];
  for (const dx of PIE_BARRAGE_OFFSETS_X) {
    const bullets = spawnPie(self, self.x + dx, self.y);
    const jitter = (Math.random() * 2 - 1) * PIE_AIM_JITTER;
    pies.push({ bullets, jitter });
  }
  shoot();
  yield FORMATION_FRAMES;
  const baseAim = self.angleToPlayer();
  for (const { bullets, jitter } of pies) {
    const aim = baseAim + jitter;
    launchFormed(bullets, Math.cos(aim) * PIE_FLY_SPEED, Math.sin(aim) * PIE_FLY_SPEED);
  }
}

// --- Bar columns ---------------------------------------------------------
//
// Each column is a tightly packed grid of small round tinted bullets —
// BLOCK_BULLETS_WIDE columns of bullets across, `h` rows down, pitched
// BLOCK_BULLET_PITCH px center-to-center on both axes. Pitch is below
// the player's hitbox diameter (2 × PLAYER_HITBOX_RADIUS = 8) so the
// player can't graze through gaps within a block. Heights vary so the
// silhouette reads as a bar chart rather than a uniform wall.
//
// Columns are packed shoulder-to-shoulder across the full game width
// (block visual width ≈ 30 px at a 36 px stride leaves only ~6 px
// between adjacent blocks — still narrower than the player's hitbox, so
// squeezing between filled slots is impossible). A single random slot
// per volley is left empty; that's the only safe lane through. The
// colleague fires four such walls back-to-back with the gap moving
// each time, so the player has to navigate a maze of moving openings.

// Eleven slots at a 36 px stride → 10 × 36 = 360 px between extreme
// column centers, plus the block width on each end ≈ 390 px span.
// Centred on self.x = GAME_W/2 = 200, the wall covers the playfield
// with ~5 px margin on each side — narrower than the player's hitbox,
// so they can't dodge round the ends either.
const COLUMN_HEIGHTS = [4, 7, 5, 8, 6, 4, 7, 5, 8, 6, 5] as const;
const COLUMN_COUNT = COLUMN_HEIGHTS.length;
const COLUMN_STRIDE = 36;
const COLUMN_FLY_SPEED = 170;
const COLUMN_VOLLEYS = 4;

// The gap is confined to the interior columns; the leftmost and rightmost
// columns always fire so the wall keeps a solid frame on each side and the
// safe lane never runs along the playfield edge.
const MIN_GAP_INDEX = 1;
const MAX_GAP_INDEX = COLUMN_COUNT - 2;

// Bullet grid that composes one column block. BLOCK_BULLET_PITCH is the
// center-to-center distance between adjacent bullets in the grid; with
// BULLET_RADIUS = 3 (diameter 6) and pitch 8, the edge-to-edge gap is
// 2 px — well below the player's 8 px hitbox diameter, so the player
// can't slip between bullets within a block. BLOCK_BULLETS_WIDE = 4
// gives a visual block width of (4-1)*8 + 6 = 30 px, close to the
// original beam's 32 px so the COLUMN_STRIDE balance still works.
const BLOCK_BULLET_PITCH = 8;
const BLOCK_BULLETS_WIDE = 4;
// One bullet row per height-cell. Visual block height for `h` cells is
// (h-1)*BLOCK_BULLET_PITCH + BULLET_DIAMETER ≈ 8h - 2 px — close to the
// original beam's 8h px so the bar-chart silhouette is preserved.

// Cap how many slots the gap can move between consecutive volleys. The
// player has VOLLEY_GAP_FRAMES / SCRIPT_FPS seconds between volley arrivals at
// their row to traverse `delta * COLUMN_STRIDE` pixels at PLAYER_SPEED;
// this constant is computed so the worst-case shift is reachable with
// a 25%-ish reaction-time margin, rounded down so the bound is a clean
// integer slot count.
const PLAYER_DODGE_REACTION_FACTOR = 0.75;
const MAX_GAP_MOVEMENT = Math.max(
  1,
  Math.floor((PLAYER_SPEED * (VOLLEY_GAP_FRAMES / SCRIPT_FPS) * PLAYER_DODGE_REACTION_FACTOR) / COLUMN_STRIDE),
);

// Fill one column's bullet grid into the shared FormingBullet[]. Each
// block spans BLOCK_BULLETS_WIDE bullets across × h bullets tall, pitched
// BLOCK_BULLET_PITCH on both axes, with its bottom-most bullet row aligned
// to baselineY so all blocks in a volley share a clean ground line.
function pushColumnBlock(
  self: Entity,
  out: FormingBullet[],
  xc: number,
  baselineY: number,
  h: number,
  tint: number,
): void {
  const blockW = (BLOCK_BULLETS_WIDE - 1) * BLOCK_BULLET_PITCH;
  const blockH = (h - 1) * BLOCK_BULLET_PITCH;
  const left = xc - blockW / 2;
  const top = baselineY - blockH;
  for (let i = 0; i < BLOCK_BULLETS_WIDE; i++) {
    for (let j = 0; j < h; j++) {
      const tx = left + i * BLOCK_BULLET_PITCH;
      const ty = top + j * BLOCK_BULLET_PITCH;
      out.push(spawnFormingBlockBullet(self, tx, ty, tint));
    }
  }
}

function* fireBarMaze(self: Entity, gapIndex: number): Generator<ScriptYield, void, void> {
  const baseX = self.x - ((COLUMN_COUNT - 1) / 2) * COLUMN_STRIDE;
  const bullets: FormingBullet[] = [];
  for (let c = 0; c < COLUMN_COUNT; c++) {
    if (c === gapIndex) continue; // the open slot — the only way through
    const xc = baseX + c * COLUMN_STRIDE;
    const h = COLUMN_HEIGHTS[c] ?? 5;
    const tint = CHART_TINTS[c % CHART_TINTS.length] ?? 0xffffff;
    pushColumnBlock(self, bullets, xc, self.y, h, tint);
  }
  shoot();
  yield FORMATION_FRAMES;
  launchFormed(bullets, 0, COLUMN_FLY_SPEED);
}

// --- Colleague scripts ---------------------------------------------------

function* pieFireSequence(self: Entity): Generator<ScriptYield, void, void> {
  yield* firePieBarrage(self);
  yield VOLLEY_GAP_FRAMES;
  yield* firePieBarrage(self);
}

function* pieColleagueScript(self: Entity): Generator<ScriptYield, void, void> {
  yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);
  // Globals lock so the line fires at most once per stage run — the bar
  // colleague that follows enters silently regardless of order.
  if (checkStageOnce(self, 'moreCharts:dataForTomorrow')) {
    self.say('Data for tomorrow!', SAY_FRAMES);
  }
  yield 24;

  // Run the chart sequence and the side-ring stream in parallel. The
  // race ends the moment the chart sequence finishes, dropping the side
  // stream so it doesn't keep firing while the colleague pivots to exit.
  yield { race: [pieFireSequence(self), fireSideRings(self, PIE_SIDE_RING_INTERVAL)] };

  self.setVelocity(0, EXIT_SPEED);
}

// Pick a maze gap that's both different from the previous one (the wall
// has to actually move, so the player has to actually step) and within
// MAX_GAP_MOVEMENT slots of it (so the worst-case dodge is physically
// reachable at PLAYER_SPEED in VOLLEY_GAP_FRAMES, not just an "RNG screwed
// you" hit). The gap is also clamped to [MIN_GAP_INDEX..MAX_GAP_INDEX] so
// the wall's outermost columns always fire. First volley samples uniformly
// from that interior range.
function nextGapIndex(previous: number | null): number {
  if (previous === null) {
    return MIN_GAP_INDEX + Math.floor(Math.random() * (MAX_GAP_INDEX - MIN_GAP_INDEX + 1));
  }
  const minIdx = Math.max(MIN_GAP_INDEX, previous - MAX_GAP_MOVEMENT);
  const maxIdx = Math.min(MAX_GAP_INDEX, previous + MAX_GAP_MOVEMENT);
  // Sample uniformly over [minIdx, maxIdx] excluding `previous` itself
  // by picking from the window of size (maxIdx - minIdx) and bumping
  // past `previous` if we landed on or above it.
  const skip = Math.floor(Math.random() * (maxIdx - minIdx)) + minIdx;
  return skip < previous ? skip : skip + 1;
}

// Background pressure during a chart fight: every `interval` frames the
// colleague spits out a small ring of plain bullets at a random base
// angle. Fired in parallel with the main chart sequence so the player
// has to weave the random bullets at the same time as the pies / maze.
// Cancelled (by the surrounding `race`) the moment the chart sequence
// completes. The pie phase passes a 5× tighter interval so the random
// stream is dense enough to demand active dodging on top of reading
// the pie spread; the bar phase keeps the original cadence so the
// maze itself stays the dominant pressure.
const SIDE_RING_COUNT = 4;
const SIDE_RING_SPEED = 90;
const BAR_SIDE_RING_INTERVAL = 50;
const PIE_SIDE_RING_INTERVAL = 10;

function* fireSideRings(self: Entity, interval: number): Generator<ScriptYield, void, void> {
  while (true) {
    ring(self, SIDE_RING_COUNT, bullet, SIDE_RING_SPEED, Math.random() * Math.PI * 2);
    yield interval;
  }
}

function* barFireSequence(self: Entity): Generator<ScriptYield, void, void> {
  let prevGap: number | null = null;
  for (let v = 0; v < COLUMN_VOLLEYS; v++) {
    const gap = nextGapIndex(prevGap);
    yield* fireBarMaze(self, gap);
    prevGap = gap;
    if (v < COLUMN_VOLLEYS - 1) yield VOLLEY_GAP_FRAMES;
  }
}

function* columnColleagueScript(self: Entity): Generator<ScriptYield, void, void> {
  yield* moveTo(self, self.x, ENTRY_Y, ENTRY_SPEED);
  yield 24;

  yield { race: [barFireSequence(self), fireSideRings(self, BAR_SIDE_RING_INTERVAL)] };

  self.setVelocity(0, EXIT_SPEED);
}

export const slideColleague = new EntityKind({
  sprite: 'sales',
  hitboxRadius: 16,
  hp: 40,
  damageClass: ['player'],
  damagedByClass: ['enemy'],
});

// Two slide-deck colleagues, strictly one after another: the pie-chart one
// flies in centre-screen, presents its disc, exits; once it's off the field
// the bar-chart one comes in to do the same with columns.
export function* moreChartsWave(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'more charts');
  yield* suspendRunning(self, function* () {
    const pie = self.spawn(slideColleague, GAME_W * 0.5, -30, 0, 0, {
      script: pieColleagueScript,
    });
    yield { until: pie };
    const bar = self.spawn(slideColleague, GAME_W * 0.5, -30, 0, 0, {
      script: columnColleagueScript,
    });
    yield { until: bar };
  });
}
