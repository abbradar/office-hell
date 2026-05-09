import Phaser from 'phaser';
import { shoot } from '../../audio/sfx/events';
import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { isTouchDevice } from '../../input/device';
import { moveTo, walkOffScreen } from '../../script/patterns';
import { clearScreen, race, suspendRunning, waitSeconds } from '../../script/stage';
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
// Two-line layout keeps icons on their own row above the action label so
// keys read at full size without crowding the text.
const ARROW_TEMPLATE = isTouchDevice ? 'TAP ◀ ▶\nTO DODGE' : '<moveHorizontal>\nDODGE!';
const BOMB_TEMPLATE = isTouchDevice ? 'TAP ✱\nTO GET ANGRY' : '<bomb>\nGET ANGRY!';
const FIRE_TEMPLATE = '<fire>\nFIRE EXCUSES!';
// Side prompt that appears for repeat players: spend a bomb to skip the
// rest of the tutorial.
const SKIP_TEMPLATE = isTouchDevice ? 'TAP ✱\nSKIP' : '<bomb>\nSKIP';

// Persisted in localStorage so we only offer the skip after the player
// has actually finished the tutorial at least once. Skipping does NOT
// set the flag — a first run that's skipped wouldn't have taught
// anything, so the offer stays hidden until they sit through it.
const INTRO_COMPLETED_KEY = 'office-hell:intro-completed';

function hasCompletedIntro(): boolean {
  try {
    return window.localStorage.getItem(INTRO_COMPLETED_KEY) === '1';
  } catch {
    return false;
  }
}

function markIntroCompleted(): void {
  try {
    window.localStorage.setItem(INTRO_COMPLETED_KEY, '1');
  } catch {
    // localStorage unavailable (private mode, quota, etc.) — silently
    // skip; worst case the player sees the tutorial again next time.
  }
}

type TutorialKind = 'arrows' | 'bomb' | 'fire';

// Show a tutorial bubble, freeze physics, and yield until the player
// presses the matching input. Doesn't touch `stage.paused` — that would
// also stop the script we're polling from, so instead we pause physics
// directly (bullets / the email freeze in place) and read input through
// `key.isDown` / the touch helpers each frame. Player.controlUpdate keeps
// running on the arrows prompt, which is fine: a held arrow during the
// freeze just sets the body's velocity, then physics integrates it the
// moment we resume. For bomb / fire prompts we lock controls and zero
// velocity so left/right doesn't flip the run-anim direction while the
// player is supposed to be standing still.
//
// The body is wrapped in try/finally so a parent racer (the intro skip
// poll) cancelling this generator mid-prompt still tears down the bubble,
// resumes physics, and unlocks controls — without it, the scene would be
// left frozen with an orphan bubble drawn on screen.
function* tutorialPrompt(self: Entity, template: string, kind: TutorialKind): Generator<ScriptYield, void, void> {
  const scene = self.scene;
  const player = self.stage.player;
  scene.physics.pause();
  const dismiss = showTutorialBubble(scene, template);

  const lockMovement = kind !== 'arrows';
  if (lockMovement) player.lockControls();

  const kb = scene.input.keyboard;
  if (!kb) throw new Error('keyboard input plugin missing');

  try {
    // Polling loops use script-frame yields so they keep ticking through
    // the `physics.pause()` above — physics-frame yields would freeze
    // alongside the world and the prompt would never see the keypress.
    if (kind === 'arrows') {
      const left = kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
      const right = kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
      while (!(left.isDown || right.isDown || scene.isLeftHeld() || scene.isRightHeld())) yield { scriptFrames: 1 };
    } else if (kind === 'bomb') {
      const bombKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.X);
      // consumeBombPress is edge-triggered (drains the bomb-tap queue), so
      // a touch tap registers exactly once; the keyboard side uses isDown
      // for held-key tolerance.
      while (!(bombKey.isDown || scene.consumeBombPress())) yield { scriptFrames: 1 };
    } else {
      const fireKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
      // Z also dismisses dialogues, so the press that just closed the
      // preceding line typically arrives here still down. Wait for a
      // release before arming the wait — otherwise the prompt would
      // resolve on the same keypress and never visibly pause the player.
      while (fireKey.isDown) yield { scriptFrames: 1 };
      while (!fireKey.isDown) yield { scriptFrames: 1 };
    }
  } finally {
    if (lockMovement) player.unlockControls();
    dismiss();
    scene.physics.resume();
  }
}

// Poll for the bomb input (X / touch tap) until detected. Uses
// `realSeconds` rather than scriptFrames so the poll keeps ticking
// through dialogue freezes — otherwise an X press during a cutscene
// line would only register after the player advanced the dialog.
// Keydown event captures short taps that .isDown polling would miss
// when the press happens between two poll fires.
function* bombSkipPoll(self: Entity): Generator<ScriptYield, void, void> {
  const scene = self.scene;
  const kb = scene.input.keyboard;
  if (!kb) return;
  const bombKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.X);
  let pressed = false;
  const onX = (): void => {
    pressed = true;
  };
  kb.on('keydown-X', onX);
  try {
    while (!pressed && !scene.consumeBombPress()) {
      yield { realSeconds: 0.05 };
    }
  } finally {
    kb.off('keydown-X', onX);
    // The keydown event above sees the press but doesn't clear Phaser's
    // _justDown flag. Without this drain, Player.controlUpdate would read
    // it on the next frame (after controls + bombs unlock) and fire a
    // bomb on the same X press the player used to skip the intro.
    Phaser.Input.Keyboard.JustDown(bombKey);
  }
}

// Everything from the first MC monologue through the "I'm getting angry"
// beat — the part of the intro the skip can preempt. Stops just before
// the bomb tutorial: from there the player is committed (the email is
// closing, only a bomb clears the field).
function* skippableIntroBody(self: Entity): Generator<ScriptYield, void, void> {
  const p = self.stage.player;
  const ch = p.character;

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
  p.unlockControls();
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
}

// Bomb tutorial through fire tutorial — the closing half of the intro.
// Runs only when the player let the skippable section finish naturally.
function* postBombIntroBody(self: Entity): Generator<ScriptYield, void, void> {
  const p = self.stage.player;
  const ch = p.character;

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
}

export function* introMonologue(self: Entity): Generator<ScriptYield, void, void> {
  // The whole intro plants the MC + halts the corridor: the coach is
  // spawned un-hittable (so she's not in `damagedBy.enemy` and can't
  // drive the running flag on her own), the email is a projectile not
  // an enemy, and tutorial bubbles freeze physics. Wrap the lot in
  // `suspendRunning` so the corridor sits still until we hand back at
  // the end. `waitEnemiesClear` afterwards is a no-op (no enemies in
  // the group ever).
  yield* suspendRunning(self, function* () {
    // Lock the player out for the whole intro — the lead-in beat plus dialogue.
    // controlUpdate runs after stage.update, so this disable lands before any
    // input or auto-fire executes this frame. Re-enabled on the way out so the
    // first wave plays normally.
    const p = self.stage.player;
    p.lockControls();
    // Shooting stays off through the dodge window too — the player can move
    // to evade the email but can't fire back until the bomb tutorial has
    // unlocked their kit. Re-enabled together with bombs at the end.
    p.firingEnabled = false;

    const offerSkip = hasCompletedIntro();
    let dismissSkipBubble: (() => void) | null = null;
    if (offerSkip) {
      dismissSkipBubble = showTutorialBubble(self.scene, SKIP_TEMPLATE, { pos: 'right' });
    }

    let skipped = false;
    try {
      if (offerSkip) {
        // Race the skippable body against the bomb-input poll. The poll
        // sets `skipped` only when it finishes naturally (i.e. wins);
        // a race-loss tears it down via its own try/finally without
        // running the post-yield assignment.
        yield* race(
          skippableIntroBody(self),
          (function* () {
            yield* bombSkipPoll(self);
            skipped = true;
          })(),
        );
      } else {
        yield* skippableIntroBody(self);
      }
    } finally {
      dismissSkipBubble?.();
    }

    if (skipped) {
      // The skippable body was dropped mid-flight. If it was parked on
      // a dialogue yield, the dialog UI is still showing — tear it down
      // explicitly (cancel runs the same teardown a Z press would,
      // including the freeze release). Then sweep the half-finished
      // spawns (the coach, the in-flight email) so the first wave
      // doesn't inherit them.
      if (self.stage.dialogue.isActive()) self.stage.dialogue.cancel();
      clearScreen(self);
    } else {
      yield* postBombIntroBody(self);
    }

    // Common end-of-intro state. Fire + bombs unlock; restoring
    // `running` here lets the corridor pick up scrolling immediately so
    // the first wave's `alignDoor` finds its slot promptly. (Without
    // this, alignDoor would loop on a frozen door cycle until timeWave's
    // 9-second budget expired — readable as a long pause when the intro
    // is skipped, harder to notice after a natural finish where the
    // bomb tutorial and fire prompt fill the same window.)
    p.firingEnabled = true;
    p.kind.bombs = PLAYER_BOMBS;
    p.render();
    p.unlockControls();
    self.stage.running = true;

    // Only mark the intro completed on a natural finish — skipping a
    // first-time run shouldn't unlock the skip option for the next one
    // (it would silently bypass the tutorial forever).
    if (!skipped) markIntroCompleted();
  });
}
