// A level file is read on the watch by scanning bytes: "# Name" opens a group
// and every line under it is a "front|back" card, up to the next header or the
// end of the file. Nothing records how many cards a group has, so the only way
// to break a level is to break that shape. Run: node scripts/check-groups.js
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert";

const root = new URL("../packs/", import.meta.url);

// Every pack's levels, checked as one list. A pack is what the phone downloads:
// <id>.json naming the levels, and the level files beside it.
const levels = readdirSync(root).filter(file => file.endsWith(".json")).flatMap(file =>
	JSON.parse(readFileSync(new URL(file, root))).levels
		.map(level => ({ ...level, name: `${file.slice(0, -5)} ${level.name}` })));

for (const level of levels) {
	const text = readFileSync(new URL(level.file, root), "utf8");
	assert.ok(text.endsWith("\n"), `${level.file}: needs a trailing newline`);

	const groups = new Map();
	let open = null;
	for (const [i, line] of text.split("\n").slice(0, -1).entries()) {
		const where = `${level.file}:${i + 1}`;
		if (line.startsWith("#")) {
			assert.ok(line.startsWith("# ") && (line.length > 2), `${where}: "${line}" needs a name`);
			open = line.slice(2);
			assert.ok(!groups.has(open), `${where}: "${open}" is already a group`);
			groups.set(open, 0);
			continue;
		}
		assert.ok(open, `${where}: "${line}" sits above the first group`);
		assert.ok(line.includes("|"), `${where}: "${line}" has no | separator`);
		groups.set(open, groups.get(open) + 1);
	}

	for (const [name, cards] of groups)
		assert.ok(cards, `${level.file}: group "${name}" has no cards`);
	const total = [...groups.values()].reduce((a, b) => a + b, 0);
	console.log(`${level.name}: ${groups.size} groups, ${total} cards`);
}
