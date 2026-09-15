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

A level file is one card per line, `front|back`, under `# Group` headings. The
headings are there for whoever edits the file; the watch never sees them, and
neither does the phone — it keeps the lines that hold a `|`, drops the rest, and
streams them one by one. Blank lines are fine.

    # Greetings
    hallo|hello
    dank je wel|thank you

A single `.txt` works on its own as a one-level deck, which is what the settings
page's link and paste fields take; `packs/example.txt` is one, and doubles as
the format's documentation. `npm run check` reads every pack's levels and fails
on a header with no name, a duplicate group, a card above the first header, a
line with no `|`, an empty group, or a missing trailing newline.

## The settings page

`packs/config.html` is a plain static page — five ready-made decks, a link
field, and a box to paste or open a `.txt`. A pasted deck rides back in the
webview's URL, so it is capped at 2,500 characters; anything longer belongs at a
link. The page is the only thing that knows the list of ready-made decks.

The deck only reaches the watch while the app is open on it: the transfer is
started by the watch saying hello. Choose a deck with the app closed and it
arrives the next time you open it.

## Publishing

`npm run publish` splits `packs/` in two, because the two halves are served
from different hosts. `config.html` goes to the site's `public/wristcards/`, in
`static-portfolio`; the decks — every `.json` and `.txt`, `example.txt`
included — go to `cdn/wristcards/` in `eduardochiaro.com-data`, which is
`cdn.eduardochiaro.com/wristcards/`. Put a deck beside the page and the phone
will not find it. This repository stays the source of truth for all of them, and
`src/pkjs/index.js` names both URLs at the top.

## Layout

    src/embeddedjs/main.js   the watchapp: menus, cards, saved words, messaging
    src/pkjs/index.js        the phone: downloads, caches and serves decks
    packs/                   the decks, the settings page, the example file
    scripts/check-groups.js  deck linter
