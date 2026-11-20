# Implementation Plan: Mesure par benchmark (preuve du gain de la couche 1)

**Branch**: `docs/spec-011-mesure-benchmark` | **Date**: 2026-11-20 | **Spec**: [spec.md](spec.md)

## Summary

Un script, `tools/agence/benchmark.py` (Python stdlib), prépare des rejeux d'issues fermées dans des clones neufs hors du dépôt, horodate le début et les fins dites par l'humain, lance les tests de la PR d'origine en arbitre, lit les journaux Claude Code avec la lecture de `attente_mesure.py` (étendue aux quatre postes de jetons et aux interventions humaines), et écrit un résultat en nombres par rejeu. Un rapport agrège et rend le verdict contre un seuil commité avant le premier rejeu. Une sous-commande `comparer` rejoue en automatique (`claude -p`) pour juger une économie de jetons. Une ligne de skill exige ce rapport dans les PR d'économie.

0 ligne dans `src/`, aucune dépendance, aucune fenêtre. Coût d'infrastructure : 0 € par mois. Coût réel : le temps de Heifara (10 à 30 h, hypothèse, spec.md Assumptions) et les jetons des rejeux (non chiffrés, mesurés au pilote).

## Technical Context

**Language/Version**: Python 3.9 stdlib (`tools/agence/`, comme `attente_mesure.py` et `pratiques.py`) ; Markdown (skill).
**Primary Dependencies**: aucune nouvelle ; `git`, `gh` (lecture), `cp -c` (APFS), `claude -p` (seulement `comparer`).
**Storage**: `specs/011-mesure-benchmark/{selection.json,seuil.json,resultats/*.json,rapport-benchmark.md}`, écrits par `benchmark.py` seul (sauf `seuil.json` : Heifara, à la main). Clones : `~/.cache/agence-bench/<issue>-<bras>/` (option `--racine`).
**Testing**: `npm run test:agence` (unittest) ; faux HOME, dossier temporaire, faux `gh`, `claude`, `open`, `osascript`, `electron`, `npx`, `playwright`, `npm` sur le PATH (constitution VI).
**Target Platform**: macOS arm64 (VIII).
**Constraints**: nombres seulement en sortie (006 FR-005) ; aucun modèle hors `comparer` ; aucune fenêtre (X) ; un rejeu ouvert à la fois.
**Scale/Scope**: vivier de 20 issues (spec.md, Clarifications), 2 + 10 (+5) issues, 2 bras, 4 indicateurs.

## Décision 1 : comment mesurer le temps actif de l'humain

| | (a) Traces horodatées existantes, intervention plafonnée | (b) Chronomètre tenu par l'humain (`benchmark.py pause`/`reprise`) | (c) Échantillonnage de l'OS (app au premier plan, inactivité clavier) |
|---|---|---|---|
| Source | journaux Claude Code (messages humains), clics agence (`agence.py:252-255`), `debut`/`fini` | l'humain | `ioreg` / `osascript` toutes les N s |
| Déterministe, sans modèle (009 FR-005) | oui | oui, mais déclaratif | oui |
| Charge pour l'humain | nulle | une commande à chaque pause, oubliée tôt ou tard | nulle |
| Biais | plafond de 180 s arbitraire ; lecture sans saisie non vue | oublis, arrondis | compte tout le temps devant l'écran, même hors rejeu ; lit l'activité de la machine (vie privée) |
| Constitution X | rien de lancé | rien de lancé | `osascript` lancé en boucle sur la machine de l'humain |
| Coût | 0 € | 0 € | 0 € |

**Recommandé : (a)**, calibré par (b) au pilote seulement (SC-005 de spec.md : écart ≤ 25 %). Le plafond et la règle de détection sont dans `seuil.json`, figés avec le reste avant la campagne.

Règle (a), écrite avant le code (T001) : on trie tous les événements du rejeu par instant. Un événement est **système** (sortie d'un tour `assistant`, message d'agent reconnu, notification) ou **humain** (message utilisateur non reconnu comme envoyé par une machine, clic, `debut`, `fini`). Temps actif = Σ sur les événements humains de `min(instant − instant du dernier événement système qui le précède, 180 s)`. Un message utilisateur est « machine » si son texte normalisé (espaces réduits) égale l'argument texte d'un appel Bash `cate agent send` ou `agence` d'un autre journal du même rejeu, ou s'il commence par `<task-notification>`, `Stop hook feedback`, `Another Claude session sent` (préfixes de `attente_mesure.py:43-46`).

## Décision 2 : où vit le harnais

| | (a) Script `tools/agence/benchmark.py` | (b) Sous-commande `agence bench` dans `agence.py` | (c) Panneau perso (spec 007) |
|---|---|---|---|
| Conflits | aucun : fichier neuf | `agence.py` est visé par 002, 004, 005, 008 (une PR à la fois, `specs/005-pratiques-reglables/tasks.md:34`) | panneau à écrire, et il faut quand même le calcul |
| Livré dans le tarball | non (outil de mesure de Heifara, lancé depuis le checkout) | oui, pour tous, sans usage | oui |
| Écart avec upstream (IX) | 0 dans `src/` | 0 dans `src/` | 0 dans `src/` |
| Effort | 3 lots | 3 lots + rebases | 4 lots |

**Recommandé : (a)**, comme `attente_mesure.py` (absent de `AGENCE_REQUIRED`, `scripts/agence-files.mjs:9`). Le panneau perso pour lire le rapport est inutile : le rapport est un Markdown.

## Protocole

1. **Vivier et tirage** (`benchmark.py select --graine N`) : `gh pr list --state merged --json number,closingIssuesReferences,files,baseRefOid,headRefOid`, filtre (PR qui ferme une issue, au moins un test unitaire, aucun test seulement e2e), tri par numéro, puis `random.Random(graine)` tire 2 pilotes, 10 de campagne, 5 de réserve, l'ordre et le bras de départ. Écrit `selection.json`. Refus si moins de 18 issues.
2. **Seuil** : `seuil.json`, pré-rempli par le lot 3 avec les hypothèses (rapport médian du temps actif ≤ 0,70 ; rapport médian des jetons ≤ 1,50 ; qualité : (a) outil ≥ nu en nombre d'arbitres verts au premier `fini`, (b) tours de reprise outil ≤ nu, (c) remarques outil ≤ nu + 10 % ; zone non conclusive 0,65 à 0,75 ; plafond d'intervention 180 s). Heifara le relit, le change s'il veut, le commite (T040). Empreinte : SHA-256 du fichier.
3. **Préparation** (`benchmark.py prepare <issue> <bras>`) : `git init` dans `<racine>/<issue>-<bras>/`, `git fetch --depth 1 <dépôt local> <baseRefOid>`, checkout ; aucun remote ; `node_modules` par `cp -c` si le lockfile est identique à celui de la racine, sinon état « dépendances à installer » ; énoncé `<racine>/<issue>-<bras>.md` (titre et corps de l'issue, hors clone). Refus si un autre rejeu est ouvert.
4. **Jeu** (l'humain) : `benchmark.py debut <issue> <bras>`, puis il ouvre lui-même son terminal et lance `claude` (bras nu) ou ouvre le clone comme workspace Cate et parle à l'interlocuteur ou à l'orchestrateur (bras outil). Même modèle et même mode de permission dans les deux bras (notés dans le résultat).
5. **Fin** (`benchmark.py fini <issue> <bras>`) : horodate, lance l'arbitre (fichiers de test de la PR copiés depuis `headRefOid`, lancés seuls : `./node_modules/.bin/vitest run <fichiers>` du clone (jamais `npx`, qui peut télécharger), ou `python3 -m unittest <modules>`), dit « vert » ou « rouge » sans montrer le test. Rouge : l'humain peut reprendre (tour de reprise, 3 au plus).
6. **Mesure** (`benchmark.py mesure <issue> <bras>`) : journaux de `~/.claude/projects/` dont le nom commence par le chemin encodé du clone (lui et ses worktrees) ; jetons par la lecture de `attente_mesure.py` ; temps actif par la règle de la décision 1 avec les clics lus dans l'état agence du clone ; contamination ; écrit `resultats/<issue>-<bras>.json`.
7. **Revue à l'aveugle** (`benchmark.py revue`) : présente les diffs des rejeux terminés dans un ordre tiré, sans le bras ; l'humain saisit un nombre de remarques et la marque « rouge par interface » s'il y a lieu.
8. **Rapport** (`benchmark.py rapport`) : vérifie l'empreinte du seuil et que `seuil.json` est commité, agrège, écrit `rapport-benchmark.md`.
9. **Comparaison** (`benchmark.py comparer --avant <ref> --apres <ref>`) : pour chaque issue du sous-ensemble, deux clones, `claude -p "<énoncé>" --output-format json` lancé dans chacun avec l'outil à `<ref>` (skills et briefs du dépôt à cette ref), arbitre, jetons ; « annuler » (code 1) si un vert devient rouge.

Note sur l'étape 5 : l'arbitre lance le Vitest déjà installé dans le clone, jamais `npx` ni un fichier sous `e2e/` ; le faux `npx` des tests (US3) échoue s'il est appelé.

## Reprise de `attente_mesure.py` (spec 006)

Aujourd'hui la lecture compte `cache_read_input_tokens` et `output_tokens` (`tools/agence/attente_mesure.py:81-82`), pour un seul dossier (`:132-158`). Le lot 1 ajoute, sans changer une sortie existante :
- `input_tokens` et `cache_creation_input_tokens` dans `acc` et dans `resume` (deux clés de plus, `jetons_entree`, `jetons_cache_cree`, et `jetons_total`) ;
- une fonction `interventions(path)` qui rend, en nombres, les instants des événements de la décision 1 (aucun texte rendu : la comparaison de textes se fait en mémoire, par empreinte) ;
- `mesurer` accepte une liste de dossiers.

Les 8 tests de `test_attente_mesure.py` restent verts sans retouche (garde de non-régression de la spec 006).

## Constitution Check

- **I couches** : rien dans `src/`. Passe.
- **II déclarer une fois** : le seuil et la sélection sont des fichiers lus par le script, pas recopiés dans le rapport ni le skill. Passe.
- **III coupes nettes** : aucune migration ; `attente_mesure.py` est étendu, pas dupliqué. Passe.
- **VI tests d'abord** : fixtures et nombres attendus écrits avant le code de chaque lot ; faux exécutables pour `gh`, `claude`, `npx`, `git` réel en dossier temporaire. Passe.
- **VII le plus simple** : stdlib, traces existantes plutôt qu'un capteur, Markdown plutôt qu'un panneau. Passe.
- **IX écart minimal** : `tools/agence/` et `skills/` seulement. Passe.
- **X aucune fenêtre** : le harnais ne lance ni app, ni Electron, ni Playwright, ni `npm ci` ; l'humain ouvre son terminal et son workspace ; tests garde (US3). `comparer` lance `claude -p` sans interface. Passe.

## Project Structure

### Documentation (this feature)

```text
specs/011-mesure-benchmark/
├── spec.md
├── plan.md
├── tasks.md
├── selection.json          # lot 4 (écrit par benchmark.py select)
├── seuil.json              # lot 3 (pré-rempli), T040 (Heifara)
├── resultats/              # lots 4 et 5 (un JSON par rejeu)
├── rapport-pilote.md       # lot 4
└── rapport-benchmark.md    # lot 5 (verdict de couche 1)
```

### Source Code

```text
tools/agence/
├── attente_mesure.py         # lot 1 : jetons par poste, interventions, plusieurs dossiers
├── test_attente_mesure.py    # lot 1 : ajouts
├── benchmark.py              # lots 2, 3, 6 (nouveau)
├── test_benchmark.py         # lots 2, 3, 6 (nouveau)
├── test_regle_economie.py    # lot 6 (garde de texte du skill)
└── fixtures/bench/           # lots 1 à 3 (journaux, état agence, faux gh, faux claude)
skills/orchestrateur/SKILL.md # lot 6 : une ligne
```

## Conflits de fichiers avec les autres epics

| Fichier | Cette epic | Autres | Règle |
|---|---|---|---|
| `tools/agence/attente_mesure.py`, `test_attente_mesure.py` | lot 1 | 006 lot 4 (mesure après : lit, ne modifie pas) | aucun conflit attendu ; si 006 rouvre le script, rebase |
| `tools/agence/benchmark.py`, `test_benchmark.py`, `fixtures/bench/` | lots 2, 3, 6 | aucun | seul propriétaire ; lots en série sur ce fichier |
| `skills/orchestrateur/SKILL.md` | lot 6, une ligne | 005 lot 4, 006 lot 3, 010 (interlocuteur) | dernier sur ce fichier ; l'orchestrateur sérialise |
| `specs/011-mesure-benchmark/**` | tous | aucun | seul propriétaire |
| `specs/009-vision-v2/spec.md` | non touché | tenu par un autre panneau | le verdict est référencé par son propriétaire, pas par cette epic |

## Estimation de coût

- Agents : lots 1, 2, 3, 6 : 4,5 j ; lots 4 et 5 (agent) : 1 j. Jetons d'implémentation : non chiffrés (aucune mesure d'un lot de ce type).
- Humain : pilote 2 issues × 2 bras ; campagne 10 (+5) × 2 ; revue à l'aveugle ~5 min par diff. Hypothèse 30 à 60 min de temps mural par rejeu, soit 10 à 30 h ; le rapport du pilote donne la valeur mesurée avant que la campagne parte.
- Jetons des rejeux et de `comparer` : non chiffrés ; mesurés au pilote et à la première comparaison.
- Infrastructure : 0 € par mois.

## Complexity Tracking

Aucune violation de la constitution à justifier.
