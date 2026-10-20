import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Scripts that record to the board must never touch the real one under
// ~/.claude while the suite runs.
process.env.SLUICE_BOARD_DIR = mkdtempSync(join(tmpdir(), "sluice-board-"));
