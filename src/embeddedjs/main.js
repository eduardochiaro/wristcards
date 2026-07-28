import Poco from "commodetto/Poco";
import Button from "pebble/button";

const DATA = JSON.parse(String.fromArrayBuffer(new Resource("data.json")));
const UI = DATA.ui;

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
const MAXW = W - (MARGIN * 2);
const EDGE = screen.round ? 34 : 6;			// top and bottom margin
const HEADER_BOTTOM = EDGE + BOLD[2].height + 8;	// first row below the dotted rule

const CARD_COLORS = {			// [face down, translation shown]
	session: [render.makeColor(170, 255, 255), render.makeColor(85, 170, 255)],
	review: [render.makeColor(255, 255, 170), render.makeColor(255, 255, 0)]
};

// ---- bookmarks -------------------------------------------------------------

// A card is one "front|back" string, the same text as its line in the deck file.
const BM_KEY = "bookmarks";
const MAX_BOOKMARKS = 50;		// Pebble's persistent storage is only a few KB
let bookmarks = JSON.parse(localStorage.getItem(BM_KEY) ?? "[]");

function saveBookmarks() {
	localStorage.setItem(BM_KEY, JSON.stringify(bookmarks));
}

// ---- deck ------------------------------------------------------------------

// Each level is its own file of "front|back" lines, opened only when that level
// is played. The file stays in flash: the JS heap has room for a few hundred
// objects at most, so only the ten lines a session needs are ever decoded.
const BLOCK = 512;

function readCards(file, wanted) {		// wanted: line numbers, ascending
	const deck = new Resource(file);
	const total = deck.byteLength;
	const cards = [];
	let start = 0, line = 0, next = 0, pos = 0;

	while ((pos < total) && (next < wanted.length)) {
		const end = Math.min(pos + BLOCK, total);
		const bytes = new Uint8Array(deck.slice(pos, end));
		for (let i = 0; i < bytes.length; i++) {
			if (10 !== bytes[i])		// "\n" — never a UTF-8 continuation byte
				continue;
			const stop = pos + i;
			if (line === wanted[next]) {
				cards.push(String.fromArrayBuffer(deck.slice(start, stop)));
				next += 1;
			}
			line += 1;
			start = stop + 1;
		}
		pos = end;
	}
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
		if (line && (render.getTextWidth(test, font) > MAXW)) {
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
		if (lines.every(l => render.getTextWidth(l, candidate) <= MAXW)) {
			font = candidate;
			break;
		}
	}
	return { font, lines: lines ?? wrapText(text, font) };
}

function drawCentered(text, font, color, y) {
	render.drawText(text, font, color, (W - render.getTextWidth(text, font)) >> 1, y);
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

function drawLines(lines, font, color, y) {
	for (const line of lines) {
		drawCentered(line, font, color, y);
		y += font.height;
	}
	return y;
}

// ---- view machine ----------------------------------------------------------

let view;

function go(next) {
	view = next;
	view.draw();
}

new Button({
	types: ["select", "up", "down", "back"],
	onPush(down, type) {
		if (down) view.onButton(type);
	}
});

function listView(title, labels, onSelect, onBack) {
	let sel = 0;
	return {
		draw() {
			render.begin();
			render.fillRectangle(white, 0, 0, W, H);
			drawHeader();
			drawCentered(title, BOLD[2], black, HEADER_BOTTOM);

			const step = BODY.height + 8;
			let y = ((H - (labels.length * step)) >> 1) + 4;
			labels.forEach((label, i) => {
				if (i === sel) {
					const pad = insetAt(y - 4, step);
					render.fillRectangle(black, pad, y - 4, W - (2 * pad), step);
				}
				drawCentered(label, BODY, i === sel ? white : black, y);
				y += step;
			});
			render.end();
		},
		onButton(type) {
			if ("up" === type)
				sel = (sel + labels.length - 1) % labels.length;
			else if ("down" === type)
				sel = (sel + 1) % labels.length;
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
	let i = 0, revealed = false;

	return {
		draw() {
			const card = cards[i];
			const bar = card.indexOf("|");
			const front = fitLines(card.slice(0, bar), BOLD);
			const back = revealed ? fitLines(card.slice(bar + 1), REGULAR) : null;

			let height = front.lines.length * front.font.height;
			if (back)
				height += 8 + (back.lines.length * back.font.height);

			render.begin();
			render.fillRectangle(CARD_COLORS[reviewMode ? "review" : "session"][revealed ? 1 : 0],
				0, 0, W, H);
			drawHeader();
			const top = HEADER_BOTTOM;
			drawCentered(`${title} ${i + 1}/${cards.length}`, BOLD[2], black, top);

			// Centre the card text in what is left between the subtitle and the hint.
			const bottom = H - EDGE - SMALL.height;
			let y = top + SMALL.height + ((bottom - top - SMALL.height - height) >> 1);
			y = drawLines(front.lines, front.font, black, y);
			if (back)
				drawLines(back.lines, back.font, black, y + 8);

			// Before the reveal SELECT shows the translation; after it, it toggles the bookmark.
			const hint = !revealed ? UI.hintReveal
				: bookmarks.indexOf(card) >= 0 ? UI.bookmarked
				: bookmarks.length >= MAX_BOOKMARKS ? UI.saveFull : UI.hintBookmark;
			drawCentered(hint, SMALL, black, H - EDGE - SMALL.height);
			render.end();
		},
		onButton(type) {
			if ("back" === type)
				return go(mainMenu());

			if ("select" === type) {
				if (!revealed)
					revealed = true;
				else if (!this.toggleBookmark())
					return;
			}
			else if ("up" === type) {
				i = (i + cards.length - 1) % cards.length;
				revealed = false;
			}
			else if ("down" === type) {
				if (i === (cards.length - 1))
					return go(messageView([UI.sessionComplete, `${bookmarks.length} ${UI.savedCount}`]));
				i += 1;
				revealed = false;
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
					if (!cards.length) {
						saveBookmarks();
						go(messageView([UI.noBookmarks]));
						return false;
					}
					if (i >= cards.length)
						i = 0;
					revealed = false;
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

function mainMenu() {
	return listView(DATA.appTitle, [UI.startSession, UI.reviewBookmarked], sel => {
		if (0 === sel)
			go(levelMenu());
		else if (bookmarks.length)
			go(cardView(bookmarks.slice(), UI.reviewBookmarked, true));
		else
			go(messageView([UI.noBookmarks]));
	});
}

function levelMenu() {
	return listView(UI.chooseLevel, DATA.levels.map(l => l.name), sel => {
		const level = DATA.levels[sel];
		const cards = readCards(level.file, pickLines(DATA.sessionSize, level.cards));
		go(cardView(shuffled(cards), level.name, false));
	}, () => go(mainMenu()));
}

go(mainMenu());
watch.addEventListener("minutechange", () => view.draw());		// keep the header clock honest
