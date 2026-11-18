// `cate.panel.*` and `cate.canvas.*`: panels as document records. Served by
// workspace/document's runtime side. `cate.panel.focus` is gone: focus is
// client state.

import { bool, defineCateApi, defineCliArea, num, obj, oneOf, opt, panel, path, str } from '@kernel/api/contract'
import { FRAME_STATES, PANEL_TYPES, RELATION_KINDS } from './schema'

/** The CLI permission area of these methods. */
export const panelCliArea = defineCliArea({
  label: 'Panels',
  read: {
    key: 'cliPanelReadEnabled',
    code: 'panel-read-disabled',
    detail: '`cate panel list / current / set / clear` and `cate panel group list`: enumerate the open panels, including each browser panel\'s url, and the groups, and pick the caller\'s own target panel.',
  },
  control: {
    key: 'cliPanelControlEnabled',
    code: 'panel-control-disabled',
    detail: '`cate panel create / close / title / link / unlink` and `cate panel group create / add / remove / state / collapse / expand / delete`: add, close, rename and relate panels, and group them.',
  },
})

export const panelApi = defineCateApi(
  'panel',
  {
    list: {
      access: 'read',
      handler: 'service',
      summary: 'List the open panels',
      format: 'panelList',
    },
    close: {
      access: 'control',
      handler: 'service',
      summary: 'Close a panel',
      args: {
        panelId: panel().pos().help('Panel id or unique prefix, from cate panel list'),
        discard: opt(bool, false).help('Discard unsaved changes instead of failing with dirty'),
      },
    },
    setTitle: {
      access: 'control',
      handler: 'service',
      summary: 'Rename a panel (defaults to the calling panel)',
      args: {
        title: str.nonEmpty().rest('title').help('The new title'),
        panelId: opt(panel()).flag('panel', 'id').help('Panel to rename (default: the calling panel)'),
      },
      cli: { command: ['panel', 'title'] },
    },
    link: {
      access: 'control',
      handler: 'service',
      summary: 'Relate two panels (a related pair takes the new kind and label)',
      args: {
        fromPanelId: panel().pos('from').help('Source panel id or unique prefix'),
        toPanelId: panel().pos('to').help('Target panel id or unique prefix'),
        kind: opt(oneOf(...RELATION_KINDS)).help('Relation kind (default: the pair\'s recommended intent)'),
        label: opt(str).help('Custom wording of the relation'),
      },
    },
    unlink: {
      access: 'control',
      handler: 'service',
      summary: 'Remove the relation between two panels',
      args: {
        fromPanelId: panel().pos('from').help('Source panel id or unique prefix'),
        toPanelId: panel().pos('to').help('Target panel id or unique prefix'),
      },
    },
    'target.set': {
      access: 'read',
      handler: 'service',
      summary: 'Select the panel later commands target',
      args: { panelId: panel().pos().help('Panel id or unique prefix, from cate panel list') },
      format: 'panelTarget',
      cli: { command: ['panel', 'set'] },
    },
    'target.current': {
      access: 'read',
      handler: 'service',
      summary: 'Print the selected panel',
      format: 'panelTarget',
      cli: { command: ['panel', 'current'] },
    },
    'target.clear': {
      access: 'read',
      handler: 'service',
      summary: 'Clear the selected panel',
      cli: { command: ['panel', 'clear'] },
    },
  },
  { area: panelCliArea, summary: 'List, create, select, rename, relate and close panels' },
)

export const canvasApi = defineCateApi(
  'canvas',
  {
    createPanel: {
      access: 'control',
      handler: 'service',
      summary: 'Create a panel next to the calling panel',
      args: {
        type: str.nonEmpty().pos('type').help(`The panel type: ${PANEL_TYPES.join(', ')}`),
        url: opt(str).pos('url').help('Browser panels: the page to open'),
        filePath: opt(path).flag('file', 'path').help('Editor panels: the file to open'),
        position: opt(obj({ x: num, y: num })).hidden(),
      },
      format: 'createdPanel',
      cli: { command: ['panel', 'create'] },
    },
  },
  { area: panelCliArea },
)

const frameArg = () => str.nonEmpty().pos('group').help('Group id or unique prefix, from cate panel group list')

/** `cate.frame.*`: groups of canvas panels, shown as `cate panel group`. */
export const frameApi = defineCateApi(
  'frame',
  {
    create: {
      access: 'control',
      handler: 'service',
      summary: 'Create a group on the canvas of the calling panel',
      args: {
        title: str.nonEmpty().rest('title').help('The group\'s title'),
        canvas: opt(panel()).flag('canvas', 'id').help('A canvas panel, when the caller is not on a canvas'),
      },
      cli: { command: ['panel', 'group', 'create'] },
    },
    add: {
      access: 'control',
      handler: 'service',
      summary: 'Put a panel (its whole tab stack) in a group, on the first free place',
      args: {
        frameId: frameArg(),
        panelId: panel().pos('panel').help('Panel id or unique prefix, from cate panel list'),
      },
      cli: { command: ['panel', 'group', 'add'] },
    },
    state: {
      access: 'control',
      handler: 'service',
      summary: 'Set the state of a group',
      args: {
        frameId: frameArg(),
        state: oneOf(...FRAME_STATES).pos('state').help(`The state: ${FRAME_STATES.join(', ')}`),
      },
      cli: { command: ['panel', 'group', 'state'] },
    },
    collapse: {
      access: 'control',
      handler: 'service',
      summary: 'Fold a group into its title bar',
      args: { frameId: frameArg() },
      cli: { command: ['panel', 'group', 'collapse'] },
    },
    expand: {
      access: 'control',
      handler: 'service',
      summary: 'Unfold a group',
      args: { frameId: frameArg() },
      cli: { command: ['panel', 'group', 'expand'] },
    },
    remove: {
      access: 'control',
      handler: 'service',
      summary: 'Take a panel out of its group',
      args: { panelId: panel().pos().help('Panel id or unique prefix, from cate panel list') },
      cli: { command: ['panel', 'group', 'remove'] },
    },
    delete: {
      access: 'control',
      handler: 'service',
      summary: 'Dissolve a group; its panels stay open',
      args: { frameId: frameArg() },
      cli: { command: ['panel', 'group', 'delete'] },
    },
    list: {
      access: 'read',
      handler: 'service',
      summary: 'List the groups with their state and panels',
      cli: { command: ['panel', 'group', 'list'] },
    },
  },
  { area: panelCliArea },
)
