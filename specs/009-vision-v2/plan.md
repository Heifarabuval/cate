# Implementation Plan: Vision v2 (un seul canvas, un interlocuteur, un orchestrateur, tout métier)

**Branch**: `docs/spec-009-plan` (depuis `docs/spec-vision-v2` `7c82ee6f`) | **Date**: 2026-11-20 | **Spec**: `specs/009-vision-v2/spec.md`

**Input**: `specs/009-vision-v2/spec.md` ; specs filles `010-interlocuteur` (branche locale `docs/spec-010-interlocuteur` `76d7b3bc`) et `011-mesure-benchmark` (`docs/spec-011-mesure-benchmark` `d77c191d`) ; `specs/recoupement-2026-11-20.md` ; `tasks.md` des specs 003 à 008 ; `git log origin/main` (base `fd91eb8c`, fetch du 2026-11-20).

**Nature** : plan d'ensemble. Il ne prévoit aucune ligne de code propre : il ordonne les lots des specs existantes, fixe les critères de passage (gates) de chaque couche et nomme qui les mesure. Le code vit dans les lots des specs filles. Aucune spec existante n'est modifiée.

## Summary

La vision se construit en quatre couches mesurées l'une après l'autre (spec.md, « Les quatre couches », FR-012). La couche 1 (noyau) n'est prouvée que par le benchmark de la spec 011 ; son chemin critique est le MVP de la spec 010 (lots 1 à 5), puis la campagne de rejeu jouée par Heifara. Les couches 2 à 4 ont déjà des lots livrés (005, 007, 003) ; ce plan gèle leurs lots non commencés jusqu'à leur gate, sauf ceux dont la couche 1 a besoin. Tout ce qui peut vivre dans `tools/agence/` ou un skill y vit (FR-013, constitution IX).

Chiffres d'entrée (sources) : 66 % des jetons lus de l'orchestrateur viennent de la boucle d'outils d'un contexte médian de 220 000 jetons, 11,35 % de l'attente, 13,9 % des tours forcés par un Stop hook (spec 006, cité par `spec.md`, Clarifications). Le levier principal est la taille du contexte : ce plan n'ajoute aucune lecture au tour de l'orchestrateur.

## Technical Context

**Language/Version** : Python 3 stdlib (`tools/agence/`, système, 3.9 et plus, `npm run test:agence`) ; TypeScript strict pour le seul panneau `agence` (`src/panels/agence/`, `src/shells/desktop/ui/panels/agence/`) et le panneau `app` (007).

**Primary Dependencies** : aucune nouvelle. `cate` CLI, `gh`, `git`, `claude -p` (011 lot 6 seulement).

**Storage** : JSON éditable à la main, écrit par une seule CLI (`kernel/state` côté runtime ; `tx()` côté `agence`). Nouveaux fichiers prévus par les specs filles : `.cate/tmp/agence/backlog.json`, `decisions.json` (010), `specs/011-mesure-benchmark/{seuil,selection}.json` et `resultats/` (011).

**Testing** : `unittest` (agence), Vitest (panneaux). Aucun e2e exécuté par un agent (constitution X, FR-014).

**Target Platform** : macOS Apple silicon seule (constitution VIII).

**Project Type** : application desktop Electron + CLI Python d'orchestration.

**Performance Goals** : couche 1 : temps actif de l'humain en baisse d'au moins 30 % à qualité égale ou meilleure (hypothèse, Q3) ; calculs déterministes à 0 jeton (SC-006).

**Constraints** : 4 agents Claude vivants au plus sur le Mac de 24 Go (mémoire du projet ; 13 agents ont forcé un arrêt forcé) ; une PR ouverte à la fois sur `tools/agence/agence.py` et sur `skills/orchestrateur/SKILL.md` (recoupement, matrice) ; aucune fenêtre lancée par un agent.

**Scale/Scope** : 1 projet pilote (le fork Cate), 1 humain qui joue les rejeux, 2 cobayes non-dev candidats (Q4).

## Constitution Check

| Principe | Application dans ce plan | État |
|---|---|---|
| II Déclarer une fois | 010 et 011 ajoutent des commandes `agence` et un script, pas de liste écrite à la main ; le panneau lit l'état publié | OK |
| III Coupes nettes | aucun lot de migration ; un état ancien sans clé est complété (010 T004, 005 T006) | OK |
| VI Tests d'abord | chaque lot de spec fille a ses tests rouges d'abord ; les gates humaines ne remplacent aucun test | OK |
| VII Le plus simple | la mesure étend `attente_mesure.py` (006) au lieu d'un nouvel outil ; détections en code pur | OK, voir R6 (doublon `conso.py`) |
| IX Écart minimal avec upstream | écarts dans `src/` limités au panneau `agence` (010 lot 5) et au panneau `app` (007), modules propres au fork | OK |
| X Aucune fenêtre | benchmark joué par Heifara, gardes T015 et T061 de 011 ; recettes de gate faites par l'humain | OK |

Aucune violation : section « Complexity Tracking » vide.

## Ordre des couches et gates

| Couche | Specs et lots qui la font | Gate (critère de passage) | Preuve | Mesurée par | Tranche |
|---|---|---|---|---|---|
| **1. Noyau** | 001, 002 (livrées), 003 lots 0 et 1 (livrés), 004 lots 3 à 5, 005 lots 3 et 4, 006 lots 2 à 4, 010 lots 1 à 7 et 9, 011 lots 1 à 6 | **G1** : le benchmark atteint le seuil fixé avant le premier rejeu, sur des tâches de dev (009 récit 2, SC-002) | `specs/011-mesure-benchmark/rapport-benchmark.md` avec verdict « passe » contre `seuil.json` commité, empreintes concordantes | l'agent lance `benchmark.py rapport` (011 T054) ; Heifara fixe le seuil (011 T040), joue les rejeux (T043, T051) et la revue à l'aveugle (T053) | Heifara |
| **2. Règles d'orchestration** | 005 (dev, déjà en couche 1 pour le flux), 008 lots 1 à 4 | **G2** : un projet change de règles sans toucher au code | sur un dépôt de test : deux règles changées par le formulaire du panneau (008 lot 3), `agence pratiques show --json` les rend avec la source `projet`, le comportement suivant de l'orchestrateur suit (méthode de merge, preuve de fin), `git diff --stat` vide sur `src/` et `tools/` | Heifara fait la recette à l'écran ; l'agent contrôle en lecture seule (sorties citées) | Heifara |
| **3. Connecteurs et panneaux** | 007 lots 3 à 6, spec « métiers et connecteurs » à écrire (FR-008, FR-009, US3 à US5) | **G3** : un non-dev réel finit une tâche de son métier sans aide, preuve attachée (SC-004) | tâche du cobaye passée à `faite` par son validateur, preuve nommée attachée, 0 intervention de Heifara notée | Heifara observe et compte les interventions ; le cobaye joue | Heifara |
| **4. Récurrences** | 003 lots 2 à 5 et X | **G4** : une recette tourne sans l'humain et sa preuve est vérifiée | 3 exécutions consécutives sans intervention (hypothèse H5), preuve de chacune vérifiée par son validateur, journal cité | l'agent lit le journal et le validateur ; Heifara valide la recette au départ | Heifara |

Règle (FR-012) : une couche qui n'a pas passé sa gate n'est pas étendue. Lecture retenue (hypothèse H1) : les lots **déjà commités** d'une couche supérieure se terminent (vérification, PR, merge) ; les lots **non commencés** des couches 2 à 4 attendent leur gate, sauf s'ils sont un prérequis de la couche 1. Développer sur une branche reste permis ; merger non.

## Dépendances entre specs

```
005-L3 (local) ──> 005-L4 ──┐
006-L2 ──> 006-L3 ──────────┴─> 010-L4 (SKILL.md, section « Lancer ») ──> 011-L6 (une ligne du skill)
010-L1 ──> 010-L2 ──> 010-L4 ──> 010-L5 ──> 010-L9 [H] ────────────┐
   ├──> 010-L3 (avant 010-L9) ; 010-L2 ──> 010-L6 ; 010-L1 ──> 010-L7 │
011-L1 ─┐                                                            v
011-L2 ─┴─> 011-L3 ──> 011-L4 [H pilote] ─────────────────────> 011-L5 [H campagne] ==> G1
004-L3 ──> 004-L4 ──> 004-L5 ──> 004-X          (couche 1, non bloquant pour G1)
G1 ==> 008-L1 ──> {008-L2, 008-L3} ──> 008-L4 ==> G2
G1 ==> 007-L4, 007-L5 ──> 007-L6 [H] ; spec métiers et connecteurs ==> G3 (après G2)
G1 ==> 003-L2 ... 003-L5 ==> G4 (après G3)
```

| Spec | Dépend de | Est attendue par | Fichiers partagés (ordre) |
|---|---|---|---|
| 003 | rien de neuf | G4 | aucun avec 010 et 011 |
| 004 | 005-L4 sur `declencheurs.json` (C8, Q5 de 005) | 008-L1 (`declencheurs.json`) | `agence.py`, `declencheurs.json`, `SKILL.md` (lot 5) |
| 005 | 006-L3 avant 005-L4 sur `SKILL.md` | 010-L4 (grammaire de `--done-when`), 010-L7 (`pratiques.json`), 008-L1 | `agence.py`, `SKILL.md`, `pratiques.json` |
| 006 | rien | 005-L4, 010-L4, 011-L1 (`attente_mesure.py` étendu) | `SKILL.md`, `attente_mesure.py` |
| 007 | rien hors 007 | G3 | `docs/architecture.md` (hunks disjoints) |
| 008 | 005-L2, L3, L4 ; 004 pour `declencheurs.json` ; G1 (H1) | G2 | panneau `agence` avec 010-L5 (H2 : 010-L5 d'abord) |
| 010 | 005-L1 (mergé), 005-L3, 005-L4 et 006-L3 (via `SKILL.md`) | 011-L5 (hypothèse Q3 de 011) | `agence.py`, `SKILL.md`, panneau `agence` |
| 011 | 006-L1 (mergé) | G1 | `SKILL.md` (lot 6), `attente_mesure.py` |

## Livré et restant (origin/main `fd91eb8c`, 2026-11-20)

Les cases des `tasks.md` ne sont pas tenues à jour (005 à 008 : 0 case cochée) : l'état ci-dessous vient de `git log origin/main` et `git cat-file`, pas des cases.

| Spec | Livré sur `origin/main` (commits) | Commité en local, non mergé | Restant |
|---|---|---|---|
| 001, 002 | livrées (002 : rapport final `5fa99efb`, lots 5A et 5B cochés `fac4bdf6`) | | 002-5C [H Max] et 5D (Skills) : non vérifié |
| 003 | lots 0 et 1, journal d'observation (`fd40218d` à `a7b942e9`, cases `0285161b`) | | lots 2 à 5 et X (10,5 j) |
| 004 | lot 1 `contextTokens` (`b0a6eb15`, `e706b825`), lot 2 évaluateur à blanc (`4b696ac3`) ; lot 0 présumé (non vérifié) | | lots 3, 4, 5 et X (5 j + une semaine de mesure) |
| 005 | lot 1 (`0d1dfdd9`, `bf37fdc9`), lot 2 (`b91028c0`, `1cfed649`), lot 5 (`54ae7d01`, `157b6e39`) | lot 3, `feat/preuve-politique` `1927a1d6` (`done_when_defaut` absent de `origin/main`) | vérification et PR du lot 3, lot 4 (1 j) |
| 006 | lot 1, `attente_mesure.py` (`0acd2d0e`) | | lots 2, 3, 4 (1,5 j + une vague réelle) |
| 007 | lot 1 (`41efd90c`, `dc7014b9`), lot 2 (`11683a15`, `26089184`) | lot 3, `feat/panneaux-import-accord` `0354ab26` | vérification et PR du lot 3, lots 4, 5 (1,5 à 2 j), lot 6 [H] (0,5 j) |
| 008 | spec seule (`4dedb3d1`) | | lots 1 à 4 (4 j) |
| 009 | | spec `7c82ee6f` ; ce plan | |
| 010 | | spec `76d7b3bc` | lots 1 à 9 (8,5 j hors lot 8, dont 0,5 j [H] ; lot 8 : 1 j) |
| 011 | | spec `d77c191d` (`backlog.py` et `benchmark.py` absents de `origin/main`) | lots 1 à 6 (5,5 j agent + 14 à 34 h [H], hypothèse 011) |

Tailles : celles des `tasks.md` de chaque spec, non mesurées. Aucun coût en jetons par lot n'est chiffré par une mesure : « non chiffré ».

## Chemin critique vers G1

`010-L1` (1,5 j) → `010-L2` (1 j) → `010-L4` (1,5 j) → `010-L5` (1,5 j) → `010-L9` [H] (0,5 j) → `011-L5` (0,5 j agent + 10 à 30 h [H], hypothèse 011). Total agent : 6 j ; humain : 0,5 j + 10 à 30 h, plus 4 h de pilote (011-L4) et la fixation du seuil (011 T040) en parallèle.

Chaîne presque critique : `006-L2` (0,5 j) → `006-L3` (0,5 j) → `005-L4` (1 j, après le merge de `005-L3`) doit être mergée avant que `010-L4` touche `SKILL.md` (ordre 006, 005, 010 sur ce fichier, 010 « Dépendances »). Partie au jour 0, elle finit au jour 2 ; 010-L4 commence au jour 2,5. Marge : 0,5 j.

La ressource rare n'est pas l'agent : c'est le temps de Heifara (seuil, pilote, campagne, revue à l'aveugle, recette de 010) et la file des PR sur `agence.py`.

## Risques

| # | Risque | Effet | Parade |
|---|---|---|---|
| R1 | File de PR sur `tools/agence/agence.py` : 005-L4, 004-L3 à L5, 010 lots 1, 2, 3, 4, 6, 7, 8, 008-L1, L2 | le chemin critique attend un rebase | ordre fixé dans `tasks.md` (lot T-ORD), une PR ouverte à la fois, hunks disjoints, 010 prioritaire |
| R2 | `skills/orchestrateur/SKILL.md` : 006-L3, 005-L4, 010-L4, 011-L6, 004-L5 ; plafonds de taille (006 : 105 % de 13 936 octets ; 011 T062 : +2 %) ; C5 et C6 du recoupement | test rouge croisé, skill qui grossit et se relit à chaque tour | ordre 006, 005, 010, 011, 004 ; le test de taille se calcule sur le HEAD réel de chaque PR |
| R3 | Biais du benchmark : Heifara connaît les solutions, 10 à 15 issues, seuil en hypothèse | verdict faux dans un sens ou l'autre | seuil commité avant le premier rejeu (011 T024, T040), ordre tiré, revue à l'aveugle, 5 issues de réserve, limites écrites au rapport |
| R4 | Temps humain de la campagne : 10 à 30 h + 4 h de pilote (hypothèse 011) | G1 glisse de plusieurs semaines | pilote d'abord pour mesurer la durée réelle d'un rejeu (011-L4) ; Heifara décide ensuite du rythme |
| R5 | L'outil change pendant la campagne | rejeux non comparables | gel des merges sur `tools/agence/`, `skills/orchestrateur/`, `src/panels/agence/` de la première à la dernière campagne (hypothèse H3) ; la version est notée au rapport |
| R6 | Deux lecteurs de journaux de session : `attente_mesure.py` (006, 011) et `conso.py` du dépôt Skills (bus q162, recoupement C11) | double maintenance | 011 étend `attente_mesure.py` ; `conso.py` reste un déclencheur de 004 ; à réconcilier par l'orchestrateur Skills, hors de ce plan |
| R7 | Activation d'un déclencheur définie deux fois (004 `actif`, 005 `declencheurs.actifs`, recoupement C8) | réglage incohérent en couche 2 | trancher dans 005-L4 avant 008-L1 (Q5 de 005) |
| R8 | La couche 3 n'a pas de spec pour les connecteurs, le validateur par métier ni les droits (FR-008, FR-009, SC-005) ; MCP du data manager non vérifiés (Q5) | G3 sans plan | spec à écrire après G2 (lot S3 de `tasks.md`), recherche des MCP d'abord |
| R9 | Lots commités en local (005-L3, 007-L3) qui vieillissent pendant le gel | rebase coûteux | H1 : ils se terminent et se mergent maintenant |
| R10 | Plafond de 4 agents ; une sonde de 006-L2 prend 3 places | vague bloquée | 006-L2 en vague 1 avec un seul autre lot |

## Hypothèses de ce plan

- **H1** : les lots déjà commités se terminent ; les lots non commencés des couches 2 à 4 attendent leur gate (lecture de FR-012). À confirmer par Heifara.
- **H2** : 010-L5 passe avant 008-L3 sur le panneau `agence` (010 dit « après le lot panneau de 008 » ; 008 est en couche 2 et gelée par H1). 008-L3 rebase.
- **H3** : gel des merges sur les fichiers de l'outil pendant la campagne 011-L5 (R5).
- **H4** : 004 lots 3 à 5 et 006-L4 sont de la couche 1 mais ne bloquent pas G1 ; ce qui n'est pas mergé avant la campagne n'est pas mesuré.
- **H5** : G4 = 3 exécutions consécutives sans intervention ; G2 = 2 règles changées. Valeurs sans mesure.
- **H6** : la vérification et la PR d'un lot déjà commité prennent 0,5 j d'agent.

## Project Structure

### Documentation (this feature)

```text
specs/009-vision-v2/
├── spec.md       # cadre, couches, FR, SC (tenu par un autre panneau)
├── plan.md       # ce fichier
└── tasks.md      # lots transverses, gates, couverture
```

### Source Code

Aucun fichier de code n'est touché par la spec 009 elle-même. Les fichiers touchés sont ceux des lots des specs filles, listés dans leur `tasks.md` ; les points de contact sont dans « Dépendances entre specs » et R1, R2.

**Structure Decision** : spec de cadrage, documentation seule.

## Complexity Tracking

Aucune violation de la constitution à justifier.
