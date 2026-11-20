# Implementation Plan: Ajouts de la veille du 20/11

**Branch**: `docs/spec-013-ajouts-veille` (depuis `origin/docs/spec-009-plan`) | **Date**: 2026-11-21 | **Spec**: `specs/013-ajouts-veille/spec.md`

**Input**: spec 013 ; `specs/009-vision-v2/{spec,plan,tasks}.md` ; specs 004, 005, 006, 010, 012 ; code `tools/agence/` lu sur `feat/v2-mvp-l4` (`838d1e54`, non mergé : les numéros de ligne bougeront, les noms de fonctions font foi).

## Summary

Presque tout tient dans `tools/agence/`, sans toucher `src/`. Trois ajouts de couche 1 réutilisent du code présent : la jauge lit ce que les déclencheurs de 004 lisent déjà (`contextTokens` par `cate agent usage`), la garde de plafond réutilise `plafond(st)` et le compte d'agents du régisseur, les liens de fiches étendent le schéma de `backlog.py`. Le reste est gelé par couche (009 FR-012) ou attend une recherche (Review, navigateur).

## Technical Context

**Language/Version** : Python 3 stdlib (`tools/agence/`, 3.9 et plus, `npm run test:agence`) ; Markdown.

**Primary Dependencies** : aucune nouvelle. `cate agent usage` (lecture), `gh` (carte « jeter », faux exécutable dans les tests).

**Storage** : `backlog.json` gagne deux champs par fiche ; une clé dans la politique de 005 ; un fichier exporté `docs/decisions.md` (Q1). Aucun nouveau fichier d'état.

**Testing** : `unittest` (`tools/agence/test_*.py`), faux HOME, faux `cate` et faux `gh` sur le PATH. Aucun e2e, aucune fenêtre (constitution X).

**Target Platform** : macOS Apple silicon (constitution VIII).

**Project Type** : CLI Python d'orchestration et skill.

**Performance Goals** : 0 jeton pour chaque calcul (SC-006).

**Constraints** : file de PR sur `tools/agence/agence.py` et `backlog.py` (009 R1) : une PR ouverte à la fois par fichier, après les lots de 010 et 012 déjà dans la file.

**Scale/Scope** : 9 lots, dont 5 de couche 1 (3 jours agent, estimation sans mesure) et 4 gelés.

## Constitution Check

| Principe | Application | État |
|---|---|---|
| II Déclarer une fois | la jauge lit la même mesure que les déclencheurs ; la clé de plan vit dans la politique de 005 | OK |
| III Coupes nettes | nouveaux champs de fiche sans migration : un `backlog.json` ancien devient invalide, le message dit quoi ajouter | OK, risque dit |
| VI Tests d'abord | chaque lot commence par ses tests rouges | OK |
| VII Le plus simple | lien inverse calculé, pas stocké ; export en Markdown, pas de base ; aucun recul codé avant mesure | OK |
| IX Écart minimal | 0 fichier sous `src/` pour les lots 1 à 6 ; le lot 8 ne code rien avant décision (Q5) | OK |
| X Aucune fenêtre | tests en faux exécutables ; la recette du clic navigateur est jouée par l'humain | OK |

Aucune violation : « Complexity Tracking » vide.

## Décisions

### D1 : la jauge réutilise la mesure de 004

La fonction qui lit `cate agent usage` par panneau existe pour les déclencheurs (`MESURES`, `contextTokens`). Le suivi d'un besoin affiche déjà « consommé / budget » ou « consommé inconnu ». On ajoute le contexte sur la même ligne, avec la même règle : valeur lue ou « inconnu », jamais 0. Pas de nouveau panneau, pas de pourcentage inventé : le seuil affiché est celui du déclencheur de 004 quand il existe.

### D2 : le plafond devient une garde

`plafond(st)` et `agentsActive + agentsWaiting` sont déjà calculés et publiés par le régisseur. La garde `PreToolUse` reconnaît `cate agent start` et rend `deny` quand il ne reste aucune place. Elle lit l'état, elle ne compte pas elle-même (une seule source). Hypothèse Q3 : `deny`.

### D3 : liens de fiches dans le schéma, lien inverse calculé

| Option | Pour | Contre |
|---|---|---|
| **Deux champs `remplace`, `doublonDe` + lien inverse calculé (retenue)** | même forme que `dependances` ; validation et cycle déjà écrits pour ce cas | coupe nette sur les fichiers existants |
| Stocker aussi le lien inverse dans la décision | lecture directe | deux vérités à tenir d'accord |
| Un graphe générique de liens typés (Beads) | extensible | abstraction sans second usage (VII) |

### D4 : registre durable par export

L'écrivain unique reste la CLI et le fichier vivant reste dans `.cate/tmp/agence/` (010). `agence decision export` écrit un Markdown trié par date. Le commit passe par une PR de docs, faite par l'humain ou son orchestrateur. Pas de synchro dans l'autre sens : le Markdown est une copie, pas une source.

### D5 : l'attente se mesure avant de se coder

#100 liste cinq pistes ; l'attente par événement est déjà la règle de la vision. Le lot 5 mesure ce qui reste (tours forcés par un Stop hook : 13,9 % dans 006) et ne propose un recul que sur ce reste. Sans gain mesuré, #176 se ferme.

### D6 : ce qui touche Cate attend une recherche

La proposition à jeter passe par `gh` et `git worktree`, hors `src/`. Le clic sur un élément dépend de ce que `cate browser` expose ; le lot 0 le lit et propose : skill seul, panneau perso, ou issue chez upstream. Aucun code avant.

## Project Structure

### Documentation (this feature)

```text
specs/013-ajouts-veille/
├── spec.md
├── plan.md
├── tasks.md
└── research.md      (lot 0)
```

### Source Code (repository root)

```text
tools/agence/
├── agence.py        (suivi : jauge ; garde : plafond ; decision show, export ; carte jeter)
├── backlog.py       (remplace, doublonDe, lien inverse)
├── pratiques.json   (clé de validation du plan)
├── test_backlog.py, test_guard.py, test_agence.py, test_pratiques.py
docs/decisions.md    (export, Q1)
skills/orchestrateur/SKILL.md, skills/interlocuteur/SKILL.md (une ligne chacun)
```

**Structure Decision** : aucun nouveau module ; aucun fichier sous `src/`.

## Risques

- **R1** : la file de PR sur `agence.py` est longue (010, 012, correctifs MVP). Les lots 1 à 4 attendent leur tour.
- **R2** : coupe nette du schéma. Les backlogs écrits avant le lot 3 sont à corriger à la main (2 champs vides par fiche).
- **R3** : `contextTokens` peut manquer selon l'agent (Codex, Gemini). La jauge affiche « inconnu ».
- **R4** : #176 peut se fermer sans code. C'est un résultat valide.

## Complexity Tracking

Vide.
