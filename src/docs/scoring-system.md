# Scoring system

A score × multiplier model with a kill-driven chain, a "come up to claim"
collection zone, and a Cave-style point-blank bonus on top. The goal is
that a 10-minute run's score reflects how the player *played* — risk
positioning, kill continuity, no-miss streaks — not just whether they
finished it.

This doc covers the data model, every score source, the chain mechanic,
the multiplier-drop pipeline, the HUD readout, and the reset semantics
on hit vs. continue.

---

## Design goals

- **Reward aggression and positioning.** Sitting at the bottom should be
  the lowest-scoring playstyle, not the safest path to a record.
- **Make multiplier earned, not lucky.** Mult comes from a chain the
  player builds and protects; drops are a small stabiliser, not the
  primary lever.
- **Single visible number trail.** Score + mult are the only
  scoreboard-facing values. Internal state (chain timer, floor, etc.)
  is debug-only.
- **Stay fair through dialogue-heavy waves.** Chain timer freezes when
  the simulation is paused, so a 30-second cutscene doesn't murder a
  12× chain.
- **Distinguish a hit from a continue.** A single hit costs the chain
  but preserves the score. A continue wipes the whole run's score back
  to 0 — the scoreboard reflects "untainted" runs only.

---

## Data model

Lives on `GameScore` in [src/script/score.ts](../script/score.ts):

```ts
score: number = 0;        // base points (alive + kills, after × mult)
mult: number = 1;         // current multiplier (chain-driven)
multFloor: number = 1;    // baseline mult never decays below this run
chainTimer: number = 0;   // frames remaining before chain breaks
```

`displayedScore = score` (the value is already accumulated through
`× mult` at each increment — no re-multiplication at render time).

All four fields reset to their defaults in `GameScore` construction,
which fires every time `StageManager` is rebuilt — i.e. every fresh
scene start.

---

## Score sources

Every score increment is `floor(base × mult)` added to `score`. The four
sources:

| Source | Base | Trigger |
|---|---|---|
| Alive tick | +1 | Every 6 frames (= 0.1 s @ 60 fps) while `!stage.paused` |
| Regular enemy kill | +10 | `EntityKind` with `tier === 'regular'` (default) dies |
| Mini-boss kill | +200 | `EntityKind` with `tier === 'miniBoss'` dies |
| Boss kill | +2000 | `BossKind` (sets `tier: 'boss'` in constructor) dies |

Bases are **chosen large enough that kills dominate idling** at any
non-degenerate chain length. At chain 1× and a 10-minute clear, the
alive tick banks ~6,000; a competent run with ~200 kills at average
chain 4× lands ~8,000 just from regular kills. Bosses, mini-bosses, and
point-blanks push that well above 20,000.

### Point-blank bonus

If the killing hit landed within **40 logical px** of the dying enemy's
center, multiply that kill's base by **1.5×** before the `× mult` pass.
Distance is sampled at the moment HP hits 0, between `stage.player`
and the dying entity.

Office-thematic flavour: "lean over the cubicle wall." Mechanically
it's Crimzon Clover's break-star bonus — gives positioning a score
expression beyond pure survival.

---

## Chain / multiplier

The mult is driven by a kill chain. Each kill bumps it, a decay timer
breaks it, and pickups can keep it alive through quiet beats.

```
on kill:
  mult = min(MAX_MULT, mult + 1)
  chainTimer = CHAIN_DECAY_FRAMES

every tick (when !stage.paused):
  if chainTimer > 0:
    chainTimer -= 1
  else if mult > multFloor:
    mult = multFloor   // chain break
```

### Tuning knobs

| Constant | Default | Meaning |
|---|---|---|
| `MAX_MULT` | 16 | Hard cap on chain growth. |
| `CHAIN_DECAY_FRAMES` | 120 | 2 s @ 60 fps before a chain breaks. |
| `BASE_MULT` | 1 | Starting floor at run start. |

Cap at 16 is a soft ceiling — high enough to feel rewarding for clean
play, low enough that the HUD digit width stays bounded.

### Reset triggers

| Event | `score` | `mult` | `multFloor` | `chainTimer` |
|---|---|---|---|---|
| Take a hit (any HP loss) | unchanged | → 1 | unchanged | → 0 |
| Continue used | → 0 | → 1 | → 1 | → 0 |
| New stage / new run | → 0 | → 1 | → 1 | → 0 |

**A hit resets the chain but preserves the score.** The mult floor is
*kept* — drops the player has already collected stay banked. This means
the chain is a "no-hit streak" mechanic, but the floor is a "won the
boss" mechanic.

**A continue wipes everything.** Score, mult, floor — full reset.
Continues are the scoreboard penalty.

---

## Multiplier drops

Each wave drops exactly one mult orb on a random enemy. Tier-tagged so
the player sees an obvious reward gradient for the heavier encounters.

### Drop values

| Wave tier | Floor bump | When the orb is collected |
|---|---|---|
| Regular | +0 floor, refills chain timer | Chain timer refreshes to full |
| Mini-boss | +1 floor, refills chain timer | Floor lifts, can't decay back below |
| Boss | +2 floor, refills chain timer | Same, larger floor lift |

The floor lift is what stretches a great boss kill into the *next*
wave's opening — the chain dies but the multiplier doesn't fall back
all the way to 1.

### Visual

Green square, 8×8 px, runtime-generated texture. Placeholder for v1 —
replace with an asset when the rest of the art pass arrives.

### Spawn pipeline

Waves are inline generators; there's no wave-level entry/exit hook.
A wave script picks one place in its body to call:

```ts
stage.scheduleMultDrop('regular' | 'miniBoss' | 'boss');
```

The helper:

1. Samples one currently-live enemy from `damages.player` with
   `hp != null`.
2. Attaches `entity.dropOnDeath = { tier, value }` to that entity.
3. On `Entity.die()`, if `dropOnDeath` is set, spawns a `multDrop`
   entity at `(self.x, self.y)` with a gentle downward drift before
   clearing the flag.
4. **Fallback** when no enemy is live (timing edge): drop spawns
   immediately at the field's top-center with the same drift.

Boss waves only spawn one enemy (the boss), so the random sample is
deterministic — boss always carries the drop.

### Drop entity

New `multDropKind` (subclass of `EntityKind` to carry the `value`
field) in [src/content/kinds.ts](../content/kinds.ts):

```
sprite:         green-square (runtime texture)
hitboxRadius:   4
hp:             null
damageClass:    []
damagedByClass: []
multValue:      1 | 2 | varies by tier
```

Lives in its own `stage.drops` physics group so the overlap handler
binds to that group only (doesn't collide with the player's damage
classes).

### Collection

`GameScene.create()` adds:

```ts
this.physics.add.overlap(stage.player, stage.drops, onPickup);
```

`onPickup` reads `kind.multValue` off the drop, applies the
floor + timer changes above, kills the drop, optionally plays a
chime (defer the sound to a later asset pass — `playClick()` is fine
for v1).

### Magnet zone (POC line)

When `player.y < GAME_H × 0.4` (top 40% of the field), every drop in
flight is attracted to the player at `MAGNET_SPEED = 400 px/s`. Below
that line, drops drift down at their natural fall speed and exit via
the cull margin if untouched.

This is the **inverted version of the original draft** — the safe spot
is no longer the most rewarding. The player has to come *up* into the
bullet pattern to claim mult drops, matching Touhou's POC convention.

Magnet logic lives in `StageManager.update`'s entity loop (one branch
per drop, vector-toward-player when y-zone test passes). The check is
per-frame and stateless — drops can drift in and out of the magnet
zone freely if the player moves.

---

## Tier classification

`EntityKind` gains a `tier?: 'regular' | 'miniBoss' | 'boss'` field
(default `'regular'`).

- **Regular** — every `EntityKind` in `src/content/kinds.ts` and the
  per-wave enemy kinds (interns, email-colleagues, etc.). No code
  change needed; the default applies.
- **Mini-boss** — none currently exist. The flag is added so the score
  bonus and drop value are correctly wired *before* mini-bosses ship.
  Hand-mark each mini-boss as you create it.
- **Boss** — `BossKind` constructor sets `tier = 'boss'`. All four
  existing boss kinds (gym bro, wellness coach, shrunk old man, the
  boss) inherit through `BossKind` so they pick this up for free.

---

## HUD readout

Top-right of the existing 28 px header band ([GameScene.ts:305-324](../scenes/GameScene.ts#L305)).
Two `Text` objects, both `setOrigin(1, 0.5)`:

| Element | Anchor | Font | Color |
|---|---|---|---|
| `mult` (e.g. `×12`) | `(GAME_W - 8, HEADER_H / 2)` | `FONT_DIALOGUE_SM` (monogram 16px) | `COLOR_ACCENT_RED_STR` |
| `score` (e.g. `12345`) | left of mult, gap = 6 px | `FONT_DIALOGUE_SM` | `COLOR_TEXT_PRIMARY_STR` (white) |

Both refresh in `GameScene.update` from `stage.score.score` and
`stage.score.mult`. Right-alignment keeps the score column stable as
digit count grows. No commas / thousand-separators in v1 — the
monogram font reads cleanly without them.

---

## Pause / dialogue semantics

When `stage.paused === true` (dialogue, ESC overlay, pre-fight beat):

- Alive tick **does not** increment score.
- Chain timer **does not** decrement.
- Drops in flight **continue** their physics (the body integrator is
  driven by Phaser physics, not the script tick). This is intentional
  — drops shouldn't freeze mid-air visually.

The chain holds through dialogue interruptions, so a wave that ends
with a kill, drops into a 5-second dialogue, then transitions to the
next wave doesn't penalise the player.

---

## Implementation order

1. **Data model + tier flag.** Add `tier?` to `EntityKindOpts` /
   `EntityKind`; `BossKind` constructor sets `'boss'`. Add `score`,
   `mult`, `multFloor`, `chainTimer` to `GameScore`. Verify in the
   existing debug HUD.
2. **Score sources.** Alive tick in `StageManager.update`. Kill
   bonuses + point-blank check at the existing `kills++` site in
   `EntityKind.takeDamage` ([src/script/types.ts:136](../script/types.ts#L136)).
3. **HUD readout.** Two Texts, per-frame update. Visible immediately
   so subsequent work is testable.
4. **Chain mechanic.** Decay timer in `StageManager.update`. Reset
   hooks in `Player.takeDamage` (hit) and the continue path
   ([src/scenes/GameScene.ts:650](../scenes/GameScene.ts#L650)).
5. **Drop entity.** `multDropKind` + green-square texture. `stage.drops`
   group. Spawn one manually from a debug command to confirm.
6. **Collection overlap.** `physics.add.overlap` in `GameScene`.
   Floor + timer side-effects on pickup.
7. **Magnet.** Top-40% zone check in `StageManager.update`'s entity
   loop. Test by parking the player above the line.
8. **`scheduleMultDrop` helper + wave calls.** Boss waves first (4
   files), then regular waves (~14 files), one line each.

Total surface: ~150 lines of new code + ~18 single-line additions in
wave files.

---

## Open follow-ups (deferred from v1)

These come from the genre research but aren't in the v1 scope. Listed
here so they're not lost.

- **Graze channel.** A separate score channel for bullets passing within
  N px of the player (Hellsinker's Spirits, Touhou's graze). Would
  replace or supplement the alive tick once the chain mechanic is
  proven and tuned.
- **Bullet-cancel score.** Pair with bombs — bomb-cancelled bullets pay
  out a per-bullet bonus (Espgaluda Kakusei). Natural extension once
  bomb feel is locked.
- **No-miss / no-continue stage bonus.** Track per-stage `hpLost` and
  `continues` deltas; award a 10–25% bonus at stage transitions.
  Wire into the (future) stage-transition card.
- **TLBs / score-extends.** Hidden goals (clear at chain X with no
  bomb, etc.) that unlock bonus content. Wait until the core is
  shipped.
- **High-score persistence.** `localStorage`-backed best-of, surfaced
  on the menu screen.

---

## References

- [Touhou Wiki — Graze](https://en.touhouwiki.net/wiki/Graze)
- [Maribel Hearn — Scoring FAQ](https://maribelhearn.com/faq/scoring)
- [Shmups Wiki — DoDonPachi](https://shmups.wiki/library/DoDonPachi)
- [Shmups Wiki — Crimzon Clover](https://shmups.wiki/library/Crimzon_Clover)
- [Shmups Wiki — Espgaluda](https://shmups.wiki/library/Espgaluda)
- [ZeroRanger Wiki — Gameplay](https://zeroranger.miraheze.org/wiki/Gameplay)
- [Hardcore Gaming 101 — Hellsinker](https://www.hardcoregaming101.net/hellsinker/)
- [Shmups Wiki — Glossary](https://shmups.wiki/library/Help:Glossary)
