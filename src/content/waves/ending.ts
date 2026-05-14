import type Phaser from 'phaser';
import { ENDING_LOOP_KEY, ENDING_OPENING_KEY } from '../../audio/keys';
import { stopMusicLoop } from '../../audio/music/loop';
import { GAME_H, GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo } from '../../script/patterns';
import { markWave, startMusicWithIntro, waitAudioTimeAtLeast, waitSeconds, withFootsteps } from '../../script/stage';
import type { ScriptYield } from '../../script/types';
import { FONT_DEBUG, FONT_DIALOGUE_LG, FONT_MENU } from '../../ui/fonts';
import {
  COLOR_ACCENT_GOLD_STR,
  COLOR_PANEL,
  COLOR_PANEL_BORDER,
  COLOR_TEXT_DIM_STR,
  COLOR_TEXT_MUTED_STR,
  COLOR_TEXT_PRIMARY_STR,
} from '../../ui/palette';
import { breakLongUrl, SECTIONS, type Section } from '../credits';

// Ending scene (practice-only for now): the player walks to the corridor
// centre, monologues "Finally, some quiet.", the music swells in with
// the unchained-destiny intro, the player monologues "Now, how can I
// get home?", walks to the left edge, then strolls in place while the
// floor scrolls past at half speed and the credits sections fade in/
// hold/fade out one at a time.

const WALK_SPEED = 80;
const CENTER_X = GAME_W / 2;
const CENTER_Y = GAME_H / 2;
// Final standing-spot near the left wall — comfortably inside the
// walkable corridor (player half-width + WALL_W gap).
const LEFT_REST_X = 60;
const LEFT_REST_Y = CENTER_Y - 60;
const SLOW_SCROLL_MULT = 0.5;

// Per-section roll timing. Sized so the four-section roll lasts
// roughly one music intro+loop cycle on a comfortable read.
const FADE_IN_S = 0.5;
const HOLD_S = 7;
const FADE_OUT_S = 0.5;

// Music timing — opening (~17 s) + loop (~57 s) = ~74 s for the first
// full cycle. Aim the walk-out start at this audio-time so the player
// is leaving frame as the track wraps.
const TRACK_TAIL_S = 69;
// Walk-out vertical exit. Player walks straight up off the top of the
// canvas; speed picked so the trip lasts ~the remaining ~5 s of the
// track tail and the scene returns just past the loop boundary.
const EXIT_SPEED = 100;
const EXIT_Y = -50;

// Where the section text appears on screen. Player rests on the far
// left during the roll, so the panel is shifted right of the corridor
// centre to sit in the space *next to* the player rather than on top
// of them. Player visual right edge is at LEFT_REST_X + half-sprite =
// ~84; panel left edge at SECTION_X - PANEL_MAX_W/2 = 90 leaves a
// small but readable gap.
const SECTION_X = 230;
const SECTION_Y = GAME_H * 0.5;

// Backdrop panel — semi-transparent dark card behind the text stack so
// the credits read against the busy floor tiles. Width is responsive
// per section: it snaps to the widest child clamped between MIN
// (visual cohesion across sections) and MAX (the slot beside the
// player). Height is always computed from the laid-out content.
const PANEL_MIN_W = 240;
const PANEL_MAX_W = 280;
const PANEL_PAD_X = 16;
const PANEL_PAD_Y = 20;
const PANEL_RADIUS = 8;
const PANEL_FILL_ALPHA = 0.85;
const PANEL_BORDER_ALPHA = 0.7;

// Wrap width for text inside the panel. Names, roles, body paragraph
// and URLs all wrap to this width; the responsive panel is clamped at
// PANEL_MAX_W, so wrapping is what keeps long entries from
// overflowing. URLs are pre-broken at a slash (see `breakLongUrl`)
// because Phaser's word-wrap only breaks at whitespace, not slashes.
const TEXT_WRAP = PANEL_MAX_W - PANEL_PAD_X * 2;

// Approximate character width in monogram 16px. Used to decide when a
// URL needs a manual slash-break before it's handed to Phaser's
// word-wrap. Slightly conservative so the break happens before the
// last-fitting slash, leaving safety margin.
const URL_BREAK_CHARS = 36;

// Vertical rhythm. All gaps are *additional* spacing between adjacent
// elements — actual element heights are read from `text.height` at
// layout time, so multi-line wrapped text grows the stack naturally
// instead of overlapping the next row.
const HEADING_GAP_BELOW = 14;
const NAME_GAP_BELOW = 6;
const SUB_GAP_BELOW = 22;
const SOLO_ENTRY_GAP_BELOW = 18;

export function* endingScene(self: Entity): Generator<ScriptYield, void, void> {
  markWave(self, 'ending');
  const stage = self.stage;
  const player = stage.player;
  const playerCh = player.character;

  player.lockControls();
  player.firingEnabled = false;
  player.walkAnim = true;
  // Freeze the corridor scroll while the dialog beats play out so the
  // floor doesn't drift under a stationary monologuing player.
  stage.scrollSpeedMultiplier = 0;
  // Freeze the scoreboard for the whole walk-home. In the live chain
  // theBoss already flipped this off after the fight; this is idempotent
  // there and the load-bearing path when endingScene is launched
  // directly from the practice menu (with a still-live alive-tick).
  stage.scoringActive = false;

  // Phase 1 — walk into the corridor centre. Music hasn't started yet,
  // so footsteps carry the walk.
  yield* withFootsteps(moveTo(player, CENTER_X, CENTER_Y, WALK_SPEED));
  player.facing = 'up';
  player.updateAnim();
  yield* waitSeconds(0.4);

  // Phase 2 — first monologue. Single-speaker dialog box.
  yield self.dialogue({
    left: { sprite: playerCh.sprite, frame: playerCh.frame, name: playerCh.name },
    lines: [{ speaker: 'left', text: 'Finally, some quiet.' }],
  });

  // Phase 3 — music in. After the dialog dismiss, before the second
  // line. startMusicWithIntro waits until the audio thread reports
  // the loop is ticking, so the next dialogue starts under live music.
  yield* startMusicWithIntro(ENDING_OPENING_KEY, ENDING_LOOP_KEY);

  // Phase 4 — second monologue.
  yield self.dialogue({
    left: { sprite: playerCh.sprite, frame: playerCh.frame, name: playerCh.name },
    lines: [{ speaker: 'left', text: 'Now, how can I get home?' }],
  });

  // Phase 5 — drift to the left. moveTo's facing is implicit from the
  // velocity vector, so the walk-anim shows "walking left" while the
  // player crosses to the rest position.
  yield* moveTo(player, LEFT_REST_X, LEFT_REST_Y, WALK_SPEED);

  // Phase 6 — switch from "walking left" to "walking in place facing
  // up" (forward). The corridor scroll picks up at half speed and
  // sells the illusion of forward motion.
  player.facing = 'up';
  player.walkInPlace = true;
  player.updateAnim();
  stage.scrollSpeedMultiplier = SLOW_SCROLL_MULT;

  // Phase 7 — credits roll. One section at a time, fade in / hold /
  // fade out. The whole roll fits inside the music intro + first loop
  // iteration with comfortable read time on each card.
  // The FINAL SCORE card is shown first, ahead of the TEAM section, so
  // the run's tally is the player's first read after they settle in.
  yield* showFinalScoreFade(self);
  for (const section of SECTIONS) {
    yield* showSectionFade(self, section);
  }

  // Phase 8 — final "Thank you for playing!" card. Fades in but stays
  // up (no fade-out) so it remains visible while we wait for the music
  // to wind down and the player walks out of frame.
  const thanks = self.scene.add
    .text(GAME_W / 2, GAME_H / 2, 'Thank you for playing!', {
      ...FONT_DIALOGUE_LG,
      color: COLOR_ACCENT_GOLD_STR,
      align: 'center',
    })
    .setOrigin(0.5)
    .setAlpha(0)
    .setDepth(50);
  self.scene.tweens.add({ targets: thanks, alpha: 1, duration: FADE_IN_S * 1000 });
  yield* waitSeconds(FADE_IN_S);

  // Phase 9 — wait for the music's first cycle to approach its end.
  // `waitAudioTimeAtLeast` sleeps the wall-clock gap to the target
  // music timestamp; if the user lingered through the dialogs and
  // we're already past it, the wait resolves immediately and we move
  // on without a visible stutter.
  yield* waitAudioTimeAtLeast(TRACK_TAIL_S);

  // Phase 10 — walk out of frame. Player exits straight up past the
  // top of the canvas. moveTo's velocity → walk-up animation, no need
  // to flip walkInPlace beyond clearing it (the actual y-motion takes
  // over once we set non-zero velocity).
  player.walkInPlace = false;
  yield* moveTo(player, player.x, EXIT_Y, EXIT_SPEED);

  // Cleanup. Cut the music as the wave returns so the next scene
  // (TestMenu in practice mode) doesn't inherit the unchained-destiny
  // loop bleeding under the menu UI.
  player.walkAnim = false;
  stage.scrollSpeedMultiplier = 1;
  stopMusicLoop();
}

function* showSectionFade(self: Entity, section: Section): Generator<ScriptYield, void, void> {
  const scene = self.scene;
  const container = renderSection(scene, section, SECTION_X, SECTION_Y);
  container.setAlpha(0);
  scene.tweens.add({ targets: container, alpha: 1, duration: FADE_IN_S * 1000 });
  yield* waitSeconds(FADE_IN_S + HOLD_S);
  scene.tweens.add({ targets: container, alpha: 0, duration: FADE_OUT_S * 1000 });
  yield* waitSeconds(FADE_OUT_S);
  container.destroy();
}

// Final-score card. Renders ahead of the SECTIONS roll, same fade-in /
// hold / fade-out cadence as `showSectionFade` so the run's tally
// reads as the first credits card rather than a separate beat.
function* showFinalScoreFade(self: Entity): Generator<ScriptYield, void, void> {
  const scene = self.scene;
  const container = renderFinalScore(scene, self.stage.score, SECTION_X, SECTION_Y);
  container.setAlpha(0);
  scene.tweens.add({ targets: container, alpha: 1, duration: FADE_IN_S * 1000 });
  yield* waitSeconds(FADE_IN_S + HOLD_S);
  scene.tweens.add({ targets: container, alpha: 0, duration: FADE_OUT_S * 1000 });
  yield* waitSeconds(FADE_OUT_S);
  container.destroy();
}

// Render the three-line final-score card (Score / Mult / Final) into a
// Container, then offset vertically so the rendered stack is centred
// on (cx, cy). Numbers use `toLocaleString('en-US')` for a thousands
// separator. Frames the stack with the same backdrop panel as
// `renderSection` so the score card reads as the first credits card
// rather than a separate beat.
function renderFinalScore(
  scene: Phaser.Scene,
  score: { score: number; mult: number },
  cx: number,
  cy: number,
): Phaser.GameObjects.Container {
  const container = scene.add.container(cx, 0).setDepth(50);

  // Local spacing — the score card's vertical rhythm is independent of
  // the credits sections. Heading sits a comfortable gap above the
  // three numeric rows; rows are tightly grouped because they read as
  // a single block.
  const HEADING_GAP = 14;
  const ROW_GAP = 8;

  let cursor = 0;
  let maxChildW = 0;
  const heading = scene.add
    .text(0, cursor, 'FINAL SCORE', { ...FONT_MENU, color: COLOR_ACCENT_GOLD_STR })
    .setOrigin(0.5, 0);
  container.add(heading);
  maxChildW = Math.max(maxChildW, heading.width);
  cursor += heading.height + HEADING_GAP;

  const final = score.score * score.mult;
  const lines = [
    `Score: ${score.score.toLocaleString('en-US')}`,
    `Mult: ×${score.mult.toLocaleString('en-US')}`,
    `Final: ${final.toLocaleString('en-US')}`,
  ];

  for (const [i, text] of lines.entries()) {
    const line = scene.add
      .text(0, cursor, text, { ...FONT_DIALOGUE_LG, color: COLOR_TEXT_PRIMARY_STR })
      .setOrigin(0.5, 0);
    container.add(line);
    maxChildW = Math.max(maxChildW, line.width);
    cursor += line.height;
    if (i < lines.length - 1) cursor += ROW_GAP;
  }

  drawPanelBg(scene, container, maxChildW, cursor);
  container.y = cy - cursor / 2;
  return container;
}

// Render a credits section into a Container, then offset the container
// vertically so the rendered stack is centred on (cx, cy). Reused per
// section because the widths differ (mostly the body paragraph) and a
// single fixed layout would either crop or float. A semi-transparent
// rounded panel is drawn behind the text once the stack height is
// known, so it always wraps the actual content (multi-line wrapped
// roles grow the stack, the backdrop tracks them).
function renderSection(scene: Phaser.Scene, section: Section, cx: number, cy: number): Phaser.GameObjects.Container {
  const container = scene.add.container(cx, 0).setDepth(50);

  let cursor = 0;
  let maxChildW = 0;
  const heading = scene.add
    .text(0, cursor, section.heading, { ...FONT_MENU, color: COLOR_ACCENT_GOLD_STR })
    .setOrigin(0.5, 0);
  container.add(heading);
  maxChildW = Math.max(maxChildW, heading.width);
  cursor += heading.height + HEADING_GAP_BELOW;

  const entries = section.entries ?? [];
  for (const [i, entry] of entries.entries()) {
    const isLast = i === entries.length - 1 && !section.body;

    // Names wrap at the panel inner width so a long name like "CRACK
    // THE UNDERGROUND BASE" breaks at a space instead of forcing the
    // panel to grow past `PANEL_MAX_W`.
    const name = scene.add
      .text(0, cursor, entry.name, {
        ...FONT_DIALOGUE_LG,
        color: COLOR_TEXT_PRIMARY_STR,
        align: 'center',
        wordWrap: { width: TEXT_WRAP },
      })
      .setOrigin(0.5, 0);
    container.add(name);
    maxChildW = Math.max(maxChildW, name.width);
    cursor += name.height;

    // URLs have no internal whitespace and Phaser's word-wrap only
    // breaks at spaces, so manually insert a newline at the last slash
    // within the safe character budget before handing the text to the
    // text style's wordWrap (which still clips any line longer than
    // TEXT_WRAP on the rare case the broken line still overflows).
    const subText = entry.url ? breakLongUrl(entry.url, URL_BREAK_CHARS) : entry.role;
    if (subText) {
      cursor += NAME_GAP_BELOW;
      const sub = scene.add
        .text(0, cursor, subText, {
          ...FONT_DEBUG,
          color: COLOR_TEXT_DIM_STR,
          align: 'center',
          wordWrap: { width: TEXT_WRAP },
        })
        .setOrigin(0.5, 0);
      container.add(sub);
      maxChildW = Math.max(maxChildW, sub.width);
      cursor += sub.height;
    }
    if (!isLast) cursor += subText ? SUB_GAP_BELOW : SOLO_ENTRY_GAP_BELOW;
  }

  if (section.body) {
    if (entries.length > 0) cursor += SUB_GAP_BELOW;
    const body = scene.add
      .text(0, cursor, section.body, {
        ...FONT_DEBUG,
        color: COLOR_TEXT_MUTED_STR,
        align: 'center',
        wordWrap: { width: TEXT_WRAP },
      })
      .setOrigin(0.5, 0);
    container.add(body);
    maxChildW = Math.max(maxChildW, body.width);
    cursor += body.height;
  }

  drawPanelBg(scene, container, maxChildW, cursor);
  container.y = cy - cursor / 2;
  return container;
}

// Draws the semi-transparent rounded backdrop behind the laid-out text
// stack of a section/score card. Width snaps to `maxChildW + padding`,
// clamped between MIN/MAX so the panels read as a coherent set even
// when individual sections have very different widest-line widths.
// The graphics object is inserted at index 0 of the container so the
// text renders on top.
function drawPanelBg(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  maxChildW: number,
  contentH: number,
): void {
  const panelW = Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, maxChildW + PANEL_PAD_X * 2));
  const panelH = contentH + PANEL_PAD_Y * 2;
  const bg = scene.add.graphics();
  bg.fillStyle(COLOR_PANEL, PANEL_FILL_ALPHA);
  bg.fillRoundedRect(-panelW / 2, -PANEL_PAD_Y, panelW, panelH, PANEL_RADIUS);
  bg.lineStyle(1, COLOR_PANEL_BORDER, PANEL_BORDER_ALPHA);
  bg.strokeRoundedRect(-panelW / 2, -PANEL_PAD_Y, panelW, panelH, PANEL_RADIUS);
  container.addAt(bg, 0);
}
