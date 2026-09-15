Wristcards — your own deck
==========================

Two shapes work. Put the files on any web host that serves plain files over
https, then paste the address of example.json (or of a single .txt) into the
settings page's "From a link" field.

A single .txt
-------------

example.txt is one. One card per line, front and back split by a "|":

    hallo|hello

A line starting with "# " opens a group and names it; the cards under it
belong to that group. The watch shows the groups as a menu, so you can drill
one at a time or all of them at once. A file with no headings at all is one
group and the watch goes straight to the cards.

Blank lines are ignored, and so is a line starting with "//" — the files in
this zip use those to explain themselves. Keep the "|" out of a comment: a
line with one in it is a card as far as the app can tell.

That is the whole format. A single .txt becomes a deck of one level.

A pack: .json plus level files
------------------------------

A pack is a .json naming its levels, with the level files beside it in the
same folder — example.json, example-basic.txt and example-more.txt here. The
level files are exactly the format above.

    {
        "appTitle": "Example Deck",
        "levels": [
            { "name": "Basic",         "file": "example-basic.txt" },
            { "name": "Out and about", "file": "example-more.txt"  }
        ],
        "colors": [[170, 255, 255], [0, 170, 170]],
        "ordered": false,
        "sessionSize": 10
    }

appTitle     what the watch calls the deck.
levels       in the order the watch lists them, up to twelve. "file" is
             resolved next to the .json, so keep them in one folder.
colors       the session card's two colours, face down then revealed. Values
             in multiples of 85 — that is the Pebble palette. Dark enough to
             tell apart, light enough for black text on top.
ordered      true reads a level from its first line to its last, for a deck
             that is a text rather than a pile. false deals at random.
sessionSize  how many cards one session draws. Default ten.

Only those are read; anything else in the file is ignored, which is what the
"note" line at the top of example.json is — JSON has no comments, so it borrows
a key nobody looks at.

Trying it without a host
------------------------

Anything that serves the folder works, including a local one:

    python3 -m http.server 8000

then put http://<your computer's address>:8000/example.json in the link
field, with the phone on the same network.

Note
----

The deck reaches the watch only while the Wristcards app is open on it — the
transfer is started by the watch. Choose a deck with the app closed and it
arrives the next time you open it.
