# Implementation Plan: Réglages par workspace, pour tous, dans l'interface

**Branch**: `docs/spec-reglages-workspace` | **Date**: 2026-11-20 | **Spec**: [spec.md](spec.md) | **Inventaire**: [inventaire.md](inventaire.md)

## Summary

Le schéma de la spec 005 (`tools/agence/pratiques.json`) gagne ce qu'il faut à une personne non technique : un nom, une phrase, des choix nommés, un groupe, une portée, une question. La CLI publie à chaque tour, dans `state.json`, la liste des champs déjà rendue (valeur, défaut, origine). Le panneau agence en tire un formulaire sans connaître aucune clé, et écrit par le régisseur (`POST /pratiques/...`), comme ses autres boutons. Les options de `agence start` deviennent une couche ponctuelle visible. La première ouverture pose quatre questions.

Rien dans `src/kernel/`, `src/shells/desktop/ui/app/` ni les réglages natifs. Aucune dépendance, aucun appel de modèle. Coût mensuel : 0 €.

## Technical Context

**Language/Version**: Python 3.9 stdlib (`tools/agence/`) ; TypeScript strict et React (panneau agence) ; Markdown (skill).
**Storage**: les deux fichiers de la spec 005, écrits par `pratiques.py` seul (la CLI et le régisseur sont le même programme) ; `state.json` porte la couche ponctuelle et les champs publiés.
**Testing**: `npm run test:agence` (unittest, faux HOME), Vitest (`*.test.ts` en node pour la session, `*.test.tsx` en jsdom pour la vue).
**Target Platform**: macOS arm64 (VIII).
**Constraints**: le schéma est la seule liste (II) ; la vue n'écrit rien (V) ; coupes nettes (III) ; aucun e2e (X) ; `agence.py` + 150 lignes au plus par lot (SC-006 de 005).
**Scale/Scope**: 16 réglages, 2 presets, 4 questions, 4 lots.

## Décision : où vivent les réglages

| | (a) Réglages natifs (`defineSettings`, portée `workspace`) | (b) `pratiques.json` de 005, formulaire dans le panneau agence | (c) Mélange : (b) et une page dans l'écran Réglages |
|---|---|---|---|
| Où est la valeur | `~/.cate/workspaces/<runtimeId>/settings.json` | `<racine>/.cate/tmp/agence/pratiques.json` et `~/.config/agence/pratiques.json` | comme (b) |
| Schéma déclaré | deux fois : une tranche TypeScript (`contract/settings.ts`) et la lecture Python (FR-002 de 005 cassé) | une fois, `tools/agence/pratiques.json` | une fois |
| La CLI lit la même valeur | non sans changement d'upstream : il faut une API `cate settings get/set` dans `kernel/api` (aucune n'existe : `settingsCapability` n'est servi qu'aux clients, `src/kernel/settings/contract/capability.ts:14-22`), ou que la CLI devienne second écrivain de `settings.json` (contre « every file has one writer process ») ; hors d'un terminal Cate (amorçage, `doctor --hors-cate`, tests) aucun fichier | oui, c'est elle qui lit et écrit (`pratiques.py`) | oui |
| Refus d'une valeur fausse | `normalize` l'ignore en silence (`define.ts:119-127`), contre FR-003 de 005 | refus nommé, rien d'écrit (005) | idem |
| Couche dev (tous mes projets) | perdue : la portée `workspace` n'a pas d'équivalent par personne, la portée `client` vit sur l'appareil, que la CLI ne lit pas | gardée | gardée |
| Écran | une page React écrite à la main de plus (`registry.ts:33-43` : une page est un composant, aucune page n'est générée d'un schéma) | une vue du panneau, générée des champs publiés | (b) plus une page qui doit lire l'état sans panneau ouvert : une capacité de plus |
| Écart avec upstream (IX) | `kernel/api` (nouvelle API et cellule de permission), une tranche dans `panels/agence/contract`, une page dans `ui/app/settings` | aucun hors `panels/agence` et `ui/panels/agence` (déjà propres au fork) | une page et une capacité de plus |
| Décisions déjà prises | revient sur la Q1 de 005 (tranchée par Heifara : fichiers hors dépôt, pas `defineSettings`) | les suit | les suit |
| Effort estimé | 4 lots, plus la reprise de 005-L1 à L3 | 4 lots | 5 lots |
| Coût mensuel | 0 € | 0 € | 0 € |

**Recommandé : (b)**. Une seule source, un seul écrivain, un seul schéma, aucun écart avec upstream, et les décisions de 005 tiennent. Le prix : les réglages de l'agence ne sont pas dans l'écran Réglages de Cate. Ils ne servent que dans un workspace orchestré, où le panneau est ouvert ; Q1 garde l'entrée dans l'écran Réglages pour plus tard. Les réglages natifs (`cli*Enabled`) restent natifs : ce sont ceux de Cate, et le formulaire y renvoie (FR-016).

**La source de vérité** : les fichiers, lus par `pratiques.charger`. L'interface n'a pas de copie : elle affiche ce que `watch` a publié et écrit par le régisseur, qui appelle les mêmes fonctions que `agence pratiques set`. Pas d'API `cate` à ajouter.

## Constitution Check

| Principe | Verdict | Détail |
|---|---|---|
| I. Couches et côtés | OK | Contrat pur (`types.ts`), session côté runtime, vue dans `shells/desktop/ui/panels/agence/`. |
| II. Déclarer une fois | OK | Libellés, choix, groupes et questions dans `pratiques.json` ; libellés des déclencheurs dans `declencheurs.json`. La vue et la session ne nomment aucune clé (SC-004). |
| III. Coupes nettes | OK | `dit`, `st['notify']`, `RAPPEL`, l'écriture de `agents.max` par `--max-agents`, `openPratiques` et `pratiquesFile.ts` disparaissent sans alias. |
| IV. Pas de branchement sur le contexte | OK | Aucun `if` sur local ou distant ; le contrôle de saisie dépend de la forme du champ publié, pas d'un nom de clé. |
| V. Le runtime est l'application | OK | Validation et écriture dans la CLI ; la vue demande, la confirmation passe par `ClientUi`. |
| VI. Tests d'abord | Applicable | Chaque lot liste ses tests rouges. |
| VII. Le plus simple | OK | Réutilise le canal du régisseur et le schéma de 005 ; pas de nouvelle capacité. |
| VIII. macOS arm64 | OK | |
| IX. Écart minimal | OK | SC-007. |
| X. Aucune fenêtre | OK | Vue testée en jsdom. |

## Mécanisme

### Schéma (ajouts à `pratiques.json`)

```
"agents.max": {"entier": [1, 16], "nom": "Agents en même temps", "explique": "Combien d'agents travaillent à la fois au plus. Plus d'agents va plus vite, mais prend plus de mémoire et coûte plus.",
               "groupe": "essentiel", "portee": "workspace", "question": "Combien d'agents au plus en même temps ?"},
"tests": {"valeurs": ["libre", "tdd"], "choix": {"libre": "Au choix de l'agent", "tdd": "Un test qui échoue d'abord, puis le code"}, ...},
"coherences": [{"si": {...}, "message": "...", "phrase": "Une tâche ne peut pas finir par une demande fusionnée si le travail ne passe pas par une demande."}],
"presets": {"neutre": {"nom": "Simple", "explique": "...", "valeurs": {...}}, "pr-tdd": {"nom": "Rigoureux : PR et tests d'abord", ...}}
```

Forme des presets : les valeurs passent sous `valeurs` pour laisser place à `nom` et `explique` (coupe nette, tests de 005 mis à jour dans le lot 1).

### Champs publiés

`pratiques.champs(sch, pol)` (pure) rend la liste de FR-003. `un_tour` l'ajoute à `st['pratiques']` à côté de ce que publie 005-L1, avec `presets`, `projet`, `nbProjet` et `invariants`. Taille : environ 4 Ko par tour pour 16 clés (non mesuré).

### Écriture par le régisseur

`click(path, form)` (`agence.py:882`) gagne trois routes : `/pratiques/set` (`cle`, `valeur` en JSON ; plusieurs paires pour les premières questions, appliquées dans un seul `_modifier`), `/pratiques/unset` (`cle`), `/pratiques/preset` (`nom`, `remplacer`). La portée vient du schéma, pas du formulaire. Refus : 400 et la phrase humaine (FR-005). La session relaie comme pour un brouillon (`session.ts:155-170`) ; ses nouvelles ops : `pratique.set`, `pratique.unset`, `pratique.preset`, `pratique.questions` (fin ou « Passer »).

### Options de ligne de commande

| Option | Avant | Après |
|---|---|---|
| `agence start --max-agents N` | `st['maxAgents']` (main) ; `agents.max` du fichier du projet (005-L2) | `st['ponctuel']['agents.max'] = N`, validé par le schéma ; source `ponctuel` ; effacé au prochain `agence start` |
| `agence start --notify / --no-notify` | `st['notify']`, persistant | `st['ponctuel']['notifications.systeme'] = oui/non` ; le réglage durable est `notifications.systeme` |
| `agence start` sans option | ne change rien | vide `st['ponctuel']` : le workspace reprend la main |
| `agence need add --model`, `--effort` | seule source | l'emportent sur `agents.modele`, `agents.effort` |
| `agence need add --budget`, `--budget-usd`, `--done-when` | par besoin | inchangées |
| `agence watch --interval`, `observe list --jours`, `declencheurs bilan --jours`, `hooks --settings`, `doctor --hors-cate` | modes et requêtes | inchangées, ce ne sont pas des réglages |

`pratiques.charger(racine, home, ponctuel=None)` ajoute la couche en dernier. Un `set` (CLI ou formulaire) retire la clé de `st['ponctuel']` dans la même transaction `tx()` (FR-010).

### Premières questions

La session sait que le fichier du projet manque par `pratiques.projet` du dernier état. Tant que c'est `false`, elle ne lance pas l'orchestrateur (son lancement, `session.ts:184-208`, attend l'op `pratique.questions`). Ordre de démarrage : régisseur d'abord (il publie `projet`), puis questions, puis orchestrateur. Un état sans `projet` (CLI ancienne) : pas de questions, lancement comme aujourd'hui.

## Ce que cette spec réutilise et remplace de la spec 005

| Lot de 005 | Réutilisé | Remplacé |
|---|---|---|
| L1 (mergé) : schéma, `pratiques.py`, commande, `st['pratiques']`, garde `pages` | tout : lecture, priorité, validation, écriture verrouillée, garde | `dit` devient `explique` ; presets sous `valeurs` ; `charger` prend la couche ponctuelle |
| L2 (commit local `d0ac5108`) : merge, jeton Slack, plafond, doctor | `plafond()` sur `agents.max`, méthode de merge, jeton | l'écriture de `agents.max` par `--max-agents` (couche ponctuelle) ; Q2 |
| L3 (à venir) : preuve de fin | grammaire et dérivation de `preuve` | rien ; `need add` est touché par les deux (modèle par défaut ici) : 008-L2 après 005-L3 |
| L4 (à venir) : skill, `declencheurs.actifs` | `declencheurs.actifs` | lignes 20 et 42 du skill (008-L2) ; libellés `nom` de la table (008-L1) |
| L5 (branche `feat/pratiques-panneau`, `dbb955ac`) : ligne « Pratiques », détail, bannière, ouvrir le fichier, libellé de merge | `PratiquesView`, `pratiquesView()`, bannière d'erreur, libellé de merge, fixture `etat.json` | le détail en lecture seule devient le formulaire ; « Ouvrir le fichier », `openPratiques`, `pratiquesFile.ts` supprimés (FR-008) |

## Conflits de fichiers avec les autres epics

| Fichier | Lots de 008 | Autres lots qui le visent | Risque | Règle |
|---|---|---|---|---|
| `tools/agence/pratiques.json` | 1 | 005-L3 (si clés de preuve), 005-L4 (`declencheurs.actifs` déjà posé) | Moyen | 008-L1 après 005-L3 ; le passage des presets sous `valeurs` touche les tests de 005 |
| `tools/agence/pratiques.py`, `test_pratiques.py` | 1, 2 | 005-L3 (`done_when_defaut`, `evaluer`) | Moyen | une PR à la fois, 005-L3 d'abord |
| `tools/agence/agence.py` | 1 (`un_tour`, `click`, `CHAMPS_TABLE`), 2 (`cmd_start`, `plafond`, notifications, `need add`) | 005-L2, L3, L4 ; 004 lots 3 à 5 ; 006 si `agence wait` | **Élevé** | une PR ouverte à la fois sur ce fichier ; 008-L1 après 005-L2 et L3, 008-L2 après 008-L1 |
| `tools/agence/test_retrait.py` | 2 | 005-L2 (le crée) | Moyen | 008-L2 remplace le test de `--max-agents` qui écrit le fichier |
| `tools/agence/test_agence.py` | 2 (usages de `notify`) | 005-L2, L3 ; 004 | Moyen | tests neufs dans `test_reglages.py` ; `test_agence.py` seulement là où `notify` est déjà testé |
| `tools/agence/declencheurs.json`, `test_declencheurs.py` | 1 (`nom`) | 004 lots 3 à 5, 005-L4 (`actif`) | **Élevé** | 008-L1 après 005-L4 et les lots ouverts de 004 ; sinon la tâche T008 passe à 004 |
| `skills/orchestrateur/SKILL.md` | 2 (lignes 20, 24, 42) | 005-L4, 006-L3, 004 lot 5 | **Élevé** | après 006-L3 et 005-L4 ; trois hunks courts |
| `src/panels/agence/contract/types.ts`, `session.ts`, `session.test.ts`, `contract/fixtures/etat.json`, `parts/runtime/pratiquesFile.ts`, `runtime.ts` | 3, 4 | 005-L5 | **Élevé** tant que 005-L5 n'est pas mergé | 008-L3 part de `origin/main` après le merge de 005-L5 |
| `src/panels/runtime.ts` | 3 (si `openEditor` n'a plus d'usage) | 005-L5 | Faible | idem |
| `src/shells/desktop/ui/panels/agence/AgenceView.tsx`, `.test.tsx` | 3, 4 | 005-L5 ; 004 T044, T047 (`QuestionCard`) | Moyen | après 005-L5 ; `QuestionCard` non touché par 008 |
| `docs/architecture.md` (« The agence panel ») | 3 | 005-L1, L5 ; 007-L1, L3 | Moyen | un paragraphe, rebase avant la PR |
| `src/panels/app/`, `src/shells/desktop/main/webSecurity.ts` | aucun | 007 | Nul | |

Aucun fichier de la spec 002 (lots 5A à 5D) ni de la spec 006 (lot 1, mesure) n'est touché, sauf `SKILL.md` (006-L3).

## Project Structure

```
specs/008-reglages-workspace/
├── inventaire.md
├── spec.md
├── plan.md
└── tasks.md
```

Code à écrire :

```
tools/agence/pratiques.json          # lots 1, 2 : libellés, 4 clés, presets sous `valeurs`, phrases des cohérences
tools/agence/pratiques.py            # lot 1 : champs(), phrases ; lot 2 : couche ponctuelle
tools/agence/agence.py               # lot 1 : un_tour, click, CHAMPS_TABLE ; lot 2 : start, plafond, notifications, need add
tools/agence/declencheurs.json       # lot 1 : `nom`
tools/agence/test_reglages.py        # NEUF : lots 1, 2
skills/orchestrateur/SKILL.md        # lot 2
src/panels/agence/contract/types.ts  # lot 3 : champs, presets, ops ; lot 4 : projet
src/panels/agence/session.ts         # lot 3 : relais ; lot 4 : lancement différé
src/shells/desktop/ui/panels/agence/ # lot 3 : Reglages.tsx (NEUF) ; lot 4 : PremieresQuestions.tsx (NEUF)
```

## Risques

| Risque | Parade |
|---|---|
| Le formulaire et la CLI divergent | une seule fonction (`pratiques.champs`) ; SC-003 compare `champs` et `show` |
| La vue recopie une clé « pour aller vite » | SC-004 : test avec un schéma de fixture inventé |
| Une personne bloque l'orchestrateur sans le savoir (questions non vues) | les questions occupent tout le panneau ; « Passer » est toujours là |
| `state.json` grossit à chaque tour | environ 4 Ko ; à mesurer au lot 1 (taille avant et après citée dans la PR) |
| Les libellés vieillissent (nouvelle clé sans `nom`) | test du lot 1 : toute clé sans `nom`, `explique`, `choix` ou `groupe` fait échouer la suite |
| Conflits avec 005 en cours | ordre de merge du tableau ; 008 part toujours d'`origin/main` à jour |

## Complexity Tracking

| Écart | Pourquoi | Alternative plus simple écartée |
|---|---|---|
| Couche ponctuelle dans `state.json` | la demande : l'option est un contournement, jamais la source, et doit se voir | supprimer les options : plus simple, mais contraire à la demande (point 4) |
| Champs publiés dans l'état plutôt qu'une lecture du schéma par la session | la session ne connaît pas le chemin du schéma livré, et la valeur effective vient de toute façon de la CLI | la session lit `pratiques.json` : second lecteur du schéma, en TypeScript |
