# Offline game validation — 2026-10-27

Version 1.0.4 repairs interception of WebView's internal data: startup document.
Android instrumentation against the installed app's actual interceptor passed
all 11 cases, including internal document passthrough, packaged HTML/JS/audio,
missing resources, and denied external/file/traversal requests. The same test
fails on 1.0.3 with HTTP403 for the internal data: URL shown in the user's screenshot.
This test does not construct a graphical WebView; complete gameplay remains
unverified on the Android emulator. Details are in NATIVE_VALIDATION.md.

Run from the repository root with `node scripts/test-offline.mjs` after running
`python scripts/prepare-android-assets.py`. The test finds a local Playwright
installation, or accepts `PLAYWRIGHT_MODULE` with its absolute package directory.
This machine used Playwright 1.64.1 and its cached headless Chromium.

The browser context has networking disabled. Requests for the Android app's exact
virtual origin (`https://appassets.androidplatform.net/game/`) are fulfilled from
the generated APK assets directory. No test HTTP server is started.

All five effective viewport sizes passed: 320×512, 320×568, 360×584, 360×640,
412×915. The shorter viewports also leave room for Android's native toolbar.
Three contexts made 479 local resource requests each and one made 480. The smallest context made
560 requests because it additionally checks night mode and reloads its saved
preference. No external requests, missing assets, or uncaught JavaScript errors
occurred.

Verified in each viewport:

- Android user agent enters the game in Simplified Chinese. Only the `zh_cn`
  translation directory is packaged. An English language URL parameter and an old
  English localStorage preference still launch Chinese; no language selector is
  shown. Visible room, expedition, and flight interfaces contain no English words.
- Tapping the real light-fire control changes game state; reloading preserves it.
- The native restore transaction (`prepareRestore → setItem → reload`) keeps the
  replacement state rather than overwriting it in the outgoing pagehide handler.
- Invalid Base64 save input preserves current progress and leaves saving enabled.
- Exported Base64 saves restore correctly after changing the current progress.
- `cancelRestore` re-enables saving after a failed native restore.
- Font controls change the actual text size, persist it across restart, and enforce
  the 16–22px bounds. The largest font does not cause horizontal page overflow.
- The real expedition control opens the world. A touch direction moves exactly
  one tile and respects the engine's combat/event input lock.
- The nearby map uses 16px characters and centers the player. It follows actual
  movement, can switch to an overview and back, and ignores accidental map taps.
  The current position remains above the menu and clear of the direction controls,
  including the smallest viewport with room reserved for Android's native toolbar.
- The real ship ascent, 700×700 logical canvas, holding/releasing direction
  controls, and on-screen ship/direction-pad bounds work in narrow viewports.
- Simulated native acceleration inputs steer the ship both left and right. Neutral
  input stops drift, the sensor dead zone prevents accidental motion, and touch
  directions override contrary tilt. Sensor input cannot move the expedition map.
- A simulated 65-second WebView timer suspension shifts active jQuery animation
  start times correctly, releases held directions, and does not end the flight.
- The bundled light-fire FLAC decodes into a nonempty AudioBuffer.
- The page does not overflow horizontally.

The 320×512 viewport additionally verifies the real night-mode menu action in
the room and world, the dark settings sheet, and reloading a saved night-mode
preference. The night surface is `rgb(39, 40, 35)` and the text is
`rgb(238, 238, 238)`. The real speed-confirmation event uses matching readable
surface/text colors, both normally and with the engine's `noMask` compatibility
class. Returning to day mode restores a white background. Screenshots of these
five night-mode screens were visually inspected and are saved as
`room-night-320x512.png`, `menu-night-320x512.png`,
`event-night-320x512.png`, `event-night-nomask-320x512.png`, and
`world-night-320x512.png`.

These checks found and verified fixes for an asynchronous first-load dark
stylesheet race and a dark-stylesheet specificity conflict in `noMask` events.

Screenshots were captured after allowing startup transitions to complete and
visually inspected for room (including 22px font), nearby map, overview, and flight
at the narrowest effective sizes.
The detailed machine-readable results are in `browser-report.json` alongside
`room-WIDTHxHEIGHT.png`, `world-WIDTHxHEIGHT.png`, and `space-WIDTHxHEIGHT.png`.

Final tested integration asset SHA-256:

- `offline.js`: `76F85F4D8B4C0E2FE9E7642302F03DCCCD20FAC551BB5EEC89A15D766E369EA4`
- `mobile.css`: `07C09F81330F9B2CD155669E14DC18B32DAE4D6D2F404F32240688468D9482A0`
- `zh-cn-extra.js`: `ADA7ED80E34FB532E5F5236D676FCED79AA4F0400DA4ABB72CA53851819FFB97`

## 1.0.2 startup repair and native test status

The startup HTML is now read with AssetManager and displayed with
loadDataWithBaseURL, keeping the same storage origin and full index.html path.
Import and restart use a native local reload command. A capability/storage check
shows a Chinese native error page when necessary, and prevents Engine.init from
running on an unsupported WebView. This generated engine guard does not modify
upstream source. The final 320×512 browser regression also passed after the guard.

An independent Android 7.0 API24 ARM emulator on port 5582 booted successfully.
The old 1.0.1 APK was installed and reproduced an empty main document in WebView
51, before the game scripts loaded. Updating this test device to WebView 100
succeeded, but its emulator graphics service stalled during that process. A
restart with another renderer was attempted. The repaired 1.0.2 APK has not yet
completed native runtime verification. Browser results above do not establish
that the repaired application runs on an Android device.

The standalone instrumentation harness compiles and signs successfully. Its
runtime checks and test limitations are described in NATIVE_VALIDATION.md.
Investigation evidence is retained in .local/native-api24/ and .local/avd/.

## 1.0.5 close control

Menu and messages close controls no longer receive automatic focus on touch. Symmetric padding and inline flex center the label in a 64×44px target. Offline Chromium inspection at 360×740 in day and night mode measured zero border and outline, zero horizontal text offset and a 0.5px vertical font-metric offset. Keyboard activation still focuses the close control with a visible outline. Screenshots are retained in `.local/ui-close-v105/`. The existing 320×512 offline regression passed after this change, including real open/close actions, save/import, night mode, world and flight input, and audio decoding. This is browser validation of the packaged assets.


## 1.0.6 unified layout and adjustable speed — 2026-10-28

Header tabs, actions, menu controls, dialogs and inventory use a consistent square,
fine-line style. Header selectors and inventory selectors outrank the dynamically
loaded upstream dark stylesheet, so night mode cannot reintroduce a left tab border
or the old inventory frame. The inventory has one collapsible Chinese heading and
aligned name/value rows. Disabled cooldown text and fill use readable theme colors.

All five browser sizes passed the offline functional regression. Forty populated
late-game layout scenarios also passed geometry analysis: no horizontal overflow,
control collisions, hidden healing controls or text area clipping. Twelve targeted
inventory scenes additionally covered day/night, saved night-mode reload, multiple
resources and 16/22px text at 320/360/412px widths. Evidence is in .local/ui-v106/.

Run node scripts/test-speed.mjs for the speed regression. All four real menu choices
persist in the save and schedule actual callbacks at the selected rate. An 800ms
game timeout measured about 801/401/278/206ms at 1/2/3/4x. A pending 1200ms wait
switched from 1x to 4x after 300ms completed in about 539ms, preserving progress.
The real income collector produced four one-second ticks in about one real second.
Repeating and one-shot timers remained cancellable through either browser clear
API, including cancellation inside a callback. The unscaled timer path retained
its duration. A real Button cooldown continued at its current percentage after a
speed change, completed in about 828ms, enabled the action and removed its saved
residual time. Reload retained 4x, old hyper-mode saves migrated to 2x, and invalid
stored/input speeds normalized or were rejected. The report is .local/speed-tests/report.json.

The game timer adapter scales Engine timers and Button cooldowns without globally
speeding audio, touch handling or the flight loop. Generated combat poison/stun
status timers use the same game clock. These are browser results for the packaged
assets; Android rendering was not rerun for this web layout and clock update.

## 1.0.7 village layout, scene gestures and optional cheats — 2026-10-28

The exact generated game assets passed all five offline functional viewport runs,
the nine existing speed checks and the forty populated late-game geometry scenes.
No remote requests, missing assets, script errors, horizontal overflow, worker
control collisions or hidden combat healing actions were found.

`node scripts/test-mobile-features.mjs` adds 25 early/late day/night layout cases
at 320/360/412px and 16/22px text. Actual trap/cart/hut/lodge construction creates
the village and jobs dynamically. Primary actions remain first, population moves
to the section heading, no-hut population 0/0 is hidden, and data/worker/inventory
sections do not overlap. Actual worker allocation and vertical touch scrolling
remain functional. Large resource counts use a display abbreviation; saves retain
their full values. Resource and building labels do not collide with quantities.

Real Chromium touch input checks both scene directions, all five unlocked tabs,
new and hidden tabs, boundaries, short/diagonal/vertical/cancelled gestures,
immediate button input, and action/menu/event/world exclusions. Selected tabs
stay visible. The legacy document-wide move/swipe scripts are no longer loaded.

The same test enables cheats through the actual menu and verifies default-off
behavior, clearing existing cooldowns, repeated gathering, retained build limits,
resource additions, unchanged compass, saved preferences/resources, normal supply
consumption before protection, protected movement without food, and survival of
lethal combat damage. Disabling the master switch restores cooldowns and damage;
its disabled state survives reload. Screenshots/report are in
`.local/mobile-features/`. These are offline browser results, not a claim of
physical Android testing of this update. Native loader behavior is unchanged.

## 1.0.8 theme controls, centered dialogs, workforce and material costs — 2026-10-28

`node scripts/test-ui-details.mjs` passes at 320×512 (16/22px), 360×740 (16px)
and 412×915 (22px). Twenty-one geometry cases cover material cards and village
management in both themes, with no horizontal overflow, clipped materials or
label/count/control collisions. Real hut construction spends the displayed 150
wood and changes the next cost to 200; missing amounts refresh with resources.
Multi-resource building costs, fabrication and ship upgrades display before taps.

Real workforce controls allocate/deallocate 1 or 10 villagers, support keyboard
activation, update totals and job production, clamp at available population, and
survive reloading with the saved adjustment step. The job details replace floating
tooltips. Native checkbox paint is hidden behind a separate visual check; night
mode measures #42443b fill and #eee check/text, including the selected speed.
Both event boxes and message-history sheets measure centered within one pixel in
both axes for all four sizes, in day and night themes. Short messages remain
natural height; long dialogs and full combat retain scrollable contents.

The 25 dynamic mobile layout/gesture/cheat cases and forty developed scene geometry
cases also pass. The 1–4x timer/cooldown regression passes unchanged. Screenshots
and the new report are in `.local/ui-details/`. Validation uses offline Chromium;
this does not establish physical Android verification of the new rendering.

## 1.0.9 stable materials and late-game interaction — 2026-10-28

`node scripts/test-late-game-ui.mjs` passes 88 scene/viewport/theme combinations.
It constructs bounded later-game states with 20 huts, the normal 80-person limit,
all nine assignable jobs plus gatherers, all blueprints, advanced equipment and a
loadout within its actual 110-unit capacity. These fixtures exercise later screens
directly; they are not a claim to have completed an entire playthrough.

The four viewport/font pairs are 320×512 at 16/22px, 360×740 at 16px and 412×915
at 22px, each in day/night mode. Every profession is increased and decreased by
real touch input. Material cards retain identical measured width/height when all
materials disappear, return in large quantities, reach a maximum, or the actual
last hut is built. Three-resource shortages and long material labels fit without
clipping. Construction/crafting/trading keep their order regardless of unlock
sequence; folding and reopening categories retains working purchase handlers.

Actual equipment adjustment, fabrication, hull reinforcement, embarkation and
combat healing pass. Capacity precedes equipment and stays visible while the
bottom rows are adjusted. Item hints appear inline with their changing available
counts instead of covering the next item; pressed controls use the current theme.
Responsive inventory columns keep item names on one line even in the large-font,
large-quantity cases. No workforce internal borders, overlapping controls,
horizontal overflow, uncaught errors or external resource requests are detected.
All five combat healing/defence actions remain visible on the smallest viewport.

The five functional offline viewport runs, 25 mobile layout/gesture/cheat cases,
21 detail geometry cases, nine speed checks and previous 40 stress-layout scenes
also pass. Test reload predicates now wait for both Engine and Room globals;
gesture checks use the actual empty gap below the tabs instead of a fixed pixel
that can land on the compact inventory. Reports and screenshots are retained in
`.local/late-game-ui/` and the existing test output folders. Validation is offline
Chromium against the packaged assets; this update has not been tested on a
physical Android device. The native loader, origin, package identity and signing
key remain the same for an installable update that retains local saves.

## 1.0.10 exploration controls and loot — 2026-10-28

`node scripts/test-exploration-ui.mjs` passes 72 scene/viewport/theme cases at
320×512 with 16/22px text, 360×740 with 16px, and 412×915 with 22px, in both themes.
Tests use the packaged local assets in offline Chromium. Actual touch input
operates all four directions, holds to repeat, drags between directions, pauses
outside the keys, resumes on re-entry, and stops after release or cancellation.
Keyboard activation also works. Nearby and overview maps stay above the cross;
all four targets measure at least 44px and supply-item borders remain absent.

Opening a real event while a navigation touch is held releases movement. Its
touch-end cannot click through onto a newly created modal button. Movement
fixtures suppress random encounters only; World.move, map updates and supply
consumption still run. Separate real event and combat/victory paths are exercised.

Loot checks perform single, group and whole-list collection; collecting all
leaves the event open, and the actual continue/leave buttons still work. A 68/70
loadout accepts only two further unit-weight items. At 70/70, collection-all is
disabled and the inline replacement menu can cancel or exchange an existing
item; the displaced item stays available to retrieve. A fourteen-item list
scrolls within the description while exits stay visible. Victory removes the
combat class and fixed height. The three upstream post-victory recovery actions
remain visible and eating meat actually heals; the existing combat regression
separately verifies its five healing/defence actions. Recovery labels fit the
small screen at maximum text size and the full-width single exit stays last.

No external requests, page errors, horizontal overflow, overlapping loot cells,
offscreen exits or undersized footer controls were detected. Screenshots were
visually reviewed for the 320px/22px night map, two-item list, full-backpack
replacement, long list and post-victory recovery. Evidence is retained in
`.local/exploration-ui/`. During this release the five offline functional runs,
88 later-game cases, 25 mobile-feature cases, 21 detail cases and nine game-speed
checks also passed. This is offline browser validation; the updated rendering
has not been verified on a physical Android handset. Package identity, local
storage origin, native loader and signing key stay unchanged.

## 1.0.11 compact combat dialogs — 2026-10-28

`node scripts/test-combat-ui.mjs` passes 50 cases: single rifle, ammunition
exhaustion, unarmed fighting, eleven weapons, and a long notification, each in
both themes at 320×512/16px, 320×512/22px, 360×740/16px, 412×915/16px and
412×915/22px. Simple fights shrink to content height, stay centered, and measure
at most 420px high and 82% of the viewport height. Their attack is below 45% of
the viewport rather than near the top. Attack and recovery groups are adjacent.

Real touch input heals, fires the last rifle bullet, uses the generated fallback
punch and activates the final weapon in the scrolling attack list. The original
punch button is moved into that group with its handler intact. Every recovery
control stays visible, targets measure at least 44px, and both fighters remain
unclipped. Long notifications scroll separately. Background directions hide
during the event and restore after its removal; the removal observer is tested
by opening and closing multiple real events. No page errors, external requests,
horizontal overflow or whole-dialog scrolling occur. The 88 later-game cases
and 72 exploration/loot cases also pass during this release.

Visually reviewed the 412px/16px night single-rifle popup and the 320px/22px night
many-weapon popup. Reports and screenshots are in `.local/combat-ui/`. Validation
uses offline Chromium with the bundled assets, not a physical Android handset.
The native asset loader, storage origin, package name and signing key are unchanged.

## 1.0.12 full-map cheat and landmark reference — 2026-10-28

`node scripts/test-map-guide.mjs` passes 48 scene/viewport/theme cases at
320×512/16px, 320×512/22px, 360×740/16px and 412×915/22px, each in both themes.
Actual menu input verifies that the reveal action is unavailable before map
generation, guarded by the cheat master switch, and never applied by enabling
cheats alone. Clicking it reveals all cells of both the persistent mask and the
temporary expedition mask. Tests inspect sparse unknown cells explicitly.

Terrain, visited marks, pending ship unlocks, player position and supplies remain
unchanged. Repeating the action is safe. World.seenAll updates so a later map
reward does not search forever for a hidden cell. Turning cheats off, dying and
reopening the saved game all retain the revealed fog, while death still discards
an uncommitted visit. The test performs the real death/save/reload path rather
than just serializing a fixture. The world switches to the existing overview.

Both actual guide entry points work without cheats. Its twenty unique symbols
match all nineteen World.TILE values plus @. Name, symbol and empty searches,
clearing the search, lower scrolling with the close control visible, Escape,
and reopening are covered. Counts use only the currently visible mask and
include visited V! cells; they increase correctly after full reveal. Reading
the guide before unlocking exploration does not generate a map. Actual WASD and
cursor-key input in its search field leave position and supplies unchanged.

No page errors, external requests, horizontal overflow, clipped reference cells
or offscreen map-toolbar controls were detected. The 72 exploration/loot cases,
50 combat cases and 25 mobile-feature cases also pass during this release.
Visually reviewed the small-screen night guide, full-map menu action and revealed
map. Reports and screenshots are in `.local/map-guide/`. This is offline Chromium
validation, not physical Android verification. Native loading, storage origin,
package identity and signing key stay unchanged.


## 1.0.13 title screen and mode selection — 2026-10-28

The Android launcher now opens a separate bundled `home.html`; its local script and stylesheet do not load Engine, audio, or game timers. “Start game” opens mode selection. Normal mode loads the existing index at its unchanged storage origin; Roguelike only opens a centered unavailable message and creates no save. Home reads saved theme/font preferences without changing any stored key. The game menu offers a saved return home. Native Back handles the placeholder, mode picker, title, attribution and game return explicitly. File restore no longer depends on OfflineGame existing on the current document.

`node scripts/test-home.mjs` passed 24 layout scenes at 320×512 (16/22px), 360×740 (16px) and 412×915 (22px), in day and night mode. Checks cover all stored keys unchanged before entering normal mode, no engine/audio requests on home, placeholder focus and keyboard Back, return from attribution, preserved wood/speed/theme across entry and re-entry, a fresh real light-fire action, and untouched malformed saves. Screenshots/report are retained in `.local/home-tests/`; title and mode screenshots were visually inspected. There were no external requests, missing assets or uncaught errors.

The existing smallest-viewport offline regression passed, including save/import, themes, real world movement, flight controls and FLAC decoding. Native instrumentation compiled with the updated launcher flow and three added resource interception cases. No Android device or emulator was connected for this update, so these new native paths have not been executed on a device. The signed production APK contains all 149 generated game/home assets byte-for-byte, with canonical ZIP paths, valid v1/v2/v3 signatures, alignment and no INTERNET permission.
