import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const STATUS = join(import.meta.dir, "..", "skills", "sluice", "scripts", "status.sh");
const REAL_RUNS = join(homedir(), ".claude", "sluice", "board", "runs");

function count(dir: string): number {
	return existsSync(dir) ? readdirSync(dir).length : 0;
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

test("a script spawned with no env records its run on the suite's board, not the real one", () => {
	const board = process.env.SLUICE_BOARD_DIR ?? "";
	const realBefore = count(REAL_RUNS);
	const suiteBefore = count(join(board, "runs"));
	const proc = Bun.spawnSync({
		cmd: ["bash", STATUS, "init", "--topic", "iso", "--channel", "deep", "--dir", gitRepo()],
		timeout: 10000,
	});
	expect(proc.exitCode).toBe(0);
	expect(count(join(board, "runs"))).toBe(suiteBefore + 1);
	expect(count(REAL_RUNS)).toBe(realBefore);
});
