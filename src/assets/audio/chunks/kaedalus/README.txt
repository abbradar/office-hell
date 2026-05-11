Kaedalus chunks — Office Hell
=============================

What is this?
-------------
Sixteen Ogg Vorbis files (1.ogg, 3.ogg, 5.ogg, … 75-f.ogg) cut from a
single track by Kaedalus, "Crack the Underground Base". The game's
stage script plays back the chunks in sequence — each chunk lines up
with a specific encounter beat (intro line, mid-fight escalation,
victory tag, etc.), and the gaps are filled by frame-counted waits
in src/content/kaedalusStage.ts. The numeric prefix matches the
chunk's position in the source timeline; the "-f" suffix marks a
final/finisher chunk.

Why a separate folder?
----------------------
The chunks are *derivative works* of the original track. The
original is licensed CC BY-SA 3.0 — a "ShareAlike" license that
obliges any derivative to be distributed under the same license.
This folder is therefore its own licensing island inside Office
Hell: the rest of the project sits under its own terms, but these
files (and only these files) carry the CC BY-SA 3.0 obligation.

  Original:  "Crack the Underground Base" by Kaedalus (kaedalus.com)
  Source:    https://opengameart.org/content/crack-the-underground-base-action-chipmusicrock
  License:   CC BY-SA 3.0 — see LICENSE.txt next to this file.

If you fork, repackage, or otherwise redistribute the chunks
-------------------------------------------------------------
You must:

  1. Keep the LICENSE.txt file with them (or reproduce its
     attribution + license terms equivalently).
  2. Credit "Kaedalus (kaedalus.com)" as the original author — the
     parenthetical link is the verbatim wording the licensor
     requests, please keep it intact.
  3. License whatever you redistribute under CC BY-SA 3.0.
  4. Indicate the chunks are adaptations, not the original work.

You do not need to credit the Office Hell team for the chunks
themselves — we only re-cut them. A pointer back to this folder
(https://abbradar.itch.io/office-hell or the project's source repo)
is appreciated but not required.

Where attribution appears in the game
-------------------------------------
  - In-game credits roll: src/content/credits.ts → MUSIC section.
  - Itch.io page (https://abbradar.itch.io/office-hell): the
    Credits → Music section names Kaedalus + license.

If you change the source URL, the page link, or how the chunks are
named, update src/content/credits.ts and any prose in the itch.io
description to match.
