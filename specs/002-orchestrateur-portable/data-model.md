# Data model: Orchestrateur portable

Aucun nouveau fichier d'état. Deux clés ajoutées à `state.json`, deux entrées dans un fichier de l'utilisateur écrites seulement sur sa commande (ou celle de l'amorçage qu'il a collé). État au 2026-11-19 sur `origin/main` du fork.

## `<root>/.cate/tmp/agence/state.json` (seul écrivain : la CLI)

| Champ | Aujourd'hui | Après les lots 2 et 3 | Lecteurs |
|---|---|---|---|
| `needs[].owner` | `'agent'` ou `'heifara'` (`OWNER_HUMAIN`, `agence.py:71`) ; la CLI l'affiche `humain` (`qui()`) | inchangé, clé opaque, aucune migration (q303) | CLI, panneau (`src/panels/agence/contract/suivi.ts:86-87`) |
| `humain` | absent | nom affiché (`nom()`), écrit par `watch` à chaque tour ; une ligne, 40 caractères au plus (`_propre`, `agence.py:74-77`) | panneau : titre « À faire par <humain> » ; « L'humain » si absent |
| `garde` | absent | `'actif'`, `'inactif'` ou `'partiel'`, écrit par `watch` d'après `hooks status` | panneau : bannière si différent de `actif` |

Clés absentes d'un état ancien : `load()` les complète par `empty()`, comme `maxAgents` (`agence.py:149`).

### Coût et envoi Slack (reportés de Skills#8 et Skills#20)

Tous optionnels à la lecture : un état ancien sans ces clés se rend sans erreur.

| Champ | Type | Sens | Lecteurs |
|---|---|---|---|
| `needs[].budgetUsd` | dollars ou `null` | budget voulu (`need add --budget-usd`), dans la devise de `cate agent usage`, sans conversion | CLI, régisseur |
| `needs[].overBudgetUsd` | `true`, absent tant que faux | budget en dollars dépassé ; `overBudget` passe aussi à `true` (drapeau lu pour les minutes comme pour les dollars) : le besoin devient Bloquant | CLI, panneau (`suivi.ts` : « budget de X $ dépassé (coût Y $) » ; la ligne en minutes seulement si `budgetMin`) |
| `needs[].costByPanel` | `{panneau: dollars ou null}`, absent tant que rien n'est lu | dernier coût lu par panneau d'agent du besoin ; `null` : agent connu de Cate sans coût lisible ; un panneau fermé ne fait pas retomber le cumul | CLI, panneau (somme des coûts lus, dans la ligne du dépassement en dollars seulement) |
| `drafts[].incertain` | `true`, absent sinon (Slack seulement) | envoi sans issue connue (délai, coupure, `internal_error`, `fatal_error`) ; posé avant l'appel, retiré sur une issue certaine | CLI. Le panneau le lit (`DraftView.incertain`) et remplace Envoyer par « Envoyer quand même », qui envoie `confirme=1` sur clic seulement |

Dépense d'un besoin = somme des coûts lus (« au moins » s'il reste un `null`). Total du projet = somme des panneaux distincts, maximum lu par panneau. Un brouillon `incertain` reste `à valider` et le régisseur ne l'abandonne pas ; un simple Envoyer rend 409, seul « Envoyer quand même » (`confirme=1`), sur la page du brouillon ou dans le panneau, renvoie.

## Instantané du panneau (`src/panels/agence/contract/types.ts`)

Ajout : `humain: string` (« L'humain » par défaut), `garde: 'actif' | 'inactif' | 'partiel' | 'inconnu'` (`inconnu` tant que le régisseur n'a pas fait un tour). Section `aFaire` titrée avec `humain`.

## Install du runtime `~/.cate/runtime/<build>/`

| Chemin | Contenu | État |
|---|---|---|
| `agence/agence.py` | la CLI (stdlib, Python 3.9+) | livré (PR #30) |
| `agence/agence` | lanceur POSIX (`xcode-select -p`, puis le python3 testé) | livré (PR #30) |
| `agence/agence-hook` | lanceur des gardes (`agence.py guard --mode "$1"`) | lot 3 |
| `skills/orchestrateur/SKILL.md` | le skill | lot 2 |
| `BUILD` | identifiant du build, lu par `agence --version` | livré |

`installLayout` a `agence` (`src/runtime/daemon/contract/install.ts:93`). `AGENCE_REQUIRED` (`scripts/agence-files.mjs:9`) gagne `agence/agence-hook` au lot 3 ; la liste `required` du tarball (`scripts/build-runtime-tarball.mjs:160`) gagne le skill au lot 2.

## Lanceurs du PATH (livrés, PR #30)

| Dossier | Écrit par | Fichiers |
|---|---|---|
| `<terminalCli>/panels/<panelId>/` | `cateCli.ts:81` | `cate` (avec jeton), `agence` (chemin absolu, sans jeton) |
| `<terminalCli>/process-env/` | `cliEnv.ts:55` | `cate`, `agence` |

## `~/.claude/settings.json` (fichier de l'utilisateur)

Deux entrées `hooks.PreToolUse` reconnues à leur commande `agence-hook` (`contracts/hooks.md`). Sauvegarde `settings.json.bak-agence-<AAAAMMJJ-HHMMSS>` à chaque écriture effective. Mode du fichier conservé.

## Nom de l'humain (livré, PR #41)

Ordre : `AGENCE_NOM` > `git config agence.nom` > premier mot de `git config user.name` > « L'humain ». Lu à chaque appel (pas de cache), un `git config` par appel.

## Fichiers de l'amorçage (livrés, PR #40)

| Chemin | Écrit par |
|---|---|
| `~/.local/bin/cate-fork-update` | `cate-fork-install.sh`, rafraîchi par lui-même |
| `~/Library/LaunchAgents/com.cate.fork-update.plist` | `cate-fork-install.sh` |
| `~/.local/share/cate-build/` (clone, marqueurs hors du clone) | `cate-fork-update` |
| `~/.config/cate-fork-update.conf` (dépôt, branche, dossier) | l'utilisateur, optionnel |
| `~/Library/Logs/cate-fork-update.log` | `cate-fork-update` |
