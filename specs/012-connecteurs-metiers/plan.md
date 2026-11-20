# Implementation Plan: Connecteurs et métiers (couche 3)

**Branch**: `docs/spec-012-connecteurs-metiers` (depuis `docs/spec-009-plan` `b8a37663`) | **Date**: 2026-11-20 | **Spec**: `specs/012-connecteurs-metiers/spec.md`

**Input**: spec 012 ; `specs/009-vision-v2/{spec,plan,tasks}.md` (S3, C3, G3) ; specs 005, 007, 008 ; code `tools/agence/` sur la base `b8a37663` (= `origin/main` `fd91eb8c` pour `tools/`).

## Summary

Un métier et ses connecteurs sont des données : deux catalogues JSON dans `tools/agence/`, lus par la règle `parmi` de la politique de 005 (`pratiques.py:56-60`). Le projet choisit son métier et ouvre les droits par trois clés de cette politique ; le formulaire et les premières questions de 008 les affichent sans code TypeScript propre. La validation centrale existe déjà pour Slack, le mail et GitHub (brouillon, clic Envoyer, garde `send` qui autorise un appel identique, `agence.py:2451-2524`) : elle se généralise aux outils MCP déclarés par une cible `outil:<connecteur>:<outil>`. Le validateur d'un métier étend la grammaire de fin de 005-L3 d'une forme `preuve:<nom>`. Aucun fichier de `src/` n'est touché.

## Technical Context

**Language/Version** : Python 3 stdlib (`tools/agence/`, système, 3.9 et plus, `npm run test:agence`) ; Markdown (skill).

**Primary Dependencies** : aucune nouvelle. `claude mcp list` (lecture de l'état des MCP, faux exécutable dans les tests), `cate browser network` (`src/services/browser/contract/api.ts:254-259`, preuve du data manager).

**Storage** : deux catalogues livrés (`tools/agence/connecteurs.json`, `metiers.json`) ; trois clés dans les fichiers de politique existants de 005 (projet `<racine>/.cate/tmp/agence/pratiques.json`, dev `~/.config/agence/pratiques.json`) ; cartes dans `st['drafts']` (`state.json`). Aucun nouveau fichier d'état.

**Testing** : `unittest` (`tools/agence/test_*.py`), faux HOME, faux `claude` et faux `cate` sur le PATH. Aucun e2e, aucune fenêtre (constitution X).

**Target Platform** : macOS Apple silicon (constitution VIII).

**Project Type** : CLI Python d'orchestration et skill.

**Performance Goals** : calculs de droits et de preuves en code pur, 0 jeton (SC-007). Coût d'un démarrage de la garde par appel MCP d'un serveur déclaré : non mesuré (Q7).

**Constraints** : file de PR sur `tools/agence/agence.py` (009 R1) et sur `pratiques.json` ; une PR ouverte à la fois par fichier.

**Scale/Scope** : 1 métier livré pour le cobaye (hypothèse : media planner), 2 métiers de fixture (data manager, chef de projet), 1 connecteur factice.

## Constitution Check

| Principe | Application | État |
|---|---|---|
| II Déclarer une fois | métiers et connecteurs déclarés une fois dans leurs catalogues ; le formulaire, les questions, la garde et `check` les lisent ; aucune liste recopiée dans le skill ni dans `src/` | OK |
| III Coupes nettes | `est_envoi` (`agence.py:2467-2468`) remplacé par une fonction qui lit les catalogues, pas doublé ; aucune migration : métier absent = `dev` | OK |
| V Le runtime est l'application | aucune logique dans une vue ; les cartes sont celles du régisseur | OK |
| VI Tests d'abord | chaque lot commence par ses tests rouges ; SC-005 de 009 est un test du lot 2 | OK |
| VII Le plus simple | réutilise `parmi`, les brouillons, la garde `send`, la grammaire de 005-L3 et le formulaire de 008 ; pas de nouvelle UI, pas de nouveau fichier d'état | OK |
| IX Écart minimal | 0 fichier sous `src/` (FR-013) | OK |
| X Aucune fenêtre | preuve réseau par `cate browser network` dans un panneau du canvas, prise par l'humain ou son orchestrateur dans un vrai projet, jamais dans un test ; G3 jouée par le cobaye | OK |

Aucune violation : « Complexity Tracking » vide.

## Décisions

### D1 : catalogues dans `tools/agence/`, choix par la politique

| Option | Pour | Contre |
|---|---|---|
| **Catalogues `connecteurs.json` et `metiers.json` + clés `parmi` (retenue)** | `parmi` existe (`pratiques.py:56-60`) ; formulaire et questions de 008 gratuits ; validation et garde `pages` de 005 gratuites | un connecteur propre à un projet passe par une PR (Q1) |
| Un fichier de connecteurs par projet | souple | nouveau fichier d'état, nouvelle garde, nouvelle vue du formulaire |
| Réglage natif de Cate (`defineSettings`) | dans l'écran Réglages | écart dans `src/` (IX), 008 l'a déjà écarté (008 Clarifications) |

Seul ajout à `pratiques.py` : une cohérence « connecteur dans le métier » (les cohérences actuelles comparent des valeurs, `pratiques.json:21-24`) et le défaut de `connecteurs.lecture` dérivé du métier.

### D2 : écriture = carte, garde `deny`

La garde `send` sait déjà autoriser un appel MCP identique à un brouillon cliqué, une seule fois (`agence.py:2451-2464`, `:2494-2498`). La cible `outil:<connecteur>:<outil>` porte l'appel ; le texte est le JSON canonique des arguments (`json.dumps(..., sort_keys=True, ensure_ascii=False, separators=(',', ':'))`). Écart volontaire avec Slack et Gmail, qui rendent `ask` : un connecteur rend `deny`, car le cobaye non-dev ne doit pas valider dans un terminal (SC-005 de 009 parle de refus). L'exécution reste à l'agent, après le clic, comme pour le mail : le régisseur n'appelle aucun MCP.

### D3 : matcher des hooks généré

`HOOK_ENTREES` est fixe aujourd'hui (`agence.py:2582-2588`). Il devient : les deux entrées actuelles, plus une entrée `mcp__(<serveur1>|<serveur2>)__.*` construite depuis `connecteurs.json`, mode `send`, échec fermé (`ask` si la garde est introuvable, comme `ASK_INTROUVABLE`). `hooks status` compare le matcher posé au matcher attendu : un connecteur ajouté rend `partiel`. Alternative `mcp__.*` : une seule entrée, mais la garde démarre sur chaque appel MCP de toute session de la machine et son échec fermé bloquerait les MCP sans rapport (Q7).

### D4 : preuves nommées

Grammaire de 005-L3 (`FORMES`, `CONDITION_RE` sur `feat/preuve-politique`) étendue de `preuve:<nom>`. Le type vient du métier : `fichier` et `lien` ferment par `need done --evidence` vérifié (fichier régulier non vide sous la racine, SHA-256 noté ; URL `https://`) ; `clic` ferme sur la réponse « Validé » d'une carte `agence ask` liée au besoin, jamais par `--evidence`. `done_when_defaut` lit `metier` : `dev` garde la règle de 005.

### D5 : secrets par référence

Un connecteur `api` porte `secret: {variable, fichier?}`, lu par une fonction tirée de `slack_token` (`agence.py:685-698`) généralisée, jamais publiée. `slack_token` devient un appel de cette fonction (coupe nette, pas de doublon). Les catalogues sont testés contre les motifs de secret de 007 FR-012. Un connecteur MCP n'a aucun champ secret : son authentification reste dans le client MCP.

### D6 : ordre de choix en code pour ce qui est déterministe

`agence connecteur check` lit `claude mcp list` (branché ou non), l'environnement (variable présente ou non) et le catalogue (`acces`). Chercher un MCP existant sur GitHub n'est pas déterministe : c'est le skill `metier` qui le décrit, et le lot 0 qui le fait pour le cobaye.

## Fichiers touchés

| Fichier | Lots | Nature |
|---|---|---|
| `tools/agence/connecteurs.json` | 1, 5 | nouveau ; `factice` dans les fixtures seulement |
| `tools/agence/metiers.json` | 1, 5 | nouveau ; `dev` au lot 1, métier du cobaye au lot 5 |
| `tools/agence/metiers.py` | 1, 3, 4 | nouveau : chargement et validation des catalogues, preuves, secrets |
| `tools/agence/fixtures/metiers/` | 1 à 4 | nouveau : `factice`, `data-manager`, `chef-de-projet` |
| `tools/agence/pratiques.json`, `pratiques.py` | 1, 3 | trois clés, une cohérence ; forme `preuve:` |
| `tools/agence/agence.py` | 2, 3, 4 | garde, `draft new`, `hooks`, `need done`, `connecteur check`, `prerequis` |
| `tools/agence/test_metiers.py`, `test_connecteurs.py` | 1 à 4 | nouveaux |
| `tools/agence/test_guard.py`, `test_hooks.py`, `test_preuve.py`, `test_doctor.py` | 2 à 4 | ajouts |
| `scripts/agence-files.mjs`, `scripts/build-runtime-tarball.test.mjs` | 1 | trois fichiers ajoutés à `AGENCE_REQUIRED` (`agence-files.mjs:9`) |
| `skills/metier/SKILL.md`, `evals.json` | 5 | nouveau skill |
| `docs/architecture.md` | 1 | § panneau agence : catalogues, trois clés |
| `specs/012-connecteurs-metiers/research.md` | 0 | recherche des connecteurs |

## Dépendances

```
G2 (009) ==> 012-L1 ──> 012-L2 ──┐
005-L3 mergé ──> 012-L3 (après L1)├──> 012-L5 ──> 012-L6 [H] ==> G3 (009 T050, T051)
008-L1, L3, L4 ──> 012-L4 (après L1)┘
012-L0 (recherche, lecture seule, peut partir avant G2) ──> 012-L5
009 T041 [H] (cobaye) ──> 012-L0 (périmètre) ──> 012-L5
007 lots 3 à 6 (C3) : en parallèle, aucun fichier commun
```

Ordre sur `agence.py` (009 R1) : L2, L3, L4, une PR à la fois, après les lots 008 et 010 déjà dans la file (009 T010).

## Risques

| # | Risque | Effet | Parade |
|---|---|---|---|
| R1 | Les arguments qu'un client MCP passe au hook diffèrent de ceux que l'agent a mis dans la carte (valeurs par défaut ajoutées, types) | carte cliquée qui ne passe jamais | test de la sérialisation canonique ; le lot 6 note un cas réel ; si l'écart existe, la carte compare les seuls champs qu'elle nomme (décision à prendre sur preuve, pas avant) |
| R2 | Un MCP d'outil métier mélange lecture et écriture dans un même outil (paramètre `action`) | lecture refusée ou écriture qui passe pour lecture | un outil non classé est une écriture (FR-003) ; le lot 0 classe chaque outil |
| R3 | Le cobaye a besoin d'un outil sans MCP ni API : navigateur seul | G3 sans écriture possible | v1 : l'écriture devient « à faire par l'humain » ; la tâche de référence choisie au lot 0 doit tenir en lecture et en cartes |
| R4 | Cinquième question d'installation contre 008 SC-006 (4 au plus) | conflit de spec | tranché (Q4 de la spec) : la question `metier` remplace celle de `tests` ; 4 questions, 008 inchangée |
| R5 | Le matcher généré oublie un serveur (renommé par la personne) | écriture non gardée sur ce serveur | `hooks status` `partiel`, point de `doctor` ; le serveur doit être déclaré pour être utilisé par le métier |
| R6 | Secret collé par erreur dans un catalogue par une PR | fuite dans le dépôt | test des motifs (FR-001) dans `npm run test:agence`, porte de chaque PR |

## Hypothèses de ce plan

- **P1** : tailles des lots : estimations sans mesure, sur le modèle des lots de 005 et 008.
- **P2** : la garde reçoit les arguments complets de l'appel MCP dans `tool_input` (vrai pour Gmail : `agence.py:2458-2461` compare `to`, `cc`, `body`).
- **P3** : `claude mcp list` rend une ligne par serveur avec son état ; format exact à figer dans le faux exécutable à partir d'une sortie réelle citée au lot 4.

## Project Structure

### Documentation (this feature)

```text
specs/012-connecteurs-metiers/
├── spec.md       # métiers, connecteurs, droits, validateur
├── plan.md       # ce fichier
├── tasks.md      # lots 0 à 6
└── research.md   # lot 0 (à écrire)
```

### Source Code

```text
tools/agence/
├── connecteurs.json      # catalogue
├── metiers.json          # catalogue
├── metiers.py            # validation, preuves, secrets
├── fixtures/metiers/     # factice, data-manager, chef-de-projet
└── test_metiers.py, test_connecteurs.py
skills/metier/SKILL.md
```

**Structure Decision** : tout dans `tools/agence/` et `skills/` (FR-013) ; aucun module de `src/`.

## Complexity Tracking

Aucune violation de la constitution à justifier.
