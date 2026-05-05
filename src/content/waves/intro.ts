import { shoot } from '../../audio/sfx/events';
import { GAME_W } from '../../config';
import type { Entity } from '../../entities/Entity';
import { moveTo, walkOffScreen } from '../../script/patterns';
import { waitSeconds } from '../../script/stage';
import type { ScriptYield } from '../../script/types';
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

  // Bubble runs concurrently with the email descent so the player reads it
  // while moving. Then unlock controls so they can actually dodge.
  yield self.dialogue({
    left: { sprite: ch.sprite, frame: ch.frame, name: ch.name },
    lines: [{ speaker: 'left', text: 'I really need to *dodge* this bullshit.' }],
  });
  p.controlsEnabled = true;

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

  // Free bomb — sweeps the email (and anything else lingering) toward the bin.
  // The bomb's own random barker plays via player.say, which sells the
  // "getting angry" beat we just dropped. Wait the full bomb duration so the
  // bin has dismissed and the field is genuinely settled before the next
  // dialog.
  activateBomb(p, self.stage, { barkIndex: 0 });
  yield* waitSeconds(BOMB_DURATION_MS / 1000);

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

  // Bombs and shooting become available — the HUD glyph appears as soon
  // as we re-render.
  p.kind.bombs = PLAYER_BOMBS;
  p.firingEnabled = true;
  p.render();
}
