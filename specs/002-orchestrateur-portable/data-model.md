# Data model: Orchestrateur portable

Aucun nouveau fichier d'état. Deux clés ajoutées à `state.json`, une valeur renommée, deux entrées dans un fichier de l'utilisateur écrites seulement sur sa commande.

## `<root>/.cate/tmp/agence/state.json` (seul écrivain : la CLI)

| Champ | Avant | Après | Lecteurs |
|---|---|---|---|
| `needs[].owner` | `'agent'` ou `'heifara'` | `'agent'` ou `'humain'` ; `load()` réécrit `'heifara'` en `'humain'` | CLI, panneau (`src/panels/agence/contract/suivi.ts:86-87`) |
| `humain` | absent | nom affiché, écrit par `watch` à chaque tour | panneau : titre « À faire par <humain> » ; défaut « toi » si absent |
| `garde` | absent | `'actif'`, `'inactif'` ou `'partiel'`, écrit par `watch` | panneau : bannière si différent de `actif` |

Clés absentes d'un état ancien : `load()` les complète par `empty()` (`agence.py:105-122`), comme `maxAgents` aujourd'hui (`agence.py:110-111`).

## Instantané du panneau (`src/panels/agence/contract/types.ts`)

Ajout : `humain: string`, `garde: 'actif' | 'inactif' | 'partiel' | 'inconnu'` (`inconnu` tant que le régisseur n'a pas fait un tour). Section `aFaire` titrée avec `humain`.

## Install du runtime `~/.cate/runtime/<build>/`

| Chemin | Contenu |
|---|---|
| `agence/agence.py` | la CLI (stdlib, Python 3.9+) |
| `agence/agence` | lanceur POSIX (test python3, puis `exec python3 agence.py`) |
| `agence/agence-hook` | lanceur des gardes (`agence.py guard --mode`) |
| `skills/orchestrateur/SKILL.md` | le skill |

`installLayout` (`src/runtime/daemon/contract/install.ts:82-96`) gagne `agence: at('agence', 'agence')`. La liste `required` du tarball (`scripts/build-runtime-tarball.mjs:146-160`) gagne les trois fichiers et le skill.

## Lanceurs du PATH

| Dossier | Écrit par | Fichiers |
|---|---|---|
| `<terminalCli>/panels/<panelId>/` | `cateCli.ts:73` | `cate` (avec jeton), `agence` (`exec '<install>/agence/agence' "$@"`, sans jeton : la CLI appelle `cate` par le PATH) |
| `<terminalCli>/process-env/` | `cliEnv.ts:41-47` | `cate`, `agence` |

## `~/.claude/settings.json` (fichier de l'utilisateur)

Deux entrées `hooks.PreToolUse` reconnues à leur commande `agence-hook` (`contracts/hooks.md`). Sauvegarde `settings.json.bak-agence-<horodatage>` à chaque écriture effective.

## Nom de l'humain

Ordre : `AGENCE_NOM` > `git config agence.nom` > premier mot de `git config user.name` > `toi`. Lu à chaque commande (pas de cache), coût : un `git config` par appel.
