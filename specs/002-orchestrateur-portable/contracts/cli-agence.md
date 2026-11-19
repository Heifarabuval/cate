# Contrat : changements de la CLI `agence` et de son lanceur

Codes inchangés : 0 ok, 1 refus métier, 2 environnement.

## Commandes

| Commande | Sortie | Code | État |
|---|---|---|---|
| `agence --version` | build du runtime (fichier `BUILD` de l'install) ou `dev` | 0 | livré (PR #30) |
| `agence nom` | nom affiché et sa source (`AGENCE_NOM`, `git agence.nom`, `git user.name`, `défaut`) | 0 | livré (PR #41) |
| `agence doctor [--relance]` | contrôle de relance de la spec 001 | 0 oui, 1 non | livré (PR #58), inchangé |
| `agence doctor --prerequis [--hors-cate] [--json]` | une ligne par point : `ok`, `manque` ou `info`, avec la commande qui règle | 0 tout ok, 1 un point bloquant manque | lots 3 et 4 |
| `agence hooks install\|uninstall\|status` | voir `hooks.md` | voir `hooks.md` | lot 3 |
| `agence guard --mode send\|pages` | décision JSON `PreToolUse` ou rien | 0 | lot 3 |

`agence guard` sans `--mode` garde son comportement actuel (hooks de Heifara jusqu'au lot 5), puis se retire au lot 5 (coupe nette).

## Points de `agence doctor --prerequis`

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
| nom | non | `agence nom` ; source `défaut` = info | `git config --global agence.nom <Prénom>` |
| Slack, Gmail | non | info seulement : non lisible depuis la CLI | brancher les connecteurs dans Claude Code |

Avec `--hors-cate` (lancé par l'amorçage, sans `CATE_SOCKET`) : terminal Cate, CLI livrée, `agent start --model`, réglages CLI, type `agence`, `agent usage` et skill semé (7 points) sortent en `info` « à vérifier dans un terminal Cate : `agence doctor --prerequis` », car hors Cate « CLI livrée » et `agent start --model` ne peuvent pas passer (ils interrogent `cate`) ; le code 1 ne vient que d'un bloquant hors Cate.

`doctor` n'écrit rien. Il ne lance jamais l'app Cate.

## Comportements changés

- Textes au nom de l'humain (`nom()`) : livré (PR #41).
- `watch --token-stdin` : `do_GET` rend 404 sur `/`, `/draft/*`, `/ask/*` (aucune page, aucun jeton dans du HTML) ; le POST JSON reste. Lot 2.
- `watch` écrit à chaque tour `st['humain']` (nom, lot 2) et `st['garde']` (`actif`, `inactif`, `partiel`, lot 3).
- `toast()` : inchangé (principe VIII, un échec est déjà journalisé).

## Lanceurs livrés (tarball `agence/`)

`agence` est livré (`tools/agence/agence`, PR #30) : il suit les liens symboliques, prend `$(xcode-select -p)/usr/bin/python3` si les outils développeur sont là, sinon un python3 de Homebrew, et exécute exactement le chemin testé ; sans python3 : `agence : python3 requis (xcode-select --install)` sur stderr, code 2. Il n'appelle jamais `/usr/bin/python3` ni `xcrun`, qui ouvrent la fenêtre d'installation.

`agence-hook` (lot 3) reprend la même recherche de python3 puis `exec "$py" "<dossier>/agence.py" guard --mode "$1"`. Sans python3 : pour `send`, la décision `ask` sur stdout et code 0 ; pour `pages`, rien et code 0.

Les lanceurs du PATH des terminaux (`cateCli.ts`, `cliEnv.ts`) appellent `agence` par son chemin absolu dans l'install.
