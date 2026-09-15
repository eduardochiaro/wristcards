import Poco from "commodetto/Poco";
import Button from "pebble/button";
import Message from "pebble/message";

// No deck ships with the app. The phone downloads a pack and pushes it here,
// where it is written to the watch's own filesystem and read back a session at a
// time. The mod archive is resident in the app's RAM, so decks that lived in it
// left the JS heap with nothing to work in — on the filesystem they cost nothing
// until they are read.
//
// Everything about the deck in play — its title, levels, colours and order —
// comes from the pack and lives in DECK. The wording stays here: it has to fit
// in one 512-byte message beside everything else if it travels, and it does not.
//
// The deck itself never comes here. The phone holds it and hands over one
// session at a time, which is what lets this app carry any deck at all: the
// machine has 32 KB for everything, and a file layer and a line scanner cost
// more than the cards they would have fetched.
let LEVELS, APP_TITLE, DECK;

const UI = {
	startSession: "Start Session",
	reviewBookmarked: "Review Saved",
	chooseLevel: "Choose Level",
	allGroups: "All Groups",
	noBookmarks: "No saved words",
	sessionComplete: "Session done",
	savedCount: "saved",
	saveFull: "SAVE LIST FULL",
	loading: "Loading",
	noCards: "Nothing to study",
	noPhone: "Phone not connected"
};

const render = new Poco(screen);
const black = render.makeColor(0, 0, 0);
const white = render.makeColor(255, 255, 255);

// Pebble system fonts, largest first — fitLines() steps down until the text fits.
// The word keeps its weight all the way down so it stays distinct from the translation.
const BOLD = [
	new render.Font("Bitham-Black", 30),
	new render.Font("Gothic-Bold", 24),
	new render.Font("Gothic-Bold", 18)
];
const REGULAR = [
	new render.Font("Gothic-Regular", 24),
	new render.Font("Gothic-Regular", 18)
];
const BODY = REGULAR[0], SMALL = REGULAR[1];

const W = render.width, H = render.height;
const MARGIN = screen.round ? 24 : 6;
const EDGE = screen.round ? 34 : 6;			// top and bottom margin
const HEADER_BOTTOM = EDGE + BOLD[2].height + 8;	// first row below the dotted rule

// Space kept clear on the right for the button icons; only the card view uses it.
let gutter = 0;
const maxWidth = () => W - (MARGIN * 2) - gutter;

// The session pair is the pack's own, so one deck is told apart from another at a
// glance; review mode keeps the same yellow everywhere, it marks the mode. The
// pair below stands in for a pack that names no colours of its own.
const PLAIN_RGB = [[170, 255, 255], [0, 170, 170]];
const CARD_COLORS = {			// [face down, translation shown]
	session: [],			// applyDeck() fills this from the pack
	review: [render.makeColor(255, 255, 170), render.makeColor(255, 255, 0)]
};
const BRIGHT = render.makeColor(255, 0, 0);	// a saved card's bookmark

// ---- bookmarks -------------------------------------------------------------

// A card is one "front|back" string, the same text as its line in the deck file.
// One app now plays every deck, so each deck's saved words get their own key and
// switching decks and back finds them still there.
const MAX_BOOKMARKS = 50;		// Pebble's persistent storage is only a few KB
let BM_KEY, bookmarks = [];

// Every deck's list shares one 8 KB store, so saving can fail on a watch that
// has played a few of them. The decks not in play are the ones to give up.
function saveBookmarks() {
	try {
		localStorage.setItem(BM_KEY, JSON.stringify(bookmarks));
	}
	catch {
		// ponytail: every deck's list shares one 8 KB store, and a watch that has
		// played several can fill it. Give the word back rather than evict a deck
		// the user may still want; evict if that turns out to be too blunt.
		bookmarks.pop();
	}
}

// ---- drawing ---------------------------------------------------------------

function wrapText(text, font) {
	const lines = [];
	let line = "";
	for (const word of text.split(" ")) {
		const test = line ? `${line} ${word}` : word;
		if (line && (render.getTextWidth(test, font) > maxWidth())) {
			lines.push(line);
			line = word;
		}
		else
			line = test;
	}
	if (line) lines.push(line);
	return lines;
}

// Pick the biggest font in the family whose wrapped lines all fit the screen width.
function fitLines(text, family) {
	let font = family[family.length - 1], lines;
	for (const candidate of family) {
		lines = wrapText(text, candidate);
		if (lines.every(l => render.getTextWidth(l, candidate) <= maxWidth())) {
			font = candidate;
			break;
		}
	}
	return { font, lines: lines ?? wrapText(text, font) };
}

function drawCentered(text, font, color, y) {
	render.drawText(text, font, color, ((W - gutter) - render.getTextWidth(text, font)) >> 1, y);
}

function clockText() {
	const now = new Date();
	const minutes = now.getMinutes().toString().padStart(2, "0");
	if (watch.hour12)
		return `${(now.getHours() % 12) || 12}:${minutes}`;
	return `${now.getHours().toString().padStart(2, "0")}:${minutes}`;
}

// Gabbro's screen is a circle, so the usable width shrinks towards the top and
// bottom. Anything anchored to an edge asks how wide the screen is at its rows.
function insetAt(y, height) {
	if (!screen.round)
		return MARGIN;
	const radius = W / 2;
	const dy = Math.max(Math.abs(y - (H / 2)), Math.abs((y + height) - (H / 2)));
	if (dy >= radius)
		return W / 2;
	return Math.max(MARGIN, (radius - Math.sqrt((radius * radius) - (dy * dy)) + 4) | 0);
}

// App name on the left, clock on the right, dotted rule under both.
function drawHeader() {
	const pad = insetAt(EDGE, BOLD[2].height);
	render.drawText("Wristcards", BOLD[2], black, pad, EDGE);
	const now = clockText();
	render.drawText(now, BOLD[2], black, W - pad - render.getTextWidth(now, BOLD[2]), EDGE);

	const y = EDGE + BOLD[2].height + 3;
	const dots = insetAt(y, 1);
	for (let x = dots; x < (W - dots); x += 3)
		render.fillRectangle(black, x, y, 1, 1);
}

// ---- button icons ----------------------------------------------------------

// Redrawn from assets/*.svg with Poco rectangles. The .pdc files in resources/
// are only readable through the native C draw command API, which this app,
// being pure JS on Poco, never calls.
const CHEV = 7;					// chevron half width; 3px stroke, as in the SVG
const CHEV_H = CHEV + 3;
const MARK_W = 13, MARK_H = 19;
const ICON_W = Math.max((CHEV * 2) + 1, MARK_W);
const GUTTER = ICON_W + 10;
// One row per button: UP top right, SELECT middle right, DOWN bottom right.
// Emery's buttons sit further apart than gabbro's, whose circle also runs out
// of width at the extremes.
const SPREAD = screen.round ? 0.22 : 0.28;
const UP_Y = (H * (0.5 - SPREAD)) | 0, SELECT_Y = H >> 1, DOWN_Y = (H * (0.5 + SPREAD)) | 0;

function iconX(y, height) {		// left edge of the icon column at that row
	return W - insetAt(y, height) - ICON_W;
}

function drawChevron(color, y, down) {
	const cx = iconX(y, CHEV_H) + (ICON_W >> 1);
	for (let i = 0; i <= CHEV; i++) {
		const top = y + (down ? CHEV - i : i);
		render.fillRectangle(color, cx - i, top, 1, 3);
		render.fillRectangle(color, cx + i, top, 1, 3);
	}
}

// mark.svg: a flag with a chamfered top and a V notch cut out of the bottom.
function drawMark(color, x, y, w, h) {
	const chamfer = ((w * 2) / 7) | 0;
	const notch = (h / 3) | 0;
	const mid = x + (w >> 1);
	for (let r = 0; r < h; r++) {
		const inset = r < chamfer ? chamfer - r : 0;
		const left = x + inset, right = x + w - inset;
		const cut = r - (h - notch);
		if (cut < 0) {
			render.fillRectangle(color, left, y + r, right - left, 1);
			continue;
		}
		render.fillRectangle(color, left, y + r, Math.max(0, mid - cut - left), 1);
		render.fillRectangle(color, mid + cut + 1, y + r, Math.max(0, right - mid - cut - 1), 1);
	}
}

// Outlined while the card is unsaved, filled bright once it is bookmarked.
function drawBookmark(y, saved, background) {
	const x = iconX(y, MARK_H) + ((ICON_W - MARK_W) >> 1);
	drawMark(black, x, y, MARK_W, MARK_H);
	drawMark(saved ? BRIGHT : background, x + 2, y + 2, MARK_W - 4, MARK_H - 4);
}

// question.svg is a question mark, and the watch already has one in every font.
function drawQuestion(y) {
	const font = BOLD[1];
	const w = render.getTextWidth("?", font);
	render.drawText("?", font, black, iconX(y, font.height) + ((ICON_W - w) >> 1), y);
}

function drawLines(lines, font, color, y) {
	for (const line of lines) {
		drawCentered(line, font, color, y);
		y += font.height;
	}
	return y;
}

// ---- view machine ----------------------------------------------------------

let view, button;

// Alloy only lets the system exit the app while "back" is NOT captured, so the
// top menu releases that button and every other screen takes it over.
function go(next) {
	view = next;

	const types = next.exitOnBack ? ["select", "up", "down"] : ["select", "up", "down", "back"];
	if (button)
		button.close();
	button = new Button({
		types,
		onPush(down, type) {
			if (down) view.onButton(type);
		}
	});

	view.draw();
}

// `label` is asked for the text of a row only while that row is on screen: the
// group menu cuts its names out of the line the phone sent, and keeping the whole
// list as separate strings would leave the heap too short for the session that
// follows.
function listView(title, count, label, onSelect, onBack) {
	let sel = 0, top = 0;			// top: first label of the visible window
	const step = BODY.height + 8;
	const first = HEADER_BOTTOM + BOLD[2].height + 4;
	// A group list is longer than any watch screen, so only the rows that fit
	// below the title are drawn and the window follows the selection.
	const rows = Math.max(2, Math.min(count, ((H - EDGE - first) / step) | 0));

	return {
		exitOnBack: !onBack,
		draw() {
			if (sel < top)
				top = sel;
			else if (sel >= (top + rows))
				top = sel - rows + 1;

			render.begin();
			render.fillRectangle(white, 0, 0, W, H);
			drawHeader();
			drawCentered(title, BOLD[2], black, HEADER_BOTTOM);

			const shown = Math.min(rows, count - top);
			let y = first + ((H - EDGE - first - (shown * step)) >> 1) + 4;
			for (let i = top; i < (top + shown); i++) {
				if (i === sel) {
					const pad = insetAt(y - 4, step);
					render.fillRectangle(black, pad, y - 4, W - (2 * pad), step);
				}
				drawCentered(label(i), BODY, i === sel ? white : black, y);
				y += step;
			}
			render.end();
		},
		onButton(type) {
			if ("up" === type)
				sel = (sel + count - 1) % count;
			else if ("down" === type)
				sel = (sel + 1) % count;
			else if ("select" === type)
				return onSelect(sel);
			else if (onBack)
				return onBack();
			else
				return;
			this.draw();
		}
	};
}

// `atTop` is for a screen with nothing behind it: BACK leaves the app, the way
// it does from the main menu, and no button pretends to go back to one.
function messageView(lines, atTop) {
	return {
		exitOnBack: atTop,
		draw() {
			render.begin();
			render.fillRectangle(white, 0, 0, W, H);
			drawHeader();
			drawLines(lines, BODY, black, (H - (lines.length * BODY.height)) >> 1);
			render.end();
		},
		onButton() {
			if (!atTop)
				go(mainMenu());
		}
	};
}

function cardView(cards, title, reviewMode) {
	let i = 0;
	// One flag per card: has its translation been shown? A revealed card stays
	// revealed when you come back to it, and the session is over only once every
	// flag is set — until then UP and DOWN keep cycling through the deck.
	const seen = cards.map(() => false);

	return {
		draw() {
			const card = cards[i];
			const revealed = seen[i];
			const saved = bookmarks.indexOf(card) >= 0;
			const background = CARD_COLORS[reviewMode ? "review" : "session"][revealed ? 1 : 0];
			gutter = GUTTER;		// keep the text clear of the button icons

			const bar = card.indexOf("|");
			const front = fitLines(card.slice(0, bar), BOLD);
			const back = revealed ? fitLines(card.slice(bar + 1), REGULAR) : null;

			let height = front.lines.length * front.font.height;
			if (back)
				height += 8 + (back.lines.length * back.font.height);

			render.begin();
			render.fillRectangle(background, 0, 0, W, H);
			drawHeader();
			const top = HEADER_BOTTOM;
			drawCentered(title, BOLD[2], black, top);

			// Centre the card text in what is left between the subtitle and the footer.
			const bottom = H - EDGE - SMALL.height;
			let y = top + SMALL.height + ((bottom - top - SMALL.height - height) >> 1);
			y = drawLines(front.lines, front.font, black, y);
			if (back)
				drawLines(back.lines, back.font, black, y + 8);

			// Before the reveal SELECT shows the translation; after it, it toggles the bookmark.
			drawChevron(black, UP_Y - (CHEV_H >> 1), false);
			if (revealed)
				drawBookmark(SELECT_Y - (MARK_H >> 1), saved, background);
			else
				drawQuestion(SELECT_Y - (BOLD[1].height >> 1));
			drawChevron(black, DOWN_Y - (CHEV_H >> 1), true);

			const footer = (revealed && !saved && (bookmarks.length >= MAX_BOOKMARKS))
				? UI.saveFull : `${i + 1}/${cards.length}`;
			drawCentered(footer, SMALL, black, bottom);
			render.end();
			gutter = 0;
		},
		onButton(type) {
			if ("back" === type)
				return go(mainMenu());

			if ("select" === type) {
				if (!seen[i])
					seen[i] = true;
				else if (!this.toggleBookmark())
					return;
			}
			else if (("up" === type) || ("down" === type)) {
				// Revealing the last card never ends the session on its own —
				// only the next move off that card does.
				if (seen.every(Boolean))
					return go(messageView([UI.sessionComplete, `${bookmarks.length} ${UI.savedCount}`]));
				i = (i + cards.length + ("down" === type ? 1 : -1)) % cards.length;
			}
			this.draw();
		},
		// returns false when it already navigated away (review list emptied)
		toggleBookmark() {
			const found = bookmarks.indexOf(cards[i]);
			if (found < 0) {
				if (bookmarks.length >= MAX_BOOKMARKS)
					return true;			// list is full; the hint already says so
				bookmarks.push(cards[i]);
			}
			else {
				bookmarks.splice(found, 1);
				if (reviewMode) {
					cards.splice(i, 1);
					seen.splice(i, 1);
					if (!cards.length) {
						saveBookmarks();
						go(messageView([UI.noBookmarks]));
						return false;
					}
					if (i >= cards.length)
						i = 0;
				}
			}
			saveBookmarks();
			return true;
		}
	};
}

// ---- sessions --------------------------------------------------------------

// Built per visit rather than once: switching language rewrites UI.
function mainMenu() {
	const labels = [UI.startSession, UI.reviewBookmarked];
	return listView(APP_TITLE, labels.length, i => labels[i], sel => {
		if (0 === sel)
			go(levelMenu());
		else if (bookmarks.length)
			go(cardView(bookmarks.slice(), UI.reviewBookmarked, true));
		else
			go(messageView([UI.noBookmarks]));
	});		// no onBack: BACK leaves the app
}

// Asking is all the watch does: the phone picks the cards, shuffles them if the
// deck is not an ordered one, and sends them over one at a time. A level made of
// groups answers with their names instead, and the session is asked for a second
// time once one is picked. `title` is what the cards will be headed by.
function ask(key, value, title) {
	session = { title, cards: [] };
	say(key, value);
	go(messageView([UI.loading], !DECK));
	// Asking costs nothing if the phone is not there, but waiting forever does.
	waiting = setTimeout(() => go(messageView([UI.noPhone], !DECK)), 8000);
}

function levelMenu() {
	return listView(UI.chooseLevel, LEVELS.length, i => LEVELS[i],
		sel => ask(WANT, sel, LEVELS[sel]),
		() => go(mainMenu()));
}

// The names arrive as one string, a name per line, and stay that way: a list of
// twenty of them costs about a kilobyte, which is enough to run the heap out
// mid-session. Each row is cut out of it only while it is on screen.
function nth(list, index) {
	let at = 0;
	while (index--)
		at = list.indexOf("\n", at) + 1;
	const end = list.indexOf("\n", at);
	return (end < 0) ? list.slice(at) : list.slice(at, end);
}

// The level itself is the first row: it draws from every group at once, and from
// the groups whose names did not fit in the message as well.
function groupMenu(list, title) {
	let count = 2;			// the level, then the first group
	for (let at = list.indexOf("\n"); at >= 0; at = list.indexOf("\n", at + 1))
		count += 1;

	return listView(title, count,
		i => (0 === i) ? UI.allGroups : nth(list, i - 1),
		sel => ask(PICK, sel, (0 === sel) ? title : nth(list, sel - 1)),
		() => go(levelMenu()));
}

// ---- the phone --------------------------------------------------------------

// The deck lives on the phone; this app asks for what it needs and holds only
// that. Nothing arrives unasked — the hello below is what starts the
// conversation, and the phone answers it with whatever deck the user chose.
//
// The keys are numbered as package.json's messageKeys list is numbered. Numbers
// rather than names because a name table is memory this app does not have.
const HELLO = 10000, ACK = 10001, OOPS = 10002, WANT = 10003, META = 10004,
	CARD = 10005, DONE = 10006, FAIL = 10007, SEQ = 10008, GROUPS = 10009,
	PICK = 10010;

const NO_DECK = ["No cards yet", "Use the phone app"];

let session, waiting, outbox, greeted = false, lastSeq = -1;

const message = new Message({
	input: 512,		// the deck's description has to arrive in one piece, and
	output: 64,		// a wider inbox than this is more than the heap can hold
	// A message is only delivered here if one of its keys is in this map, and
	// every message from the phone carries its number — so one entry buys them
	// all, and a full name table is memory this app does not have. read() renames
	// a mapped key to its name, which is why the number arrives as "s".
	keys: new Map([["s", SEQ]]),

	// The firmware acknowledges a message before this code has read it, and a
	// second one arriving first overwrites it unread — so every message is
	// answered by its own number, and the phone waits for that, not the radio.
	onReadable() {
		const map = message.read();
		clearTimeout(waiting);
		const seq = map.get("s");
		if (seq === lastSeq)			// a resend of what was applied
			return say(ACK, seq);
		if (seq !== (lastSeq + 1))		// one went missing; rewind the phone
			return say(OOPS, lastSeq);

		const card = map.get(CARD);
		if (card)
			session?.cards.push(card);
		else if (map.has(META)) {
			// Kept as it arrived; parsing it, or drawing, while a message is in
			// flight costs heap this machine does not have.
			localStorage.setItem("m", map.get(META));
			applyDeck();
		}
		else if (map.has(GROUPS))
			go(groupMenu(map.get(GROUPS), session?.title ?? UI.chooseLevel));
		else if (map.has(DONE)) {
			if (session?.cards.length)
				go(cardView(session.cards, session.title, false));
			else
				go(messageView([UI.noCards], !DECK));
			session = undefined;
		}
		else if (map.has(FAIL)) {
			session = undefined;
			go(messageView(["Deck failed", map.get(FAIL)], !DECK));
		}

		lastSeq = seq;
		say(ACK, seq);
	},
	onWritable() {
		if (!greeted) {
			greeted = true;
			outbox = new Map([[HELLO, 1]]);
		}
		say();
	}
});

function say(key, value) {
	if (undefined !== key)
		outbox = new Map([[key, value]]);
	try {				// write() throws while a message is still in
		if (outbox) {		// flight, so a refused one waits for onWritable
			message.write(outbox);
			outbox = undefined;
		}
	}
	catch {
	}
}

// Everything the deck decides, in one place, so a deck that arrives while the
// app is running takes hold the same way one remembered from last time does.
function applyDeck() {
	// The pack describes itself in one letter per field, because the whole of it
	// has to cross in a single message: i id · t title · c colours · l level names.
	DECK = JSON.parse(localStorage.getItem("m") ?? "null");
	LEVELS = DECK?.l;
	APP_TITLE = DECK?.t;
	CARD_COLORS.session = (DECK?.c ?? PLAIN_RGB).map(c => render.makeColor(c[0], c[1], c[2]));

	BM_KEY = `bm:${DECK ? DECK.i : ""}`;
	bookmarks = JSON.parse(localStorage.getItem(BM_KEY) ?? "[]");

	go(DECK ? mainMenu() : messageView(NO_DECK, true));
}

applyDeck();
watch.addEventListener("minutechange", () => view.draw());		// keep the header clock honest
