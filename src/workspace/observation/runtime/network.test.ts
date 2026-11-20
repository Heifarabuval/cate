// FR-018: the journal stays on the machine. No file of the module reaches the
// network or a model: no socket, no HTTP client, no `fetch`, no model SDK.

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const MODULE = path.resolve(__dirname, '..')

const FORBIDDEN_MODULES = [
  'ws', 'http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns', 'node:http', 'node:https', 'node:http2', 'node:net',
  'node:tls', 'node:dgram', 'node:dns', 'node-fetch', 'undici', 'axios', 'got', 'node-datachannel', 'bonjour-service',
  '@anthropic-ai/sdk', '@anthropic-ai/claude-agent-sdk', 'openai', '@google/generative-ai', '@google/genai', 'ollama',
]
const FORBIDDEN_GLOBALS = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection)\b|sendBeacon/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(file)
    return /\.tsx?$/.test(entry.name) && !/\.test(?:-helpers)?\.tsx?$/.test(entry.name) ? [file] : []
  })
}

const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

function violations(text: string): string[] {
  const code = withoutComments(text)
  const specifiers = [...code.matchAll(/(?:from|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)].map((match) => match[1])
  const modules = specifiers.filter((specifier) => FORBIDDEN_MODULES.some((name) => specifier === name || specifier.startsWith(`${name}/`)))
  const globals = FORBIDDEN_GLOBALS.exec(code)
  return [...modules, ...(globals ? [globals[0]] : [])]
}

describe('the observation module and the network', () => {
  it('sees an import of a network module or a model SDK, and a global call', () => {
    expect(violations("import http from 'node:http'")).toEqual(['node:http'])
    expect(violations("import { WebSocket } from 'ws'")).toEqual(['ws', 'WebSocket'])
    expect(violations("const x = await import('undici')")).toEqual(['undici'])
    expect(violations("import Anthropic from '@anthropic-ai/sdk'")).toEqual(['@anthropic-ai/sdk'])
    expect(violations("await fetch('https://example.com')")).toEqual(['fetch'])
    expect(violations("// fetch(url) in a comment\nimport fs from 'node:fs'")).toEqual([])
  })

  it('imports none of them, in any file of the module', () => {
    const files = sourceFiles(MODULE)
    expect(files.length).toBeGreaterThanOrEqual(10)
    for (const file of files) expect(violations(readFileSync(file, 'utf8')), path.relative(MODULE, file)).toEqual([])
  })
})
