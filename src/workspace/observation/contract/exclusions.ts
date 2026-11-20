// Domains where nothing is ever captured, not even the URL (FR-007). The
// default list ships with the categories of the spec; the person adds
// domains and removes default ones in the workspace settings. Every entry
// covers its subdomains.

/**
 * The starting list (Q7): Heifara completes it before the recorder lot. It
 * holds domains the team knows; a bank with one site per region (Crédit
 * Agricole) needs its regional domains added here or by the person.
 */
export const DEFAULT_EXCLUSIONS = {
  banque: [
    'bnpparibas.net', 'mabanque.bnpparibas', 'societegenerale.fr', 'credit-agricole.fr', 'labanquepostale.fr', 'lcl.fr',
    'caisse-epargne.fr', 'banquepopulaire.fr', 'creditmutuel.fr', 'cic.fr', 'boursobank.com', 'boursorama.com',
    'hellobank.fr', 'fortuneo.fr', 'ing.fr', 'bforbank.com', 'hsbc.fr', 'qonto.com', 'revolut.com', 'n26.com',
    'paypal.com', 'wise.com',
  ],
  mail: [
    'mail.google.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com', 'mail.yahoo.com',
    'mail.proton.me', 'protonmail.com', 'webmail.ovh.net', 'mail.ovh.net', 'webmail.orange.fr', 'webmail.sfr.fr',
    'mail.laposte.net', 'icloud.com', 'webmail.gandi.net', 'mail.zoho.com', 'fastmail.com', 'gmx.com',
  ],
  sante: [
    'ameli.fr', 'doctolib.fr', 'monespacesante.fr', 'maiia.com', 'keldoc.com', 'alan.com', 'mgen.fr',
    'harmonie-mutuelle.fr', 'malakoffhumanis.com',
  ],
  rh: [
    'lucca-software.com', 'ilucca.net', 'factorialhr.com', 'bamboohr.com', 'myworkday.com', 'workday.com',
    'personio.com', 'personio.de', 'successfactors.com',
  ],
  paie: ['payfit.com', 'silae.fr', 'adp.com', 'net-entreprises.fr', 'urssaf.fr', 'impots.gouv.fr'],
  motsDePasse: [
    '1password.com', 'bitwarden.com', 'lastpass.com', 'dashlane.com', 'keepersecurity.com', 'nordpass.com',
    'pass.proton.me',
  ],
} as const

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const DOMAIN = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`)

/** A bare domain in lowercase: `exemple.fr`, never a URL, a path or a name without a dot. */
export function isDomainName(value: string): boolean {
  return value.length <= 253 && DOMAIN.test(value)
}

const normalize = (domain: string): string => domain.trim().toLowerCase()

/**
 * The domains the journal refuses at this moment: the default list, plus the
 * ones the person added, minus the ones the person removed. A removal wins
 * over an addition of the same domain.
 */
export function exclusionList(changes: { ajoutees: readonly string[]; retirees: readonly string[] }): string[] {
  const removed = new Set(changes.retirees.map(normalize))
  const all = new Set([...Object.values(DEFAULT_EXCLUSIONS).flat(), ...changes.ajoutees].map(normalize))
  return [...all].filter((domain) => !removed.has(domain))
}
