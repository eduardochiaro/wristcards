// One watchapp per language, all from this one source tree.
//
// A Moddable mod is resident in the watchapp's RAM, decks and all, so a single
// build carrying every language leaves the JS heap with nothing to run in. Each
// language therefore ships as its own app with its own UUID.
//
// The project is copied to a temp directory and the copy is stripped down to
// one language before `pebble build` runs, so nothing here edits your tree.
//
// Run: node scripts/release.js [code ...] [--emulator[=name]] [--phone]
//   no codes            every app in apps.json, or the first one when installing
//   --emulator[=name]   install the result on that emulator (default emery)
//   --phone             install the result on the watch
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const apps = JSON.parse(readFileSync(path.join(root, "apps.json")));

// Bare words are language codes, so the emulator name comes with its flag. The
// npm scripts already pass a flag and the user's own is appended after it, so
// the last one given wins: `npm run emulator -- fr --emulator=gabbro`.
const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith("--"));
const emulator = flags.filter(a => a.startsWith("--emulator")).pop();
const install = flags.includes("--phone") ? ["--phone"]
	: emulator ? ["--emulator", emulator.split("=")[1] || "emery"]
	: null;
const wanted = args.filter(a => !a.startsWith("--"));

// Installing five apps at once is nobody's intent, so a bare install builds one.
const building = wanted.length ? wanted.map(code => {
	const app = apps.find(a => a.code === code);
	if (!app)
		throw new Error(`no app for "${code}" in apps.json`);
	return app;
}) : install ? [apps[0]] : apps;

const edit = (file, change) => {
	const json = JSON.parse(readFileSync(file));
	change(json);
	writeFileSync(file, JSON.stringify(json, null, "\t") + "\n");
};

const dist = path.join(root, "dist");
mkdirSync(dist, { recursive: true });

for (const app of building) {
	const work = path.join(tmpdir(), `wristcards-${app.code}`);
	rmSync(work, { recursive: true, force: true });
	cpSync(root, work, {
		recursive: true,
		filter: src => !/\/(node_modules|build|dist|\.git)$/.test(src),
	});

	// The manifest globs whole folders, so the other languages are removed
	// rather than the globs narrowed.
	const embedded = path.join(work, "src/embeddedjs");
	for (const dir of ["levels", "langs"])
		for (const file of readdirSync(path.join(embedded, dir)))
			if (!file.startsWith(app.code))
				rmSync(path.join(embedded, dir, file));

	edit(path.join(embedded, "data.json"), data => {
		data.language = app.code;
		if (app.colors)
			data.colors = app.colors;
		data.ordered = !!app.ordered;
	});
	edit(path.join(work, "package.json"), pkg => {
		pkg.pebble.uuid = app.uuid;
		pkg.pebble.displayName = app.name;
	});

	execFileSync("npm", ["run", "build"], { cwd: work, stdio: "inherit" });

	const pbw = readdirSync(path.join(work, "build")).find(f => f.endsWith(".pbw"));
	const out = path.join(dist, `wristcards-${app.code}.pbw`);
	cpSync(path.join(work, "build", pbw), out);
	rmSync(work, { recursive: true, force: true });
	console.log(`${app.name}: ${out}`);

	if (install)
		execFileSync("pebble", ["install", out, ...install], { stdio: "inherit" });
}
