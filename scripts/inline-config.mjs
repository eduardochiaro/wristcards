// The settings page travels inside the app: pkjs hands the phone the whole page
// rather than a link to one, so there is nothing to publish and no way for the
// page to be older than the app that opened it. This turns packs/config.html
// into the module pkjs requires. Run by every build script.
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync(new URL("../packs/config.html", import.meta.url), "utf8");
writeFileSync(new URL("../src/pkjs/config.js", import.meta.url),
	`// Generated from packs/config.html by scripts/inline-config.js. Do not edit.\nmodule.exports = ${JSON.stringify(html)};\n`);
