import { createHash } from 'node:crypto'

/** Python's `str.isspace()` characters, what `str.strip()` removes (not JS
 *  trim's set: U+001C..U+001F and U+0085 are in, U+FEFF is out). */
const PY_SPACE = '\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const PY_STRIP = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, 'g')

/** sha256 hex of the draft text as `click()` in agence.py hashes it:
 *  `sha(open(path).read().strip())`. Text mode reads CRLF and a lone CR as
 *  LF, so the raw file text is normalized the same way first. */
export const draftHash = (texte: string): string =>
  createHash('sha256').update(texte.replace(/\r\n?/g, '\n').replace(PY_STRIP, '')).digest('hex')
