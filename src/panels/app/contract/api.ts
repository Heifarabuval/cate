// `cate.app.*`: share custom panels from a terminal (spec 007 FR-019). The
// runtime serves them as services. None installs: `import` only puts a panel
// on hold, and installing stays a click in a client (`apps.acceptImport`).

import { defineCateApi, defineCliArea, opt, path, str } from '@kernel/api/contract'

/** The CLI permission area of these methods. */
export const appCliArea = defineCliArea({
  label: 'Custom panels',
  read: {
    key: 'cliAppEnabled',
    code: 'app-read-disabled',
    detail: '`cate app list` and `cate app imports`: the custom panels and the imports waiting for a click in Cate.'
  },
  control: {
    key: 'cliAppControlEnabled',
    code: 'app-control-disabled',
    detail: '`cate app export` writes a package of a panel; `cate app import` puts one on hold. Installing stays a click in Cate.'
  }
})

export const appApi = defineCateApi(
  'app',
  {
    list: {
      access: 'read',
      handler: 'service',
      summary: 'List the custom panels of the panels folder'
    },
    imports: {
      access: 'read',
      handler: 'service',
      summary: 'List the imports waiting for a click in Cate'
    },
    export: {
      access: 'control',
      handler: 'service',
      summary: 'Write a custom panel to a .cate-panneau package; the last line is the fingerprint to give the recipient',
      args: {
        id: str.pos('id').help('The panel: the name of its folder'),
        out: path.flag('out', 'fichier').help('The package to write, outside the panel folder')
      }
    },
    import: {
      access: 'control',
      handler: 'service',
      summary: 'Put a folder or a .cate-panneau on hold; only the user installs it, by a click in Cate',
      args: {
        source: path.pos('source').help('A panel folder or a .cate-panneau package'),
        fingerprint: opt(str).flag('empreinte', 'début').help('The start of the fingerprint the sender gave, 8 hex characters at least')
      }
    }
  },
  { area: appCliArea, summary: 'Share custom panels: export, put on hold, list' }
)
