import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// A case's `plugins` list replaces the plugin under test, and every entry must
// sit inside the case's own directory, so a case that needs two skills loaded
// keeps a copy of each under evals/<case>/plugins/<name>/. This keeps those
// copies equal to what each skill ships, so a case never measures a stale skill.

export type PluginCopy = { source: string; copy: string };

function filesUnder(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		return entry.isDirectory() ? filesUnder(path) : [path];
	});
}

/**
 * Paths, relative to the skill, of what an install ships: SKILL.md, skill.json,
 * each files.supporting path and each bundle.include path.
 */
export function shippedFiles(skillDir: string): string[] {
	const manifestPath = join(skillDir, "skill.json");
	if (!existsSync(join(skillDir, "SKILL.md")) || !existsSync(manifestPath)) {
		throw new Error(`${skillDir} has no SKILL.md and skill.json to copy`);
	}
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
		files?: { supporting?: string[] };
		bundle?: { include?: string[] };
	};
	const files = new Set(["SKILL.md", "skill.json"]);
	for (const listed of [...(manifest.files?.supporting ?? []), ...(manifest.bundle?.include ?? [])]) {
		const path = resolve(skillDir, listed);
		const inside = relative(skillDir, path);
		if (inside === "" || inside.split(sep)[0] === ".." || isAbsolute(inside)) {
			throw new Error(`${manifestPath} lists ${listed}, which is outside the skill`);
		}
		if (!existsSync(path)) throw new Error(`${manifestPath} lists ${listed}, which does not exist`);
		const found = statSync(path).isDirectory() ? filesUnder(path) : [path];
		for (const file of found) files.add(relative(skillDir, file));
	}
	return [...files].sort();
}

const sameFile = (a: string, b: string): boolean =>
	statSync(a).mode === statSync(b).mode && readFileSync(a).equals(readFileSync(b));

/** Every skills/<skill>/evals/<case>/plugins/<name>/ under root, paired with skills/<name>/. */
export function pluginCopies(root: string): PluginCopy[] {
	const skills = join(root, "skills");
	const copies: PluginCopy[] = [];
	for (const skill of readdirSync(skills).sort()) {
		const evals = join(skills, skill, "evals");
		if (!existsSync(evals)) continue;
		for (const evalCase of readdirSync(evals).sort()) {
			const plugins = join(evals, evalCase, "plugins");
			if (!existsSync(plugins) || !statSync(plugins).isDirectory()) continue;
			for (const name of readdirSync(plugins).sort()) {
				const source = join(skills, name);
				if (!existsSync(source)) {
					throw new Error(`${join(plugins, name)} copies skills/${name}, which does not exist`);
				}
				copies.push({ source, copy: join(plugins, name) });
			}
		}
	}
	return copies;
}

/** Paths, relative to the copy, that are missing, extra, or different from the source's shipped files. */
export function copyDrift(source: string, copy: string): string[] {
	const shipped = shippedFiles(source);
	const present = existsSync(copy) ? filesUnder(copy).map((file) => relative(copy, file)) : [];
	const drift = present.filter((path) => !shipped.includes(path));
	for (const path of shipped) {
		const copied = join(copy, path);
		if (!existsSync(copied) || !sameFile(copied, join(source, path))) drift.push(path);
	}
	return drift.sort();
}

export function syncPluginCopies(root: string): PluginCopy[] {
	const copies = pluginCopies(root);
	for (const { source, copy } of copies) {
		const shipped = shippedFiles(source);
		rmSync(copy, { recursive: true, force: true });
		for (const path of shipped) {
			mkdirSync(dirname(join(copy, path)), { recursive: true });
			copyFileSync(join(source, path), join(copy, path));
		}
	}
	return copies;
}

if (import.meta.main) {
	const root = join(import.meta.dir, "..");
	for (const { copy } of syncPluginCopies(root)) console.log(`wrote ${relative(root, copy)}`);
}
