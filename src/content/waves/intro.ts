import Phaser from 'phaser';
import { shoot } from '../../audio/sfx/events';
import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { isTouchDevice } from '../../input/device';
import { consumeBombPress, isLeftHeld, isRightHeld } from '../../input/touch';
import { moveTo, walkOffScreen } from '../../script/patterns';
import { waitSeconds } from '../../script/stage';
import type { ScriptYield } from '../../script/types';
import { showTutorialBubble } from '../../ui/tutorialBubble';
import { activateBomb, BOMB_DURATION_MS } from '../bomb';
import { PLAYER_BOMBS } from '../player';
import { emailBullet } from './checkEmail';
import { wellnessCoach } from './wellnessCoach';

const COACH_INTRO_Y = 110;
const COACH_INTRO_SPEED = 110;
const COACH_EMAIL_SPEED = 120;
const COACH_EXIT_SPEED = 160;
// How close (px above the player's y) the email is allowed to get before
// the "getting angry" beat fires. Larger than the player+email combined
// hitbox (4 + 6 = 10) so moveTo's halt-and-snap leaves a visible gap and
// the email never actually clips the player while the bomb beat plays.
const EMAIL_NEAR_MARGIN = 16;

// Tutorial bubble templates. Touch sessions get plain text — the touch
// icon map is intentionally empty (see ui/inputIcons.ts) so a `<bomb>`
// token would render as `[bomb]`, which is worse than nothing.
const ARROW_TEMPLATE = isTouchDevice ? 'TAP ◀ ▶ TO DODGE' : '<moveHorizontal>  DODGE!';
const BOMB_TEMPLATE = isTouchDevice ? 'TAP ✱ TO GET ANGRY' : '<bomb>  GET ANGRY!';
const FIRE_TEMPLATE = '<fire>  FIRE EXCUSES!';

type TutorialKind = 'arrows' | 'bomb' | 'fire';

// Show a tutorial bubble, freeze physics, and yield until the player
// presses the matching input. Doesn't touch `stage.paused` — that would
// also stop the script we're polling from, so instead we pause physics
// directly (bullets / the email freeze in place) and read input through
// `key.isDown` / the touch helpers each frame. Player.controlUpdate keeps
// running, which is fine: a held arrow during the freeze just sets the
// body's velocity, then physics integrates it the moment we resume.
function* tutorialPrompt(self: Entity, template: string, kind: TutorialKind): Generator<ScriptYield, void, void> {
  const scene = self.scene;
  scene.physics.pause();
  const dismiss = showTutorialBubble(scene, template);

  const kb = scene.input.keyboard;
  if (!kb) throw new Error('keyboard input plugin missing');

  if (kind === 'arrows') {
    const left = kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    const right = kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
    while (!(left.isDown || right.isDown || isLeftHeld() || isRightHeld())) yield 1;
  } else if (kind === 'bomb') {
    const bombKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.X);
    // consumeBombPress is edge-triggered (drains the bomb-tap queue), so
    // a touch tap registers exactly once; the keyboard side uses isDown
    // for held-key tolerance.
    while (!(bombKey.isDown || consumeBombPress())) yield 1;
  } else {
    const fireKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    // Z also dismisses dialogues, so the press that just closed the
    // preceding line typically arrives here still down. Wait for a
    // release before arming the wait — otherwise the prompt would
    // resolve on the same keypress and never visibly pause the player.
    while (fireKey.isDown) yield 1;
    while (!fireKey.isDown) yield 1;
  }

  dismiss();
  scene.physics.resume();
}

export function* introMonologue(self: Entity): Generator<ScriptYield, void, void> {
  // Lock the player out for the whole intro — the lead-in beat plus dialogue.
  // controlUpdate runs after stage.update, so this disable lands before any
  // input or auto-fire executes this frame. Re-enabled on the way out so the
  // first wave plays normally.
  const p = self.stage.player;
  const ch = p.character;
  p.controlsEnabled = false;
  // Shooting stays off through the dodge window too — the player can move
  // to evade the email but can't fire back until the bomb tutorial has
  // unlocked their kit. Re-enabled together with bombs at the end.
  p.firingEnabled = false;

  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    lines: [
      {
        speaker: 'left',
        text: '8:47 PM. The AC will forcefully turn off in 10 minutes.',
      },
      {
        speaker: 'left',
        text: "Okay. Tonight I'm leaving before I have a heatstroke. I mean it this time.",
      },
      { speaker: 'left', text: '…how hard can it be.' },
    ],
  });

  // Spawn scriptless and drive the coach from here — keeps the email
  // reference local and dodges the closure-narrowing dance.
  const coach = self.spawn(wellnessCoach, GAME_W / 2, -30, 0, 0, {
    damagedByClass: [],
    script: null,
  });
  yield* moveTo(coach, GAME_W / 2, COACH_INTRO_Y, COACH_INTRO_SPEED);
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    right: { sprite: 'coach1', frame: 1, name: 'Coach Becky' },
    lines: [
      {
        speaker: 'right',
        text: `Hey ${ch.name}, I'm from the wellness department!\nCan you drop by later?`,
      },
      {
        speaker: 'right',
        text: "I've sent you an email with the details.",
      },
    ],
  });
  const [vx, vy] = coach.vectorToPlayer(COACH_EMAIL_SPEED);
  const email = self.spawn(emailBullet, coach.x, coach.y, vx, vy);
  shoot();
  // Walk her back out the way she came; wait for the off-screen cull.
  yield* walkOffScreen(coach, 0, -COACH_EXIT_SPEED);

  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    lines: [{ speaker: 'left', text: 'I really need to *dodge* this bullshit.' }],
  });

  // Dodge tutorial: enable controls first so the freeze ends with the
  // player already in command — pressing arrow during the prompt sets
  // their velocity (controlUpdate keeps running) and physics integrates
  // it the instant the prompt's wait resolves.
  p.controlsEnabled = true;
  yield* tutorialPrompt(self, ARROW_TEMPLATE, 'arrows');

  // Stop the email *just* before it would hit — moveTo halts and snaps
  // it to a position above the player, so the "getting angry" dialog
  // pauses physics with the email frozen close but not touching. The
  // bomb radius (≥ GAME_W/2) guarantees it gets swept regardless of how
  // far the player dodged sideways.
  yield* moveTo(email, email.x, p.y - EMAIL_NEAR_MARGIN, COACH_EMAIL_SPEED);

  // The dialog itself pauses physics + input — no need to flip
  // controlsEnabled around it.
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    lines: [
      {
        speaker: 'left',
        text: "I can't take this anymore, I'm getting *angry*!",
      },
    ],
  });

  // Bomb tutorial. The bomb itself fires script-side after the prompt:
  // bombs are still locked (kind.bombs = 0) until the very end of the
  // intro, so even if the player's X press is also picked up by
  // controlUpdate it no-ops there. activateBomb's barkIndex=0 keeps the
  // line predictable so it pairs with the angry beat we just dropped;
  // wait the full bomb duration so the bin has dismissed and the field
  // is genuinely settled before the next dialog.
  yield* tutorialPrompt(self, BOMB_TEMPLATE, 'bomb');
  activateBomb(p, self.stage, { barkIndex: 0 });
  yield* waitSeconds(BOMB_DURATION_MS / 1000 + 1);

  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    lines: [
      {
        speaker: 'left',
        text: "I can't do this too often or the HRs get involved.",
      },
      { speaker: 'left', text: 'Better just *fire* some *excuses.*' },
    ],
  });

  // Fire tutorial only on keyboard — touch auto-fires (Player.controlUpdate
  // gates `firing` on isTouchDevice || fireKey.isDown), so there's no
  // discrete press to teach. Firing stays disabled across the prompt: the
  // Z that just dismissed the preceding dialog is typically still held,
  // and we don't want it to spawn bullets behind the bubble. The
  // tutorialPrompt's fire branch waits for a release before arming the
  // press detector, so the prompt resolves on a fresh keypress; we then
  // flip firingEnabled true so the first bullet lands the moment the
  // bubble disappears.
  if (!isTouchDevice) {
    yield* tutorialPrompt(self, FIRE_TEMPLATE, 'fire');
  }
  p.firingEnabled = true;

  // Bombs become available — the HUD glyph appears as soon as we re-render.
  p.kind.bombs = PLAYER_BOMBS;
  p.render();
}
