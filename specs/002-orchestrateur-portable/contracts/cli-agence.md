# Contrat : changements de la CLI `agence` et de son lanceur

Codes inchangés : 0 ok, 1 refus métier, 2 environnement (`agence.py:16`).

## Nouvelles commandes

| Commande | Sortie | Code |
|---|---|---|
| `agence --version` | build du runtime (fichier `BUILD` de l'install) ou `dev` | 0 |
| `agence nom` | nom affiché et sa source (`AGENCE_NOM`, `git config agence.nom`, `user.name`, défaut) | 0 |
| `agence doctor [--json]` | une ligne par point : `ok`, `manque` ou `info`, avec la commande qui règle | 0 tout ok, 1 un point bloquant manque |
| `agence hooks install\|uninstall\|status` | voir `hooks.md` | voir `hooks.md` |
| `agence guard --mode send\|pages` | décision JSON `PreToolUse` ou rien | 0 |

`agence guard` sans `--mode` garde son comportement actuel (compatibilité des hooks de Heifara jusqu'au lot 5).

## Points de `agence doctor`

| Point | Bloquant | Vérification | Correctif affiché |
|---|---|---|---|
| python3 | oui | `sys.version_info >= (3, 9)` (le lanceur a déjà trouvé python3) | `xcode-select --install` |
| terminal Cate | oui | `CATE_SOCKET` défini et socket joignable (`require_cate`, `agence.py:201`) | ouvrir un terminal Cate |
| version Cate | oui | `agence/` présent dans l'install courante ; `cate agent start --help` cite `--model` ; `cate agent usage --help` code 0 ; `cate panel create --help` cite `agence` (hypothèse à confirmer : l'aide liste les types) | attendre la mise à jour automatique (`cate-fork-update`), ou recoller la ligne d'amorçage |
| réglages CLI | oui | lecture seule de `<dirname CATE_SOCKET>/settings.json` : `cliEnabled`, `cliPanelReadEnabled`, `cliPanelControlEnabled`, `cliAgentReadEnabled`, `cliAgentControlEnabled`, `cliTerminalReadEnabled`, `cliTerminalInputEnabled` (défaut `false`, `src/kernel/api/contract/settings.ts:16`), `cliSkillInstallEnabled` | Réglages du workspace dans Cate, même texte que `SETTINGS_HINT` (`agence.py:372-373`) |
| gh | oui | `gh auth status` code 0 | `gh auth login` |
| claude | oui | `claude --version` code 0 | installeur officiel de Claude Code |
| gardes | oui | `agence hooks status` | `agence hooks install` |
| skill | non | `.claude/skills/orchestrateur/SKILL.md` dans le dépôt | créer `.claude/` puis rouvrir le workspace |
| nom | non | `agence nom` | `git config --global agence.nom <Prénom>` |
| notification | non | macOS et `osascript` | info : notifications au journal seulement |
| Slack, Gmail | non | info seulement : non lisible depuis la CLI | brancher les connecteurs dans Claude Code |

`doctor` n'écrit rien. Il ne lance jamais l'app Cate.

## Comportements changés

- `toast()` : rien hors macOS ou sans `osascript`, une ligne de journal à la place.
- Textes « Heifara » remplacés par le nom (`agence nom`) ; valeur stockée `humain` (voir `data-model.md`).
- `watch --token-stdin` : `do_GET` rend 404 sur `/`, `/draft/*`, `/ask/*` (aucune page, aucun jeton dans du HTML) ; le POST JSON reste.
- `watch` écrit à chaque tour `st['humain']` (nom) et `st['garde']` (`actif`, `inactif`, `partiel`).

## Lanceurs livrés (tarball `agence/`)

```sh
#!/bin/sh
# agence : CLI d'orchestration livrée avec le runtime Cate.
if ! xcrun --find python3 >/dev/null 2>&1 && ! [ -x /opt/homebrew/bin/python3 ] && ! [ -x /usr/local/bin/python3 ]; then
	echo "agence : python3 requis (xcode-select --install)" >&2; exit 2
fi
exec python3 "$(dirname "$0")/agence.py" "$@"
```

`xcrun` n'existe que sur macOS : hors macOS, le test devient `command -v python3` (fixé au lot 1). Les lanceurs du PATH des terminaux (`cateCli.ts`, `cliEnv.ts`) appellent ce fichier par son chemin absolu dans l'install.
