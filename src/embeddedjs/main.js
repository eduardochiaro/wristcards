import Poco from "commodetto/Poco";
import Button from "pebble/button";

// One build carries one language: data.json holds the wording every build
// shares and names the language, langs/<code>.json its title and levels. The
// mod archive is resident in the app's RAM, so a build that carried every
// language's decks left the JS heap with nothing to work in.
//
// Nothing keeps the parsed files alive; only the handful of values below stay.
let UI, SESSION_SIZE, LEVELS, APP_TITLE, CARD_RGB;

function readShared() {
	const data = JSON.parse(String.fromArrayBuffer(new Resource("data.json")));
	UI = data.ui;
	SESSION_SIZE = data.sessionSize;
	CARD_RGB = data.colors;		// release.js copies these from apps.json
	return data.language;
}

const LANGUAGE = readShared();

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

// The session pair is the language's own, so one app is told apart from another
// at a glance; review mode keeps the same yellow everywhere, it marks the mode.
// A plain `pebble build` has no app entry to read, so the Dutch pair stands in.
const SESSION_RGB = CARD_RGB ?? [[170, 255, 255], [0, 170, 170]];
const CARD_COLORS = {			// [face down, translation shown]
	session: SESSION_RGB.map(c => render.makeColor(c[0], c[1], c[2])),
	review: [render.makeColor(255, 255, 170), render.makeColor(255, 255, 0)]
};
const BRIGHT = render.makeColor(255, 0, 0);	// a saved card's bookmark

// ---- bookmarks -------------------------------------------------------------

// A card is one "front|back" string, the same text as its line in the deck file.
// Each language is its own watchapp, so each has its own storage and there is
// nothing to keep apart here.
const BM_KEY = "bookmarks";
const MAX_BOOKMARKS = 50;		// Pebble's persistent storage is only a few KB
let bookmarks = JSON.parse(localStorage.getItem(BM_KEY) ?? "[]");

function saveBookmarks() {
	localStorage.setItem(BM_KEY, JSON.stringify(bookmarks));
}

// ---- language ---------------------------------------------------------------

function loadLang(code) {
	const lang = JSON.parse(String.fromArrayBuffer(new Resource(`${code}.json`)));
	LEVELS = lang.levels;
	APP_TITLE = lang.appTitle;
}

// ---- deck ------------------------------------------------------------------

// Each level is one file, opened only while that level is played. A line
// starting with "#" names the group the lines below it belong to; every other
// line is a "front|back" card. The file stays in flash and the mod's JS heap is
// a couple of kilobytes, so only the ten lines a session needs are ever decoded
// — and where each group starts is counted off the file rather than recorded
// anywhere, which is why nothing can fall out of step with the cards.
const BLOCK = 512;
const HASH = 35, NEWLINE = 10;		// neither is ever a UTF-8 continuation byte

// Hand every line's byte range to `each`, until it returns false.
function eachLine(deck, each) {
	const total = deck.byteLength;
	let start = 0, line = 0, pos = 0, first = 0;

	while (pos < total) {
		const end = Math.min(pos + BLOCK, total);
		const bytes = new Uint8Array(deck.slice(pos, end));
		for (let i = 0; i < bytes.length; i++) {
			if ((pos + i) === start)	// the line may have begun in an earlier block
				first = bytes[i];
			if (NEWLINE !== bytes[i])
				continue;
			if (false === each(line, start, pos + i, first))
				return;
			line += 1;
			start = pos + i + 1;
		}
		pos = end;
	}
}

// Every question below is answered by one pass over the file, keeping a couple
// of numbers. Holding the group list in RAM instead costs about a kilobyte,
// which is enough to run the heap out mid-session.
function countGroups(file) {
	const deck = new Resource(file);
	let groups = 0;
	eachLine(deck, (line, start, stop, first) => {
		if (HASH === first)
			groups += 1;
	});
	return groups;
}

function countCards(file) {
	const deck = new Resource(file);
	let cards = 0;
	eachLine(deck, (line, start, stop, first) => {
		if (HASH !== first)
			cards += 1;
	});
	return cards;
}

// The name on group `index`'s header line.
function groupName(file, index) {
	const deck = new Resource(file);
	let group = -1, name = "";

	eachLine(deck, (line, start, stop, first) => {
		if (HASH !== first)
			return;
		group += 1;
		if (group < index)
			return;
		name = String.fromArrayBuffer(deck.slice(start + 2, stop));	// past "# "
		return false;
	});
	return name;
}

// How many cards come before group `index`, and how many are in it.
function groupRange(file, index) {
	const deck = new Resource(file);
	let group = -1, from = 0, count = 0;

	eachLine(deck, (line, start, stop, first) => {
		if (HASH === first) {
			group += 1;
			return (group <= index) ? undefined : false;
		}
		if (group < index)
			from += 1;
		else
			count += 1;
	});
	return { from, count };
}

function readCards(file, wanted) {		// wanted: card numbers, ascending
	const deck = new Resource(file);
	const cards = [];
	let card = 0, next = 0;

	eachLine(deck, (line, start, stop, first) => {
		if (HASH === first)		// a header is not a card
			return;
		if (card === wanted[next]) {
			cards.push(String.fromArrayBuffer(deck.slice(start, stop)));
			next += 1;
			if (next === wanted.length)
				return false;
		}
		card += 1;
	});
	return cards;
}

function pickLines(count, total) {
	const lines = [];
	count = Math.min(count, total);
	while (lines.length < count) {
		const line = (Math.random() * total) | 0;
		if (lines.indexOf(line) < 0)
			lines.push(line);
	}
	return lines.sort((a, b) => a - b);
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
	render.drawText(UI.appName, BOLD[2], black, pad, EDGE);
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
// group menu reads its names off the deck file, and keeping the whole list would
// leave the heap too short for the session that follows.
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

function messageView(lines) {
	return {
		draw() {
			render.begin();
			render.fillRectangle(white, 0, 0, W, H);
			drawHeader();
			drawLines(lines, BODY, black, (H - (lines.length * BODY.height)) >> 1);
			render.end();
		},
		onButton() {
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

function shuffled(array) {
	const copy = array.slice();
	for (let i = copy.length - 1; i > 0; i--) {
		const j = (Math.random() * (i + 1)) | 0;
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

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

function startSession(file, title, wanted) {
	go(cardView(shuffled(readCards(file, wanted)), title, false));
}

function levelMenu() {
	return listView(UI.chooseLevel, LEVELS.length, i => LEVELS[i].name,
		sel => go(groupMenu(LEVELS[sel].file, LEVELS[sel].name)),
		() => go(mainMenu()));
}

// The level itself is the first entry: it draws from every group at once.
function groupMenu(file, title) {
	return listView(title, countGroups(file) + 1,
		i => (0 === i) ? UI.allGroups : groupName(file, i - 1),
		sel => {
			if (0 === sel)
				return startSession(file, title, pickLines(SESSION_SIZE, countCards(file)));
			const group = groupRange(file, sel - 1);
			startSession(file, groupName(file, sel - 1),
				pickLines(SESSION_SIZE, group.count).map(i => i + group.from));
		},
		() => go(levelMenu()));
}

loadLang(LANGUAGE);
go(mainMenu());
watch.addEventListener("minutechange", () => view.draw());		// keep the header clock honest
