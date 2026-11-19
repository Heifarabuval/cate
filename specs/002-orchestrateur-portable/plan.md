# Implementation Plan: Orchestrateur portable

**Branch**: `docs/specs-002-orchestrateur-portable` | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

**Input**: spec rapatriée de Skills (`specs/006-orchestrateur-portable`, `1577235`), issue #29. Replanification des lots ouverts après les PR #27, #30, #40, #41 et #58.

## Summary

Le fork livre déjà la CLI `agence` sur le PATH de tout terminal (PR #30), le nom de l'humain côté CLI (PR #41), l'installation et la mise à jour en une ligne (PR #40) et le daemon qui suit l'app (PR #27). Il reste quatre choses pour que Max colle une ligne puis n'ait plus rien à taper :

1. **Lot 2, portable** : le skill `orchestrateur` livré dans `skills/`, le panneau au nom de l'humain (le régisseur écrit `humain` dans l'état), plus de page HTML sous `--token-stdin`, un test de pureté. 1,25 j.
2. **Lot 3, gardes et prérequis** : `agence hooks install|uninstall|status`, `agence guard --mode send|pages` et le lanceur `agence-hook`, `agence doctor --prerequis`, l'état du garde dans le panneau. 2 j.
3. **Lot 4, reste** : `cate-fork-install.sh` branche les gardes et lance `agence doctor --prerequis --hors-cate` ; `cate-fork-uninstall.sh --gardes`. 0,75 j.
4. **Lot 5, bascule de Skills** : à confier au projet Skills. 0,5 j.

Plus la recette : un test du parcours en faux HOME (X001), une relecture finale (X002), le premier passage réel de Max (X003, action humaine).

| Sujet | Recommandé | Taille | Coût mensuel |
|---|---|---|---|
| Skill | skill livré du fork, semé comme `cate-cli` (R2) | 0,5 j | 0 € |
| Nom dans le panneau | `watch` écrit `st['humain']`, le panneau titre la section avec (R4) | 0,5 j | 0 € |
| Pages sous le panneau | `do_GET` 404 sous `--token-stdin` (R3) | 0,25 j | 0 € |
| Gardes | `agence hooks`, json stdlib, échec fermé pour l'envoi (R3) | 1,25 j | 0 € |
| Prérequis | `agence doctor --prerequis [--hors-cate]` (R11) | 0,5 j | 0 € |
| Amorçage complet | deux appels de plus dans `cate-fork-install.sh` (R10) | 0,75 j | 0 € |

## Technical Context

**Language/Version**: Python 3.9+ stdlib (`tools/agence/agence.py`) ; TypeScript strict (panneau agence) ; sh POSIX (`agence-hook`, scripts `cate-fork-*`).

**Primary Dependencies**: aucune ajoutée. `json`, `tempfile`, `os`, `subprocess` côté Python.

**Storage**: `state.json` (deux clés écrites par `watch` : `humain`, `garde`) ; `~/.claude/settings.json` de l'utilisateur, seulement sur sa commande (`agence hooks`), ou celle de l'amorçage qu'il a collé.

**Testing**: `unittest` dans `tools/agence/` (`npm run test:agence`, CI `agence (macos-latest)` sous 3.9) ; Vitest à côté du code du panneau et pour `scripts/cate-fork-install.test.mjs` ; tout test qui touche `~/.claude`, `~/.cate` ou `launchctl` tourne en faux HOME et échoue s'il voit le vrai.

**Target Platform**: macOS Apple silicon (principe VIII). Aucun cas Linux ni Windows.

**Project Type**: desktop-app (fork) + CLI embarquée.

**Constraints**: Cate n'écrit aucun fichier global de l'utilisateur ; un seul écrivain de `state.json` (la CLI) ; coupes nettes ; écart minimal avec upstream (principe IX) : `src/panels/agence/` et `tools/agence/` n'existent que dans le fork, donc aucun coût de rebase.

**Scale/Scope**: 2 utilisateurs (Heifara, Max).

## Constitution Check

*Avant la recherche, puis après la conception : même verdict.*

| Principe | Vérification | État |
|---|---|---|
| I. Couches et côtés | panneau : `contract/` pur (types, `suivi.ts`), `session.ts` côté runtime, vue sous `src/shells/desktop/ui/panels/agence/`. CLI et skill hors `src/`. `npm run lint:deps` à chaque lot | OK |
| II. Déclarer une fois | le skill passe par le mécanisme des skills livrés (`bundled.ts` lit `skills/`) ; aucune liste écrite à la main ; la CLI Python n'est pas une méthode `defineCateApi` (hors API, R1) | OK |
| III. Coupes nettes | noms de la PR #40 gardés, ceux de la spec Skills abandonnés ; `guard` sans `--mode` retiré au lot 5 seulement (hooks de Heifara branchés dessus d'ici là) ; valeur `owner` gardée telle quelle, sans migration (q303) | OK |
| IV. Pas de branchement sur le contexte | aucun code partagé touché | OK |
| V. Le runtime est l'application | le panneau lit `humain` et `garde` dans l'état ; la vue ne fait qu'afficher | OK |
| VI. Tests d'abord | chaque tâche de code a sa tâche de test rouge avant | OK |
| VII. Le plus simple | json stdlib, scripts existants étendus, aucun service | OK |
| VIII. macOS seul | tâches « hors macOS » de la spec Skills retirées (`toast()`, branches POSIX) | OK |
| IX. Écart minimal avec upstream | `src/` touché seulement dans `src/panels/agence/` et sa vue, propres au fork ; `scripts/` et `tools/` hors `src/` | OK |
| X. Aucune fenêtre lancée par un agent | aucun test e2e lancé ; X003 est une action de Max | OK |

## Couverture de la spec

| Exigence | Où | Test | État |
|---|---|---|---|
| FR-001 | `tools/agence/`, `install.ts:93`, `cateCli.ts:81`, `cliEnv.ts:55`, `agence-files.mjs:9` | `cateCli.test.ts`, `cliEnv.test.ts`, `contract.test.ts`, `build-runtime-tarball.test.mjs`, `test_launcher.py` | livré, PR #30 |
| FR-002 | `skills/orchestrateur/SKILL.md`, liste `required` de `build-runtime-tarball.mjs:160` | `seed.test.ts`, `test_portable.py` | lot 2 |
| FR-003 | `agence.py:80-96` ; panneau `suivi.ts`, `SuiviList.tsx:12` | `test_agence.py` classes `Nom`, `NomDansLesTextes` ; `SuiviList.test.tsx` | CLI livrée (PR #41) ; panneau lot 2 |
| FR-004 | `OWNER_HUMAIN` (`agence.py:71`), `suivi.ts:86-87` | `test_agence.py`, `suivi.test.ts` | livré (PR #41), clé gardée (q303) |
| FR-005 | `gh_repo()` inchangé | `test_portable.py` (grep `/Users/`) | lot 2 |
| FR-006 | `toast()` (`agence.py:315-321`) | aucun (principe VIII) | satisfait |
| FR-007, FR-008 | `agence hooks`, `agence guard --mode`, `tools/agence/agence-hook` | `test_hooks.py`, `test_guard.py` en faux HOME | lot 3 |
| FR-009 | `agence doctor --prerequis [--hors-cate]` | `test_doctor.py` | lots 3 et 4 |
| FR-010 | `watch` écrit `humain` et `garde` ; `types.ts`, `session.ts`, `AgenceView.tsx`, `SuiviList.tsx` | `session.test.ts`, `AgenceView.test.tsx`, `SuiviList.test.tsx` | lots 2 et 3 |
| FR-011 | `scripts/cate-fork-update.sh`, `runtimeUpdate.ts:38-43` | `cate-fork-install.test.mjs` (43 tests), `runtimeUpdate.test.ts` | livré, PR #40 et #27 |
| FR-012 | revue du diff | `test_portable.py` | lot 2 |
| FR-013 | `scripts/cate-fork-install.sh`, `scripts/cate-fork-uninstall.sh` | `cate-fork-install.test.mjs` (cas gardes et doctor) | app livrée ; gardes lot 4 |

## Project Structure

### Documentation

```text
specs/002-orchestrateur-portable/
├── spec.md
├── plan.md            # ce fichier
├── research.md        # R1 à R11
├── data-model.md
├── quickstart.md      # parcours de Max, recette
├── rapport-lot0.md    # sondes du lot 0 (historique, Skills 78a8fd3)
├── contracts/
│   ├── cli-agence.md  # nom, doctor --prerequis, guard --mode, lanceurs
│   └── hooks.md       # agence hooks, entrées settings.json
├── fixtures/          # cas hostiles de settings.json (lot 0), copiés au lot 3
└── tasks.md
```

### Source Code (fork, reste à faire)

```text
tools/agence/
├── agence.py            # humain, garde, 404 sous --token-stdin, hooks, guard --mode, doctor --prerequis
├── agence-hook          # nouveau : lanceur des gardes
├── test_agence.py       # watch écrit humain et garde, 404
├── test_hooks.py        # nouveau, faux HOME
├── test_guard.py        # nouveau, exécute la commande réelle du hook
├── test_doctor.py       # nouveau
├── test_portable.py     # nouveau, pureté
└── fixtures/settings/   # depuis specs/002-orchestrateur-portable/fixtures/
skills/orchestrateur/SKILL.md          # nouveau, réécrit sans nom de personne
scripts/agence-files.mjs               # agence-hook dans AGENCE_REQUIRED
scripts/build-runtime-tarball.mjs      # skills/orchestrateur/SKILL.md dans required
scripts/cate-fork-install.sh           # gardes (sauf --sans-gardes) et doctor
scripts/cate-fork-uninstall.sh         # --gardes
scripts/cate-fork-install.md           # doc de la ligne
src/panels/agence/contract/{types,suivi}.ts
src/panels/agence/session.ts
src/shells/desktop/ui/panels/agence/{SuiviList,AgenceView}.tsx
docs/architecture.md                   # skills livrés, gardes
```

Dépôt Skills (lot 5, à confier au projet Skills) : `common/tools/agence.py`, `test_agence.py`, `common/skills/orchestrateur/`, `common/bin/agence`, `common/hooks/agence-guard.sh` supprimés ; `common/settings.base.json` remplacé ; `send-guard.sh` réduit à l'exception personnelle.

**Structure Decision**: rien de neuf dans `src/` hors du panneau agence, propre au fork. `tools/agence/` reste hors des couches et du build esbuild ; le tarball le copie comme `skills/`.

## Lots restants (une PR chacun sur le fork, livrable seule)

| Lot | Contenu | Tâches | Taille | Dépend de | Preuve |
|---|---|---|---|---|---|
| 2. Portable | skill livré, `humain` écrit par `watch` et affiché, 404 sous `--token-stdin`, pureté | 12 | 1,25 j | rien | grep SC-002 ; suite verte ; état réel de Heifara relu sur une copie |
| 3. Gardes et prérequis | `hooks`, `guard --mode`, `agence-hook`, `doctor --prerequis`, `garde` dans l'état et bannière | 15 | 2 j | rien (rebase sur 2 : `agence.py`) | `test_hooks.py` ; commande réelle du hook sans CLI : `ask` |
| 4. Amorçage complet | gardes et `doctor --hors-cate` dans l'amorçage, `--sans-gardes`, `--gardes` | 8 | 0,75 j | 3 | tests en faux HOME ; 0 appel réel à `launchctl` |
| 5. Bascule de Skills | retrait dans Skills, Heifara sur la CLI livrée | 8 | 0,5 j | 2 et 3 fusionnés et installés chez Heifara | à confier au projet Skills |
| X. Recette | parcours en faux HOME, relecture finale, premier passage de Max | 3 | 0,75 j + Max | 2, 3, 4 | X001 vert ; X003 par Max |

Total restant : 4,75 j d'agent dans le fork et 0,5 j dans Skills, soit 5,25 j. Le plan Skills comptait 8,25 j ; les lots 0, 1, 4b et une partie des lots 2 et 4 sont livrés. Coût mensuel : 0 €. Ordre : 2 et 3 en parallèle (deux agents, `agence.py` commun : fusionner 2 avant 3), puis 4, puis X001, puis 5 et X002, puis X003.

## Risques

| Risque | Effet | Parade |
|---|---|---|
| Fusion de `settings.json` | config de Max écrasée | json stdlib, sauvegarde, idempotence testée, refus sur JSON invalide ou fichier non inscriptible, lien résolu, mode conservé (rapport du lot 0) |
| Deux jeux de gardes chez Heifara pendant la transition | double `ask`, ou `allow` de l'un ignoré | amorçage chez lui avec `--sans-gardes` jusqu'au lot 5 ; ordre du lot 5 : `agence hooks install` avant le retrait des anciens |
| Skill semé et skill utilisateur du même nom chez Heifara | mauvaise version chargée | L5-01 tranche la priorité avant le retrait du lien |
| `doctor` de la spec 001 et `doctor` des prérequis | contrat de la spec 001 cassé | option `--prerequis`, `doctor` seul inchangé (q305) |
| Amorçage qui touche `~/.claude` de Max | config d'un autre perdue | sauvegarde par `agence hooks install`, `--sans-gardes`, désinstallation `--gardes` |
| Premier build de 10 à 20 min (non mesuré) | Max croit à un blocage | journal et message d'avancement (livré, PR #40) ; mesure en X003 |
| Lecture de l'état d'un ancien régisseur | titre de section sans nom un tour | défaut « L'humain » tant que `humain` manque |

## Complexity Tracking

| Écart | Pourquoi | Alternative plus simple rejetée |
|---|---|---|
| Python dans un dépôt TypeScript | la CLI existe, testée (317 tests), stdlib | réécriture en TypeScript : plus de 5 j |
| Commande de hook en `sh -c` | trouver la CLI du runtime courant hors terminal Cate et échouer fermé pour l'envoi | chemin absolu d'un build : faux après chaque mise à jour |
| `guard` sans `--mode` gardé jusqu'au lot 5 | les hooks de Heifara l'appellent aujourd'hui (Skills `agence-guard.sh`) | retrait immédiat : trou de garde chez Heifara |
| Une clé `heifara` reste dans le code livré | ses états existants restent lisibles sans code de migration (SC-005, principe III) | passer à `humain` : réécriture par `load()`, donc de la migration (rejeté par Heifara, q303) |

## Tranché par Heifara le 2026-11-19

- q303 (besoin n304) : la valeur stockée `owner` reste `heifara`, opaque.
- q305 (besoin n306) : `agence doctor --prerequis` ; `doctor` seul inchangé.
- q307 (besoin n308) : `cliTerminalInputEnabled` reste coupé par défaut ; `doctor --prerequis` le nomme.
