// Colors of the agence panel. Theme tokens only, picked for WCAG AA (4.5:1) on
// surface-1 and surface-2 in every built-in theme: text-primary and
// text-secondary carry all text, text-muted is too pale there. The shared
// Button's own variants are not (primary is white on the accent, danger is
// muted), so the panel's actions state their colors with `!` over a variant.

/** The action to take (Envoyer, Répondre, Demander le rebase): accent tint, primary text. */
export const ACTION =
  'shrink-0 whitespace-nowrap font-medium !border-agent !bg-agent/15 !text-primary hover:!bg-agent/25 ' +
  'disabled:!border-transparent disabled:!bg-transparent disabled:!text-secondary disabled:!opacity-100'

/** A destructive action (Abandonner, Merger quand même): danger tint, primary text. */
export const ACTION_DANGER =
  'shrink-0 whitespace-nowrap font-medium !border-danger !bg-danger-tint !text-primary hover:!bg-danger-tint ' +
  'disabled:!border-transparent disabled:!bg-transparent disabled:!text-secondary disabled:!opacity-100'

/** Any other button (Modifier, Retour, Relancer): readable text, no emphasis. */
export const ACTION_PLAIN = 'shrink-0 whitespace-nowrap !text-primary'

/** A link in running text: underlined so it is not told by color alone. */
export const LINK = 'text-primary underline decoration-agent hover:decoration-2'
