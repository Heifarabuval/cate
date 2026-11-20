# Implementation Plan: Interlocuteur, backlog de fiches et garde-fous

**Branch**: `docs/spec-010-interlocuteur` | **Date**: 2026-11-20 | **Spec**: [spec.md](spec.md) | **Parent**: [009](../009-vision-v2/spec.md)

## Summary

Un module Python neuf, `tools/agence/backlog.py`, porte le schéma des fiches et des décisions et toutes les détections déterministes (chevauchement, vagues, dépendances, péremption, plafond, budget). `agence.py` n'y gagne que des sous-commandes (`fiche`, `decision`, `revue`), trois chemins de clic (`/fiches/lancer`, `/decision/<id>/<choix>`, `/fiche/<id>/<choix>`), un champ `budgetJetons` sur le besoin et des motifs dans la garde. Un skill neuf, `skills/interlocuteur/SKILL.md`, dit à l'interlocuteur quoi lire et quelles commandes il a. Le skill `orchestrateur` gagne une section « Lancer ». Le panneau `agence` affiche le backlog, le bouton « Lancer » et le consommé contre budget.

Aucune dépendance, aucun appel de modèle dans le code, aucune migration. Coût mensuel : 0 € d'infrastructure. Le coût en jetons d'un interlocuteur est mesuré par la spec 011, pas promis ici.

## Technical Context

**Language/Version**: Python 3.9 stdlib (`tools/agence/`) ; TypeScript strict (panneau `agence`) ; Markdown (skills).
**Storage**: `<racine>/.cate/tmp/agence/backlog.json` et `decisions.json`, JSON éditable à la main, un seul écrivain (la CLI, sous le verrou de `tx()`, `tools/agence/agence.py:197`), écriture atomique (`dump`, `:211`). Ignorés par git (`.cate/.gitignore`).
**Testing**: `npm run test:agence` (unittest, faux HOME, faux `cate` sur le PATH, dossier temporaire) ; Vitest pour le panneau ; `scripts/build-runtime-tarball.test.mjs` pour la liste livrée.
**Target Platform**: macOS arm64.
**Performance Goals**: `backlog.plan` sur 100 fiches < 50 ms (paires de fichiers, O(n² · f), hypothèse : un backlog réel reste sous 100 fiches ouvertes).
**Constraints**: `agence.py` + 150 lignes au plus par lot (spec 005, SC-006) ; écart avec upstream limité au panneau `agence` ; aucun agent ne lance l'app.
**Scale/Scope**: 2 fichiers de données, 3 sous-commandes, 3 chemins de clic, 1 skill neuf, 9 lots (dont le lot 8 tardif et le lot 9 d'acceptation [H]).

## Constitution Check

| Principe | Verdict | Détail |
|---|---|---|
| I. Couches et côtés | OK | Python hors `src/`. TypeScript : champs de contrat dans `src/panels/agence/contract/types.ts`, lus par `session.ts`, rendus par la vue ; une op `fiches.lancer` comme `draft.send`. |
| II. Déclarer une fois | OK | Schéma de la fiche et de la décision dans `backlog.py` seul ; la CLI, la validation, le brief et le panneau en dérivent. Le panneau n'affiche que ce que le régisseur publie. |
| III. Coupes nettes | OK | Rien à supprimer : tout est neuf. Le besoin garde `budgetUsd` et `budgetMin` ; `budgetJetons` s'ajoute sans alias. |
| IV. Pas de branchement | OK | Aucun `if` sur un type de panneau ni sur local ou distant. |
| V. Le runtime est l'application | OK | La logique est dans la CLI ; la vue demande (op), le régisseur agit (`click()`). |
| VI. Tests d'abord | Applicable | Chaque lot commence par ses tests rouges ; `cate` et `gh` en faux exécutables. |
| VII. Le plus simple | OK, une exception | Un module de plus (`backlog.py`) plutôt que des fonctions dans `agence.py` (2 962 lignes, quatre epics y écrivent) : même raison que `pratiques.py` (spec 005, plan). |
| VIII. macOS arm64 | OK | Rien de plus. |
| IX. Écart minimal | OK | `src/` : panneau `agence` seul (déjà un écart du fork). Interlocuteur et fiches hors `src/`. |
| X. Aucune fenêtre | OK | Le scénario de SC-001 est joué par Heifara ; aucun e2e exécuté. |

## Mécanisme

### Fichiers et écrivains

| Fichier | Écrit par | Lu par |
|---|---|---|
| `backlog.json` | `agence fiche add|edit|etat`, clics `/fiches/lancer`, `/fiche/<id>/relancer|abandonner`, tour du régisseur (fiche `faite` à la fermeture du besoin) | interlocuteur (`agence fiche list|show`), orchestrateur (`agence fiche brief`), régisseur |
| `decisions.json` | `agence decision add` (statut `proposée`), clic `/decision/<id>/valider|rejeter|revoquer` | interlocuteur (`agence decision list`), brief de fiche |
| `state.json` | inchangé ; gagne `backlog` (vue publiée : fiches, vagues, attentes, erreur) et `panels.interlocuteur` | panneau `agence` |

Les deux fichiers neufs s'écrivent sous le même verrou que `state.json` (un seul `tx()`), pour qu'un clic « Lancer » écrive fiches et besoins d'un coup. Un fichier invalide (édité à la main) : `erreur` publiée, toute écriture refusée (code 2), aucune fiche lancée. Même règle que `pratiques.json` (spec 005, plan, « Lecture et priorité »).

### États d'une fiche

```
discussion ──(edit, champs complets)──> prête ──(clic Lancer)──> lancée ──(besoin done)──> faite
     ^  |                                 |  ^                        |
     |  └──(clic revue : abandonner)──> abandonnée <──────────────────┤ (besoin dropped : retour à prête)
     └────────(etat discussion)───────────┘  └────────────────────────┘
```

Transitions par la CLI : `discussion` <-> `prête` seulement. `lancée`, `faite`, `abandonnée` : régisseur sur clic ou sur fermeture du besoin. Une fiche `faite` ou `abandonnée` ne change plus.

Champs exigés pour `prête` : `titre`, `type`, `preuve` (validée par la grammaire de la spec 005, lot 3), `priorite`, `fichiers` non vide, `budgetJetons` > 0, `vision` non vide. `dependances` : ids existants, sans cycle.

### Détections (`backlog.py`, fonctions pures)

- `chevauche(a, b)` : vrai si un chemin de `a.fichiers` égale un de `b` ou en est un dossier parent (comparaison par segments, après normalisation `posixpath.normpath`).
- `plan(fiches, faites, place)` : rend `{vagues: [[id...]], attente: {id: motif}}`. Tri par priorité puis ancienneté ; une fiche entre dans la première vague où elle ne chevauche personne et après toutes ses dépendances du lot ; une dépendance hors lot non `faite` donne `attente: dépendance F<n>`. Seule la première vague part ; sa taille est bornée par `place = agents.max - agents vivants` (`plafond`, `tools/agence/agence.py:181`) ; le reste prend `attente: plafond (<n>)`.
- `perimees(fiches, maintenant, jours=14)` : fiches `discussion` dont `maj` a plus de 14 jours (009, `specs/009-vision-v2/spec.md:142`).
- `consomme(mesures, panneaux)` : somme `inputTokens + outputTokens` des panneaux du besoin (`src/services/agents/contract/usage/types.ts:149-150`), `None` si aucune mesure lisible (jamais 0).
- `revue_due(derniere, premiere_fiche, maintenant)` : 7 jours écoulés.
- `brief(fiche, decisions)` : texte fixe, champ par champ, décisions liées en une ligne chacune (objet, pourquoi). Aucun texte libre ajouté.

### Clic « Lancer » et contrat avec l'orchestrateur

1. La vue envoie `{kind: 'fiches.lancer', ids}` ; la session poste `/fiches/lancer` au régisseur (même chemin que `draft.send`, `src/panels/agence/session.ts:110`).
2. `click()` sous `tx()` : relit les fiches ; refuse celles qui ne sont plus `prêtes` (double clic : 409, rien de créé) ; calcule `plan`.
3. Pour chaque fiche de la première vague : `add_need(kind='task', title, ref='fiche:F<n>', done_when=fiche.preuve, budget_jetons, model=fiche.modele)` (`tools/agence/agence.py:231`), fiche `lancée`, `besoin` renseigné, ligne de journal `clic`.
4. Les fiches en attente restent `prêtes` avec `attente` publiée ; le tour du régisseur relance `plan` quand une place se libère et lance la suivante sans nouveau clic (le clic vaut pour le lot).
5. Un seul message à l'orchestrateur : « Lancer : F1, F3 (vague 1) ; en attente : F2 (chevauche F1 sur src/a.ts) » suivi des briefs. L'orchestrateur lit `agence fiche brief` s'il lui manque un champ, jamais l'interlocuteur.
6. Tour du régisseur : besoin `done` donne fiche `faite` ; besoin `dropped` donne fiche `prête` avec la ligne « abandon de l'exécution ».

### Budget en jetons

`add_need` gagne `budget_jetons` (champ `budgetJetons`). Le tour du régisseur, à côté du budget en dollars (`tools/agence/agence.py:1625-1630`), lit `consomme` sur les mesures déjà lues (`lire_mesures`, `:2003`) et pose `overBudget` et `overBudgetJetons`. La carte existante « budget dépassé » (`:1202-1205`) gagne la ligne en jetons. Aucun appel `cate` de plus par tour.

### Interlocuteur

- `agence start` (`tools/agence/agence.py:462`) : après l'orchestrateur, `cate agent start --agent claude-code --title Interlocuteur /interlocuteur` si `panels.interlocuteur` n'est pas vivant (adoption du vivant par titre, `adopt`, `:509`) ; lien `context` vers le panneau agence.
- `skills/interlocuteur/SKILL.md` : rôle (capter, trier, challenger, ne rien lancer) ; à chaque idée : `agence decision list --active`, `agence fiche list`, puis `agence fiche add` ; ce qu'il ne fait pas ; quand proposer une décision ; la table « modèle par rôle » lue dans `agence pratiques show` ; aucune règle de flux de Heifara en dur (règle de la spec 005).
- Garde (`guard`, `tools/agence/agence.py:2476`, mode `pages`) : si la commande Bash correspond à `cate (agent start|panel (create|link|close)|terminal (send|create))` ou `agence (need add|ask .*--merge|draft new)`, la garde sonde `caller_panel()` et refuse si c'est `panels.interlocuteur`. Les autres commandes ne sondent rien. `Write` et `Edit` sur `backlog.json` et `decisions.json` : refus à tout agent.
- La CLI refuse aussi `agence need add` et `agence draft new` quand l'appelant est l'interlocuteur (seconde barrière, sans dépendre des hooks posés).

### Modèle par rôle

`pratiques.json` gagne quatre clés : `modele.tri`, `modele.interlocuteur`, `modele.implementation`, `modele.structurant`, type chaîne ou `null`, défaut `null`, absentes des deux presets. `agence fiche add` sans `--modele` reprend `modele.implementation` (ou `modele.structurant` si la fiche cite une décision structurante). `agence start` passe `modele.interlocuteur` à `cate agent start --model` s'il est posé. Le modèle de l'orchestrateur reste celui que Heifara choisit.

### Écran central

Panneau `agence` (vue React existante, `src/shells/desktop/ui/panels/agence/AgenceView.tsx`) : une section « Backlog » groupée par état (`discussion` repliée), cases à cocher sur les `prêtes`, bouton « Lancer (n) » ; par fiche `lancée` : « consommé / budget jetons » ; total du lot ; motif d'attente (« plafond (4) », « chevauche F1 ») ; bannière d'erreur si un fichier est invalide. Les cartes de décision (décision proposée, revue de cap, dépassement) passent par les questions existantes (`QuestionCard`) : `agence decision add` et la revue créent une question dont les options mènent aux clics `/decision/...` et `/fiche/...`. Pas de composant de carte neuf.

### Lentilles (lot tardif)

`tools/agence/lentilles.json` (données : nom, consigne, modèle `null`) ; `agence lentille <fiche> [--nom N | --hasard]` rend le brief de lentille (fiche + consigne, rien d'autre) ; l'orchestrateur, sur clic d'une carte « Éclairer », lance un agent à contexte vierge avec ce brief ; sa réponse est attachée à la fiche par `agence fiche note`. Elle n'écrit ni état ni registre.

## Risques

- **Conflits sur `agence.py`** avec les lots ouverts de 005 (lot 4), 006 et 008 : une PR à la fois sur ce fichier, hunks disjoints, rebase de la suivante.
- **Conflits sur le panneau `agence`** avec la spec 008 (lot sur `types.ts`, `session.ts`, `AgenceView.tsx`) : l'orchestrateur sérialise ; le lot 5 ici passe avant le lot 3 de 008, qui rebase (règle H2 de `specs/009-vision-v2/plan.md` : 008 est en couche 2, gelée jusqu'à G1).
- **Sonde `caller_panel()`** : elle renomme le panneau une seconde. Bornée aux commandes interdites, elle ne tourne pas à chaque appel ; si elle échoue (`None`), la garde laisse passer et la CLI garde sa seconde barrière.
- **Qualité du tri par le modèle** (doublons, contradictions) : jugement, non testable par unittest ; couvert par le scénario de SC-001 joué par Heifara.

## Project Structure

### Documentation (this feature)

```text
specs/010-interlocuteur/
├── spec.md
├── plan.md
└── tasks.md
```

### Source Code

```text
tools/agence/
├── backlog.py               # lots 1, 2, 6, 7, 8 (nouveau) : schéma, détections, revue, brief
├── test_backlog.py          # lots 1, 2, 7 (nouveau)
├── agence.py                # lots 1 à 4, 6, 7, 8 : sous-commandes, clic, budget, garde, start
├── test_guard.py            # lots 1, 3 : ajouts
├── test_interlocuteur.py    # lot 3 (nouveau)
├── test_lancer.py           # lot 4 (nouveau)
├── test_politique_skill.py  # lot 4 : ajout
├── test_revue.py            # lot 6 (nouveau)
├── pratiques.json           # lot 7 : quatre clés modele.*
├── test_pratiques.py        # lot 7
├── lentilles.json           # lot 8 (nouveau)
└── test_lentilles.py        # lot 8 (nouveau)
skills/
├── interlocuteur/SKILL.md   # lots 3, 6 (nouveau)
└── orchestrateur/SKILL.md   # lots 4, 8 : section « Lancer », lentille sur clic
src/panels/agence/
├── contract/types.ts        # lot 5 : BacklogView, op fiches.lancer
├── contract/fixtures/       # lot 5 : un état avec backlog
├── session.ts               # lot 5
└── session.test.ts          # lot 5
src/shells/desktop/ui/panels/agence/
├── Backlog.tsx              # lot 5 (nouveau)
├── Backlog.test.tsx         # lot 5 (nouveau)
├── AgenceView.tsx           # lot 5
└── AgenceView.test.tsx      # lot 5
scripts/agence-files.mjs, scripts/build-runtime-tarball.test.mjs   # lots 1, 3, 8 : fichiers livrés
docs/architecture.md                                              # lots 1, 5 : panneau agence
```

**Structure Decision** : la logique reste dans `tools/agence/` (Python hors `src/`) ; `src/` ne change que dans le panneau `agence`, déjà propre au fork (constitution IX).

## Complexity Tracking

| Écart | Pourquoi | Alternative plus simple écartée |
|---|---|---|
| Module neuf `tools/agence/backlog.py` (constitution VII) | `agence.py` fait 2 962 lignes et quatre epics y écrivent ; un module pur garde les détections testables seules et les PR disjointes | des fonctions dans `agence.py` : conflits de rebase sur le fichier le plus disputé (même choix que `pratiques.py`, spec 005) |
