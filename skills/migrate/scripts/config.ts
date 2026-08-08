import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { storePaths } from './paths.ts'

export const DEFAULT_SURFACES: readonly string[] = [
  'routes',
  'tables',
  'jobs',
  'reports',
  'screens',
  'integrations',
  'workflows',
  'settings',
]

export const DEFAULT_CLOSERS: readonly string[] = [
  'cross-capability-workflow',
  'scope-injection',
  'read-write-symmetry',
]

export type Config = {
  source: {
    path: string
    scope: string
    stack: string
    vcs: string
    basis: 'runnable' | 'source-only'
  }
  target: {
    name: string
    stack: string
    parity_test_path: string
    layout: Record<string, string>
    commands: Record<string, string>
  }
  surfaces: string[]
  surfaceSingular: Record<string, string>
  closers: string[]
  handoff: { adapter: string }
}

export type ConfigInit = {
  sourcePath: string
  scope: string
  targetName: string
  sourceStack?: string
  targetStack?: string
  vcs?: string
  basis?: 'runnable' | 'source-only'
}

// Values substituted into the TOML template come from operator-typed free text
// (--scope, --name, and friends), not from anything shaped like TOML syntax. A
// quote, a backslash, a newline, or a control character must round-trip through
// loadConfig byte-identical, not be interpreted as TOML escape/string syntax.
//
// Bun.TOML.parse (verified directly against Bun 1.3.14) has two quirks that
// shape this function:
//   1. The named escapes for tab and form feed decode swapped: writing the
//      tab escape reads back as the form feed code point, and vice versa.
//      Tab is therefore emitted as a literal character rather than escaped
//      (the TOML spec permits a raw, unescaped tab inside a basic string, and
//      Bun reads that back correctly), and form feed is emitted via a
//      four-hex-digit unicode escape instead of its named escape.
//   2. A four-hex-digit unicode escape only decodes correctly for the C0
//      control codes that coincide with a named escape (backspace, tab,
//      newline, form feed, carriage return) and for the delete character;
//      every other C0 control fails to parse back at all, named or
//      unicode-escaped, so a config.toml written with one of those bytes
//      could never be read again. Those bytes cannot occur from real CLI
//      text (a NUL byte cannot even survive in argv), so rather than
//      silently write a store loadConfig can never reopen, this rejects
//      them with a clear diagnostic instead.
const TOML_NAMED_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '"': '\\"',
  '\b': '\\b',
  '\n': '\\n',
  '\r': '\\r',
}

const FORM_FEED = String.fromCharCode(0x0c)
const DEL = String.fromCharCode(0x7f)

// Every C0 control other than tab (code point 9) must be escaped in a TOML
// basic string. Tab, newline, carriage return and backspace are excluded from
// this set because they are handled above; form feed and delete are excluded
// because they are handled via a working unicode escape just below. What
// remains is what Bun's TOML reader cannot represent by any means. Built from
// explicit code points, rather than a literal character class, so no raw
// control bytes sit in this source file.
const UNREPRESENTABLE_CODES = [
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x0b, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14,
  0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
]
const UNREPRESENTABLE = new Set(UNREPRESENTABLE_CODES)

function escapeTomlString(value: string, where: string): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (UNREPRESENTABLE.has(code)) {
      throw new Error(
        `config.toml: ${where} contains U+${code.toString(16).padStart(4, '0')}, ` +
          'a control character this store cannot represent in config.toml',
      )
    }
    if (ch === '\t') {
      // Literal tab: legal unescaped in a TOML basic string, and the one
      // representation Bun's reader decodes correctly (see note above).
      out += ch
      continue
    }
    if (ch === FORM_FEED) {
      out += '\\u000c'
      continue
    }
    if (ch === DEL) {
      out += '\\u007f'
      continue
    }
    out += TOML_NAMED_ESCAPES[ch] ?? ch
  }
  return out
}

// A plain replaceAll(placeholder, replacement) treats a $-pattern inside the
// replacement string as a substitution directive (`$&`, `$$`, `$'`, ...), even
// though the placeholder is a literal string, not a regex. A callback
// replacement is used verbatim instead, so an escaped value that happens to
// contain a dollar sign cannot reintroduce corruption after escaping removed
// the TOML-specific risk.
function substitute(text: string, placeholder: string, value: string): string {
  return text.replaceAll(placeholder, () => value)
}

function req(obj: Record<string, unknown> | undefined, key: string, where: string): string {
  const value = obj?.[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`config.toml: missing or empty ${where}.${key}`)
  }
  return value
}

export async function loadConfig(root: string): Promise<Config> {
  const path = storePaths(root).config
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    throw new Error(`config.toml not found at ${path}; run 'migrate init' first`)
  }
  const raw = Bun.TOML.parse(text) as Record<string, Record<string, unknown> | undefined>
  const source = raw.source
  const target = raw.target
  const sourcePath = req(source, 'path', 'source')
  const sourceScope = req(source, 'scope', 'source')
  const sourceStack = req(source, 'stack', 'source')
  const sourceVcs = req(source, 'vcs', 'source')
  const basis = req(source, 'basis', 'source')
  if (basis !== 'runnable' && basis !== 'source-only') {
    throw new Error(`config.toml: source.basis must be runnable or source-only, got ${basis}`)
  }
  const surfacesTable = raw.surfaces
  const declared = surfacesTable?.types
  const singular = (surfacesTable?.singular ?? {}) as Record<string, string>
  const closersTable = raw.closers
  const declaredClosers = closersTable?.set
  const handoffTable = raw.handoff

  return {
    source: {
      path: sourcePath,
      scope: sourceScope,
      stack: sourceStack,
      vcs: sourceVcs,
      basis,
    },
    target: {
      name: req(target, 'name', 'target'),
      stack: req(target, 'stack', 'target'),
      parity_test_path: req(target, 'parity_test_path', 'target'),
      layout: (target?.layout ?? {}) as Record<string, string>,
      commands: (target?.commands ?? {}) as Record<string, string>,
    },
    surfaces: Array.isArray(declared) ? (declared as string[]) : [...DEFAULT_SURFACES],
    surfaceSingular: singular,
    closers: Array.isArray(declaredClosers) ? (declaredClosers as string[]) : [...DEFAULT_CLOSERS],
    handoff: { adapter: (handoffTable?.adapter as string | undefined) ?? 'markdown' },
  }
}

export async function writeConfig(root: string, init: ConfigInit): Promise<void> {
  const templatePath = join(import.meta.dir, '..', 'templates', 'config.toml')
  const template = await readFile(templatePath, 'utf8')
  let rendered = template
  rendered = substitute(
    rendered,
    '{{SOURCE_PATH}}',
    escapeTomlString(init.sourcePath, 'source.path'),
  )
  rendered = substitute(rendered, '{{SCOPE}}', escapeTomlString(init.scope, 'source.scope'))
  rendered = substitute(
    rendered,
    '{{SOURCE_STACK}}',
    escapeTomlString(init.sourceStack ?? 'unknown', 'source.stack'),
  )
  rendered = substitute(rendered, '{{VCS}}', escapeTomlString(init.vcs ?? 'none', 'source.vcs'))
  rendered = substitute(
    rendered,
    '{{BASIS}}',
    escapeTomlString(init.basis ?? 'source-only', 'source.basis'),
  )
  rendered = substitute(
    rendered,
    '{{TARGET_NAME}}',
    escapeTomlString(init.targetName, 'target.name'),
  )
  rendered = substitute(
    rendered,
    '{{TARGET_STACK}}',
    escapeTomlString(init.targetStack ?? 'unknown', 'target.stack'),
  )
  // Deliberately a plain writeFile, not writeAtomically. Routing it through
  // that helper would make writeConfig itself refuse to render a config whose
  // declared source.path contains the store, which sounds right but is the
  // wrong layer for the decision: this function renders a declaration, and
  // whether the declaration is usable is init-cmd.ts's call, made there
  // against all three of init's write targets before anything is created.
  // Putting the refusal here as well would also make the one state those
  // downstream guards exist for -- a config.toml hand-edited after the fact to
  // point at a source containing its own store -- unconstructible through this
  // API, and it is that hand-edit, not init, that reaches them in practice.
  // The containment invariant still holds: init-cmd.ts guards this path.
  await writeFile(storePaths(root).config, rendered)
}
