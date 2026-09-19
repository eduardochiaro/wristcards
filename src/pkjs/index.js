// Wristcards' phone half — and the half that holds the deck.
//
// The watch has 32 KB for everything it does, which is not enough to keep a deck
// or the code that would read one. So the deck lives here: this downloads it,
// keeps it, and hands the watch one session at a time, a card per message. The
// watch asks; nothing is ever pushed unasked.
//
// The watch answers every message with its own number. That ack, not the radio's,
// is what lets the next one go: the firmware acknowledges a message before the
// watch's JS has read it, and a second one arriving in that gap overwrites the
// first unread.

var PAGE = require("./config.js");	// packs/config.html, built in by npm run build

var PACKS = "https://cdn.eduardochiaro.com/wristcards/";
var MAX_LEVELS = 12;
var MAX_ORDERED = 50;		// an ordered level is read through; this is one sitting
var CACHE = "c2:";		// bump when the cached shape changes
var MAX_NAMES = 400;		// group names in one message, once the keys have theirs
var RETRIES = 3;
var PATIENCE = 5000;		// how long to wait for the watch's answer

var live = false;		// has the watch said hello since the app opened
var deck = null;		// {meta, levels: [[{n, c}, ...]]} once one is loaded
var wanted = 0;			// the level the watch is working through
var queue = null;		// messages not yet acknowledged, oldest first
var seq = 0;
var tries = 0;
var timer = null;

function get(key) {
	var raw = localStorage.getItem(key);
	return raw ? JSON.parse(raw) : null;
}

function set(key, value) {
	localStorage.setItem(key, JSON.stringify(value));
}

// ---- the watch --------------------------------------------------------------

// The watch cannot send anything until it has heard from this side once: the
// firmware holds its outbox shut until the phone answers its opening knock.
Pebble.addEventListener("ready", function () {
	Pebble.sendAppMessage({ "15025": 1 });
});

Pebble.addEventListener("appmessage", function (e) {
	var payload = e.payload;

	if ("15025" in payload) {
		Pebble.sendAppMessage({ "15025": 1 });		// it knocked again
		return;
	}
	if ("hello" in payload) {
		live = true;
		queue = null;		// the app restarted; anything in flight is gone
		seq = 0;		// and it is counting from the beginning again
		describe();
		return;
	}
	if ("want" in payload) {
		wanted = payload.want;
		var groups = deck && deck.levels[wanted];
		// A level with groups is answered by their names; the watch picks one and
		// asks again. One group, or none, is a session straight away.
		if (groups && (groups.length > 1))
			push([{ groups: names(groups) }]);
		else
			serve(wanted, 0);
		return;
	}
	if ("pick" in payload) {
		serve(wanted, payload.pick);
		return;
	}
	if ("ack" in payload) {
		if (!queue || (payload.ack !== seq))
			return;
		stop();
		queue.shift();
		seq += 1;
		tries = 0;
		send();
		return;
	}
	if ("oops" in payload) {
		stop();
		if (payload.oops < -1) {
			queue = null;	// the watch gave up and said why on its own screen
			return;
		}
		seq = payload.oops + 1;	// it is behind; pick up where it stopped
		send();
	}
});

// ---- what the watch is told --------------------------------------------------

// One message: the deck's name, its colours and its level names. Everything the
// watch needs to draw its menus, and nothing it would have to store.
function describe() {
	var want = get("want");
	if (!want)
		return push([{ fail: "No deck chosen" }]);

	load(want, function () {
		push([{ meta: JSON.stringify(deck.meta) }]);
	}, function (reason) {
		push([{ fail: reason }]);
	});
}

// The names of a level's groups, one per line, capped at what one message holds.
// Whatever is cut off is still played by the first row of the watch's menu, which
// draws from every group at once.
function names(groups) {
	var list = "";
	for (var i = 0; i < groups.length; i++) {
		var next = list ? (list + "\n" + groups[i].n) : groups[i].n;
		if (next.length > MAX_NAMES)
			break;
		list = next;
	}
	return list;
}

function every(groups) {
	return groups.reduce(function (cards, group) { return cards.concat(group.c); }, []);
}

// A session: the cards themselves, one per message, then the word that they are
// all there. `group` is nought for the whole level, otherwise the group's place
// in the list the watch was sent. An ordered deck is read through in its own
// order; any other is dealt from at random.
function serve(level, group) {
	var groups = deck && deck.levels[level];
	if (!groups)
		return push([{ fail: "No deck" }]);

	var picked = group && groups[group - 1];
	var cards = picked ? picked.c : every(groups);
	var chosen = [];
	if (deck.meta.o)
		chosen = cards.slice(0, MAX_ORDERED);
	else {
		var pool = cards.slice();
		var count = Math.min(deck.size, pool.length);
		while (chosen.length < count)
			chosen.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
	}

	push(chosen.map(function (card) { return { card: card }; }).concat([{ done: 1 }]));
}

// The numbering runs on across everything the watch is sent, because the watch
// takes a number it has already answered for a resend and ignores it. Starting
// each batch at nought would lose its first message.
function push(messages) {
	queue = messages;
	tries = 0;
	send();
}

function send() {
	if (!queue)
		return;
	if (!queue.length) {
		queue = null;
		return;
	}

	var message = queue[0], out = {};
	for (var key in message)
		out[key] = message[key];
	out.seq = seq;

	Pebble.sendAppMessage(out, function () {}, retry);
	stop();
	timer = setTimeout(retry, PATIENCE);
}

// A resend is safe at any point: the watch ignores a number it has already
// answered, and answers it again.
function retry() {
	stop();
	if (!queue)
		return;
	tries += 1;
	if (tries > RETRIES) {
		queue = null;		// the watch will ask again when it wants something
		return;
	}
	send();
}

function stop() {
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
}

// ---- the user's choice ------------------------------------------------------

// The settings page is part of the app: the phone is handed the page itself, not
// a link to one, so nothing has to be published for a change to it to take and no
// copy of it can be older than the app that opened it. The deck in play is
// written in on the way out, which is what makes a second visit find it chosen.
Pebble.addEventListener("showConfiguration", function () {
	var want = get("want") || {};
	// A deck's own text is about to sit inside the page's script, so the one
	// character that could end it early is spelled out instead.
	var deck = JSON.stringify(want).replace(/</g, "\\u003c");

	// Replaced through a function: a pasted deck may hold "$&" and the like, which
	// a string replacement would read as instructions of its own.
	var page = PAGE.replace("var WANT = null; //$$WANT$$", function () {
		return "var WANT = " + deck + ";";
	});
	Pebble.openURL("data:text/html;charset=utf-8," + encodeURIComponent(page));
});

Pebble.addEventListener("webviewclosed", function (e) {
	if (!e || !e.response)
		return;			// cancelled
	var choice;
	try {
		choice = JSON.parse(decodeURIComponent(e.response));
	}
	catch (err) {
		return;
	}

	if (choice.pack)
		set("want", { id: choice.pack, url: PACKS + choice.pack + ".json" });
	else if (choice.url)
		set("want", { id: basename(choice.url), url: choice.url });
	else if (choice.text)
		set("want", { id: "c" + fingerprint(choice.text), text: choice.text, title: choice.title || "My deck" });
	else
		return;

	deck = null;
	if (live)
		describe();		// the watch resets itself into the new deck
});

function basename(url) {
	var name = url.split("?")[0].split("/").pop();
	return name.replace(/\.(json|txt)$/, "").slice(0, 24) || "deck";
}

// A pasted deck has no name of its own, so its text gives it one: change the
// text and the id changes, which is what tells the watch this is a new deck.
function fingerprint(text) {
	var h = 2166136261;
	for (var i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = (h * 16777619) >>> 0;
	}
	return h.toString(36);
}

// ---- packs ------------------------------------------------------------------

// A pack is <id>.json — the level list — and the level files beside it. A single
// .txt is a pack of one level. Either way a level is kept as its groups: a "#"
// line opens one and names it, and the lines under it are its cards.
//
// The description uses one letter per field because the whole of it has to reach
// the watch in a single 512-byte message:
// i id · t title · c colours · o ordered · l level names
function load(want, done, fail) {
	if (deck && (deck.id === want.id))
		return done();

	var cached = get(CACHE + want.id);
	if (cached) {
		deck = cached;
		return done();
	}

	// A pasted deck and a lone .txt are the same deck once the text is in hand:
	// one level, named after whatever the deck itself is called.
	function single(text, title) {
		keep({
			id: want.id,
			size: 10,
			meta: { i: want.id, t: title, l: [title] },
			levels: [parse(text)]
		});
		done();
	}

	if (want.text)
		return single(want.text, want.title);

	if (/\.txt($|\?)/.test(want.url))
		return fetch(want.url, function (text) { single(text, want.id); }, fail);

	fetch(want.url, function (body) {
		var pack;
		try {
			pack = JSON.parse(body);
		}
		catch (err) {
			return fail("bad pack");
		}
		if (!pack || !pack.levels || !pack.levels.length)
			return fail("bad pack");
		if (pack.levels.length > MAX_LEVELS)
			return fail("too many levels");

		var base = want.url.replace(/[^/]*$/, "");
		var levels = [];

		(function next(i) {
			if (i === pack.levels.length) {
				keep({
					id: want.id,
					size: pack.sessionSize || 10,
					meta: {
						i: want.id,
						t: pack.appTitle || want.id,
						c: pack.colors,
						o: !!pack.ordered,
						l: pack.levels.map(function (level) { return level.name; })
					},
					levels: levels
				});
				return done();
			}
			fetch(base + pack.levels[i].file, function (text) {
				levels.push(parse(text));
				next(i + 1);
			}, fail);
		})(0);
	}, fail);
}

function keep(loaded) {
	deck = loaded;
	set(CACHE + loaded.id, loaded);		// a re-open costs no network
}

// "# Name" opens a group, "front|back" is a card, everything else is nothing. A
// file with no headings at all is one group, and the watch skips the menu for it.
function parse(text) {
	var groups = [], open = null;
	text.split("\n").forEach(function (line) {
		if ("#" === line.charAt(0)) {
			open = { n: line.slice(1).trim(), c: [] };
			groups.push(open);
			return;
		}
		if (line.indexOf("|") <= 0)
			return;
		if (!open) {
			open = { n: "Cards", c: [] };
			groups.push(open);
		}
		open.c.push(line);
	});
	return groups.filter(function (group) { return group.c.length; });
}

function fetch(url, done, fail) {
	var request = new XMLHttpRequest();
	request.open("GET", url, true);
	request.onload = function () {
		if ((request.status < 200) || (request.status > 299))
			return fail("HTTP " + request.status);
		done(request.responseText);
	};
	request.onerror = function () { fail("no connection"); };
	request.ontimeout = function () { fail("timed out"); };
	request.timeout = 20000;
	request.send();
}
