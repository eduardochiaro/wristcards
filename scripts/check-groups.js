// A level file is read on the watch by scanning bytes: "# Name" opens a group
// and every line under it is a "front|back" card, up to the next header or the
// end of the file. Nothing records how many cards a group has, so the only way
// to break a level is to break that shape. Run: node scripts/check-groups.js
import { readFileSync } from "node:fs";
import assert from "node:assert";

const root = new URL("../src/embeddedjs/", import.meta.url);
const apps = JSON.parse(readFileSync(new URL("../apps.json", import.meta.url)));

// Every language's levels, checked as one list. Each ships as its own app, but
// they are all built from these files.
const levels = apps.flatMap(({ code, name }) =>
	JSON.parse(readFileSync(new URL(`langs/${code}.json`, root))).levels
		.map(level => ({ ...level, name: `${name} ${level.name}` })));

for (const level of levels) {
	const text = readFileSync(new URL(`levels/${level.file}`, root), "utf8");
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
