export type BumpLevel = "patch" | "minor" | "major";

export function bumpVersion(current: string, level: BumpLevel): string {
  const parts = current.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
    throw new Error(`Invalid semver version: '${current}'`);
  }

  const [major, minor, patch] = parts.map(Number);

  switch (level) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}
