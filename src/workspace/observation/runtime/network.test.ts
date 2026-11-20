// FR-018: the journal stays on the machine. No file of the module reaches the
// network or a model: no socket, no HTTP client, no `fetch`, no model SDK.
// A file is read with the TypeScript parser, so a comment or a string is no
// code and every way of importing is seen (import, import type, side effect,
// export from, import(), require(), import = require).

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const MODULE = path.resolve(__dirname, '..')

/** Network clients and servers, and the SDKs of language models. */
const NETWORK_MODULES = [
  'ws', 'http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns', 'undici', 'node-fetch', 'axios', 'got',
  'node-datachannel', 'bonjour-service', '@anthropic-ai/sdk', '@anthropic-ai/claude-agent-sdk', 'openai',
  '@google/generative-ai', '@google/genai', 'ollama',
]
/** What a page or a runtime calls to reach out. */
const NETWORK_NAMES = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'RTCPeerConnection', 'sendBeacon']

/** The module itself, its `node:` form, or a path inside it. */
function isNetworkModule(specifier: string): boolean {
  const bare = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier
  return NETWORK_MODULES.some((name) => bare === name || bare.startsWith(`${name}/`))
}

/** The module a node imports, whatever the form, when it names it with a string. */
function importedModule(node: ts.Node): string | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    return node.moduleSpecifier.text
  }
  if (ts.isExternalModuleReference(node) && ts.isStringLiteral(node.expression)) return node.expression.text
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) return node.argument.literal.text
  if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
    const callee = node.expression
    if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) return node.arguments[0].text
  }
  return undefined
}

/** The network modules a piece of code imports and the network names it uses. */
function violations(code: string): string[] {
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    const specifier = importedModule(node)
    if (specifier !== undefined && isNetworkModule(specifier)) found.push(specifier)
    if (ts.isIdentifier(node) && NETWORK_NAMES.includes(node.text)) found.push(node.text)
    ts.forEachChild(node, visit)
  }
  // The file name is only a label for the parser: the code is TypeScript.
  visit(ts.createSourceFile('', code, ts.ScriptTarget.Latest))
  return found
}

/** A file of the module that ships: neither a test nor a test helper. */
function isShippedSource(name: string): boolean {
  return name.endsWith('.ts') && !name.includes('.test')
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(file)
    return isShippedSource(entry.name) ? [file] : []
  })
}

const files = sourceFiles(MODULE).map((file) => path.relative(MODULE, file).split(path.sep).join('/')).sort()

describe('the list of what the module must not reach', () => {
  it('names these network modules and model SDKs', () => {
    expect(NETWORK_MODULES).toEqual([
      'ws', 'http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns', 'undici', 'node-fetch', 'axios', 'got',
      'node-datachannel', 'bonjour-service', '@anthropic-ai/sdk', '@anthropic-ai/claude-agent-sdk', 'openai',
      '@google/generative-ai', '@google/genai', 'ollama',
    ])
  })

  it('names these network APIs', () => {
    expect(NETWORK_NAMES).toEqual(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'RTCPeerConnection', 'sendBeacon'])
  })
})

describe('the scanner', () => {
  it.each(NETWORK_MODULES)('sees %s bare, as a node: module and by a path inside it', (name) => {
    expect(violations(`import x from '${name}'`)).toEqual([name])
    expect(violations(`import x from 'node:${name}'`)).toEqual([`node:${name}`])
    expect(violations(`import x from '${name}/lib'`)).toEqual([`${name}/lib`])
  })

  it('sees every way of importing a module', () => {
    for (const code of [
      "import x from 'ws'",
      "import { x } from 'ws'",
      "import * as x from 'ws'",
      "import type { X } from 'ws'",
      "import 'ws'",
      "export * from 'ws'",
      "export { x } from 'ws'",
      "import x = require('ws')",
      "const x = require('ws')",
      "const x = await import('ws')",
      "type X = import('ws').Server",
      "import {\n  x,\n} from\n  'ws'",
    ]) expect(violations(code), code).toEqual(['ws'])
  })

  it('does not see another module, a path of the module, or what is no import', () => {
    for (const code of [
      "import x from 'node:fs'",
      "import x from './ws'",
      "import x from '../http'",
      "import x from 'http-status'",
      "import x from 'wsx'",
      "import x from 'nodehttp'",
      "import x from 'xnode:http'",
      'export const ws = 1',
      'const x = 1\nexport { x }',
      'export {}',
      "const x = other('ws')",
      "const x = a.require('ws')",
      'const x = require(name)',
      'const x = import(name)',
      'const x = require()',
      'const x = import()',
      "// import x from 'ws'",
      "/* const x = require('ws') */",
      'const s = "import x from \'ws\'"',
      "type X = import('node:fs').Stats",
      "type X = typeof import('node:path')",
    ]) expect(violations(code), code).toEqual([])
  })

  it.each(NETWORK_NAMES)('sees %s called, constructed or reached through an object', (name) => {
    expect(violations(`${name}(url)`)).toEqual([name])
    expect(violations(`new ${name}(url)`)).toEqual([name])
    expect(violations(`navigator.${name}(url)`)).toEqual([name])
    expect(violations(`globalThis.${name}`)).toEqual([name])
  })

  it('does not see a network name in a comment, a string or a longer name', () => {
    for (const code of [
      '// fetch(url)',
      '/* new WebSocket(url) */',
      "const a = 'fetch'",
      'const a = `XMLHttpRequest ${1}`',
      'const fetchAll = 1',
      'const myWebSocket = 1',
      'const sendBeaconCount = 1',
      'const Fetch = 1',
    ]) expect(violations(code), code).toEqual([])
  })

  it('lists each hit, in the order of the code', () => {
    expect(violations("import a from 'http'\nimport b from 'ws'\nfetch(1)")).toEqual(['http', 'ws', 'fetch'])
  })

  it('takes a source file of the module and no test file or helper', () => {
    expect(isShippedSource('journal.ts')).toBe(true)
    expect(isShippedSource('contract.ts')).toBe(true)
    expect(isShippedSource('journal.test.ts')).toBe(false)
    expect(isShippedSource('testing.test-helpers.ts')).toBe(false)
    expect(isShippedSource('index.test.tsx')).toBe(false)
    expect(isShippedSource('notes.md')).toBe(false)
    expect(isShippedSource('data.json')).toBe(false)
    expect(isShippedSource('ts')).toBe(false)
  })
})

describe('the observation module and the network', () => {
  it('scans the contract and the runtime, and no test', () => {
    for (const anchor of [
      'contract.ts',
      'contract/observation.ts',
      'contract/rules.ts',
      'contract/settings.ts',
      'runtime/index.ts',
      'runtime/journal.ts',
      'runtime/purge.ts',
      'runtime/read.ts',
      'runtime/sources.ts',
    ]) expect(files, anchor).toContain(anchor)
    expect(files.filter((file) => file.includes('.test'))).toEqual([])
  })

  it('imports no network module and no model SDK, and calls no network API, in any file', () => {
    for (const file of files) expect(violations(readFileSync(path.join(MODULE, file), 'utf8')), file).toEqual([])
  })
})
