const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function singularOf(surface: string, overrides: Record<string, string>): string {
  const override = overrides[surface]
  if (override) return override
  return surface.endsWith('s') ? surface.slice(0, -1) : surface
}

export function idPrefixFor(surface: string, overrides: Record<string, string>): string {
  return `${singularOf(surface, overrides)}-`
}

export function isValidSlug(s: string): boolean {
  return SLUG.test(s)
}

export function validateElementId(
  id: string,
  surface: string,
  overrides: Record<string, string>,
): string | null {
  const prefix = idPrefixFor(surface, overrides)
  if (!id.startsWith(prefix)) {
    return `id ${id} does not start with ${prefix} (surface ${surface})`
  }
  const slug = id.slice(prefix.length)
  if (!isValidSlug(slug)) {
    return `id ${id} has an invalid slug after ${prefix}: want lowercase kebab-case`
  }
  return null
}
