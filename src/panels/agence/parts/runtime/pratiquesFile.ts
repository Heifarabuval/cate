// The project's policy file (spec 005): `<root>/.cate/tmp/agence/pratiques.json`.
// The panel only makes sure it exists, with `{}`, so there is something to edit;
// keys are written by `agence pratiques set`, never here. An existing file is left as it is.

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function ensurePratiquesFile(root: string): Promise<string> {
  const file = path.join(root, '.cate', 'tmp', 'agence', 'pratiques.json')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, '{}\n', { flag: 'wx' }).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'EEXIST') throw err })
  return file
}
