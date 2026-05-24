import { validateManifest, type SkillManifest } from "./types";

const REPO = "iceinvein/agent-skills";
const BRANCH = "master";
const BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

export function buildRawUrl(skillName: string, filePath: string): string {
  return `${BASE}/skills/${skillName}/${filePath}`;
}

type FetchManifestResult =
  | { ok: true; manifest: SkillManifest }
  | { ok: false; error: string };

export async function fetchSkillManifest(skillName: string): Promise<FetchManifestResult> {
  const url = buildRawUrl(skillName, "skill.json");
  const res = await fetch(url);

  if (res.status === 404) {
    return { ok: false, error: `Skill '${skillName}' not found` };
  }
  if (!res.ok) {
    return { ok: false, error: `Failed to fetch manifest: HTTP ${res.status}` };
  }

  const data = await res.json();
  return validateManifest(data);
}

type FetchFileResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

export async function fetchSkillFile(skillName: string, filePath: string): Promise<FetchFileResult> {
  const url = buildRawUrl(skillName, filePath);
  const res = await fetch(url);

  if (!res.ok) {
    return { ok: false, error: `Failed to fetch '${filePath}': HTTP ${res.status}` };
  }

  const content = await res.text();
  return { ok: true, content };
}

export async function fetchAllSkillFiles(
  skillName: string,
  manifest: SkillManifest
): Promise<Map<string, string> | { error: string }> {
  const files = new Map<string, string>();

  if (manifest.files?.prompt) {
    const result = await fetchSkillFile(skillName, manifest.files.prompt);
    if (!result.ok) return { error: result.error };
    files.set(manifest.files.prompt, result.content);
  }

  if (manifest.files?.supporting) {
    for (const supportFile of manifest.files.supporting) {
      const result = await fetchSkillFile(skillName, supportFile);
      if (!result.ok) return { error: result.error };
      files.set(supportFile, result.content);
    }
  }

  if (manifest.bundle) {
    const treeResult = await fetchSkillTree(skillName);
    if (!treeResult.ok) return { error: treeResult.error };

    const bundlePaths = resolveBundlePaths(treeResult.entries, manifest.bundle);
    for (const relPath of bundlePaths) {
      if (files.has(relPath)) continue;
      const result = await fetchSkillFile(skillName, relPath);
      if (!result.ok) return { error: result.error };
      files.set(relPath, result.content);
    }
  }

  return files;
}

export type TreeEntry = { path: string; type: "blob" | "tree" };

type FetchTreeResult =
  | { ok: true; entries: TreeEntry[] }
  | { ok: false; error: string };

export async function fetchSkillTree(skillName: string): Promise<FetchTreeResult> {
  const url = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    return { ok: false, error: `Failed to fetch repo tree: HTTP ${res.status}` };
  }
  const data = (await res.json()) as { tree: Array<{ path: string; type: string }>; truncated?: boolean };
  if (data.truncated) {
    return { ok: false, error: "GitHub tree response was truncated; skill bundle too large to enumerate" };
  }

  const prefix = `skills/${skillName}/`;
  const entries: TreeEntry[] = data.tree
    .filter((e) => e.path.startsWith(prefix) && (e.type === "blob" || e.type === "tree"))
    .map((e) => ({ path: e.path.slice(prefix.length), type: e.type as "blob" | "tree" }));

  return { ok: true, entries };
}

export function resolveBundlePaths(entries: TreeEntry[], bundle: { include: string[]; exclude?: string[] }): string[] {
  const excludes = bundle.exclude ?? [];
  const isExcluded = (p: string) => excludes.some((ex) => p === ex || p.startsWith(ex));

  const dirs = new Set<string>();
  const files = new Set<string>();
  for (const entry of entries) {
    if (entry.type === "tree") dirs.add(entry.path);
    else files.add(entry.path);
  }

  const result = new Set<string>();
  for (const include of bundle.include) {
    if (dirs.has(include)) {
      const prefix = include.endsWith("/") ? include : include + "/";
      for (const f of files) {
        if (f.startsWith(prefix) && !isExcluded(f)) result.add(f);
      }
    } else if (files.has(include)) {
      if (!isExcluded(include)) result.add(include);
    }
    // Silently skip entries that match nothing; install will surface missing files via fetch errors only if they were declared as prompt.
  }

  return [...result].sort();
}
