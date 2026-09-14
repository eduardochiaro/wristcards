# Wristcards

Pebble watchapp for language vocabulary drills. Dutch, French, German, Italian
and Spanish, each shipping as its own watchapp built from this one source tree.

## Why one app per language

A Moddable mod is resident in the watchapp's RAM — code and every packed
resource — and a Pebble app gets about 122 KB in total. One build carrying all
five decks came to 113 KB and left the JS heap roughly 3 KB, which is not
enough to open a session; the watch faults with `fxAbort memory full`. Each
language on its own keeps a build near 39 KB, the size that was known good.

## Building

    npm run emulator             # Dutch, on the emery emulator
    npm run emulator -- fr       # French instead
    npm run phone -- de          # German, on the watch
    npm run release              # every app in apps.json, into dist/
    npm run release -- fr de     # just those

Bare words are language codes; the emulator takes its name attached to the
flag, as in `node scripts/release.js fr --emulator=gabbro`.

`npm run build` compiles the tree as it stands, every language at once. That is
a syntax check, not something to install: it is the build that overruns the
watchapp's memory.

`release` copies the project to a temp directory, strips it to one language,
sets that app's UUID and name from `apps.json`, and leaves a `.pbw` in `dist/`.
Your working tree is not touched. The Dutch app keeps the original UUID, so it
upgrades in place and its saved words survive.

Each entry's `colors` is the session card's pair, face down and revealed, as
`[r, g, b]` in multiples of 85 — the Pebble palette — dark enough to tell apart
and light enough for black text. Review mode keeps its yellow in every app.

`apps.json` is the record of the UUIDs and must stay in the repository. A watch
identifies an app by its UUID alone: reissue one and the watch installs a
second, empty copy alongside the old one instead of upgrading it, and the saved
words stay with the app nobody opens any more. Add a language by appending an
entry with a fresh UUID; never edit one that has shipped.

The Dutch UUID also appears in `package.json`, where it serves plain
`npm run build` and the emulator. `release` overwrites that field in its own
copy, so `apps.json` is what every released `.pbw` is built from.

## Decks

`src/embeddedjs/levels/<code>-<level>.txt` — one card per line, `front|back`,
under `# Group` headers. `src/embeddedjs/langs/<code>.json` names the levels.
`node scripts/check-groups.js` checks the shape of every deck.
