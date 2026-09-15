# Wristcards

One Pebble watchapp for vocabulary drills, with the deck chosen on the phone.
Dutch, French, German, Italian and Spanish are ready-made; any text file of
cards will do.

## How it works

The watch holds no deck. It has about 32 KB for everything it does — code,
objects and all — and a deck plus the code to read one does not fit beside the
app. So the deck lives on the phone: `src/pkjs/index.js` downloads it, keeps it,
and hands the watch one session at a time, a card per message. The watch asks;
nothing is ever pushed at it.

What the watch keeps is small and deliberate: the deck's name, colours and level
names, so its menus draw before the phone answers, and the words you saved, so
reviewing them works with the phone nowhere nearby. Starting a new session needs
the phone.

    watch                    phone
    ──────────────────────────────────────────────
    hello            ──▶
                     ◀──     the deck's name, colours, levels
    want level 2     ──▶
                     ◀──     the level's group names
    group 4          ──▶
                     ◀──     card, card, card … done

Every message is answered by its own number, and that answer, not the radio's,
is what lets the next one go — the firmware acknowledges a message before the
watch's JavaScript has read it, and a second one arriving in that gap overwrites
the first unread.

## Building

    npm run emulator             # build and install on the emery emulator
    npm run phone                # build and install on the watch
    npm run config               # open the settings page against the emulator
    npm run logs                 # pkjs logging; the watch itself cannot log
    npm run screenshot emery

`npm run packs` serves `packs/` on port 8000, so the settings page's link field
can point at `http://localhost:8000/nl.json` and a deck can be changed without
deploying anything. `npm run check` checks the shape of every deck file.

## Decks

A **pack** is `<id>.json` naming its levels, with the level files beside it:

    {
      "appTitle": "Learn Dutch",
      "levels": [{ "name": "Basic", "file": "nl-basic.txt" }],
      "colors": [[170, 255, 255], [0, 170, 170]],
      "ordered": false
    }

`colors` is the session card's pair — face down, then revealed — in multiples of
85, the Pebble palette, dark enough to tell apart and light enough for black
text. Review mode keeps its yellow in every deck. `ordered` turns sampling off:
the level is read from the first line to the last, for a deck that is a text
rather than a pile. `sessionSize` sets how many cards a session draws, default
ten.

### Level files

A level file is one card per line, `front|back`, under `# Group` headings. A
heading opens a group and the cards below it belong to it, which is what the
watch's second menu is: pick a level, then one group of it or all of them at
once. The phone keeps the groups; the watch is sent their names, one line each,
and only for the level being played. Blank lines are fine.

    # Greetings
    hallo|hello
    dank je wel|thank you

A file with no headings at all is one group, and the watch goes straight from the
level to the cards. A single `.txt` works on its own as a one-level deck, which
is what the settings page's link and paste fields take; `packs/example.txt` is
one, and doubles as the format's documentation. `npm run check` reads every pack's levels and fails
on a header with no name, a duplicate group, a card above the first header, a
line with no `|`, an empty group, or a missing trailing newline.

## The settings page

`packs/config.html` is a plain static page — five ready-made decks, a link
field, and a box to paste or open a `.txt`. A pasted deck rides back in the
webview's URL, so it is capped at 2,500 characters; anything longer belongs at a
link. The page is the only thing that knows the list of ready-made decks.

The app carries the page rather than linking to one: `npm run build` turns it
into `src/pkjs/config.js` and the phone is handed the whole of it as a `data:`
URL, the way Clay does. Nothing has to be published for a change to take, and no
copy of the page can be older than the app that opened it. The deck in play is
written into the page on the way out, so a second visit finds it chosen. The
emulator takes the same page: `pebble-tool` decodes the URL to a file of its own
and opens that, which is why the page reads its return address off the query
string rather than assuming `pebblejs://close`.

The deck only reaches the watch while the app is open on it: the transfer is
started by the watch saying hello. Choose a deck with the app closed and it
arrives the next time you open it.

## Publishing

`npm run publish` copies the decks — every `.json` and `.txt`, `example.txt`
included — to `cdn/wristcards/` in `eduardochiaro.com-data`, which is
`cdn.eduardochiaro.com/wristcards/`. The settings page is not published: it goes
out inside the app. This repository stays the source of truth for both, and
`src/pkjs/index.js` names the deck URL at the top.

## Layout

    src/embeddedjs/main.js   the watchapp: menus, cards, saved words, messaging
    src/pkjs/index.js        the phone: downloads, caches and serves decks
    packs/                   the decks, the settings page, the example file
    scripts/check-groups.js  deck linter
    scripts/inline-config.mjs  builds the settings page into the phone half
