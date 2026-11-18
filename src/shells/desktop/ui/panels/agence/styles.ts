// Colors of the agence panel. Theme tokens only, picked for WCAG AA (4.5:1) on
// surface-1 and surface-2 in every built-in theme: text-primary and
// text-secondary carry all text, text-muted is too pale there. The shared
// Button's own variants are not (primary is white on the accent, danger is
// muted), so the panel's actions state their colors with `!` over a variant.

/** Disabled, for every action: neutral border and fill, no tint, text still readable. */
const OFF = 'disabled:!border-subtle disabled:!bg-surface-3 disabled:!text-secondary disabled:!opacity-100'

/** The action to take (Envoyer, Répondre, Demander le rebase): accent tint and border, primary text. */
export const ACTION =
  `shrink-0 whitespace-nowrap font-medium !border-agent !bg-agent/25 !text-primary enabled:hover:!bg-agent/35 ${OFF}`

/** A destructive action (Abandonner, Merger quand même): danger tint, primary text. */
export const ACTION_DANGER =
  `shrink-0 whitespace-nowrap font-medium !border-danger !bg-danger-tint !text-primary ${OFF}`

/** Any other button (Modifier, Retour, Relancer): readable text, no emphasis. */
export const ACTION_PLAIN = 'shrink-0 whitespace-nowrap !text-primary'

/** A link in running text: underlined so it is not told by color alone. */
export const LINK = 'text-primary underline decoration-agent hover:decoration-2'
