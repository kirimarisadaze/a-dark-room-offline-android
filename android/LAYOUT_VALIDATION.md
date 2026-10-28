# Final mobile layout verification

Reviewed the final generated assets at android/app/src/main/assets/game using offline Chromium. A virtual HTTPS route fulfilled every request from those local files. No Android emulator or physical handset was available for this review.

## Coverage

Five viewport/font combinations: 320×512 at 16px and 22px, 360×584 at 16px and 22px, and 412×800 at 16px. Eight populated late-game scenes per combination produce 40 measured scenarios and 50 screenshots including lower-scroll views. Covered village workers, path equipment, fabricator/blueprints, room build/craft/buy, save dialog, actual export/import code textareas, and combat with six attack actions plus five healing/defence actions. Reference details were all expanded. Worker/resource values of 1000 and population 20000 exercised quantity width.

## Results

All 40 scenarios pass measured checks: no JavaScript errors, document horizontal overflow, horizontally offscreen controls, row-label/quantity collisions, quantity/control collisions, or overlapping row controls. Export/import textareas stay inside the dialog and preserve their own selectable scrolling.

Every combat viewport keeps all five healing/defence controls inside the visible dialog. Attacks occupy a separate scrolling area; at 320×512 with 22px text its second row requires scrolling that area. The combat description also has its own capped scrolling area. HP and fighter labels remain below the description without collision, including the maximum font. Fixed dimensions previously caused description/HP overlap; final natural fighter height resolves it.

Inspected final combat screenshots at 320×512/16px, 320×512/22px and 360×584/22px, together with populated workers, path and save-code screenshots. mobile.css and zh-cn-extra.js each match their generated asset copy by SHA-256.

## Translation verification

zh-cn-extra.js contains 263 entries. All 1,029 extracted literal translation keys are covered; all 786 existing upstream dictionary outputs remain unchanged. Raw combat status outputs for venomous, energised, enraged, meditation, shield and boost resolve to Chinese through both text/html setters. Getter/callback behavior, damage numbers, map glyphs and placeholders are preserved. See ../zh-validation.json and ../validate-zh.mjs.

## Evidence

report.json contains geometry, errors, fighter/notification bounds and control bounds. analysis.json contains all automated comparisons. Screenshots use scene-viewport-font filenames. ../review.mjs reproduces the render, and ../analyze.mjs evaluates recorded bounds. Earlier ../review.md describes the superseded baseline and must not be treated as current behavior.

## 1.0.6 refresh (2026-10-28)

Reran all 40 populated scenarios and geometry analysis after unifying the header, inventory, action and settings styles. All passed. Separately inspected 12 day/night inventory cases, including persisted night mode and 22px text. Header left borders and text underlining stay absent, inventory frames do not reappear after dark.css loads, and item names never overlap their right-aligned quantities. Reports remain in .local/layout-review/final/ and .local/ui-v106/.

## 1.0.7 refresh (2026-10-28)

All 40 late-game scenes and geometry checks passed again. The additional reproducible `scripts/test-mobile-features.mjs` covers 25 dynamic layout cases, including actual first building/first hut/new job creation, 10-digit inventory quantities, day/night and 16/22px text at 320/360/412px. Actions stay before village data; buildings, population, workers and shared inventory have stable separate positions. The Chinese stylesheet's fixed outside-button width is overridden by the action grid. Inventory uses compact two-column rows and Chinese large-number abbreviations. No horizontal overflow or name/quantity collisions were found. Real vertical scrolling and worker input passed.

Visually inspected forest actions and compact inventory at 360px/16px, developed village at 320px/22px in night mode, the large-count inventory, and the expanded cheat settings. The long settings sheet keeps its heading and close control visible during scrolling; game tooltips stay below the fixed bottom bar. Evidence is in `.local/mobile-features/` and the updated `.local/layout-review/final/`.

## 1.0.8 refresh (2026-10-28)

Forty developed scenes, 25 dynamic mobile cases and 21 new detail geometry cases pass. The detail test at 320/360/412px verifies material cards, small/large text, workforce labels/counts/visible controls, and day/night colors. Both event and message-history panels are centered in both axes. Combat retains its capped full-height layout and visible healing controls; long import/export textareas remain contained. Visually reviewed the night materials, selected speed/checkbox marks, centered story message, and village management at 16px/22px. See `.local/ui-details/` and `scripts/test-ui-details.mjs` for reproducible screenshots, actual allocation/build actions and measurements.

## 1.0.9 refresh (2026-10-28)

Material actions now use one compact horizontal row per item. Resource names,
required counts and shortages occupy fixed columns, with space reserved for the
original material rows after completion. Tests compare every card's exact
dimensions across complete, missing, sufficient and real last-hut purchases.
Workforce statistics, the management panel and profession rows have no internal
rules; spacing distinguishes the jobs and their production. Adjustment targets
measure 44×44px. Room categories can fold to shorten the completed building list.

The new reproducible `scripts/test-late-game-ui.mjs` uses 80 people and all nine
assignable professions, all blueprints, advanced weapons and an expedition within
the real carrying limit. Eight day/night/viewport/font configurations cover 88
scenes, including actual scrolling and touch actions, repeated job allocation,
material changes, folded categories, long outfitting, fabrication, ship upgrades,
the world and combat. Every case passes. Inventory names stay on one line through
responsive columns. Item tooltips are replaced by inline damage/weight/available
text, and capacity remains visible during lower equipment adjustments. Existing
40 stress scenarios and their geometry analysis pass as well.

Visually inspected final 320px/22px night workforce, equipment, inventory and
combat, plus 360px/16px materials and folded room categories. The smallest combat
still scrolls attack actions independently while retaining all healing controls.
Evidence is in `.local/late-game-ui/` and `.local/ui-details/`. All rendering and
touch checks use offline Chromium, not a physical handset.

## 1.0.10 refresh (2026-10-28)

Exploration uses a three-by-three cross with 52px direction keys, reduced to
44px for short viewports. Pressed keys follow the current theme. Nearby glyphs
are 20px, supplies are compact unframed text, and map height follows the actual
top of the controls. The overview scrolls within the same map area. Real holds,
direction changes, cancellation and modal opening are tested alongside geometry.

Loot no longer inherits the full combat height. Each row presents a name/count,
a single-item or replacement action and a group action. Capacity and whole-list
collection are separate from the exits. Full backpacks open replacement choices
inline below the relevant item. Long contents scroll above a footer that keeps
continue/leave visible. Post-victory recovery uses compact labels above the exit;
a single exit spans the available width. Day/night and maximum-font screenshots
were reviewed on the smallest supported test viewport.

`scripts/test-exploration-ui.mjs` passes all 72 cases across four viewport/font
combinations and both themes, including actual collection, replacement, continued
exploration and combat victory. Its report and screenshots are under
`.local/exploration-ui/`. Existing 88 later-game, 25 dynamic mobile and 21 detail
cases also pass for this release. Rendering and touch input were checked with
offline Chromium; no physical Android rendering claim is made.

## 1.0.11 refresh (2026-10-28)

Combat uses a centered content-sized popup with a maximum width of 460px. Attack
and recovery sections use adjacent two-column grids; a lone action spans its
row. The action labels cap at 18px and targets measure 48px, reduced to at least
44px on short screens. Multi-weapon attacks scroll independently when space is
limited. Both fighters keep their natural height so their HP and glyphs remain
visible. Notifications retain their own capped scrolling. Background directions
hide throughout an event and restore on closing it.

The new `scripts/test-combat-ui.mjs` passes 50 scene/viewport/theme cases,
including real fire, healing, ammunition exhaustion and the fallback punch.
Simple fights remain at most 420px tall, with the main action below 45% of the
screen height. Small-screen many-weapon cases keep all five recovery/defence
actions visible. Screenshots and measurements are in `.local/combat-ui/`.
Existing 88 later-game and 72 exploration/loot cases also pass for this release.
These are offline browser results; the new rendering has not been tested on a handset.

## 1.0.12 refresh (2026-10-28)

The full-map cheat occupies its own settings row with a short persistent-state
explanation and status feedback. Before exploration unlocks it stays disabled.
The map toolbar fits both overview and guide controls at 320px, with at least
44px-high targets. The map still ends above the cross-shaped direction controls.

The landmark reference is a centered sheet with the existing sticky heading and
close control. It groups twenty symbols with Chinese names, descriptions and
current visible counts; counts stay hidden before a map exists. Text and symbols
can be searched without moving the player behind the sheet. Unmatched searches
show a clear empty result. Long descriptions wrap inside their column and the
reference scrolls independently, including at 320px/22px in night mode.

The new reproducible `scripts/test-map-guide.mjs` passes 48 cases across four
viewport/font combinations and both themes. The 72 exploration/loot, 50 combat
and 25 mobile-feature cases also pass for this release. Visual evidence and
measurements are retained in `.local/map-guide/`; checks use offline Chromium.
