import { createHash } from 'node:crypto'

/** sha256 hex of the trimmed text: `sha(texte.strip())` of agence.py's `click()`. */
export const draftHash = (texte: string): string => createHash('sha256').update(texte.trim()).digest('hex')
