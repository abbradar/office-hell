import Phaser from 'phaser';
import { getMusicTime, pauseMusic, resumeMusic, stopMusicLoop } from '../audio/music/loop';
import { playerDeath } from '../audio/sfx/events';
import { DEADZONE_Y, DEVELOPER_MODE, GAME_H, GAME_W, HEADER_H, WALL_W } from '../config';
import { activateDeathBomb } from '../content/bomb';
import { getSelectedCharacter } from '../content/characters';
import { computeDoorYs, DOOR_COUNT, DOOR_H, DOOR_SPACING } from '../content/doors';
import { PlayerKind } from '../content/player';
import { makeWaveStage, stage, type WaveDef } from '../content/stage';
import { stageTest } from '../content/testStage';
import { BG_DOORS_BBOX_KEY, BG_DOORS_KEY, BG_FLOOR_KEY, BG_WALLS_KEY } from '../content/textures';
import type { Entity } from '../entities/Entity';
import { Player } from '../entities/Player';
import { isTouchDevice } from '../input/device';
import { bindLogicalCamera } from '../render/cameraBind';
import { displayState } from '../render/displayState';
import { StageManager } from '../script/StageManager';
import { addMult, MultDropKind, onContinue } from '../script/score';
import { DAMAGE_CLASSES, type HPVars } from '../script/types';
import { FONT_DEBUG, FONT_DIALOGUE_SM, FONT_MENU, FONT_TITLE } from '../ui/fonts';
import { addMuteButton } from '../ui/muteButton';
import {
  COLOR_ACCENT_GOLD,
  COLOR_ACCENT_GOLD_STR,
  COLOR_ACCENT_GREEN_STR,
  COLOR_ACCENT_RED_STR,
  COLOR_PANEL,
  COLOR_PANEL_BORDER,
  COLOR_TEXT_DIM_STR,
  COLOR_TEXT_PRIMARY,
  COLOR_TEXT_PRIMARY_STR,
  COLOR_WALL,
} from '../ui/palette';
import { makePrompt } from '../ui/prompt';
import { onTap } from '../ui/tap';

const CORRIDOR_SCROLL_PX_PER_MS = 0.1;

// HUD text refresh budget: setText on a Phaser.Text re-rasterises the
// backing canvas and re-uploads it via gl.texImage2D. Doing that every
// frame (because actualFps changes every frame) was capping us at ~57 fps
// on top of the GPU pipeline, independent of bullet count. 1 Hz is plenty
// for "hostile / fps / practice mode" — the only sub-second thing in the
// line is the displayed FPS itself.
const HUD_REFRESH_MS = 1000;

// Score / mult readout layout. Score is zero-padded to SCORE_WIDTH
// digits (`%08d`); mult to MULT_WIDTH (`%03d`). The whole compound
// right-anchors at HUD_READOUT_RIGHT — left-of-the-mute-icon, with a
// small gap so the mute glyph never overlaps the digits. The mute
// icon at the GAME_W edge takes ~28 px including its 6 px margin, so
// 42 px clears it comfortably regardless of font width quirks.
const SCORE_WIDTH = 8;
const MULT_WIDTH = 3;
const HUD_READOUT_RIGHT = 400 - 42;

// Split a zero-padded numeric string into a leading-zeros run and the
// significant-digits suffix. Used by the HUD to render the leading
// zeros at a lower alpha than the real digits, so the eye lands on
// the meaningful number first. When the whole string is zeros (the
// value is 0), the last character stays in `digits` so the readout
// never shows nothing — "00000000" reads as "0000000|0", not "
// 00000000|".
function splitLeadingZeros(padded: string): { zeros: string; digits: string } {
  const i = padded.search(/[^0]/);
  if (i === -1) return { zeros: padded.slice(0, -1), digits: padded.slice(-1) };
  return { zeros: padded.slice(0, i), digits: padded.slice(i) };
}

// Door layout constants live in src/content/doors.ts so stage scripts
// can compute door y values from the same formula. See that module for
// the cycle / spacing rationale.
//
// Background rendering pipeline — four stacked layers, drawn back-to-front
// every frame:
//   1. Floor   (depth -10, BG_FLOOR_KEY)  — full-canvas TileSprite,
//                                            vertical scroll = corridor
//                                            advance.
//   2. Walls   (depth  -9, wallsRt)       — RenderTexture: tiled walls
//                                            drawn in...
//   3. ...then BG_DOORS_BBOX_KEY is erased at each visible door slot's
//      y, punching through to the floor in the rect the doors will
//      cover. (Same layer, not a separate display object — the third
//      logical step happens inside the walls RT.)
//   4. Doors   (depth  -8, doorSlots)     — full-width door Image drawn
//                                            at the same (x, y) as the
//                                            eraser, filling the cutout.
// Eraser and door Image share native size + origin (0, 0), so they
// cover the exact same rect — the door pixels can't drift past the
// cutout edge.

const BOMB_BUTTON_RADIUS = 50;
const BOMB_BUTTON_X = GAME_W / 2;

// With a control band, the bomb button sits at the canvas bottom — the
// rest of the band is the finger-follow movement zone (see
// getTouchTarget). Without a band (desktop), it tucks above the bottom
// of the playfield.
function bombButtonY(): number {
  return displayState.logicalH > GAME_H ? displayState.logicalH - 60 : GAME_H - 220;
}

// Pause button (touch only) sits in the lower-left, on the same row as
// the bomb button so both thumbs find their controls at the same y. Kept
// small so it doesn't compete with the bomb glyph for visual weight.
const PAUSE_BUTTON_RADIUS = 24;
const PAUSE_BUTTON_X = 32;
function pauseButtonY(): number {
  return displayState.logicalH > GAME_H ? displayState.logicalH - 60 : GAME_H - 30;
}

// Pointer.x / .y arrive in canvas-internal device pixels because the
// canvas is sized at parent CSS × DPR (see main.ts). The world is rendered
// into a centered scaled rect inside that — convert to logical coords by
// subtracting the world rect's offset and dividing by displayState.scale.
function pointerLogicalX(x: number): number {
  return (x - displayState.offsetX) / displayState.scale;
}
function pointerLogicalY(y: number): number {
  return (y - displayState.offsetY) / displayState.scale;
}

export const PRACTICE_HITS_KEY_PREFIX = 'practiceHits:';
// Per-wave unlock marker. Set to `true` when the player has reached
// that wave in a real-stage run (see `markReached` in content/stage.ts).
// Production builds use this to gate which entries appear in the
// TestMenu practice list — only sections the player has actually
// played through are surfaced as replay options. Mirrored to
// `localStorage` so unlocks persist across reloads (Phaser's registry
// is in-memory only).
export const PRACTICE_UNLOCK_KEY_PREFIX = 'unlock:';

// Hydrate registry-backed unlock flags from `localStorage` so per-wave
// unlocks survive page reloads. Phaser's registry doesn't persist; we
// mirror writes (see `markReached`) to `localStorage` and pull them
// back into the registry on entry. Called from both GameScene and
// TestMenuScene — either consumer reaching the registry first will
// populate it for the rest of the session. Cheap and idempotent
// (a few dozen keys total).
export function hydrateUnlocksFromStorage(scene: Phaser.Scene): void {
  try {
    const reg = scene.game.registry;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null) continue;
      if (!key.startsWith(PRACTICE_UNLOCK_KEY_PREFIX)) continue;
      reg.set(key, true);
    }
  } catch {
    // localStorage may be unavailable (private mode, SSR). Unlock flow
    // degrades to in-memory only — still works for the current session.
  }
}

export type GameSceneData = {
  practice?: WaveDef;
  // When true, run the diagnostics test stage (content/testStage.ts) instead
  // of the normal stage. Surfaces an extra debug HUD line built from the
  // music clock + stage queue introspection.
  test?: boolean;
};

// Per-run state container. Phaser reuses the same Scene instance across
// `scene.start('Game')`, so class field initializers (e.g. `= 0`, `= []`)
// only fire at construction — any per-run state declared that way leaks
// the previous run's value when create() runs again. Bundling everything
// per-run into one object lets init() rebuild it from scratch each time
// and makes "did I forget to reset that field?" a type error: anything
// added here gets initialised by `RunState`'s ctor or TypeScript complains.
//
// Anything assigned with `!:` and reassigned every create() (player,
// stage, the various Text / RenderTexture refs) stays out of here —
// those are already fresh by the time update() runs. Only fields that
// are set at runtime (mutated by handlers, accumulated across frames)
// live here.
class RunState {
  // From init data — set once at scene entry.
  readonly practiceWave: WaveDef | null;
  readonly testMode: boolean;
  // ESC pause state. Distinct from `stage.paused`, which dialogues also set —
  // we share the same physics/script freeze (set stage.paused + physics.pause)
  // but track this flag so X can route to "exit to menu" only while the
  // pause overlay owns the freeze. Only entered when no dialogue is active,
  // so the two pause owners never overlap.
  userPaused = false;
  pauseOverlay: Phaser.GameObjects.Container | null = null;
  // Set once when the player has died and we've kicked off the flicker /
  // game-over transition. Idempotent: keeps update() from re-firing the
  // sequence on every subsequent frame while the animation plays out.
  deathStarted = false;
  // Continue overlay shown when HP hits 0 in the real stage. Holds the
  // freeze (stage.freeze + paused music) until the player picks
  // continue (revive + death-bomb) or exit-to-menu. Cleared when either
  // path runs; subsequent deaths re-show it. Null in practice / test /
  // music modes — those fall through to startDeathSequence.
  continueOverlay: Phaser.GameObjects.Container | null = null;
  // Pointer ids currently captured by an interactive button (bomb /
  // pause). Phaser's hit-test puts the pointerdown event on the button
  // (topOnly), so the button's pointerdown handler adds the id here
  // and the scene-level pointerup removes it. getTouchTarget skips
  // these so a finger holding the bomb button doesn't drag the player
  // — without ever doing a manual coordinate check.
  readonly buttonPointers: Set<number> = new Set();
  // Accumulated forward scroll, in pixels. Mirrors `-bg.tilePositionY` (the
  // floor's tile offset) and drives the doors' wrap-around y. Tracked
  // separately so the doors keep their phase across the modulo without
  // having to reason about tilePositionY's seed offset.
  bgScrollY = 0;
  // Doors: each visible "door slot" is one full-canvas-width Image of the
  // doors texture (transparent in the middle, panels at the wall columns).
  // y is recomputed each frame from the shared scroll offset. Built fresh
  // each create() — the array MUST start empty there or the loop appends
  // a second set on top of the previous run's destroyed Images.
  readonly doorSlots: Phaser.GameObjects.Image[] = [];
  // HUD text is a canvas-backed Phaser.Text — every changed string redraws
  // the canvas and re-uploads it via gl.texImage2D, which serialises the
  // WebGL pipeline. The fps + hostile-count line was rebuilt every frame
  // (actualFps changes constantly), so we throttle to 1 Hz here. Reset on
  // every tick that exceeds the budget; HUD freeze during pause is fine
  // because pause itself is a longer-than-1 s state.
  hudAccumMs = HUD_REFRESH_MS;

  constructor(data: GameSceneData | undefined) {
    this.practiceWave = data?.practice ?? null;
    this.testMode = data?.test ?? false;
  }
}

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private stage!: StageManager;
  private hud!: Phaser.GameObjects.Text;
  private hpText!: Phaser.GameObjects.Text;
  private bombsText!: Phaser.GameObjects.Text;
  private bossNameText!: Phaser.GameObjects.Text;
  // Score × multiplier readout in the top-right of the header. Each
  // number is split into a leading-zeros run (dim) and significant
  // digits (full alpha); the `×` separator sits in between at full
  // alpha. Five Texts so the layout reads like a classic arcade
  // scoreboard. See src/docs/scoring-system.md.
  private scoreZerosText!: Phaser.GameObjects.Text;
  private scoreDigitsText!: Phaser.GameObjects.Text;
  private scoreSepText!: Phaser.GameObjects.Text;
  private multZerosText!: Phaser.GameObjects.Text;
  private multDigitsText!: Phaser.GameObjects.Text;
  private bg!: Phaser.GameObjects.TileSprite;
  // Walls layer baked per-frame: walls texture drawn in, then the doors
  // silhouette (BG_DOORS_BBOX_KEY) is erased at each door's y. Eraser and
  // door Image share native size + origin (0, 0), so the cutout matches
  // the door panel pixel for pixel.
  private wallsRt!: Phaser.GameObjects.RenderTexture;
  // Off-display TileSprite of the 1px-tall walls texture, sized to the
  // full canvas. Drawn into wallsRt each frame so the wall pattern tiles
  // vertically across the playfield in a single RT.draw() call instead of
  // looping the 1px source GAME_H times.
  private wallsTile!: Phaser.GameObjects.TileSprite;
  private debugHud: Phaser.GameObjects.Text | null = null;
  // Movement / fire keys live on the scene, not the Player, so all
  // gameplay input dispatching is in one place. Player.controlUpdate
  // takes a snapshot built from these each frame.
  private leftKey!: Phaser.Input.Keyboard.Key;
  private rightKey!: Phaser.Input.Keyboard.Key;
  private upKey!: Phaser.Input.Keyboard.Key;
  private downKey!: Phaser.Input.Keyboard.Key;
  private focusKey!: Phaser.Input.Keyboard.Key;
  private fireKey!: Phaser.Input.Keyboard.Key;
  private playerKind!: PlayerKind;
  // Per-run mutable state — see RunState. Built fresh in init() each
  // entry; never assign to fields that should be in here directly.
  private state!: RunState;

  constructor() {
    super('Game');
  }

  init(data: GameSceneData): void {
    this.state = new RunState(data);
    // Pull persisted per-wave unlock flags into the registry so the
    // TestMenu can read them via `registry.get(PRACTICE_UNLOCK_KEY_PREFIX + id)`.
    // No-op after the first scene entry (registry already populated),
    // but cheap enough to run every time.
    hydrateUnlocksFromStorage(this);
    // pauseGame() sets `scene.time.paused = true` to freeze realSeconds
    // waits during the ESC pause overlay. Phaser's Clock.shutdown() does
    // NOT reset `paused`, and the same Clock instance is reused across
    // scene.start, so a hard exit from the pause menu (X → Menu) leaves
    // the clock paused for the next run. Without this reset, every
    // `realSeconds` yield (e.g. bombSkipPoll's `realSeconds: 0.05` poll)
    // is parked forever in the next session and X-skip silently no-ops.
    this.time.paused = false;
  }

  // Finger-follow movement target: (x, y) of the most recently pressed
  // active pointer in logical coords, or null if no movement pointer is
  // held. Pointers whose pointerdown landed on an interactive button
  // (bomb / pause) are skipped so a finger resting on the bomb doesn't
  // drag the player — Phaser's hit-test marks them via
  // state.buttonPointers, no manual coordinate check needed.
  getTouchTarget(): { x: number; y: number } | null {
    let chosen: { x: number; y: number } | null = null;
    let chosenTime = -Infinity;
    for (const p of this.game.input.pointers) {
      if (!p.isDown) continue;
      if (this.state.buttonPointers.has(p.id)) continue;
      if (p.downTime > chosenTime) {
        chosen = { x: pointerLogicalX(p.x), y: pointerLogicalY(p.y) };
        chosenTime = p.downTime;
      }
    }
    return chosen;
  }

  create(): void {
    bindLogicalCamera(this);
    stopMusicLoop();

    // Scene-level pointerup releases any pointer ids the bomb / pause
    // buttons captured on pointerdown. Listening at the scene level (not
    // on each button) keeps releases reliable on touch — finger drift
    // off the hit area between press and release is a known Phaser quirk
    // (see ui/tap.ts) that breaks per-object pointerup, but the scene-
    // level event always fires for the released pointer.
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      this.state.buttonPointers.delete(pointer.id);
    });

    // Floor: small repeating tile (416 wide × 112 tall, designed to loop
    // seamlessly in both axes). TileSprite scrolls the texture vertically
    // as `tilePositionY` advances; with a 660-tall sprite the source
    // tiles ~6 times down the canvas. Seed tilePositionX = 8 to centre
    // the 16px horizontal overhang the same way the previous floor did.
    this.bg = this.add.tileSprite(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, BG_FLOOR_KEY).setDepth(-10);
    this.bg.tilePositionX = 8;

    // Walls: a 400×1 repeating pattern. Tiled to canvas height via an
    // off-display TileSprite, then drawn into a per-frame RenderTexture
    // so we can erase each door's bbox before the doors are drawn on top.
    this.wallsRt = this.add.renderTexture(0, 0, GAME_W, GAME_H).setOrigin(0, 0).setDepth(-9);
    this.wallsTile = this.make
      .tileSprite({ x: 0, y: 0, width: GAME_W, height: GAME_H, key: BG_WALLS_KEY }, false)
      .setOrigin(0, 0);

    // Doors: each slot is one full-canvas-width Image of the doors
    // texture, drawn at canvas (0, slot_y). The PNG has door panels at
    // the wall columns (x=0..WALL_W-1, x=GAME_W-WALL_W..GAME_W-1) and is
    // transparent in the middle, so a single Image renders both panels
    // and never touches the corridor. Per-frame the same y drives
    // wallsRt.erase() at (0, y) so the wall cutout tracks the door
    // panels exactly.
    for (let i = 0; i < DOOR_COUNT; i++) {
      const startY = i * DOOR_SPACING - DOOR_H;
      this.state.doorSlots.push(this.add.image(0, startY, BG_DOORS_KEY).setOrigin(0, 0).setDepth(-8));
    }

    // Mask the touch-control band so bullets that drift below the playfield
    // (within CULL_MARGIN before being culled) don't peek through behind the
    // buttons. Depth 50 sits above entities (default 0) and below HUD (99+).
    // displayState.logicalH is the world's logical height (= GAME_H on
    // desktop, larger on touch); the band is anything past GAME_H.
    const bandH = displayState.logicalH - GAME_H;
    if (bandH > 0) {
      this.add.rectangle(0, GAME_H, GAME_W, bandH, COLOR_WALL).setOrigin(0, 0).setDepth(50);
    }

    this.stage = new StageManager(this);

    this.add.rectangle(0, 0, GAME_W, HEADER_H, COLOR_PANEL, 0.92).setOrigin(0, 0).setDepth(99);
    this.add
      .rectangle(0, HEADER_H - 1, GAME_W, 1, COLOR_PANEL_BORDER, 0.6)
      .setOrigin(0, 0)
      .setDepth(99);

    this.hpText = this.add
      .text(8, HEADER_H / 2, '', { ...FONT_MENU, color: COLOR_ACCENT_RED_STR })
      .setOrigin(0, 0.5)
      .setDepth(100);
    // Bombs sit just right of HP. Allowing ~64px of HP slot covers the
    // widest hp string ("♥♥") at FONT_MENU 16px.
    this.bombsText = this.add
      .text(72, HEADER_H / 2, '', { ...FONT_MENU, color: COLOR_ACCENT_GOLD_STR })
      .setOrigin(0, 0.5)
      .setDepth(100);
    this.bossNameText = this.add
      .text(GAME_W / 2, HEADER_H / 2, '', { ...FONT_DIALOGUE_SM, color: COLOR_TEXT_PRIMARY_STR })
      .setOrigin(0.5)
      .setDepth(100);
    // Score × multiplier readout. Score is rendered zero-padded to 8
    // digits, mult to 3 (matching the `%08d` / `%03d` shape the user
    // asked for), with the leading-zero run drawn at alpha 0.7 so the
    // significant digits read first. Layout is left-to-right:
    // [score-zeros] [score-digits] [×] [mult-zeros] [mult-digits].
    // The whole block right-anchors at HUD_READOUT_RIGHT so it stays
    // clear of the top-right mute icon. See src/docs/scoring-system.md.
    const scoreStyle = { ...FONT_DIALOGUE_SM, color: COLOR_TEXT_PRIMARY_STR };
    const multStyle = { ...FONT_DIALOGUE_SM, color: COLOR_ACCENT_RED_STR };
    const hudY = HEADER_H / 2;
    this.scoreZerosText = this.add.text(0, hudY, '', scoreStyle).setOrigin(0, 0.5).setAlpha(0.7).setDepth(100);
    this.scoreDigitsText = this.add.text(0, hudY, '', scoreStyle).setOrigin(0, 0.5).setDepth(100);
    this.scoreSepText = this.add.text(0, hudY, '×', multStyle).setOrigin(0, 0.5).setDepth(100);
    this.multZerosText = this.add.text(0, hudY, '', multStyle).setOrigin(0, 0.5).setAlpha(0.7).setDepth(100);
    this.multDigitsText = this.add.text(0, hudY, '', multStyle).setOrigin(0, 0.5).setDepth(100);

    // Mute toggle in the top-right corner — same widget the menu uses.
    // The depth-200 icon clears the HUD band; the score readout above
    // is right-anchored at HUD_READOUT_RIGHT so the two don't collide.
    addMuteButton(this);

    const character = getSelectedCharacter(this);
    if (!character)
      throw new Error('GameScene started without a selected character — go through CharacterSelect first');

    // Real stage: bombs start at 0; the intro's wellness-coach drop-in
    // unlocks them. Practice / test modes get the full pile so they're
    // usable straight from the menu.
    const isRealStage = !this.state.practiceWave && !this.state.testMode;
    this.playerKind = new PlayerKind({
      hpText: this.hpText,
      bombsText: this.bombsText,
      practice: this.state.practiceWave !== null,
      character,
      bombs: isRealStage ? 0 : undefined,
    });
    this.player = new Player(this, this.stage, this.playerKind);
    this.stage.player = this.player;

    // Sync test stage: pin player invincible for the whole run so dying
    // doesn't interrupt the timing checks. Pushed once with no pop —
    // bombs still push/pop on top, but the base depth stays at 1.
    if (this.state.testMode) this.player.pushInvincible();

    const stageKind = this.state.testMode
      ? stageTest
      : this.state.practiceWave
        ? makeWaveStage(this.state.practiceWave)
        : stage;
    this.stage.spawn(stageKind, 0, 0, 0, 0, { debugYieldReasons: DEVELOPER_MODE });

    for (const c of DAMAGE_CLASSES) {
      this.physics.add.overlap(this.stage.damages[c], this.stage.damagedBy[c], (a, b) => {
        const attacker = a as Entity;
        const target = b as Entity;
        if (!attacker.alive || !target.alive) return;
        // Top-of-screen dead zone: an enemy that's still drifting in from
        // y = -30 shouldn't be killable by the player's auto-fire before
        // it's visually on-screen. The player itself sits at y ≈ 580 so
        // this never gates legitimate enemy-bullet → player collisions.
        if (target.y < DEADZONE_Y) return;
        attacker.kind.targetCollision(attacker, target);
      });
    }

    // Multiplier-drop pickup: one-way overlap with the player. Reading
    // `multLift` off MultDropKind bumps the live mult (boss drops bump
    // it most) and kills the drop. See src/docs/scoring-system.md.
    this.physics.add.overlap(this.player, this.stage.drops, (_p, d) => {
      const drop = d as Entity;
      if (!drop.alive) return;
      const kind = drop.kind;
      if (!(kind instanceof MultDropKind)) return;
      if (kind.multLift > 0) addMult(this.stage.score, kind.multLift);
      drop.die();
    });

    if (isTouchDevice) {
      const bombY = bombButtonY();
      // Bomb button — gold accent reads as "the ✱-button" without a
      // separate label. Movement is finger-follow (see getTouchTarget),
      // so the rest of the touch area is implicit and unmarked.
      const bombBtn = makeRoundButton(this, BOMB_BUTTON_X, bombY, BOMB_BUTTON_RADIUS, COLOR_ACCENT_GOLD, 0.2, 0.6);
      this.add
        .text(BOMB_BUTTON_X, bombY, '✱', { color: COLOR_ACCENT_GOLD_STR, fontSize: '30px' })
        .setOrigin(0.5)
        .setAlpha(0.95)
        .setDepth(101);
      // Bombs fire on pointerdown, not on the onTap pointerup, so the
      // gameplay action is responsive — not a menu click. Capture the
      // pointer id for getTouchTarget in the same handler. The Player
      // listens for `bombInput` and decides whether to actually fire.
      bombBtn.on('pointerdown', (p: Phaser.Input.Pointer) => {
        this.state.buttonPointers.add(p.id);
        this.events.emit('bombInput');
      });

      // Pause button — neutral colour so it reads as a UI control rather
      // than a gameplay action. Toggles between pause and resume so the
      // same thumb tap can dismiss the overlay it opened.
      const pauseY = pauseButtonY();
      const pauseBtn = makeRoundButton(
        this,
        PAUSE_BUTTON_X,
        pauseY,
        PAUSE_BUTTON_RADIUS,
        COLOR_TEXT_PRIMARY,
        0.15,
        0.5,
      );
      this.add
        .text(PAUSE_BUTTON_X, pauseY, '❚❚', { color: COLOR_TEXT_PRIMARY_STR, fontSize: '18px' })
        .setOrigin(0.5)
        .setAlpha(0.95)
        .setDepth(101);
      pauseBtn.on('pointerdown', (p: Phaser.Input.Pointer) => {
        this.state.buttonPointers.add(p.id);
      });
      onTap(this, pauseBtn, () => {
        // Toggle: tap the same button to dismiss the overlay it opened.
        // Skip when a dialogue / continue overlay already owns the
        // freeze — yanking it would resume play mid-cutscene.
        if (this.state.userPaused) this.unpauseGame();
        else if (!this.stage.paused) this.pauseGame();
      });
    }

    this.hud = this.add
      .text(WALL_W + 8, HEADER_H + 4, '', { ...FONT_DEBUG, color: COLOR_TEXT_DIM_STR })
      .setScrollFactor(0)
      .setDepth(100);

    // Debug HUD (track / t / next / blocked) shown for the real stage and
    // every test stage. Test mode gets the green tint as a "you're in
    // test mode" cue; real-stage version is greyer so it recedes.
    // x is nudged past the wall column so it sits inside the playfield
    // rather than getting clipped by the side wall. Depth sits below every
    // dialogue-ish overlay (bubbles=50, scroll indicator=95, tutorial=150,
    // dialogue=200) so any of them draw on top of the debug line.
    //
    // Gated on DEVELOPER_MODE — prod builds skip the Text construction
    // entirely; the null check in update()'s setText call handles the
    // missing widget without a separate branch.
    if (DEVELOPER_MODE) {
      const debugTinted = this.state.testMode;
      this.debugHud = this.add
        .text(WALL_W + 8, HEADER_H + 20, '', {
          ...FONT_DEBUG,
          color: debugTinted ? COLOR_ACCENT_GREEN_STR : COLOR_TEXT_DIM_STR,
        })
        .setScrollFactor(0)
        .setDepth(10);
    }

    const kb = this.input.keyboard;
    if (!kb) throw new Error('Keyboard input plugin missing');
    this.leftKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    this.rightKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
    this.upKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this.downKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    this.focusKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.fireKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    kb.on('keydown-ESC', this.handleResume, this);
    kb.on('keydown-X', this.handleExitToMenu, this);
    // X is the bomb key during gameplay — emit the unified `bombInput`
    // event that Player and the intro skip / bomb tutorial polls all
    // listen for. handleExitToMenu above gates on userPaused so it
    // shares the same key without conflict.
    kb.on('keydown-X', (e: KeyboardEvent) => {
      if (e.repeat) return;
      this.events.emit('bombInput');
    });

    // Auto-pause when the player tabs away or hides the page. We own
    // this because BootScene set `sound.pauseOnBlur = false` to take
    // over from Phaser's per-frame onFocus contention. Both events fire
    // because no single one is reliable across platforms — desktop
    // browsers fire window blur, iOS Safari only fires visibilitychange
    // when the tab actually hides. Resume is intentionally manual: the
    // pause overlay stays up after focus returns so the player chooses
    // when to drop back into bullets.
    const onLoseFocus = (): void => {
      if (this.state.userPaused || this.stage.paused) return;
      this.pauseGame();
    };
    this.game.events.on(Phaser.Core.Events.BLUR, onLoseFocus);
    const onVisibility = (): void => {
      if (document.hidden) onLoseFocus();
    };
    document.addEventListener('visibilitychange', onVisibility);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.BLUR, onLoseFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      // wallsTile is held off the display list, so the scene's normal
      // teardown won't reach it — destroy it explicitly.
      this.wallsTile.destroy();
      if (this.state.practiceWave) {
        this.registry.set(PRACTICE_HITS_KEY_PREFIX + this.state.practiceWave.id, this.playerKind.hits);
      }
    });
  }

  private handleResume(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (this.state.userPaused) {
      this.unpauseGame();
      return;
    }
    // Only own the freeze when nobody else does — dialogue holds the same
    // stage.paused / physics.pause state during cutscenes, and toggling them
    // out from under it would resume physics mid-line.
    if (this.stage.paused) return;
    this.pauseGame();
  }

  private handleExitToMenu(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (!this.state.userPaused) return;
    this.scene.start('Menu');
  }

  private pauseGame(): void {
    console.warn(`[menu-open t=${performance.now().toFixed(0)}]`);
    this.state.userPaused = true;
    this.stage.freeze();
    // Freeze Phaser's clock too: `stage.freeze()` only stops the physics
    // and script-frame queues, but `realSeconds` waits (e.g. the
    // `waitTrackEnded` body's `delayedCall`) live on `scene.time` and
    // keep ticking through `freeze()`. Without this pause, the script
    // would advance past `waitTrackEnded` during the overlay and call
    // `playMusicLoop(NEW_KEY)`, starting the next track audibly even
    // though the user is paused. Dialogue/cutscene freezes intentionally
    // leave the clock running — only ESC pause stops it.
    this.time.paused = true;
    pauseMusic();
    this.showPauseOverlay();
  }

  private unpauseGame(): void {
    this.state.userPaused = false;
    this.stage.unfreeze();
    this.time.paused = false;
    resumeMusic();
    this.hidePauseOverlay();
  }

  private showPauseOverlay(): void {
    if (this.state.pauseOverlay) return;
    const c = this.add.container(0, 0).setDepth(200);
    const dim = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, COLOR_PANEL, 0.85);
    c.add(dim);
    const title = this.add
      .text(GAME_W / 2, GAME_H * 0.4, 'PAUSED', { ...FONT_TITLE, color: COLOR_ACCENT_GOLD_STR })
      .setOrigin(0.5);
    c.add(title);

    const resumeTpl = isTouchDevice ? '▶ TAP TO RESUME' : '▶ <back>  RESUME';
    const resume = makePrompt(this, GAME_W / 2, GAME_H * 0.52, resumeTpl, {
      ...FONT_MENU,
      color: COLOR_TEXT_PRIMARY_STR,
    });
    c.add(resume);

    const menuTpl = isTouchDevice ? '▷ TAP TO QUIT' : '▷ <bomb>  MENU';
    const menu = makePrompt(this, GAME_W / 2, GAME_H * 0.62, menuTpl, {
      ...FONT_MENU,
      color: COLOR_TEXT_PRIMARY_STR,
    });
    c.add(menu);

    // Click / tap targets work on both desktop (mouse) and touch — onTap
    // dispatches on scene-level pointerup which is the same event for
    // both. The keyboard handlers above stay so ESC / X still work.
    setOverlayHit(resume);
    setOverlayHit(menu);
    onTap(this, resume, () => this.unpauseGame());
    onTap(this, menu, () => this.scene.start('Menu'));

    this.state.pauseOverlay = c;
  }

  private hidePauseOverlay(): void {
    this.state.pauseOverlay?.destroy();
    this.state.pauseOverlay = null;
  }

  private allowsContinue(): boolean {
    return !this.state.practiceWave && !this.state.testMode;
  }

  private showContinueOverlay(): void {
    if (this.state.continueOverlay) return;
    this.stage.freeze();
    pauseMusic();

    const c = this.add.container(0, 0).setDepth(200);
    const dim = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, COLOR_PANEL, 0.85);
    c.add(dim);
    const title = this.add
      .text(GAME_W / 2, GAME_H * 0.38, 'CONTINUE?', { ...FONT_TITLE, color: COLOR_ACCENT_RED_STR })
      .setOrigin(0.5);
    c.add(title);

    const continueTpl = isTouchDevice ? '▶ TAP TO CONTINUE' : '▶ <confirm>  CONTINUE';
    const continueBtn = makePrompt(this, GAME_W / 2, GAME_H * 0.52, continueTpl, {
      ...FONT_MENU,
      color: COLOR_TEXT_PRIMARY_STR,
    });
    c.add(continueBtn);

    const quitTpl = isTouchDevice ? '▷ TAP TO QUIT' : '▷ <back>  QUIT';
    const quitBtn = makePrompt(this, GAME_W / 2, GAME_H * 0.62, quitTpl, {
      ...FONT_MENU,
      color: COLOR_TEXT_PRIMARY_STR,
    });
    c.add(quitBtn);

    this.state.continueOverlay = c;

    setOverlayHit(continueBtn);
    setOverlayHit(quitBtn);
    onTap(this, continueBtn, () => {
      this.dismissContinueOverlay();
      this.revivePlayerWithDeathBomb();
    });
    onTap(this, quitBtn, () => this.scene.start('Menu'));

    const kb = this.input.keyboard;
    if (!kb) return;
    kb.on('keydown-Z', this.handleContinueConfirm, this);
    kb.on('keydown-ESC', this.handleContinueExit, this);
  }

  private dismissContinueOverlay(): void {
    this.state.continueOverlay?.destroy();
    this.state.continueOverlay = null;
    const kb = this.input.keyboard;
    if (!kb) return;
    kb.off('keydown-Z', this.handleContinueConfirm, this);
    kb.off('keydown-ESC', this.handleContinueExit, this);
  }

  private handleContinueConfirm(event: KeyboardEvent): void {
    if (event.repeat) return;
    this.dismissContinueOverlay();
    this.revivePlayerWithDeathBomb();
  }

  private handleContinueExit(event: KeyboardEvent): void {
    if (event.repeat) return;
    // Don't bother dismissing the overlay — scene.start tears the whole
    // scene down, taking the container with it.
    this.scene.start('Menu');
  }

  private revivePlayerWithDeathBomb(): void {
    const p = this.player;
    this.stage.score.continues++;
    // Continue wipes the run's score column — the scoreboard reflects
    // untainted runs only. Resets the chain + floor too. See
    // src/docs/scoring-system.md → reset triggers.
    onContinue(this.stage.score);
    p.alive = true;
    (p.vars as HPVars).hp = this.playerKind.hp;
    p.body.enable = true;
    p.setVelocity(0, 0);
    p.setVisible(true);
    p.setAlpha(1);
    p.clearTint();
    if (p.anims.isPaused) p.anims.resume();
    p.updateAnim();
    p.render();

    this.stage.unfreeze();
    resumeMusic();

    activateDeathBomb(p, this.stage);
  }

  override update(time: number, delta: number): void {
    // Death check first — placement matters because of Phaser 3's frame order.
    //
    // Arcade physics runs on the SceneEvents.UPDATE event, which fires BEFORE
    // the scene's update() method:
    //
    //   PRE_UPDATE → UPDATE (physics integrates + overlap callbacks fire) →
    //   scene.update() (← we are here) → POST_UPDATE → PRE_RENDER → render
    //
    // So a fatal player-vs-bullet overlap in this frame has already called
    // player.die() before this method runs; alive === false is visible from
    // line one. We have to bail before stage.update so scripts never tick with
    // a dead player.
    //
    // Why not check at the bottom of update (right before render)? scene.start
    // only queues the scene swap for next frame; it doesn't preempt the rest
    // of this update. By then stage.update has already run with alive === false
    // — exactly the tick we want to skip. (If physics ran AFTER scene.update,
    // the death wouldn't have happened yet during stage.update and the
    // end-of-update check would be fine — but Phaser 3's order is the other
    // way around, so top-of-update is the only safe slot.)
    if (!this.player.alive) {
      if (this.state.continueOverlay !== null || this.state.deathStarted) return;
      // Continue prompt only in the real stage — practice / test / music
      // modes either keep the player invincible or never decrement HP, so
      // a death there is anomalous and falls through to the death sequence.
      if (this.allowsContinue()) this.showContinueOverlay();
      else this.startDeathSequence();
      return;
    }

    // Tick handlers first, controls last (before Phaser's physics step). This
    // lets a script flip stage.paused or player.controlsEnabled this frame and
    // have those state changes land before controlUpdate decides whether to
    // read input or auto-fire — otherwise a held fire key spawns a bullet in
    // the same frame (or the frame before) a cutscene begins, and it pops into
    // view as physics integrates.
    this.stage.update(time, delta);
    if (!this.stage.paused) {
      // Floor only scrolls between encounters — `stage.running` is the
      // single source of truth, flipped around each wave by the stage
      // script. The player anim follows the same flag (see
      // Player.updateAnim), so MC + floor stay in sync. Scroll rate is
      // additionally scaled by `scrollSpeedMultiplier` so cutscenes can
      // dial it (e.g. the ending walks home at 0.5×).
      if (this.stage.running) {
        const advance = delta * CORRIDOR_SCROLL_PX_PER_MS * this.stage.scrollSpeedMultiplier;
        this.state.bgScrollY += advance;
        // tilePositionY is fed straight into the texture-coord shader uniform
        // (TileSpriteWebGLRenderer) and is NOT affected by camera.roundPixels —
        // a fractional value samples the floor texture at sub-texel offsets,
        // so the scroll advances by uneven visual amounts each frame (judder
        // under variable delta). Drive it from the rounded float accumulator
        // so the displayed position always lands on an integer pixel; the
        // accumulator itself stays float so the next frame's increment and
        // the door-wrap math (computeDoorYs, which rounds its own output)
        // don't lose precision.
        this.bg.tilePositionY = -Math.round(this.state.bgScrollY);
      }
      // Mirror the scroll onto the stage so script helpers (alignDoor,
      // pickDoorCenterY) read the same number that drives the door
      // rasterisation below.
      this.stage.bgScrollY = this.state.bgScrollY;
      // Doors ride the floor: each slot's y is its phase offset plus the
      // shared scroll, wrapped through DOOR_CYCLE so the trio cycles
      // through the canvas with no gaps. Subtract DOOR_H so the wrap
      // happens fully off-screen at the top instead of popping in.
      // Round to an integer pixel: the door renders through the main
      // scene camera (roundPixels=true via pixelArt) while the eraser
      // hits the wallsRt's own camera (roundPixels=false by default), so
      // a fractional y would let the two rasterise to slightly different
      // rows and the door panels would flicker in and out. Rounding once
      // up front feeds both paths the same integer.
      const doorYs = computeDoorYs(this.state.bgScrollY);

      // Refresh the walls layer: blit the tiled walls into the RT, then
      // erase each slot's full-width bbox. Eraser and door Image share
      // native size + origin (0, 0), so Phaser's batchTextureFrame path
      // produces identical pixel coverage.
      this.wallsRt.clear();
      this.wallsRt.draw(this.wallsTile, 0, 0);
      this.state.doorSlots.forEach((slot, i) => {
        const y = doorYs[i] ?? 0;
        slot.y = y;
        this.wallsRt.erase(BG_DOORS_BBOX_KEY, 0, y);
      });

      const kbDirX = (this.leftKey.isDown ? -1 : 0) + (this.rightKey.isDown ? 1 : 0);
      const kbDirY = (this.upKey.isDown ? -1 : 0) + (this.downKey.isDown ? 1 : 0);
      this.player.controlUpdate({
        kbDirX,
        kbDirY,
        focusHeld: this.focusKey.isDown,
        touchTarget: isTouchDevice ? this.getTouchTarget() : null,
        firing: isTouchDevice || this.fireKey.isDown,
      });
    }
    // Player isn't part of stage.active, so its anim doesn't get the per-tick
    // refresh that other entities get inside stage.update — drive it here. Run
    // even while paused so the dialogue's first frame doesn't show a stale anim
    // from before the cutscene started.
    this.player.updateAnim();

    this.state.hudAccumMs += delta;
    if (this.state.hudAccumMs >= HUD_REFRESH_MS) {
      this.state.hudAccumMs = 0;
      const hostile = this.stage.damages.player.countActive(true);
      const mode = this.state.practiceWave ? `   PRACTICE: ${this.state.practiceWave.name}` : '';
      this.hud.setText(`hostile: ${hostile}   fps: ${Math.round(this.game.loop.actualFps)}${mode}`);
    }

    this.bossNameText.setText(this.stage.bossName ?? '');

    // Score × mult. Each number is split into a leading-zero run
    // (alpha 0.7) and the significant digits (full alpha). The block
    // is laid out left-to-right at runtime so the rightmost glyph
    // pins to HUD_READOUT_RIGHT regardless of how many leading zeros
    // collapsed away.
    this.refreshScoreReadout();

    if (this.debugHud) this.debugHud.setText(this.formatDebugLine());
  }

  // Layout the split score-readout in the HUD band. Score is
  // zero-padded to 8 digits, mult to 3; the dim-zero / bright-digit
  // boundary is the first non-zero character (or the last char if the
  // value is exactly zero, so the readout never shows nothing).
  // Pieces are positioned left-to-right with their measured widths
  // chained, and the whole block right-anchors at HUD_READOUT_RIGHT
  // so the rightmost glyph stays clear of the top-right mute icon.
  private refreshScoreReadout(): void {
    const { score, mult } = this.stage.score;
    const scoreStr = score.toString().padStart(SCORE_WIDTH, '0');
    const multStr = mult.toString().padStart(MULT_WIDTH, '0');
    const sZ = splitLeadingZeros(scoreStr);
    const mZ = splitLeadingZeros(multStr);

    this.scoreZerosText.setText(sZ.zeros);
    this.scoreDigitsText.setText(sZ.digits);
    this.multZerosText.setText(mZ.zeros);
    this.multDigitsText.setText(mZ.digits);

    // Right-pack: position the rightmost element first, then walk left
    // by each piece's measured width.
    let x = HUD_READOUT_RIGHT;
    this.multDigitsText.setX(x - this.multDigitsText.width);
    x -= this.multDigitsText.width;
    this.multZerosText.setX(x - this.multZerosText.width);
    x -= this.multZerosText.width;
    this.scoreSepText.setX(x - this.scoreSepText.width);
    x -= this.scoreSepText.width;
    this.scoreDigitsText.setX(x - this.scoreDigitsText.width);
    x -= this.scoreDigitsText.width;
    this.scoreZerosText.setX(x - this.scoreZerosText.width);
  }

  // Death animation: freeze the world (stage script + physics), strobe the
  // player sprite a few times, hide it, then sit on the frozen frame for a
  // beat before swapping to End. Tweens and scene.time keep running because
  // we only pause physics — not the scene itself — so the sequence
  // self-completes without needing update() ticks.
  private startDeathSequence(): void {
    this.state.deathStarted = true;
    this.stage.freeze();

    playerDeath();

    // Stepped strobe: 8 toggles at ~80ms = ~640ms of flicker. setTint
    // alternates between white (full visible) and a transparent alpha
    // toggle would also work, but alpha is cheaper and reads clearly.
    const FLICKER_TOGGLES = 8;
    const FLICKER_INTERVAL_MS = 80;
    let toggle = 0;
    this.time.addEvent({
      delay: FLICKER_INTERVAL_MS,
      repeat: FLICKER_TOGGLES - 1,
      callback: () => {
        toggle++;
        this.player.setAlpha(toggle % 2 === 0 ? 1 : 0);
      },
    });

    const FLICKER_TOTAL_MS = FLICKER_INTERVAL_MS * FLICKER_TOGGLES;
    const POST_FLICKER_HOLD_MS = 600;
    this.time.delayedCall(FLICKER_TOTAL_MS, () => {
      this.player.setVisible(false);
    });
    this.time.delayedCall(FLICKER_TOTAL_MS + POST_FLICKER_HOLD_MS, () => {
      this.scene.start('End', { won: false });
    });
  }

  private formatDebugLine(): string {
    const m = getMusicTime();
    // Whole-second precision: the formatted string only changes once a
    // second, so Phaser.Text.setText hits its `value !== this._text`
    // early-bail and skips the canvas redraw + gl.texImage2D upload on
    // most frames. wave / yield reason / track key change rarely enough
    // that they pass through cheaply on the same path.
    const trackPart = m === null ? 'track: (none)  t: -' : `track: ${m.key}  t: ${Math.floor(m.time)}s`;

    const wave = this.stage.wave;
    const secondLineParts: string[] = [];
    if (wave) secondLineParts.push(`wave: ${wave}`);
    const reason = this.stage.lastYieldReason;
    if (reason) secondLineParts.push(`yield: ${reason}`);

    return secondLineParts.length > 0 ? `${trackPart}\n${secondLineParts.join('  ')}` : trackPart;
  }
}

// Add an interactive circular button (visual circle + ready-to-handle
// tap). Hit area is an explicit Phaser.Geom.Circle so taps register on
// the visible disc rather than its bounding rectangle, and the center
// is offset by the radius because Phaser's pointWithinHitArea uses
// local coords with `displayOrigin` already applied (origin 0.5, 0.5
// on Arc puts the visual centre at local (radius, radius)).
function makeRoundButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  radius: number,
  fillColor: number,
  fillAlpha: number,
  strokeAlpha: number,
): Phaser.GameObjects.Arc {
  return scene.add
    .circle(x, y, radius, fillColor, fillAlpha)
    .setStrokeStyle(2, fillColor, strokeAlpha)
    .setDepth(100)
    .setInteractive(new Phaser.Geom.Circle(radius, radius, radius), Phaser.Geom.Circle.Contains);
}

// Fat-finger pad for an overlay prompt. Container origin sits at the
// prompt's centre (makePrompt positions it that way), so a centred
// rectangle gives a hit pad that extends in all four directions equally
// — same pattern MenuScene uses for its title-screen buttons.
const OVERLAY_HIT_W = GAME_W * 0.7;
const OVERLAY_HIT_H = 70;
function setOverlayHit(target: Phaser.GameObjects.Container): void {
  target.setInteractive(
    new Phaser.Geom.Rectangle(-OVERLAY_HIT_W / 2, -OVERLAY_HIT_H / 2, OVERLAY_HIT_W, OVERLAY_HIT_H),
    Phaser.Geom.Rectangle.Contains,
  );
}
