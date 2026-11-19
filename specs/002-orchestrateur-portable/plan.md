# Implementation Plan: Orchestrateur portable

**Branch**: `feat/spec-orchestrateur-portable` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)
**Input**: besoin #n159, décision de Heifara « le code vit dans le fork ».

## Summary

Le fork Heifarabuval/cate livre tout ce qui fait l'orchestrateur ; Max colle **une ligne, une seule fois**, et n'a plus jamais de commande à taper (exigence de Heifara, 2026-11-18 : « passer le projet à quelqu'un et qu'il le lance sans problème »).

1. **CLI** : `agence.py` passe dans le fork (`tools/agence/`), embarqué dans le tarball du runtime (`agence/`) à côté de `cate`. Les lanceurs de PATH déjà écrits pour `cate` (terminaux et régisseur) écrivent aussi `agence`. Rien à installer ; python3 3.9 du système suffit (241 tests verts sous 3.9.6, vérifié).
2. **Skill** : `skills/orchestrateur/` du fork, semé dans les dépôts par le mécanisme des skills livrés.
3. **Gardes** : `agence hooks install|uninstall|status`, lancé par l'utilisateur, fusion json stdlib dans `~/.claude/settings.json`, garde d'envoi qui échoue fermé. Le panneau affiche l'état du garde.
4. **Portabilité** : nom configurable (`git config agence.nom`, défaut prénom de `user.name`), valeur d'état `humain`, notification dégradée hors macOS, `gh repo view` déjà en place.
5. **Mise à jour automatique et amorçage** (lot 4) : le script `cate-fork-update` de Heifara, déjà rodé (build du fork quand `origin/main` avance, installation quand Cate est fermé, toutes les 10 min par launchd), est **adopté**, livré dans le fork (`scripts/cate-fork-update.sh`) et rendu portable (Node 22 détecté, aucun chemin personnel). `scripts/agence-install.sh` l'installe avec son agent launchd, construit une première fois, branche les gardes et lance `agence doctor` : une ligne collée une fois. `scripts/agence-uninstall.sh` défait. Remplace l'ancien `agence-update.sh`.
6. **Le daemon suit l'app** (lot 4b) : `runtimeUpdate.ts` traite un runtime de même version mais d'un autre build comme candidat à la mise à jour, avec le comportement existant (inactif : mise à jour ; travail en cours : demande ; jamais de coupure silencieuse). Fin du `pkill` manuel. Aucune dépendance.
7. **Skills** : retire ce qui part dans le fork ; garde la config personnelle de Heifara.

Recommandations (détail et options rejetées : `research.md`) :

| Sujet | Recommandé | Taille | Coût mensuel |
|---|---|---|---|
| CLI | dans le tarball, lanceur `agence` à côté de `cate` (R1) | 1 j | 0 € |
| Skill | skill livré du fork (R2) | 0,25 j | 0 € |
| Gardes | `agence hooks install`, json stdlib, échec fermé pour l'envoi (R3) | 1 j | 0 € |
| Nom | `humain` stocké, nom par `git config agence.nom` (R4) | 0,5 j | 0 € |
| Mise à jour de l'app | adopter `cate-fork-update` + agent launchd généré (R7) | 1 j | 0 € |
| Amorçage | une ligne `curl \| sh`, idempotent, désinstallation (R10) | 1 j | 0 € |
| Daemon | candidat à la mise à jour sur build différent, même parcours qu'une version plus ancienne (R9) | 0,75 j | 0 € |

## Technical Context

**Language/Version**: TypeScript strict (fork Cate) ; Python 3.9+ stdlib (`agence.py`) ; sh POSIX (lanceurs, amorçage) ; zsh (script de mise à jour, livré avec macOS)
**Primary Dependencies**: aucune ajoutée. `node:fs`, `json`, `tempfile`, `subprocess`
**Storage**: `state.json` (2 clés, 1 valeur renommée, `data-model.md`) ; `~/.claude/settings.json` de l'utilisateur, sur sa commande
**Testing**: Vitest à côté du code du fork ; `unittest` pour `agence.py` (`tools/agence/test_agence.py`, lancé par `npm run test:agence` et en CI sous Python 3.9) ; test de l'installeur en faux HOME (unittest, `HOME` = `tempfile.mkdtemp()`) ; scripts shell par `node --test` (commandes simulées par PATH, faux HOME, plist généré dans un dossier temporaire et **jamais chargé**) ; `npm run lint:deps`
**Target Platform**: macOS (hypothèse à confirmer pour Max) ; Linux toléré sans notification ; Windows hors périmètre
**Project Type**: desktop-app (fork) + CLI embarquée
**Constraints**: Cate n'écrit aucun fichier global de l'utilisateur ; le runtime est l'application (aucune logique dans le shell desktop) ; un seul écrivain de `state.json` ; « clean cuts » : pas de shim dans le fork
**Scale/Scope**: 2 utilisateurs (Heifara, Max)

## Constitution Check

| Principe | Vérification | État |
|---|---|---|
| I. Le canvas est l'univers | inchangé ; `doctor` tourne dans un terminal Cate | OK |
| II. Anticiper | `doctor` dit chaque manque et sa commande ; installation en une ligne, mises à jour sans commande | OK |
| III. Rien sans validation | garde d'envoi fermé par défaut ; plus de page HTML sous le panneau ; bannière si garde absent | OK |
| IV. Sous-agents briefés | skill inchangé sur le fond | OK |
| V. Le plus simple | lanceurs existants réutilisés ; skills livrés existants ; aucune dépendance ; un seul dépôt | OK |

## Couverture de la spec

| Exigence | Où (fork sauf mention) | Test |
|---|---|---|
| FR-001 | `tools/agence/`, `scripts/build-runtime-tarball.mjs:139-160`, `install.ts:82-96`, `cateCli.ts:73`, `cliEnv.ts:41-47` | `cateCli.test.ts` (lanceur `agence` écrit, chemin absolu, mode 0700), `cliEnv.test.ts` (idem), `build-runtime-tarball` : liste `required` |
| FR-002 | `skills/orchestrateur/` | `seed.test.ts` existant (parcourt les skills livrés) ; grep « Heifara » = 0 |
| FR-003, FR-004 | `agence.py` (`nom()`, `load()`), `suivi.ts:86-87`, `SuiviList.tsx:11` | `test_agence.py` : ordre des sources, `heifara` réécrit, alias `--owner heifara` ; `suivi.test.ts` avec `humain` |
| FR-005 | `agence.py:315-319` inchangé | grep `/Users` = 0 en CI |
| FR-006 | `toast()` | `test_agence.py` : `sys.platform='linux'` → aucun appel `osascript` |
| FR-007, FR-008 | `agence hooks`, `agence guard --mode` | `test_hooks.py` en faux HOME : 2 installs = 1, uninstall rend l'original, JSON invalide refusé sans écriture, lien symbolique, entrées de l'utilisateur intactes ; `send` sans CLI → `ask` (exécution réelle de la commande du hook avec `current` absent) |
| FR-009 | `agence doctor` | `test_agence.py` : chaque point avec `RUN` simulé ; code 1 si un bloquant manque |
| FR-010 | `watch` écrit `garde` ; instantané et bannière | `session.test.ts`, `AgenceView.test.tsx` |
| FR-011 | `scripts/cate-fork-update.sh`, `scripts/agence-install.sh`, `scripts/agence-uninstall.sh` ; `runtimeUpdate.ts` pour le daemon | `cate-fork-update.test.mjs` : build en échec → `/Applications` non touché, Node hors plage → rien construit, Cate ouvert → attend ; `agence-install.test.mjs` : plist généré, idempotence, aucun `launchctl` lancé ; `runtimeUpdate.test.ts` : build différent → mise à jour, `busy` → demande, `shared` → rien ; essai réel de Max |
| FR-013 (nouveau) | Aucune commande à taper après la première ligne | `agence-install.test.mjs` + X001 : le parcours se rejoue en faux HOME, 0 commande hors la ligne |
| FR-012 | revue du diff | grep CI : `Heifara`, `U02FQHK9FPD`, `/Users/` absents du code livré |

## Project Structure

### Documentation

```text
specs/006-orchestrateur-portable/
├── spec.md
├── plan.md            # ce fichier
├── research.md        # R1 à R10, options, coûts, sources
├── data-model.md
├── quickstart.md      # parcours de Max, recette
└── contracts/
    ├── cli-agence.md  # doctor, nom, guard --mode, lanceurs
    └── hooks.md       # agence hooks, entrées settings.json
```

### Source Code

Fork Heifarabuval/cate :

```text
tools/agence/
├── agence.py            # depuis Skills common/tools/agence.py
├── agence               # lanceur POSIX
├── agence-hook          # lanceur des gardes
├── test_agence.py       # depuis Skills
└── test_hooks.py        # installeur en faux HOME
skills/orchestrateur/SKILL.md
scripts/build-runtime-tarball.mjs   # copie tools/agence -> agence/, required
scripts/cate-fork-update.sh (+ .test.mjs)  # adopté depuis le script local de Heifara, rendu portable
scripts/agence-install.sh (+ .test.mjs)    # amorçage : prérequis, script, agent launchd, premier build, gardes, doctor
scripts/agence-uninstall.sh                # défait l'agent et le script ; ni l'app ni ~/.cate
src/client/connections/runtimeUpdate.ts    # lot 4b : candidat sur build différent (+ test, texte de l'écran)
src/runtime/daemon/contract/install.ts          # layout.agence
src/runtime/daemon/compose/workspace.ts:240-258 # passe layout.agence aux deux lanceurs
src/runtime/daemon/compose/cliEnv.ts            # lanceur agence
src/services/terminal/runtime/cateCli.ts        # lanceur agence
src/panels/agence/contract/{suivi,types}.ts     # humain, garde
src/shells/desktop/ui/panels/agence/            # titre de section, bannière
package.json                                    # script test:agence
.github/workflows/*                             # job Python 3.9
```

`src/services/terminal` est un module de couche `services` ; `cateCli.ts` reçoit le chemin par ses deps comme `cliPath` aujourd'hui : aucune règle de `lint:deps` touchée.

Dépôt Skills (lot 5) : `common/tools/agence.py`, `test_agence.py`, `common/skills/orchestrateur/`, `common/bin/agence`, `common/hooks/agence-guard.sh` supprimés ; `common/settings.base.json:43`, `:62` remplacés ; `send-guard.sh` réduit à l'exception personnelle.

**Structure Decision**: `tools/agence/` hors de `src/` : ce n'est pas un module TypeScript, il n'entre ni dans les couches ni dans le build esbuild ; le tarball le copie comme `skills/`.

## Lots (une PR chacun sur le fork, livrable seule)

| Lot | Contenu | Taille | Dépend de | Preuve |
|---|---|---|---|---|
| 0. Risques d'abord | sonde : lanceur `agence` dans le dossier d'un terminal restauré ; `xcrun --find python3` sur un compte macOS neuf ; fusion `settings.json` sur une copie de celui de Heifara et de Max. Aucun commit de code | 0,5 j | rien | rapport avec commandes et sorties |
| 1. CLI dans le runtime | `tools/agence/` tel quel (git mv logique depuis Skills, historique non gardé), tarball, layout, deux lanceurs, CI Python 3.9, `--version` | 1,5 j | 0 | `agence --help` dans un terminal Cate restauré ; régisseur du panneau démarré sans `~/.claude/bin` sur PATH |
| 2. Portable | nom, `humain`, textes, `toast`, skill livré et réécrit, panneau (titre), 404 des pages sous `--token-stdin` | 1,5 j | 1 | SC-002 grep ; suite verte ; état réel de Heifara ouvert |
| 3. Gardes et doctor | `agence hooks`, `guard --mode`, `doctor`, `garde` dans l'état, bannière | 1,5 j | 1 | `test_hooks.py` ; essai réel : envoi Slack sans clic → `ask` |
| 4. Mise à jour automatique et amorçage | script de mise à jour portable (Node 22 détecté et vérifié), agent launchd généré, amorçage en une ligne, `doctor --hors-cate`, désinstallation, README | 2 j | script et plist : rien ; amorçage complet : 1 et 3 (gardes, doctor) | tests en faux HOME ; essai réel par Max (X003) |
| 4b. Le daemon suit l'app | `runtimeUpdate.ts` : candidat sur build différent, texte de l'écran, tests Vitest, PR sur le fork | 0,75 j | **aucune**, peut partir tout de suite | Vitest ; app installée deux fois de suite : le workspace inactif passe au nouveau build sans `pkill` (X003) |
| 5. Bascule Skills | retrait dans Skills (PR sur Skills), Heifara sur la CLI livrée, `agence.nom` | 0,5 j | 2, 3 | ses projets ouverts tournent ; `check.py` 0 échec |

Total : 8,25 j d'agent (0 : 0,5 ; 1 : 1,5 ; 2 : 1,5 ; 3 : 1,5 ; 4 : 2 ; 4b : 0,75 ; 5 : 0,5), contre 6,5 j avant la révision : +1 j pour le lot 4 (script, amorçage, désinstallation, `doctor --hors-cate` au lieu d'un script d'un jour qui doublonnait l'existant), +0,75 j pour le lot 4b. Coût mensuel : 0 €. Ordre : 0, 1, puis 2, 3 et 4 en parallèle (fichiers disjoints sauf `agence.py` entre 2 et 3 : 2 avant 3 si un seul agent) ; **4b dès maintenant, en parallèle de tout** ; le script de mise à jour et le plist du lot 4 n'attendent rien ; l'amorçage complet attend 1 et 3 ; puis 5.

## Risques

| Risque | Effet | Parade |
|---|---|---|
| python3 absent (Mac neuf sans CLT) | régisseur `missing`, boîte de dialogue système | CLT requis pour build ; lanceur teste `xcrun --find` ; `doctor` |
| PATH d'un terminal restauré | `agence` introuvable après relance | même dossier et même réécriture au spawn que `cate` (`cateCli.ts:67-83`) ; lot 0 le prouve |
| Fusion de `settings.json` | config de Max écrasée | json stdlib, sauvegarde, idempotence testée, refus sur JSON invalide, lien résolu |
| Deux gardes chez Heifara pendant la transition | double `ask` ou `allow` ignoré | lot 5 remplace les siens ; ne pas installer `agence hooks` chez lui avant |
| Updater propose la release upstream (R6) | le fork remplacé, type `agence` perdu | réglé à la construction par `CATE_SELF_UPDATE=0` (script) ; un build manuel du fork sans la variable reste exposé : README |
| Agents en cours à la mise à jour de l'app | PTY tués | le script n'arrête **aucun** daemon ; l'app installée attend que Cate soit fermé ; le daemon se met à jour inactif, demande sinon (lot 4b) |
| Node absent ou hors plage chez Max | amorçage ou build en échec, toutes les 10 min | version vérifiée **avant** `npm ci`, message clair, notification une fois, rien construit |
| Prérequis manquants (CLT, Node 22, `gh`) | l'amorçage s'arrête, Max colle la ligne une seconde fois | seul cas de deuxième collage ; le script nomme le manque et sa commande |
| Amorçage lancé chez Heifara | deux gardes sur un même outil, ancien agent launchd en double | `--sans-gardes` jusqu'au lot 5 ; l'agent existant sous une autre étiquette est remplacé |
| Premier build de 10 à 20 min (non mesuré) | Max croit à un blocage | le script écrit l'avancement et la durée attendue ; journal `~/Library/Logs/cate-fork-update.log` |
| Deux builds du daemon sur un workspace partagé | boucle de redémarrage | `shared` refuse la mise à jour ; un essai par connexion (`tried`) |
| Divergence avec upstream | conflits de rebase sur `tarball` et `install.ts` | changements additifs et courts ; `tools/` hors `src/` |

## Complexity Tracking

| Écart | Pourquoi | Alternative plus simple rejetée |
|---|---|---|
| Python dans un dépôt TypeScript | la CLI existe, testée (241 tests), stdlib ; la réécrire coûte plus de 5 j | réécriture en TypeScript : deux codes d'action pendant la transition |
| Commande de hook en `sh -c` | trouver la CLI du runtime courant hors terminal Cate et échouer fermé pour l'envoi | chemin absolu d'un build : faux après chaque mise à jour |

## Ouvert pour Heifara

- R3 (plus de page HTML sous le panneau) et R4 (valeur `humain`, alias `--owner heifara`) : validées avec le plan (brief #n189) ; à re-confirmer seulement si la PR du lot 2 révèle un écart.
- Le fork est public (vérifié) : plus de question d'accès pour Max.
- Garder `cliTerminalInputEnabled` coupé par défaut (recommandé : c'est un réglage de sécurité) : Max garde alors un clic par workspace, que `doctor` et le skill nomment. Décision de Heifara, voir `tasks.md`.
