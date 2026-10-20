import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Scripts that record to the board must never touch the real one under
// ~/.claude while the suite runs.
process.env.SLUICE_BOARD_DIR = mkdtempSync(join(tmpdir(), "sluice-board-"));

// Bun.spawn and Bun.spawnSync hand a child given no `env` the environment bun
// started with, not process.env as changed above, and neither Bun.env nor a
// bunfig setting changes that. Defaulting `env` to process.env is what makes
// the board dir above reach every child a test spawns.
type SpawnArgs = [cmd: string[], options?: object] | [options: { cmd: string[]; env?: object }];

function withSuiteEnv(args: SpawnArgs): SpawnArgs {
	const [first, options] = args;
	if (Array.isArray(first)) return [first, { env: process.env, ...options }];
	return [{ env: process.env, ...first }];
}

const spawn = Bun.spawn;
const spawnSync = Bun.spawnSync;
Bun.spawn = ((...args: SpawnArgs) => Reflect.apply(spawn, Bun, withSuiteEnv(args))) as typeof Bun.spawn;
Bun.spawnSync = ((...args: SpawnArgs) => Reflect.apply(spawnSync, Bun, withSuiteEnv(args))) as typeof Bun.spawnSync;
