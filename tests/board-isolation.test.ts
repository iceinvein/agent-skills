import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const STATUS = join(import.meta.dir, "..", "skills", "sluice", "scripts", "status.sh");
const REAL_RUNS = join(homedir(), ".claude", "sluice", "board", "runs");

/** The pointer name board-index.sh gives a tree: its physical path, % then / escaped. */
function pointerKey(dir: string): string {
	return realpathSync(dir).replaceAll("%", "%25").replaceAll("/", "%2F");
}

function gitRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "sluice-iso-"));
	Bun.spawnSync({ cmd: ["git", "-C", dir, "init", "-q"], timeout: 10000 });
	return dir;
}

test("a child spawned with no env sees the suite's board dir", () => {
	const proc = Bun.spawnSync({ cmd: ["bash", "-c", 'printf %s "$SLUICE_BOARD_DIR"'] });
	const seen = proc.stdout.toString();
	expect(seen).not.toBe("");
	expect(seen).toBe(process.env.SLUICE_BOARD_DIR ?? "");
});

test("a child spawned with env set to undefined still sees the suite's board dir", () => {
	const proc = Bun.spawnSync({ cmd: ["bash", "-c", 'printf %s "$SLUICE_BOARD_DIR"'], env: undefined });
	const seen = proc.stdout.toString();
	expect(seen).not.toBe("");
	expect(seen).toBe(process.env.SLUICE_BOARD_DIR ?? "");
});

test("a script spawned with no env records its run on the suite's board, not the real one", () => {
	const board = process.env.SLUICE_BOARD_DIR ?? "";
	const dir = gitRepo();
	const proc = Bun.spawnSync({
		cmd: ["bash", STATUS, "init", "--topic", "iso", "--channel", "deep", "--dir", dir],
		timeout: 10000,
	});
	expect(proc.exitCode).toBe(0);
	expect(existsSync(join(board, "runs", pointerKey(dir)))).toBe(true);
	expect(existsSync(join(REAL_RUNS, pointerKey(dir)))).toBe(false);
});
