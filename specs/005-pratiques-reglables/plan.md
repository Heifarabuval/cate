# Implementation Plan: Pratiques réglables par dev

**Branch**: `docs/spec-pratiques-reglables` | **Date**: 2026-11-20 | **Spec**: [spec.md](spec.md) | **Audit**: [audit.md](audit.md)

## Summary

Une politique de flux par dev et par projet, lue à chaque commande dans deux fichiers JSON, validée contre un schéma déclaré une fois. Le code Python qui la porte tient dans un module neuf, `tools/agence/pratiques.py`, et un fichier de données, `tools/agence/pratiques.json` (schéma, défauts, presets). `agence.py` n'y gagne que des appels : méthode de merge, source du jeton Slack, plafond d'agents, grammaire de `--done-when`, point de `doctor`, clé `pratiques` de l'état. Le skill `orchestrateur` cesse d'écrire le flux en dur : il colle le bloc que rend `agence pratiques brief`. Le panneau affiche la politique en lecture seule.

Aucune dépendance, aucun appel de modèle, aucune migration. Coût mensuel : 0 €.

## Technical Context

**Language/Version**: Python 3.9 stdlib (`tools/agence/`, système macOS) ; TypeScript strict (panneau, contrat et session) ; Markdown (skill).
**Storage**: JSON éditable à la main, un seul écrivain (la CLI) : `<racine>/.cate/tmp/agence/pratiques.json` et `~/.config/agence/pratiques.json`. `pratiques.json` du fork (données livrées) est en lecture seule.
**Testing**: `npm run test:agence` (unittest, faux HOME, faux `gh` sur le PATH), Vitest pour le panneau, `scripts/build-runtime-tarball.test.mjs` pour la liste livrée.
**Target Platform**: macOS arm64 (principe VIII).
**Performance Goals**: lecture de la politique < 5 ms (deux petits fichiers) ; aucun appel réseau ; `ci-green` réutilise l'appel `gh pr view` déjà fait par tour.
**Constraints**: invariants hors schéma (spec, FR-005) ; coupes nettes (III) ; `agence.py` ne grossit pas de plus de 150 lignes par lot (SC-006) ; écart avec upstream limité au panneau agence (IX).
**Scale/Scope**: 12 réglages, 2 presets, 5 lots.

## Constitution Check

| Principe | Verdict | Détail |
|---|---|---|
| I. Couches et côtés | OK | Python hors `src/`. Côté TypeScript : un champ de contrat (`pratiques`) dans `src/panels/agence/contract/types.ts`, lu par `session.ts` ; la vue ne lit aucun fichier. |
| II. Déclarer une fois | OK | Schéma, valeurs, défauts et presets dans `pratiques.json` seul. Validateur, `show`, `brief`, `doctor` en dérivent. Le panneau affiche ce que le régisseur publie, il ne connaît aucune clé par son nom. |
| III. Coupes nettes | OK | `HERMES_ENV`, `MAX_AGENTS`, `maxAgents`, `actif` de la table des déclencheurs disparaissent ; aucun alias. Le coût est un geste unique de Heifara (`preset pr-tdd`), écrit dans la PR. |
| IV. Pas de branchement sur le contexte | OK | Aucun `if` sur local ou distant ni sur un type de panneau. |
| V. Le runtime est l'application | OK | La logique est dans la CLI du runtime ; le panneau demande (op « ouvrir le fichier »), la session agit. |
| VI. Tests d'abord | Applicable | Chaque lot commence par ses tests rouges (cités dans `tasks.md`). `gh` se fait par un faux exécutable. |
| VII. Le plus simple | OK, une exception | Un module et un fichier de données de plus. Justifié : `agence.py` fait 2 870 lignes et trois autres epics y écrivent ; la logique pure de la politique y serait un quatrième foyer de conflits. |
| VIII. macOS arm64 | OK | Rien de plus. |
| IX. Écart minimal | OK | Seul `src/panels/agence/` bouge (lot 5), déjà un écart du fork. |
| X. Aucune fenêtre | OK | Aucun test e2e ; le panneau se teste en jsdom. |

## Mécanisme

### Lecture et priorité

`pratiques.charger(racine, home)` rend `(valeurs, sources, erreur)`. Ordre, la dernière source gagne clé par clé :

1. preset `neutre` (source `défaut`) ;
2. preset nommé par `preset` dans le fichier du dev (source `dev`), puis les clés du fichier du dev (source `dev`) ;
3. preset nommé par `preset` dans le fichier du projet, puis ses clés (source `projet`).

Fichier absent : sauté. Fichier illisible ou invalide : `erreur` renseignée, valeurs de `neutre`. Les commandes qui **agissent** selon la politique (`ask --merge`, `need add`, merge au clic) refusent (code 2) quand `erreur` n'est pas vide ; `watch` continue avec `neutre`, publie l'erreur et ne s'arrête pas. Choix : un flux strict ne retombe jamais en silence sur un flux lâche.

### Schéma (`pratiques.json`, donnée livrée)

```
{
 "cles": { "<chemin pointé>": {"valeurs": [...] | "type": "entier", "min": 1, "max": 16 | "liste": [...], "defaut": ..., "dit": "<une ligne>"} },
 "coherences": [ {"si": {...}, "alors": "refus", "message": "..."} ],
 "presets": { "neutre": {...}, "pr-tdd": {...} }
}
```

| Clé | Valeurs permises | `neutre` | `pr-tdd` |
|---|---|---|---|
| `livraison.mode` | `pr`, `main` | `pr` | `pr` |
| `livraison.merge` | `clic`, `dehors` | `clic` | `clic` |
| `livraison.methode` | `squash`, `rebase`, `merge` | `squash` | `rebase` |
| `issue` | `libre`, `obligatoire` | `libre` | `obligatoire` |
| `tests` | `libre`, `tdd` | `libre` | `tdd` |
| `speckit` | `non`, `au-dela-d-une-journee`, `toujours` | `non` | `au-dela-d-une-journee` |
| `verification` | `libre`, `differente` | `libre` | `differente` |
| `preuve` | liste de `pr-mergee`, `ci-verte`, `tests-locaux`, `rapport` ; absente : dérivée du mode (`pr` : `["pr-mergee"]`, `main` : `["rapport"]`) | dérivée | `["ci-verte", "pr-mergee"]` |
| `agents.max` | entier de 1 à 16 | 4 | 4 |
| `declencheurs.actifs` | liste d'identifiants de `declencheurs.json` | `["T1"]` | `["T1", "T2", "T3"]` |
| `envoi.slack.variable` | nom de variable d'environnement | `SLACK_USER_TOKEN` | `SLACK_USER_TOKEN` |
| `envoi.slack.fichier` | chemin d'un fichier `.env`, ou `null` | `null` | `null` |

Cohérences refusées : `livraison.mode = main` avec `preuve` contenant `pr-mergee` ou `ci-verte` ; `verification = differente` avec `agents.max = 1` ; `declencheurs.actifs` citant un identifiant absent de la table. Une clé du preset `pr-tdd` qui n'existe pas dans le schéma est une erreur de test, pas de runtime.

Contenu de `pr-tdd` : repris de ce que le fork écrit déjà (skill, constitution `VI` et « Flux de travail », audit lignes C et E). Le preset ne contient aucun chemin ni nom de personne ; le fichier du jeton Slack de Heifara va dans son `~/.config/agence/pratiques.json`.

### Commandes

| Commande | Effet |
|---|---|
| `agence pratiques show [--json]` | valeurs effectives et sources ; code 2 si `erreur` |
| `agence pratiques set <clé> <valeur> [--dev]` | valide le résultat entier puis écrit (verrou `fcntl`, remplacement atomique) |
| `agence pratiques unset <clé> [--dev]` | retire la clé du fichier |
| `agence pratiques preset <nom> [--dev]` | pose `preset` |
| `agence pratiques check` | valide les deux fichiers, n'écrit rien |
| `agence pratiques brief` | bloc de pratiques à coller dans un brief : invariants, puis une ligne par exigence active (`tests: tdd` donne « test rouge vu en échec avant le code ») |
| `agence need pr <besoin> <N>` | rattache la PR à un besoin `task` (lot 3) |

Les trois commandes d'écriture et le fichier sont refusés aux agents par la garde `pages` (lot 1).

### Preuve de fin

`preuve` se traduit en grammaire de `--done-when` : `pr-mergee` en `pr-merged:N`, `ci-verte` en `ci-green:N`, `tests-locaux` en `tests-local`, `rapport` en `report`. Le besoin `task` créé sans `--done-when` reçoit la forme dérivée avec `N` vide ; `need pr` la complète. Évaluation par une fonction pure `pratiques.evaluer(done_when, faits)` qui rend `(fait, manques)`, `faits` étant l'état GitHub déjà relevé par tour (`state`, `checks`). Les conditions machine ferment seules ; `tests-local` et `report` exigent `need done --evidence`.

### Texte du skill

Le skill n'énumère plus le flux. Il dit : « Avant de découper : `agence pratiques show`. Dans chaque brief, colle le bloc de `agence pratiques brief`. » Le texte qui dépend de `livraison.mode`, `livraison.merge` et `verification` (audit, lignes C et E) devient deux ou trois phrases conditionnelles lisibles, ni un gabarit ni du code.

## Points de contact avec la spec 002 (lots 2, 3, 5, écrits par un autre agent)

| Point | Où | Ce que fait 005 | Règle |
|---|---|---|---|
| `doctor --prerequis` | `tools/agence/agence.py` (`prerequis`, ~1860-1930), `test_doctor.py` | ajoute le point `pratiques` et rend `gh` conditionnel (lot 2) | 005 lit la liste de points de 002 telle que mergée ; si le lot 4 de 002 (amorçage) touche la même fonction, rebase de l'un sur l'autre, jamais deux PR ouvertes qui éditent `prerequis()` ensemble |
| Nom de l'humain | `nom()`, `st['humain']` | n'y touche pas ; les textes que 005 ajoute (`brief`, refus, panneau) disent « l'humain » par `nom()` | 002 garde la propriété de tout texte au nom de l'humain |
| État écrit par `watch` | `un_tour` (~1980-2000) | ajoute `st['pratiques']` à côté de `humain` et `garde` | même motif (clé absente = état ancien valide) ; ajouts disjoints |
| Pureté (SC-002 de 002) | `tools/agence/test_portable.py` | étend la liste des mots interdits : `hermes`, `.hermes` | une ligne ajoutée à un test de 002 ; à faire dans le lot 2 de 005, pas avant que les lots 2 et 3 de 002 soient mergés |
| Bascule de Skills (002, lot 5) | dépôt Skills | déjà faite (002 L5-07) ; le merge du lot 2 de 005 doit attendre le preset `pr-tdd` réglé chez Heifara (T064) | sinon son merge passe de rebase à squash sans qu'il l'ait voulu ; action **[H]** : `agence pratiques preset pr-tdd --dev` avant le merge du lot 2 |
| Gardes | `agence guard --mode pages` | étend la liste des écritures refusées à `pratiques.json` (lot 1) | même fonction que 002 lot 3 ; ajout de deux motifs |

## Conflits de fichiers avec les autres epics

Les quatre specs (002 lots macro, 005, 006 coût de l'attente, 007 panneaux perso partagés) s'écrivent en même temps ; un essaim d'implémenteurs les prendra ensuite en parallèle. Fichiers lus dans les worktrees voisins (état au 2026-11-20, à relire avant de planifier la vague).

| Fichier | Lots de 005 | Autres epics qui le visent | Risque | Règle proposée |
|---|---|---|---|---|
| `tools/agence/agence.py` | 1, 2, 3, 4 | 002 (lots 2, 3, 4 si encore ouverts), 004 (lots 3 à 5), 006 (piste `agence wait`, lot 4 si retenu) | **Élevé** : fichier de 2 870 lignes, quatre epics | Hunks disjoints (appels, pas de logique : `pratiques.py` porte la logique). Un seul lot de ce fichier ouvert à la fois par epic ; l'orchestrateur sérialise les PR qui le touchent et fait rebaser la suivante |
| `tools/agence/test_agence.py` | 2, 3 | 002, 004, 006 | Moyen | Tests nouveaux dans des fichiers neufs : `test_pratiques.py` (lots 1, 3), `test_retrait.py` (lot 2), `test_preuve.py` (lot 3) ; `test_agence.py` ne change que là où `HERMES_ENV` et `--rebase` sont déjà utilisés |
| `skills/orchestrateur/SKILL.md` | 4 | 002 (le skill est son objet), 006 (lot 3 : ligne 28 et deux lignes), 007 (peut le citer) | **Élevé** | Lot 4 de 005 **après** le lot 3 de 006, ou rebase ; l'orchestrateur sérialise. Diff de 005 : remplacement des lignes 19, 20, 25, 30, 36, 39-41, 43, 65, 74 (audit) |
| `tools/agence/declencheurs.json`, `test_declencheurs.py` | 4 (tâche `declencheurs.actifs`, Q5) | 004 (lots 3 à 5, 4e déclencheur) | Moyen | Tâche séparable ; si 004 a des lots ouverts, elle passe à 004 |
| `tools/agence/pratiques.json`, `pratiques.py`, `test_pratiques.py` | 1 (création), 3, 4 (ajouts) | aucun | Nul | Fichiers neufs, propriété de 005 |
| `scripts/agence-files.mjs`, `scripts/build-runtime-tarball.test.mjs` | 1 | 002 (lot 3 y a ajouté `agence-hook`) | Faible | Une ligne dans `AGENCE_REQUIRED` ; relire `origin/main` avant |
| `src/panels/agence/contract/types.ts`, `session.ts`, `session.test.ts` | 5 | 002 (lots 2, 3 y ont ajouté `humain`, `garde`) | Faible | Ajout d'un champ à côté des leurs ; lot 5 après leur merge |
| `src/shells/desktop/ui/panels/agence/{AgenceView,QuestionCard}.tsx` | 5 | 002 (bannière `garde`) | Faible | Ajouts disjoints |
| `docs/architecture.md` | 1 (fichiers de la politique), 5 | tous | Moyen | Un titre par lot ; rebase avant la PR |
| `src/panels/framework/`, `src/panels/app/` | aucun | 007 | Nul | 005 ne touche pas les définitions de panneau |

**Ordre de merge et conflits entre les 4 specs** : voir `specs/recoupement-2026-11-20.md` (PR #110) (vague 1 : 005-L1, 007-L2, 002-5A, 006-L1).

**Ce qui ne bouge pas, par choix** : la propriété du texte « au nom de l'humain » (002), la table des déclencheurs hors du champ `actif` (004), la règle d'attente de l'orchestrateur (006 : le plafond du filet de 600 s et le seuil de `/compact` ne deviennent pas des réglages en v1, voir Q9).

## Project Structure

### Documentation (cette feature)

```
specs/005-pratiques-reglables/
├── audit.md     # l'entrée : occurrences propres à Heifara, sourcées
├── spec.md
├── plan.md
└── tasks.md
```

### Source Code (à écrire)

```
tools/agence/
├── pratiques.py            # NEUF : charger, valider, brief, done_when_defaut, evaluer (fonctions pures)
├── pratiques.json          # NEUF : schéma, cohérences, presets (donnée livrée)
├── test_pratiques.py       # NEUF : lots 1, 3
├── test_retrait.py         # NEUF : lot 2
├── test_preuve.py          # NEUF : lot 3
├── agence.py               # appels seulement (sous-commande, merge, jeton, plafond, doctor, watch, grammaire)
└── declencheurs.json       # lot 4 : sans `actif`
skills/orchestrateur/SKILL.md          # lot 4
scripts/agence-files.mjs               # lot 1 : `agence/pratiques.py`, `agence/pratiques.json` requis
src/panels/agence/contract/types.ts    # lot 5 : `pratiques` dans l'état
src/panels/agence/session.ts           # lot 5 : publie, op `openPratiques`
src/shells/desktop/ui/panels/agence/   # lot 5 : ligne « Pratiques », bannière d'erreur
docs/architecture.md                   # lots 1 et 5
```

## Lots (une PR chacun, livrable seul)

| Lot | Contenu | Taille | Dépend de |
|---|---|---|---|
| 1 | Schéma, presets `neutre` et `pr-tdd`, lecture, validation, commande `agence pratiques`, `watch` publie `pratiques`, garde `pages` étendue, livraison dans le tarball | 1,5 j | rien |
| 2 | Retrait du codé en dur : méthode de merge, `ask --merge`, jeton Slack, plafond d'agents, `doctor` | 1 j | 1 |
| 3 | Preuve de fin dérivée : grammaire, `need add`, `need pr`, évaluation, `ci-green` | 1,25 j | 1 (puis après 2 : `agence.py`) |
| 4 | Skill lit la politique, `declencheurs.actifs`, pureté étendue | 1 j | 1 ; après 006 lot 3 pour le skill |
| 5 | Panneau : ligne, valeurs, bannière, ouvrir le fichier, libellé de merge | 1 j | 1 |

Total : 5,75 j d'agent. Estimation en jetons ou en euros : non chiffrée (aucune mesure faite).

## Risques

| Risque | Parade |
|---|---|
| Heifara oublie `preset pr-tdd` et son merge passe de rebase à squash | `doctor` affiche `pratiques : neutre (aucun fichier)` en `info` ; la PR du lot 2 le dit en tête ; action **[H]** (T064) nommée dans `tasks.md`, à faire avant le merge du lot 2 |
| `agence.py` devient un goulot de merge | `pratiques.py` porte la logique ; fichiers de test neufs ; sérialisation par l'orchestrateur |
| Une politique invalide bloque le régisseur | Le régisseur retombe sur `neutre` et publie l'erreur ; seules les commandes qui agissent refusent |
| Un agent réécrit la politique pour contourner une exigence | Garde `pages` étendue ; sans gardes installés, la protection est celle de `state.json` et la bannière de 002 le dit |
| `tests-local` crée une fausse assurance | Affiché « déclaré, non revérifié » ; Q6 propose de le retirer |
| Le schéma grossit sans fin | Tout nouveau réglage est une entrée de `pratiques.json` et un test ; une demande sans pratique réelle derrière se refuse (VII) |

## Complexity Tracking

| Écart | Pourquoi | Alternative plus simple écartée |
|---|---|---|
| Module `pratiques.py` et fichier `pratiques.json` neufs | Éviter un quatrième foyer de conflits dans `agence.py` ; un schéma déclaré une fois pour la CLI et le panneau | Tout dans `agence.py` : conflits certains avec 002, 004, 006 |
| Deux fichiers (projet et dev) | Un dev a un flux par défaut et des exceptions par projet (POC en `main`) ; c'est le cas de Heifara | Un seul fichier de projet : chaque projet à régler à la main |
| Hors dépôt, sous `tmp/` | D5 et le modèle de confiance : un dépôt cloné n'impose rien | Fichier commité : amendement de D5 (Q1) |
