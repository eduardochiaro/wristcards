// The phone's half of a deck, run without a phone: src/pkjs/index.js is loaded
// with the three things it talks to — a require, a Pebble and a localStorage —
// stubbed, and its load() is asked for each kind of deck the settings page can
// hand it. The point is the example pack: it is what a stranger downloads to
// copy, so it is read here the way the phone reads it rather than trusted.
// Run: node scripts/check-deck.js
import { readFileSync } from "node:fs";
import assert from "node:assert";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");

const pkjs = read("src/pkjs/index.js");
const store = {};
const served = {};

function Request() {
	this.open = (method, url) => { this.url = url; };
	this.send = () => {
		const text = served[this.url];
		if (undefined === text) {
			this.status = 404;
			this.onload();
			return;
		}
		this.status = 200;
		this.responseText = text;
		this.onload();
	};
}

const { load } = new Function("require", "Pebble", "localStorage", "XMLHttpRequest",
	`${pkjs}\nreturn { load: load };`)(
	() => "",
	{ addEventListener() {}, sendAppMessage() {} },
	{ getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
	Request);

function loaded(want) {
	let got, failed;
	load(want, () => { got = JSON.parse(store[`c2:${want.id}`]); }, r => { failed = r; });
	assert.ok(!failed, failed);
	return got;
}

// Pasted in: one level, named after the deck, the cards parsed out of the text.
let deck = loaded({ id: "c1a", text: "hallo|hello\ndank je|thank you\n", title: "My deck" });
assert.deepEqual(deck.meta, { i: "c1a", t: "My deck", l: ["My deck"] });
assert.equal(deck.levels.length, 1);
assert.deepEqual(deck.levels[0][0].c, ["hallo|hello", "dank je|thank you"]);
assert.equal(deck.size, 10);

// From a link: same shape, and the id stands in for the name there is none of.
served["https://example.com/mydeck.txt"] = "# Greetings\nhallo|hello\n";
deck = loaded({ id: "mydeck", url: "https://example.com/mydeck.txt" });
assert.deepEqual(deck.meta, { i: "mydeck", t: "mydeck", l: ["mydeck"] });
assert.deepEqual(deck.levels[0], [{ n: "Greetings", c: ["hallo|hello"] }]);

// A last line with no newline after it is still a card: what the page used to
// paste one on for.
deck = loaded({ id: "c1b", text: "hallo|hello", title: "Ragged" });
assert.deepEqual(deck.levels[0][0].c, ["hallo|hello"]);

// A pack still takes the other path: its own levels, its own names.
served["https://cdn.example.com/nl.json"] = JSON.stringify({
	appTitle: "Learn Dutch",
	levels: [{ name: "Basic", file: "nl-basic.txt" }, { name: "More", file: "nl-more.txt" }]
});
served["https://cdn.example.com/nl-basic.txt"] = "# A\nhallo|hello\n";
served["https://cdn.example.com/nl-more.txt"] = "# B\ndoei|bye\n";
deck = loaded({ id: "nl", url: "https://cdn.example.com/nl.json" });
assert.deepEqual(deck.meta.l, ["Basic", "More"]);
assert.equal(deck.levels.length, 2);

// The example people download is the same pack the app has to read, so it is
// loaded here rather than trusted: a broken one is a broken first impression.
const base = "https://example.com/wristcards/";
served[`${base}example.json`] = read("packs/example.json");
for (const level of JSON.parse(served[`${base}example.json`]).levels)
	served[base + level.file] = read(`packs/${level.file}`);
deck = loaded({ id: "example", url: `${base}example.json` });
assert.equal(deck.meta.t, "Example Deck");
assert.deepEqual(deck.meta.l, ["Basic", "Out and about"]);
assert.ok(deck.levels.every(groups => groups.length > 1), "a level with nothing to pick from");
assert.ok(deck.levels.flat().every(group => group.n && group.c.length), "an unnamed or empty group");
// The files explain themselves in "//" lines. Those are notes, not cards.
assert.ok(deck.levels.flat().flatMap(group => group.c).every(card => !card.startsWith("//")),
	"a comment was dealt out as a card");

// The single .txt the page offers beside the pack, read the same way.
served[`${base}example.txt`] = read("packs/example.txt");
deck = loaded({ id: "example-txt", url: `${base}example.txt` });
assert.equal(deck.levels.length, 1);
assert.ok(deck.levels[0].length > 1, "the example .txt lost its groups");
assert.ok(deck.levels[0].flatMap(group => group.c).every(card => !card.startsWith("//")),
	"a comment was dealt out as a card");

console.log("deck load ok");
