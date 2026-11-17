import { describe, expect, it } from 'vitest'
import { draftHash } from './draftHash'

// Vectors from `hashlib.sha256(texte.strip().encode()).hexdigest()`, the hash
// `click()` in agence.py compares a send against.
const PARITY: Array<{ texte: string; hash: string }> = [
  { texte: 'Bonjour', hash: '9172e8eec99f144f72eca9a568759580edadb2cfd154857f07e657569493bc44' },
  { texte: '  espaces autour  \n', hash: 'af7e3daa1ea6c1b090f4c9ca5c94d7fe213f84008b95cf53d23889512d433ce1' },
  { texte: '\n\nlignes vides\n\n', hash: '41dcc932cbf59994e24eb896d1887b997ba5a42c46225a358c9cef887f5f3c5a' },
  { texte: 'ligne 1\n\nligne 3\n', hash: 'bfabcac3d490fb394967b25998a87d4d6b567432124ce954b6b2c4f3627ce9b1' },
  { texte: 'accents : é à ç œ, 日本語, 😀', hash: '8980d81f7b8aab67cd885004bdb44830a47566474057b46a3d784b1786b9dd7a' },
  { texte: '\t tab et nbsp insécable  ', hash: '9ac27c59da24970f8b18be8553aa07021c655b063cafd83d4fd0cbd29211052a' },
  { texte: '', hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  { texte: '   ', hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  { texte: 'a b　', hash: 'd98ee46a818de7808c5b2342ea531289af73aec4e83591208efba6ca748d7f5f' },
  { texte: '\r\nCRLF\r\n', hash: '4633c324448f771f6dcb6b4eedfb1e19d6ea2076474c92b7b18c7dcaf05f8355' },
]

describe('draftHash', () => {
  it.each(PARITY)('equals sha(texte.strip()) of agence.py for %j', ({ texte, hash }) => {
    expect(draftHash(texte)).toBe(hash)
  })

  // JS trim and Python strip disagree on a few characters: Python strips the
  // separators U+001C to U+001F, JS strips U+FEFF. A text with one of them at
  // an edge hashes differently, so click() answers 409 "texte a changé" (a
  // refused send, never a wrong one).
  it('knowingly differs from Python on U+001C..U+001F and U+FEFF at the edges', () => {
    expect(draftHash('\u001ctexte\u001f')).not.toBe('a41a6138807bea7e591acbae98d154f61ba83164c7186cd7717f79073c3144c7')
    expect(draftHash('﻿texte')).not.toBe('4fa7cf3e9420db438fda5807643fed798d4594d1fc32613bc6b8cd77ee834d3f')
  })
})
