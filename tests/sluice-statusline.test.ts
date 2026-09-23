import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "skills", "sluice", "scripts", "statusline.sh");
const STATUS = join(import.meta.dir, "..", "skills", "sluice", "scripts", "status.sh");

function repo(): string {
	return mkdtempSync(join(tmpdir(), "sluice-statusline-"));
}

function gitRepo(): string {
	const dir = repo();
	const git = (...args: string[]) =>
		Bun.spawnSync({ cmd: ["git", "-C", dir, ...args], timeout: 10000 });
	git("init", "-q");
	git("config", "user.email", "t@example.com");
	git("config", "user.name", "t");
	writeFileSync(join(dir, "README.md"), "hi\n");
	git("add", "-A");
	git("commit", "-qm", "init");
	return dir;
}

/** A linked worktree of `main`, checked out on a fresh branch. */
function worktree(main: string, branch: string): string {
	const path = join(mkdtempSync(join(tmpdir(), "sluice-wt-")), branch);
	Bun.spawnSync({
		cmd: ["git", "-C", main, "worktree", "add", "-q", path, "-b", branch],
		timeout: 10000,
	});
	return path;
}

function status(dir: string, ...args: string[]) {
	return Bun.spawnSync({ cmd: ["bash", STATUS, ...args, "--dir", dir], timeout: 5000 });
}

/** Opens a deep run in `dir` with one active task. */
function seed(dir: string) {
	status(dir, "init", "--topic", "widget", "--channel", "deep");
	status(dir, "task", "1", "--name", "first", "--status", "active");
}

function render(...args: string[]) {
	const proc = Bun.spawnSync({ cmd: ["bash", SCRIPT, ...args], timeout: 5000 });
	return {
		code: proc.exitCode,
		out: proc.stdout.toString(),
		err: proc.stderr.toString(),
	};
}

describe("statusline.sh syntax", () => {
	test("parses under bash -n", () => {
		const proc = Bun.spawnSync(["bash", "-n", SCRIPT]);
		expect(proc.stderr.toString()).toBe("");
		expect(proc.exitCode).toBe(0);
	});
});

// The whole point of the script: the caller passes a directory and gets back
// either a render or nothing. Every layout question -- own run, worktree set,
// no run at all -- is answered in here, so the caller never encodes one and
// never goes stale when the answer changes.
describe("statusline.sh renders a live run", () => {
	test("a tree holding its own run renders the wide line", () => {
		const dir = gitRepo();
		seed(dir);

		const r = render("--dir", dir);
		expect(r.code).toBe(0);
		expect(r.out).toContain("deep");
		expect(r.out).toContain("widget");
		expect(r.out).toMatch(/T1/);
	});

	// The regression this script exists for: after the run moved into the
	// implementer worktree, a caller gating on its own .sluice/run.json showed
	// nothing from a tree that had none, though status.sh resolves it fine.
	test("a linked worktree with no run of its own renders the set's", () => {
		const main = gitRepo();
		seed(main);

		const r = render("--dir", worktree(main, "impl"));
		expect(r.code).toBe(0);
		expect(r.out).toContain("deep");
		expect(r.out).toMatch(/T1/);
	});

	// The compact render carries the channel and a count; only the wide one
	// carries the topic. Pinning the topic pins the choice this script makes
	// without also pinning how many rows status.sh happens to draw.
	test("the wide render is the one asked for, not the compact one", () => {
		const dir = gitRepo();
		seed(dir);

		expect(render("--dir", dir).out).toContain("widget");
	});

	test("a session in a subdirectory sees the run in its tree", () => {
		const dir = gitRepo();
		seed(dir);
		const nested = join(dir, "a", "b", "c");
		mkdirSync(nested, { recursive: true });

		const r = render("--dir", nested);
		expect(r.code).toBe(0);
		expect(r.out).toContain("widget");
	});

	// The gate stops at a `.git` directory, so the main tree answers "no run
	// here" before status.sh is ever consulted. Once the run has moved into a
	// worktree, that is the one tree the controller's own session is most likely
	// to be sitting in, and its bar went blank on a live run.
	test("the tree the run moved out of still renders it", () => {
		const main = gitRepo();
		seed(main);
		status(main, "move", "--to", worktree(main, "impl"));

		const r = render("--dir", main);
		expect(r.code).toBe(0);
		expect(r.out).toContain("widget");
		expect(r.out).toMatch(/T1/);
	});

	// A directory reached through a symlink has lexical parents that are not its
	// real ones. Walking those climbs away from the tree instead of up it.
	test("a symlinked session directory sees the run behind the link", () => {
		const dir = gitRepo();
		seed(dir);
		const nested = join(dir, "deep", "nested");
		mkdirSync(nested, { recursive: true });
		const link = join(mkdtempSync(join(tmpdir(), "sluice-link-")), "link");
		symlinkSync(nested, link);

		const r = render("--dir", link);
		expect(r.code).toBe(0);
		expect(r.out).toContain("widget");
	});
});

// A status bar renders on every keystroke and has nowhere to put an error. Any
// of these printing would put permanent clutter in the bar, so silence and a
// zero exit is the contract the caller is written against.
describe("statusline.sh is silent where there is nothing to show", () => {
	test("a git tree with no run anywhere prints nothing and exits 0", () => {
		const r = render("--dir", gitRepo());
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
		expect(r.err).toBe("");
	});

	test("a directory that is no git tree prints nothing and exits 0", () => {
		const r = render("--dir", repo());
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
		expect(r.err).toBe("");
	});

	test("a missing directory prints nothing and exits 0", () => {
		const r = render("--dir", join(repo(), "gone"));
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
		expect(r.err).toBe("");
	});

	// With no --dir the script reads the tree it is run from, so the test picks
	// that tree rather than inheriting the suite's, which holds a live run
	// whenever sluice is used on this repo.
	test("no --dir at all prints nothing and exits 0", () => {
		const proc = Bun.spawnSync({
			cmd: ["bash", SCRIPT],
			cwd: repo(),
			timeout: 5000,
		});
		expect(proc.exitCode).toBe(0);
		expect(proc.stdout.toString()).toBe("");
		expect(proc.stderr.toString()).toBe("");
	});

	test("an unreadable run prints nothing and exits 0", () => {
		const dir = gitRepo();
		seed(dir);
		writeFileSync(join(dir, ".sluice", "run.json"), "{ truncated");

		const r = render("--dir", dir);
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
		expect(r.err).toBe("");
	});

	// An unknown flag is a caller bug, but the bar is the wrong place to learn
	// about it: it would print on every render for as long as the session lived.
	test("an unknown flag prints nothing and exits 0", () => {
		const r = render("--wat", "x");
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
		expect(r.err).toBe("");
	});

	// Unchecked, an omitted value makes the next flag the directory, and the
	// field then holds a flag name rather than a path.
	test("--dir with no value prints nothing and exits 0", () => {
		const r = render("--dir");
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
		expect(r.err).toBe("");
	});

	test("--dir followed by another flag prints nothing and exits 0", () => {
		const r = render("--dir", "--full");
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
		expect(r.err).toBe("");
	});

	// The walk stops at an ordinary tree root, so a repo nested inside a repo
	// that holds a run does not inherit its neighbour's render.
	test("a repo nested inside a tree with a run shows nothing of its own", () => {
		const outer = gitRepo();
		seed(outer);
		const inner = join(outer, "vendored");
		mkdirSync(inner, { recursive: true });
		for (const args of [["init", "-q"], ["config", "user.email", "t@example.com"], ["config", "user.name", "t"]]) {
			Bun.spawnSync({ cmd: ["git", "-C", inner, ...args], timeout: 10000 });
		}

		const r = render("--dir", inner);
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
	});
});

// The caller contributes a path and nothing else. If it had to know that a run
// may live in the tree a worktree was cut from, it would break again the next
// time that answer changed -- which is exactly how it broke the first time.
describe("the documented snippet carries no layout knowledge", () => {
	const REF = readFileSync(
		join(import.meta.dir, "..", "skills", "sluice", "references", "status.md"),
		"utf8"
	);

	function snippets(): string[] {
		const out: string[] = [];
		let buf: string[] | null = null;
		for (const line of REF.split("\n")) {
			if (line.startsWith("```")) {
				if (buf) {
					out.push(buf.join("\n"));
					buf = null;
				} else {
					buf = [];
				}
				continue;
			}
			if (buf) buf.push(line);
		}
		return out.filter((b) => b.includes("sluice_line"));
	}

	test("the snippet is carried literally and calls the bundled script", () => {
		const blocks = snippets();
		expect(blocks.length).toBeGreaterThan(0);
		expect(blocks.join("\n")).toContain("statusline.sh");
	});

	test("the snippet tests neither the state file nor the worktree marker", () => {
		for (const block of snippets()) {
			expect(block).not.toContain(".sluice/run.json");
			expect(block).not.toMatch(/-f\s+"\$cwd\/\.git"/);
		}
	});
});

// The installer cannot wire a statusline it did not write: finding the file
// would mean parsing a path out of a shell command string in settings.json,
// which is guessing. So it says what to paste, once, and leaves the file alone.
describe("the install notice", () => {
	const POSTINSTALL = join(
		import.meta.dir,
		"..",
		"skills",
		"sluice",
		"scripts",
		"postinstall.sh"
	);

	/** A config dir with sluice installed under it, and the given settings. */
	function installed(settings: string | null): { root: string; bundle: string } {
		const root = join(mkdtempSync(join(tmpdir(), "sluice-install-")), ".claude");
		const bundle = join(root, "skills", "sluice", "scripts");
		mkdirSync(bundle, { recursive: true });
		writeFileSync(join(bundle, "statusline.sh"), "#!/usr/bin/env bash\n");
		if (settings !== null) writeFileSync(join(root, "settings.json"), settings);
		return { root, bundle };
	}

	function notice(settings: string | null) {
		const { root, bundle } = installed(settings);
		const proc = Bun.spawnSync({
			cmd: ["bash", POSTINSTALL],
			cwd: join(bundle, ".."),
			timeout: 5000,
		});
		return { code: proc.exitCode, out: proc.stdout.toString(), root };
	}

	const WIRED = JSON.stringify({
		statusLine: { type: "command", command: 'bash "$HOME/.claude/statusline-command.sh"' },
	});

	// Pinned as the literal line, not by a fragment. Lose the backslash on `\$(`
	// in the heredoc and the install runs statusline.sh then and there, baking
	// one machine's render into the instructions -- and every fragment-shaped
	// assertion still passes while it happens.
	test("the capture line is emitted exactly as it must be pasted", () => {
		const r = notice(WIRED);
		expect(r.code).toBe(0);
		const script = realpathSync(join(r.root, "skills", "sluice", "scripts", "statusline.sh"));
		expect(r.out).toContain(
			`  sluice_line=$(bash "${script}" --dir "$cwd" 2>/dev/null)`
		);
	});

	test("the print line is emitted exactly as it must be pasted", () => {
		expect(notice(WIRED).out).toContain(
			`  if [ -n "$sluice_line" ]; then printf '%s\\n' "$sluice_line"; fi`
		);
	});

	test("no statusline configured means nothing to paste into, so nothing is said", () => {
		const r = notice(JSON.stringify({ hooks: {} }));
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
	});

	// The install claims an empty slot itself, so the paste instructions would be
	// wrong here: there is nothing left to do and saying so is the useful thing.
	test("a slot the install claimed is reported as ready, not as work to do", () => {
		const { root } = installed(null);
		const script = join(root, "skills", "sluice", "scripts", "statusline-command.sh");
		writeFileSync(script, "#!/usr/bin/env bash\n");
		writeFileSync(
			join(root, "settings.json"),
			JSON.stringify({ statusLine: { type: "command", command: `bash '${script}'` } })
		);
		const proc = Bun.spawnSync({
			cmd: ["bash", POSTINSTALL],
			cwd: join(root, "skills", "sluice"),
			timeout: 5000,
		});
		expect(proc.exitCode).toBe(0);
		const out = proc.stdout.toString();
		expect(out).not.toContain("sluice_line=");
		expect(out).toMatch(/status line/i);
	});

	test("no settings file at all is silent", () => {
		const r = notice(null);
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
	});

	test("unreadable settings are silent rather than fatal to the install", () => {
		const r = notice("{ truncated");
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
	});

	// Someone who pasted the two lines a release ago has nothing left to do, and
	// saying it again every update is the one thing they cannot switch off. The
	// script the slot runs is recovered rather than known, so a command this
	// cannot resolve keeps printing, which is what it did before.
	describe("a statusline that already carries the render", () => {
		/** An install whose configured statusline script holds `body`. */
		function withScript(body: string, command?: string) {
			const { root, bundle } = installed(null);
			const script = join(root, "statusline-command.sh");
			writeFileSync(script, body);
			writeFileSync(
				join(root, "settings.json"),
				JSON.stringify({
					statusLine: {
						type: "command",
						command: command ?? `bash "${script}"`,
					},
				})
			);
			const proc = Bun.spawnSync({ cmd: ["bash", POSTINSTALL], cwd: join(bundle, ".."), timeout: 5000 });
			return { code: proc.exitCode, out: proc.stdout.toString(), root };
		}

		const WIRED_BODY = '#!/usr/bin/env bash\nsluice_line=$(bash "$HOME/.claude/skills/sluice/scripts/statusline.sh" --dir "$cwd" 2>/dev/null)\n';

		test("says nothing, because there is nothing left to paste", () => {
			const r = withScript(WIRED_BODY);
			expect(r.code).toBe(0);
			expect(r.out).toBe("");
		});

		test("still says it when the script does not carry the render", () => {
			const r = withScript("#!/usr/bin/env bash\necho hello\n");
			expect(r.out).toContain("sluice_line=");
		});

		// $HOME and CLAUDE_CONFIG_DIR are the two ways a config path is ever
		// written, and they are expanded by substitution rather than by eval,
		// which on a settings file would be running its contents.
		test("resolves a path written through CLAUDE_CONFIG_DIR", () => {
			const { root, bundle } = installed(null);
			writeFileSync(join(root, "statusline-command.sh"), WIRED_BODY);
			writeFileSync(
				join(root, "settings.json"),
				JSON.stringify({
					statusLine: {
						type: "command",
						command: 'bash "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/statusline-command.sh"',
					},
				})
			);
			const proc = Bun.spawnSync({ cmd: ["bash", POSTINSTALL], cwd: join(bundle, ".."), timeout: 5000 });
			expect(proc.stdout.toString()).toBe("");
		});

		test("a command naming no file it can find keeps printing the instructions", () => {
			const r = withScript(WIRED_BODY, "my-prompt-tool --statusline");
			expect(r.out).toContain("sluice_line=");
		});
	});
});

// The complete statusline command, for a machine that had none. statusline.sh
// takes a path; the harness delivers one as JSON on stdin, so something has to
// bridge the two, and it is the thing settings.json can point at directly.
describe("statusline-command.sh", () => {
	const COMMAND = join(
		import.meta.dir,
		"..",
		"skills",
		"sluice",
		"scripts",
		"statusline-command.sh"
	);

	function feed(json: string) {
		const proc = Bun.spawnSync({
			cmd: ["bash", COMMAND],
			stdin: Buffer.from(json),
			timeout: 5000,
		});
		return {
			code: proc.exitCode,
			out: proc.stdout.toString(),
			err: proc.stderr.toString(),
		};
	}

	test("parses under bash -n", () => {
		const proc = Bun.spawnSync(["bash", "-n", COMMAND]);
		expect(proc.stderr.toString()).toBe("");
		expect(proc.exitCode).toBe(0);
	});

	test("renders the run in workspace.current_dir", () => {
		const dir = gitRepo();
		seed(dir);

		const r = feed(JSON.stringify({ workspace: { current_dir: dir } }));
		expect(r.code).toBe(0);
		expect(r.out).toContain("widget");
		expect(r.out).toMatch(/T1/);
	});

	// The field the harness sends has changed name before, and both spellings
	// are still in the wild, so the older one is a fallback rather than a bug.
	test("falls back to cwd when workspace.current_dir is absent", () => {
		const dir = gitRepo();
		seed(dir);

		const r = feed(JSON.stringify({ cwd: dir }));
		expect(r.code).toBe(0);
		expect(r.out).toContain("widget");
	});

	test("a tree with no run prints nothing and exits 0", () => {
		const r = feed(JSON.stringify({ workspace: { current_dir: gitRepo() } }));
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
		expect(r.err).toBe("");
	});

	test("input that is not JSON prints nothing and exits 0", () => {
		const r = feed("not json at all");
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
		expect(r.err).toBe("");
	});

	test("empty input prints nothing and exits 0", () => {
		const r = feed("");
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
		expect(r.err).toBe("");
	});

	// The harness closes stdin after the JSON, but nothing here can enforce that,
	// and an unbounded read against a pipe nobody closes is a bar that never
	// draws. feed() cannot express this: it always hands over a closed buffer.
	test("a writer that never closes stdin does not hang the render", async () => {
		const proc = Bun.spawn({ cmd: ["bash", COMMAND], stdin: "pipe", stdout: "pipe" });
		proc.stdin.write(JSON.stringify({ workspace: { current_dir: gitRepo() } }));
		proc.stdin.flush();

		const exited = await Promise.race([
			proc.exited,
			new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 8000)),
		]);
		if (exited === "hung") proc.kill();
		expect(exited).not.toBe("hung");
	}, 15000);

	// Nothing is drawn until a run exists, which is the whole shape of this
	// statusline: it is the run's row, not a prompt someone has to like.
	test("it prints no trailing blank line when there is no run", () => {
		const r = feed(JSON.stringify({ workspace: { current_dir: gitRepo() } }));
		expect(r.out).not.toBe("\n");
		expect(r.out.length).toBe(0);
	});
});
