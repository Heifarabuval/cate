# Feature Specification: Noyau de l'agence

**Feature Branch**: `docs/spec-014-noyau-agence`
**Created**: 2026-11-24
**Status**: Draft
**Input**: l'agence marche pour le cas « dev et PR » et casse dès qu'un projet ou une demande sort de ce moule. Besoin : suivre ce que font plusieurs agents et valider leur travail, de façon fiable et simple, comme l'équipe d'une agence.

## Constat (lu sur `origin/main` le 2026-11-24)

- `tools/agence/agence.py` : 4 142 lignes, 223 fonctions, une cinquantaine de sous-commandes.
- Une demande traverse deux objets, la fiche (5 états) puis le besoin (7 genres), et jusqu'à 5 surfaces : carte, brouillon, question, lentille, vague.
- 16 bugs ouverts sur 37 issues, presque tous sur les gardes et la boîte de validation (#195 à #202, #207, #210 à #214).
- Deux retours de session du 2026-11-24 :
  - le budget en jetons d'une fiche est dépassé à chaque fois et pose une ligne « Bloquant » pour des agents sans dérive (3 besoins en un jour) ; décision de l'humain : le budget n'est pas un blocage ;
  - l'état d'une fiche se lit à deux endroits qui ne disent pas la même chose (`agence fiche plan` ignore les fiches lancées) : 4 affirmations fausses en une session.

Cause commune : trop d'objets et trop de règles, chacune écrite pour le cas « dev et PR ». Chaque nouveau type de projet rencontre une règle qui ne le prévoyait pas.

## Principe

Un seul objet, une seule boîte, un seul « fini ». Ce qui ne sert pas à suivre ou à valider sort du noyau.

## Vocabulaire

- **Tâche** : la seule unité de travail. Elle remplace la fiche et le besoin.
- **Carte** : une chose qui attend l'humain dans la boîte de validation.
- **Fini** : la preuve qu'une tâche est terminée, réglée par projet.
- **Rôle** : un fichier de brief (interlocuteur, orchestrateur, implémenteur, vérificateur). Aucun rôle n'est codé en dur.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Je vois où en est chaque tâche, à un seul endroit (Priority: P1)

Chaque tâche a un état parmi 4 : `à faire`, `en cours`, `à valider`, `faite`. Le panneau et la CLI lisent le même fichier par la même fonction.

**Independent Test** : créer 3 tâches, en lancer 2, en finir 1. Le panneau et `agence tache list` rendent les mêmes 3 lignes, sans exception.

**Acceptance Scenarios** :

1. **Given** une tâche lancée, **When** je lis le panneau puis la CLI, **Then** les deux disent `en cours` avec le même agent.
2. **Given** un agent qui dépasse un coût quelconque, **When** je lis le panneau, **Then** le coût est affiché et la tâche reste `en cours`, sans carte.

### User Story 2 - Tout ce qui m'attend est dans une seule boîte (Priority: P1)

La boîte de validation porte 3 types de cartes, pas plus :

| Carte | Quand | Boutons |
|---|---|---|
| Question | un agent doute, ou son terminal attend une confirmation | les options, la recommandée en premier |
| Envoi | un texte part en mon nom (issue, PR, commentaire, Slack, mail) | Envoyer, Modifier, Abandonner |
| Fin de tâche | un agent dit avoir fini et la preuve a tourné | Valider, Reprendre, Abandonner |

**Independent Test** : faire attendre l'humain de 3 façons (doute, texte à publier, travail fini). Chacune produit une carte, aucune n'apparaît ailleurs (terminal, ligne de suivi sans bouton).

**Acceptance Scenarios** :

1. **Given** une tâche dont le « fini » est une PR mergée, **When** la PR est prête, **Then** la carte Fin de tâche porte le bouton de merge ; il n'y a pas de carte de merge séparée.
2. **Given** une carte affichée, **When** son sujet a changé (PR fermée, agent mort), **Then** elle est revérifiée à l'affichage et au clic, et retirée si elle n'a plus d'objet.

### User Story 3 - Je règle ce que « fini » veut dire pour mon projet (Priority: P1)

Le « fini » d'un projet est une liste de contrôles. Chaque contrôle est une commande qui rend 0, ou `manuel` (l'humain regarde). Le régisseur lance les commandes et colle leur sortie dans la carte Fin de tâche.

Préréglages livrés : `dev-pr` (tests locaux, PR mergée), `dev-main` (tests locaux), `livrable` (URL en ligne, capture), `manuel`.

**Independent Test** : rejouer 3 demandes réelles, une par préréglage (un correctif avec PR, un bandeau sans PR, un document hors git). Les trois arrivent à `faite` sans consigne donnée hors du panneau.

### User Story 4 - Une demande, deux clics (Priority: P2)

L'interlocuteur écrit la tâche. Je clique Lancer. L'orchestrateur lance un agent par tâche, dans la limite de `agents.max`. Le reste attend en file et part seul quand une place se libère. Je clique Valider.

**Independent Test** : « corrige le bandeau » donne la tâche T12, 2 clics, 1 seule ligne dans le panneau du début à la fin.

### Edge Cases

- Double clic sur Lancer ou Valider : le second ne fait rien.
- Agent mort en cours de tâche : la tâche reste `en cours` avec la mention « sans agent » et une carte Question (relancer, abandonner).
- Preuve rouge : la tâche reste `en cours`, la sortie va à l'agent, aucune carte.
- Deux tâches sur le même fichier : la seconde attend en file. La comparaison se fait par fichier, jamais par dossier.
- Tâche abandonnée dont le travail est déjà mergé : elle passe `faite`, elle ne revient pas `à faire`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** : une seule entité de travail, la tâche, avec 4 états. Une tâche `faite` porte son issue : `livrée` ou `abandonnée`.
- **FR-002** : 3 transitions, 3 auteurs. Lancer (humain, clic), Rendre (agent, avec preuve), Valider ou Reprendre (humain, clic). Aucune autre commande ne change un état.
- **FR-003** : l'état se lit par une seule fonction, que le panneau et la CLI appellent tous les deux.
- **FR-004** : la boîte de validation porte 3 types de cartes. Tout ce qui attend l'humain en est une.
- **FR-005** : le « fini » est une liste de contrôles réglée par projet, lancée par le régisseur, jamais déclarée par l'agent.
- **FR-006** : le coût (jetons, dollars) s'affiche et ne bloque rien. Le budget par tâche est retiré.
- **FR-007** : les rôles sont des fichiers de brief dans le projet. Ajouter un rôle ne demande aucun code.
- **FR-008** : deux gardes restent. Un agent n'écrit pas le fichier d'état. Un agent ne clique pas et n'envoie pas à la place de l'humain.
- **FR-009** : coupe nette, selon la règle du dépôt : ni couche de compatibilité ni alias des anciennes commandes.

### Hors du noyau (gelé, code retiré du chemin d'une tâche)

Lentilles, benchmark, journal d'observation, déclencheurs, catalogues de métiers et de connecteurs, vagues, budget en jetons, cartes Éclairer et Jeter, pages du régisseur hors panneau. Chacun peut revenir plus tard comme module qui lit les tâches, sans y écrire.

### Key Entities

- **Tâche** : id (`T<n>`), titre, état, issue, fichiers, dépendances, agent, panneaux, journal (clics et rapports).
- **Carte** : type, tâche, texte, options, réponse.
- **Fini** : liste de contrôles du projet.

## Success Criteria *(mandatory)*

- **SC-001** : les 3 demandes réelles de la User Story 3 finissent sans consigne hors panneau.
- **SC-002** : 12 sous-commandes au plus, et le noyau tient en moins de 1 500 lignes.
- **SC-003** : aucun état n'est rendu par deux chemins de code (test d'invariant).
- **SC-004** : chacun des 16 bugs ouverts est fermé, soit corrigé, soit sans objet parce que son code est retiré. La liste est dressée au plan.
- **SC-005** : une demande simple se suit sur 1 ligne et se règle en 2 clics.

## Assumptions

- Cible : macOS arm64, un seul humain par projet.
- L'interlocuteur et l'orchestrateur restent deux agents distincts.
- Le panneau agence de Cate reste la seule interface.

## Questions ouvertes

1. Tâches et besoins en cours dans les projets ouverts : conversion unique à la main, ou on les termine sur l'ancien modèle avant la bascule ?
2. Suppression d'un worktree après merge : case dans la carte Fin de tâche, ou ménage manuel ?
3. Registre de décisions : gardé comme journal de la tâche, ou gelé avec le reste ?
4. Vérificateur : un contrôle du « fini » (un second agent relit) ou un rôle lancé par l'orchestrateur ?
