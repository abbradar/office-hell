import type Phaser from 'phaser';
import { ENDING_LOOP_KEY, ENDING_OPENING_KEY } from '../../audio/keys';
import { stopMusicLoop } from '../../audio/music/loop';
import { GAME_H, GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo } from '../../script/patterns';
import { markWave, startMusicWithIntro, waitSeconds } from '../../script/stage';
import type { ScriptYield } from '../../script/types';
import { FONT_DEBUG, FONT_DIALOGUE_LG, FONT_MENU, FONT_TITLE } from '../../ui/fonts';
import {
  COLOR_ACCENT_GOLD_STR,
  COLOR_TEXT_DIM_STR,
  COLOR_TEXT_MUTED_STR,
  COLOR_TEXT_PRIMARY_STR,
} from '../../ui/palette';
import { SECTIONS, type Section } from '../credits';

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

// Where the section text appears on screen. Player is on the far left
// during the roll, so place the credits centred horizontally — the
// player and the text don't overlap.
const SECTION_X = GAME_W / 2;
const SECTION_Y = GAME_H * 0.5;
// Rough wrap width for the body paragraph (AI disclosure). Leaves
// margin from each wall.
const BODY_WRAP = GAME_W * 0.75;
// Per-row vertical spacing inside a section's stack.
const HEADING_TO_FIRST_ENTRY = 22;
const ENTRY_TO_SUB = 14;
const SUB_TO_NEXT = 16;
const ENTRY_SOLO = 4;

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

  // Phase 1 — walk into the corridor centre.
  yield* moveTo(player, CENTER_X, CENTER_Y, WALK_SPEED);
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
  // `untilMusicTime` schedules a single resume at the target audio
  // time; if the user lingered through the dialogs and we're already
  // past it, the wait resolves immediately and we move on without a
  // visible stutter.
  yield { untilMusicTime: TRACK_TAIL_S };

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

// Render a credits section into a Container, then offset the container
// vertically so the rendered stack is centred on (cx, cy). Reused per
// section because the widths differ (mostly the body paragraph) and a
// single fixed layout would either crop or float.
function renderSection(scene: Phaser.Scene, section: Section, cx: number, cy: number): Phaser.GameObjects.Container {
  const container = scene.add.container(cx, 0).setDepth(50);

  let cursor = 0;
  const heading = scene.add
    .text(0, cursor, section.heading, { ...FONT_MENU, color: COLOR_ACCENT_GOLD_STR })
    .setOrigin(0.5, 0);
  container.add(heading);
  cursor += HEADING_TO_FIRST_ENTRY;

  for (const entry of section.entries ?? []) {
    const name = scene.add
      .text(0, cursor, entry.name, { ...FONT_DIALOGUE_LG, color: COLOR_TEXT_PRIMARY_STR })
      .setOrigin(0.5, 0);
    container.add(name);
    if (entry.url) {
      cursor += ENTRY_TO_SUB;
      const url = scene.add.text(0, cursor, entry.url, { ...FONT_DEBUG, color: COLOR_TEXT_DIM_STR }).setOrigin(0.5, 0);
      container.add(url);
      cursor += SUB_TO_NEXT;
    } else if (entry.role) {
      cursor += ENTRY_TO_SUB;
      const role = scene.add
        .text(0, cursor, entry.role, { ...FONT_DEBUG, color: COLOR_TEXT_DIM_STR })
        .setOrigin(0.5, 0);
      container.add(role);
      cursor += SUB_TO_NEXT;
    } else {
      cursor += SUB_TO_NEXT - ENTRY_SOLO;
    }
  }

  if (section.body) {
    const body = scene.add
      .text(0, cursor, section.body, {
        ...FONT_DEBUG,
        color: COLOR_TEXT_MUTED_STR,
        align: 'center',
        wordWrap: { width: BODY_WRAP },
      })
      .setOrigin(0.5, 0);
    container.add(body);
    cursor += body.height;
  }

  // Centre the rendered stack vertically around (cx, cy).
  container.y = cy - cursor / 2;
  return container;
}
