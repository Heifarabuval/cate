# Implementation Plan: Fiabiliser l'orchestration d'agents

**Branch**: `feat/speckit-fiabiliser-agents` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-fiabiliser-agents/spec.md`

## Summary

Six changements indépendants contre les pannes du 2026-11-18. Trois lots sans fichier commun, exécutables en parallèle :

- **Lot A** (récits 1 à 3) : `tools/agence/agence.py` et `tools/agence/test_agence.py`. Plafond à 4 avec agents en attente comptés, sous-commande `doctor --relance`, balayage des panneaux orphelins en offres « Fermer ou Garder » sur le modèle de l'offre de worktree.
- **Lot B** (récit 4) : `src/workspace/repository/runtime/nodeModules.ts` (nouveau) et une ligne dans `git.ts` : clone APFS de `node_modules` à la création du worktree.
- **Lot C** (récits 5 et 6) : hors du fork, dans `~/.claude` : deux lignes du gabarit de brief, un hook `window-guard`. Livrés par l'humain ou sous son contrôle.

Approche : le plus simple d'abord. Aucune dépendance, aucune capability ni option de réglage nouvelle. Détails : [research.md](research.md).

## Technical Context

**Language/Version**: Python 3 système (3.9 et plus, `unittest`) pour `agence` ; TypeScript strict (Node du runtime) pour `git.ts` ; bash et Python 3 pour le hook

**Primary Dependencies**: aucune nouvelle. `agence` : bibliothèque standard, `cate`, `git`, `gh` appelés par `RUN`. `git.ts` : `node:child_process`, `node:fs/promises`

**Storage**: `<racine>/.cate/tmp/agence/state.json` (récits 1 à 3, deux clés ajoutées) ; rien pour les récits 4 à 6

**Testing**: `npm run test:agence` (unittest, faux `RUN`) ; Vitest en node pour `nodeModules.test.ts` ; `python3 ~/.claude/setup/check.py` et `hooks/tests/cases.json` pour le hook

**Target Platform**: macOS arm64 seul (constitution VIII)

**Project Type**: desktop-app (Electron, daemon) avec CLI Python livrée dans le tarball du runtime

**Performance Goals**: `agence doctor --relance` en moins de 10 s (4 appels : `cate`, `git`, `gh`, lecture de fichier) ; clone de `node_modules` mesuré à 14 s pour 1,3 Go

**Constraints**: lecture seule pour `doctor` ; aucun panneau fermé sans clic ; la création de worktree n'échoue jamais à cause du clone ; écart `src/` minimal

**Scale/Scope**: un projet, jusqu'à une quinzaine de panneaux et 43 worktrees (chiffres du 2026-11-18)

## Constitution Check

| Principe | Verdict |
|----------|---------|
| I. Couches et côtés | OK. `nodeModules.ts` vit dans `workspace/repository/runtime/`, importe seulement `node:*`. `lint:deps` à passer (T-B06). |
| II. Déclarer une fois | OK. Aucune capability, méthode d'API, action ni réglage nouveau. |
| III. Coupes nettes | OK. Le texte « les agents en attente ne comptent pas » est supprimé partout (docstring, aide, skill, test inversé). |
| IV. Pas de branchement sur le contexte | OK. Le clone est gardé par la plateforme (`darwin`), pas par local ou distant. `process.platform` est déjà lu ailleurs dans `git.ts`. |
| V. Le runtime est l'application | OK. Le clone vit dans le runtime ; les boutons d'orphelin vivent sur la page du régisseur, qui est un processus du daemon. |
| VI. Tests d'abord | OK. Chaque lot ouvre par des tests rouges (tâches `T-*0x` de test avant les tâches de code). |
| VII. Le plus simple d'abord | OK. Le modèle de l'offre de worktree est réutilisé ; `cp -c` natif ; pas de dépendance. |
| VIII. macOS arm64 seule | OK. Tests de clone sautés hors darwin ; aucun plan Windows. |
| IX. Écart minimal avec upstream | Un écart `src/` : un fichier nouveau et une ligne dans `git.ts`. Justifié : seul endroit qui crée le worktree (rapport B). Écart à porter à chaque synchro. |
| X. Aucune fenêtre | OK. Aucune tâche de ce plan ne lance l'app, Playwright, Electron ni `npm run dev`. |

Après conception : aucune violation. Le panneau agence (TS) n'est pas touché (décision n273).

## Project Structure

### Documentation (this feature)

```text
specs/001-fiabiliser-agents/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/interfaces.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
tools/agence/
├── agence.py            # lot A : MAX_AGENTS, tick, cmd_doctor, orphelins, routes /orphan
└── test_agence.py       # lot A : tests d'abord

src/workspace/repository/runtime/
├── nodeModules.ts       # lot B : cloneNodeModules (nouveau)
├── nodeModules.test.ts  # lot B : tests (nouveau)
└── git.ts               # lot B : un import et un appel dans addWorktree

~/.claude/                          # lot C, hors du fork
├── skills/orchestrateur/SKILL.md   # gabarit de brief, règle du plafond
├── skills/orchestrateur/evals.json # un cas
├── hooks/window-guard.sh           # nouveau
├── hooks/window_guard.py           # nouveau
├── hooks/tests/cases.json          # cas du hook
└── settings.json                   # enregistrement du hook (accord de l'humain)
```

**Structure Decision**: aucun nouveau dossier dans le fork. Les trois lots n'ont aucun fichier commun : A écrit `tools/agence/`, B écrit `src/workspace/repository/runtime/`, C écrit `~/.claude/`. La documentation (`CLAUDE.md`, `docs/architecture.md`) n'a pas de mention du plafond ni de `doctor` : seule l'aide de la CLI et le docstring portent le texte. Le lot A ajoute `doctor` à la liste du docstring du module.

## Ordre et parallélisme

1. Les trois lots démarrent ensemble, chacun par ses tests rouges.
2. Dans le lot A, un seul implémenteur, dans l'ordre : récit 1 (le plus court), récit 2, récit 3 (dépend du schéma d'état et des routes, après les deux autres pour éviter les conflits dans `tick` et `parser`).
3. Un vérificateur différent par lot (règle du skill orchestrateur). Aucun agent ne lance de fenêtre.
4. Une seule PR par lot vers `main` du fork. Le lot C n'a pas de PR dans le fork : il se livre dans `~/.claude`.

## Risques

- **Orphelins** (réponses de l'humain, n271 et n273) : critère = titre `#n<chiffres> ` seulement ; boutons sur la page du régisseur seulement. Conséquence : dans le panneau agence l'offre s'affiche sans bouton, comme l'offre de worktree. Un lot D (`src/panels/agence/`, vue desktop) reste possible plus tard, avec un écart upstream de plus.
- **Clone** : 14 s de plus à la création d'un worktree sur ce dépôt. Un lockfile identique ne garantit pas des binaires identiques si la racine est restée sur une autre version de Node : accepté, une installation reste possible dans le worktree.
- **Copie vide mais rouge** : un `node_modules` incomplet de la racine est cloné tel quel. Hors périmètre.
- **Hook** : un faux positif bloque un agent ; la sortie `ALLOW_E2E=1` existe et le message la nomme.

## Complexity Tracking

Aucune violation de la constitution à justifier.
