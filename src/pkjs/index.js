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

var PACKS = "https://cdn.eduardochiaro.com/wristcards/";
var CONFIG = "https://eduardochiaro.com/wristcards/config.html";
var MAX_LEVELS = 12;
var MAX_ORDERED = 50;		// an ordered level is read through; this is one sitting
var CACHE = "c1:";		// bump when the cached shape changes
var RETRIES = 3;
var PATIENCE = 5000;		// how long to wait for the watch's answer

var live = false;		// has the watch said hello since the app opened
var deck = null;		// {meta, levels: [[card, ...]]} once one is loaded
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
		serve(payload.want);
		return;
	}
	if ("ack" in payload) {
		if (!queue || (payload.ack !== seq))
			return;
		stop();
		queue.shift();
		seq += 1;
		tries = 0;
		step();
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

// A session: the cards themselves, one per message, then the word that they are
// all there. An ordered deck is read through in its own order; any other is
// dealt from at random.
function serve(level) {
	if (!deck || !deck.levels[level])
		return push([{ fail: "No deck" }]);

	var cards = deck.levels[level], chosen = [];
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
	step();
}

function step() {
	if (!queue)
		return;
	if (!queue.length) {
		queue = null;
		return;
	}
	send();
}

function send() {
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

Pebble.addEventListener("showConfiguration", function () {
	var want = get("want") || {};
	Pebble.openURL(CONFIG + "?v=" + encodeURIComponent(want.id || ""));
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
// .txt is a pack of one level. Either way what is kept is the cards themselves:
// a "#" line is a heading in the text, not a card.
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

	if (want.text) {
		keep({
			id: want.id,
			size: 10,
			meta: { i: want.id, t: want.title, l: [want.title] },
			levels: [cards(want.text)]
		});
		return done();
	}

	if (/\.txt($|\?)/.test(want.url))
		return fetch(want.url, function (text) {
			keep({
				id: want.id,
				size: 10,
				meta: { i: want.id, t: want.id, l: [want.id] },
				levels: [cards(text)]
			});
			done();
		}, fail);

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
				levels.push(cards(text));
				next(i + 1);
			}, fail);
		})(0);
	}, fail);
}

function keep(loaded) {
	deck = loaded;
	set(CACHE + loaded.id, loaded);		// a re-open costs no network
}

function cards(text) {
	return text.split("\n").filter(function (line) {
		return line && ("#" !== line.charAt(0)) && (line.indexOf("|") > 0);
	});
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
