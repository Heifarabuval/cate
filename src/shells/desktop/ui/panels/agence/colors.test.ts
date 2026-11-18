import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// Guard for #n158: the panel's colors come from theme tokens that read on every
// theme. It reads the source, so it does not see a color built at runtime or
// set by a shared component (Button variants, InlineNotice tones): those are
// overridden in styles.ts and checked in the browser (scripts/agence-theme).

const dir = __dirname
const sources = readdirSync(dir)
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
  .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1') }))
const styles = sources.find((source) => source.name === 'styles.ts')!.text

/** Hard-coded colors, and the tokens too pale as text on surface-1 and surface-2 (< 4.5:1). */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\btext-(white|black)\b/, 'text-white / text-black'],
  [/#[0-9a-fA-F]{3,8}\b/, '#hex'],
  [/\b(rgba?|hsla?)\(/, 'rgb( / hsl('],
  [/\b(bg|text|border)-\[(#|rgb|hsl)/, 'arbitrary color'],
  [/\btext-(muted|danger|warning|agent)\b/, 'text token under 4.5:1 on the surfaces'],
]

/** The opening tag at `start`: up to its closing `>` outside braces. */
function openingTag(text: string, start: number): string {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') depth--
    else if (text[i] === '>' && depth === 0) return text.slice(start, i + 1)
  }
  return text.slice(start)
}

it('uses no hard-coded color and no pale text token', () => {
  const found = sources.flatMap(({ name, text }) =>
    FORBIDDEN.flatMap(([pattern, label]) => (pattern.test(text) ? [`${name}: ${label}`] : [])),
  )
  expect(found).toEqual([])
})

it('gives every raw button, link and field an explicit text color', () => {
  const missing: string[] = []
  for (const { name, text } of sources) {
    for (const match of text.matchAll(/<(button|a|input|textarea|select)\b/g)) {
      const tag = openingTag(text, match.index!)
      // The class may be a literal or a name defined in this file or in styles.ts.
      const names = [...(tag.match(/className=\{([^}]*)\}/)?.[1] ?? '').matchAll(/[A-Za-z_]\w*/g)].map((id) => id[0])
      const definitions = [text, styles].flatMap((source) => names.flatMap((id) => source.split('\n').filter((line) => new RegExp(`\\b(const|function) ${id}\\b`).test(line))))
      if (!/\btext-(primary|secondary)\b/.test([tag, ...definitions].join('\n'))) missing.push(`${name}: <${match[1]}> ${tag.slice(0, 60).replace(/\s+/g, ' ')}`)
    }
  }
  expect(missing).toEqual([])
})

it('keeps the shared actions on readable text', () => {
  for (const id of ['ACTION', 'ACTION_DANGER', 'ACTION_PLAIN', 'LINK']) {
    const line = styles.split('\n').find((candidate) => candidate.includes(`export const ${id}`)) ?? ''
    const body = styles.slice(styles.indexOf(line), styles.indexOf('\n\n', styles.indexOf(line)))
    expect(body, id).toMatch(/text-primary/)
  }
})
