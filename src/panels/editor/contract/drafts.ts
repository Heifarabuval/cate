// Connected editors (docs/connected-editors.md): an untitled editor connected
// to an agent gets a persistent working file `.cate/tmp/<id>.md` in its
// checkout's temporary folder. Pure path strings; `/` and `\` separators both
// work.

import { CATE_TEMP_DIR, cateTempDir, pathSeparatorOf } from '@workspace/files/contract'

export const DRAFTS_DIR = CATE_TEMP_DIR

export function isEditorDraft(path: string | undefined): boolean {
  return !!path && /[/\\]\.cate[/\\]tmp[/\\][\da-f-]{36}\.md$/i.test(path)
}

export function editorDraftPath(root: string, id: string): string {
  return `${cateTempDir(root)}${pathSeparatorOf(root)}${id}.md`
}
