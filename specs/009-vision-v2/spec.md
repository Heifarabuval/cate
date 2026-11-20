# Feature Specification: Vision v2 (un seul canvas, un interlocuteur, un orchestrateur, tout métier)

**Feature Branch**: `docs/spec-vision-v2`

**Created**: 2026-11-20 (base `origin/main` `fd91eb8c`)

**Status**: Draft. Spec d'ensemble : elle fixe le cadre, les couches et leurs critères de passage. Aucune ligne de code. Elle ne remplace aucune spec existante ; elle dit dans quel ordre elles servent la vision et ce qui manque. Questions ouvertes en fin de document, chacune avec son hypothèse de travail.

**Input**: cap produit dit par Heifara le 20/11 et validé en séance (« exactement l'idée »). L'outil doit accompagner n'importe quel dev dans ses missions quotidiennes avec un seul outil, à la place des centaines d'onglets et de fenêtres : une carte visuelle et mentale du travail, avec des interactions, des liens et du contexte entre les panneaux. Il doit aussi servir des non-devs qui veulent tous leurs outils centralisés, reliés par une IA agentique. On y branche n'importe quel outil (gestionnaire de mots de passe, messagerie...). Des règles d'orchestration générales, spécialisables par projet selon le besoin initial. Un seul canvas, dont on ne sort plus. Les tâches devenues récurrentes s'automatisent. Contrainte transversale : consommer le moins de jetons possible à qualité égale, et le prouver par la mesure.

Liens :
- `docs/architecture.md` : le modèle (panneaux, runtime, `cate` API). Cette spec n'y change rien.
- Constitution du fork : II (déclarer une fois), III (coupes nettes), VI (tests d'abord), VII (le plus simple), IX (écart minimal avec upstream), X (aucune fenêtre lancée par un agent).
- Spec `003-apprentissage-observation` : les gestes répétés deviennent des recettes (couche 4).
- Spec `004-cercle-vertueux` : `/compact`, `/clear` aux bons moments (frugalité).
- Spec `005-pratiques-reglables` : les pratiques de flux d'un dev, par projet (couche 2).
- Spec `006-cout-attente-orchestrateur` : la mesure en jetons de l'orchestrateur ; son `attente_mesure.py` sert de base à la mesure de cette spec.
- Spec `007-panneaux-perso-partage` : panneaux perso locaux et partageables (couche 3).
- Spec `008-reglages-workspace` : réglages par workspace, sans ligne de commande.
- À écrire, enfants de celle-ci : `010-interlocuteur` (fenêtre de discussion, backlog, garde-fous), `011-mesure-benchmark` (preuve du gain).

## Clarifications

### Session 2026-11-20

- Q: Une fenêtre de discussion par projet ou par idée ? → A: **par projet**. Une fenêtre par idée recrée le problème de départ (plusieurs sessions à suivre, aucune vue des chevauchements, un contexte rechargé par idée). Les idées sont des **fiches** d'un backlog avec un état : `discussion`, `prête`, `lancée`, `faite`. Décision de Heifara.
- Q: Pourquoi séparer l'interlocuteur de l'orchestrateur ? → A: un seul terminal qui porte la discussion et l'exécution mélange les tâches dans le même contexte. L'**interlocuteur** pense (il capte, trie, challenge, ne lance rien) ; l'**orchestrateur** exécute (seul à créer et relier agents et panneaux). Le contrat entre les deux est une **fiche** structurée, pas un message libre.
- Q: Qui déclenche l'exécution ? → A: l'humain, par un clic sur « Lancer » (un lot de fiches `prêtes`). Rien ne part sans lui ; il tranche les cartes de décision et fait le merge final.
- Q: Quels garde-fous contre le flux d'idées (contradictions, mauvaise direction) ? → A: trois sont **proposés**, pas encore tranchés (Q1) : un registre de décisions, une revue de cap hebdomadaire, des « lentilles » (angles imposés). Les lentilles viennent d'une demande de Heifara : voir un problème sous un autre angle.
- Q: Comment prouver que l'outil sert vraiment ? → A: par un benchmark par rejeu d'issues fermées, Claude Code nu contre l'outil (spec 011). Le seuil est fixé avant le premier rejeu (Q3). Le gain attendu est surtout le temps actif de l'humain, pas le temps mural.
- Q: Quelle part des jetons est en jeu ? → A: spec 006, sur 10 sessions d'orchestrateur : 66 % des jetons lus viennent de la boucle d'outils d'un contexte médian de 220 000, 11,35 % de l'attente, 13,9 % des tours forcés par un Stop hook. Le levier principal est la taille du contexte.

## Vocabulaire

- **Interlocuteur** : la fenêtre de discussion d'un projet. Il ne code pas et ne lance aucun agent.
- **Fiche** : un besoin structuré (titre, type, preuve attendue, priorité, fichiers probables, dépendances, budget de jetons, point de la vision servi).
- **Backlog** : les fiches d'un projet, avec leur état. Un fichier, pas un historique de conversation.
- **Orchestrateur** : voir l'agence existante. Un par projet, seul à créer, relier et fermer agents et panneaux.
- **Registre de décisions** : date, pourquoi, alternatives écartées, ce que la décision invalide.
- **Lentille** : un angle imposé (inverser, supprimer, novice, dans un an, pire cas, agence réelle), appliqué par un agent à contexte vierge qui ne reçoit que la fiche. Elle propose, ne tranche jamais.
- **Connecteur** : un outil externe branché en panneau, d'abord par MCP.
- **Recette** : un geste récurrent devenu skill + déclencheur.
- **Métier** : se décrit par quatre éléments : connecteurs, panneaux, validateur « fini », recette récurrente.
- **Validateur** : ce qui prouve qu'une tâche est finie ; surchargeable par métier.

## Les quatre couches

| Couche | Contenu | Specs | Critère pour passer à la suivante |
|---|---|---|---|
| 1. Noyau | canvas, liens porteurs de contexte, interlocuteur, backlog, orchestrateur, écran central | 001 à 006, 010 | le benchmark (011) atteint le seuil sur des tâches de dev |
| 2. Règles d'orchestration | générales par défaut, surchargées par projet, montées à l'installation | 005, 008 | un projet change de règles sans toucher au code |
| 3. Connecteurs et panneaux | MCP et panneaux perso, droits par connecteur | 007 | un non-dev réel finit une tâche de son métier sans aide |
| 4. Récurrences | gestes répétés proposés en recettes, validés par l'humain | 003 | une recette tourne sans l'humain et sa preuve est vérifiée |

Chaque couche se mesure avant la suivante. Une couche qui n'atteint pas son critère n'est pas étendue.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Je discute de tout dans une fenêtre, l'orchestrateur n'exécute que le prêt (Priority: P1)

Le dev ouvre le projet et parle à l'interlocuteur : idées, bugs, retours, audit, brainstorm. L'interlocuteur confronte chaque idée au registre, repère doublons et chevauchements de fichiers, et en tire des fiches. Le brainstorm reste en `discussion`. Le dev marque un lot `prêt`, clique sur « Lancer » ; l'orchestrateur reçoit les fiches, les ordonne (parallèle ou série selon les fichiers pris) et lance ses agents.

**Why this priority**: c'est le problème de départ : plusieurs tâches sur un projet, un seul terminal, tout se mélange.

**Independent Test**: sur un projet de test, 6 retours dictés donnent 4 fiches `prêtes` et 2 restent en `discussion` ; deux fiches qui touchent le même fichier sont proposées en série ; aucun agent ne démarre avant le clic.

**Acceptance Scenarios**:

1. **Given** une idée qui contredit une décision du registre, **When** l'interlocuteur la reçoit, **Then** il cite la décision et son pourquoi et demande si elle est révoquée, avant de créer la fiche.
2. **Given** un lot `prêt`, **When** le dev ne clique pas sur « Lancer », **Then** l'orchestrateur ne lance rien.
3. **Given** une fiche complète, **When** l'orchestrateur la reçoit, **Then** il ne repose aucune question déjà traitée dans la fiche.

---

### User Story 2 - L'outil prouve qu'il fait gagner du temps et ne coûte pas trop (Priority: P1)

Un benchmark rejoue 10 à 15 issues déjà fermées depuis leur commit parent, une fois en Claude Code nu (un terminal) et une fois avec l'outil, dans un ordre tiré au hasard ; le test de la PR d'origine arbitre. On mesure le temps actif de l'humain, le temps mural, la qualité (tests verts du premier coup, remarques de review, bugs après merge, travail refait) et le coût en jetons. Le seuil de décision est fixé avant le premier rejeu.

**Why this priority**: l'outil ne doit pas être un caprice de dev. Sans mesure, la vision n'est qu'une hypothèse.

**Independent Test**: spec 011 ; le rapport donne les quatre indicateurs par bras et le verdict contre le seuil.

**Acceptance Scenarios**:

1. **Given** une économie de jetons proposée, **When** le test de l'issue rejouée devient rouge, **Then** l'économie est annulée.
2. **Given** le benchmark terminé, **When** le seuil n'est pas atteint, **Then** la couche 1 n'est pas étendue à la couche 2.

---

### User Story 3 - Un data manager monte son univers (Priority: P2)

À l'installation, le produit reste nu et pose des questions : métier, clients, outils (tag manager, analytics, régies, test A/B, bannière de consentement), règle « lecture seule en production, toute publication validée ». Les outils se branchent en panneaux ; un panneau perso montre les tags présents contre les tags attendus. La tâche est « faite » quand une capture réseau dans un vrai navigateur prouve que le pixel ne part qu'après consentement et que l'événement arrive dans l'analytics. Une recette audite chaque semaine tous les sites par script, le modèle n'interprète que les écarts.

**Why this priority**: premier cas non-dev ; le validateur est une preuve technique, pas une PR.

**Independent Test**: un faux site avec un pixel qui part avant consentement : la carte de décision arrive avec la preuve réseau ; sans preuve attachée, la tâche ne passe pas à « faite ».

**Acceptance Scenarios**:

1. **Given** une publication de conteneur, **When** le dev n'a pas validé la carte, **Then** rien n'est publié (écriture = validation).
2. **Given** un audit hebdo, **When** 18 sites sur 20 sont conformes, **Then** le modèle ne lit que les 2 sites qui dévient.

---

### User Story 4 - Un chef de projet marketing pilote une campagne (Priority: P2)

Il dit : « le client veut décaler le lancement au 12, budget +10 %, visuel non validé ». L'interlocuteur en fait trois fiches et rappelle la décision de budget antérieure. Après « Lancer », l'orchestrateur ouvre le planning, le tableur de budget, la maquette et un brouillon de mail. Le recalcul du budget est un script (exact, zéro jeton). Deux cartes arrivent : décaler les jalons liés, envoyer le mail. Le mail part au clic ; l'outil relit le message parti. Le validateur est « validé par le client », pas une PR.

**Why this priority**: second cas non-dev, validateur par accord humain.

**Independent Test**: sans clic sur la carte d'envoi, aucun mail ne part ; après le clic, le message est relu et la fiche passe à `faite`.

**Acceptance Scenarios**:

1. **Given** une validation en attente depuis plus de 3 jours, **When** la recette de relance tourne, **Then** un brouillon arrive dans l'écran central et rien n'est envoyé seul.

---

### User Story 5 - Je branche mes outils sans quitter le canvas (Priority: P3)

Chaque outil est un panneau. Ordre de choix : un MCP déjà branché, un MCP existant, l'API officielle, le navigateur en dernier recours. Droits par connecteur : lecture par défaut, écriture ou envoi par carte de validation. Les secrets restent dans le coffre, jamais dans le contexte d'un agent.

**Why this priority**: c'est la généralité, mais elle ne vaut qu'une fois les couches 1 et 2 prouvées.

**Independent Test**: un connecteur de test en lecture seule refuse une écriture ; l'écriture passe seulement après clic.

---

### User Story 6 - Un geste répété devient une recette (Priority: P3)

Un geste fait 2 ou 3 fois est proposé comme recette (spec 003) ; l'humain valide ; elle tourne dans Cate, ou dans l'outil d'automatisation externe quand elle doit tourner sans lui.

**Why this priority**: gain de productivité en régime établi, après les couches précédentes.

**Independent Test**: spec 003.

### Edge Cases

- Deux fiches `prêtes` qui touchent les mêmes fichiers : série, pas parallèle.
- Plafond d'agents atteint : la fiche attend, l'écran central le dit.
- Fiche hors vision : signalée, jamais refusée seule ; l'humain tranche.
- Idée en `discussion` depuis plus de 14 jours : relancée ou archivée par la revue de cap.
- Une lentille contredit une décision : elle propose, le registre n'est modifié que sur clic.
- Connecteur sans MCP ni API : panneau navigateur, annoncé comme dernier recours.
- Métier sans validateur défini : la tâche ne passe pas à `faite` sans preuve nommée.
- Interlocuteur réinitialisé (`/clear`) : aucun état perdu, il vit dans le backlog et le registre.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Un projet MUST avoir au plus une fenêtre d'interlocuteur et un orchestrateur. Les idées MUST être des fiches, jamais des fenêtres.
- **FR-002**: L'interlocuteur MUST NOT créer, relier ni fermer un agent ou un panneau, ni lancer une commande de travail. Seul l'orchestrateur le fait.
- **FR-003**: Le passage vers l'orchestrateur MUST se faire par une fiche structurée d'un lot `prêt`, après un clic humain sur « Lancer ». Aucun message libre ne lance du travail.
- **FR-004**: Le backlog et le registre de décisions MUST vivre dans des fichiers éditables à la main, écrits par une seule CLI, pas dans l'historique d'une conversation.
- **FR-005**: Les détections déterministes MUST être du code, sans modèle : chevauchement de fichiers, état d'une fiche, péremption (14 jours), plafond d'agents, budgets, indicateurs de mesure. Le modèle ne sert qu'au jugement et à la rédaction.
- **FR-006**: Toute fiche MUST porter un budget de jetons et le point de la vision qu'elle sert. L'écran central MUST afficher consommé contre budget ; un dépassement MUST devenir une carte de décision.
- **FR-007**: Une lentille MUST recevoir uniquement la fiche (contexte vierge), proposer et jamais trancher. Elle MUST se déclencher à la demande (tirage au hasard) ou sur une décision marquée structurante. La liste de lentilles MUST être éditable par métier.
- **FR-008**: Le validateur « fini » MUST être déclaré par métier et MUST exiger une preuve nommée. Une tâche sans preuve ne passe pas à `faite`.
- **FR-009**: Un connecteur MUST avoir des droits distincts en lecture et en écriture ; toute écriture ou tout envoi MUST passer par la validation centrale. Aucun secret MUST entrer dans la politique, un brief ou un contexte d'agent.
- **FR-010**: Les règles d'orchestration MUST avoir deux niveaux : générales par défaut, surchargées par projet (spec 005, spec 008). Les questions d'installation MUST pouvoir les poser sans ligne de commande.
- **FR-011**: Une optimisation de jetons MUST se mesurer avant et après avec le même outil, et MUST être annulée si la qualité mesurée baisse (test de l'issue rejouée rouge).
- **FR-012**: Chaque couche MUST avoir son critère de passage (tableau ci-dessus) ; la couche suivante ne démarre pas avant.
- **FR-013**: Coupes nettes (constitution III) : aucune migration, aucun alias. Écart minimal avec upstream (IX) : tout ce qui peut vivre dans `tools/agence`, dans un skill ou dans un panneau perso y vit plutôt que dans le coeur de Cate.
- **FR-014**: Aucun agent MUST lancer une fenêtre ou une application de test sur la machine de l'humain (constitution X), y compris pour le benchmark.

### Key Entities

- **Fiche** : titre, type, preuve, priorité, fichiers probables, dépendances, budget de jetons, point de la vision, état.
- **Backlog** : liste de fiches d'un projet.
- **Décision** : date, objet, pourquoi, alternatives écartées, invalidations, marque « structurante » optionnelle.
- **Lentille** : nom, consigne d'angle, modèle prévu.
- **Connecteur** : outil, mode d'accès (MCP, API, navigateur), droits lecture et écriture.
- **Métier** : connecteurs, panneaux, validateur, recette.
- **Recette** : déclencheur, action, preuve.

## Success Criteria *(mandatory)*

- **SC-001**: sur un projet de test, 6 retours produisent le bon nombre de fiches, les chevauchements sont proposés en série et aucun agent ne démarre sans clic.
- **SC-002**: le benchmark (011) donne, par bras, temps actif, temps mural, qualité et jetons, et un verdict contre le seuil fixé avant (Q3).
- **SC-003**: aucune économie de jetons n'est livrée avec un test rejoué rouge.
- **SC-004**: un non-dev réel finit une tâche de son métier avec la preuve attachée, sans aide, sur un des deux cobayes (Q4).
- **SC-005**: aucune écriture ni aucun envoi par un connecteur sans carte validée (test sur un connecteur factice).
- **SC-006**: les calculs déterministes (chevauchement, péremption, budget) ne consomment aucun jeton (vérifié par la mesure de session).

## Assumptions

- Les specs 003 à 008 restent valides ; cette spec ne les modifie pas.
- Le seuil de gain peut être fixé par Heifara avant le premier rejeu ; hypothèse de travail en Q3.
- Les MCP des outils d'un data manager (tag manager, test A/B, bannière) ne sont pas vérifiés : à chercher avant de choisir (Q5).
- Les cas métier ci-dessus sont des scénarios cibles, pas des fonctions livrées.
- Cible macOS Apple silicon seule (constitution VIII).

## Questions ouvertes

1. **Garde-fous** (registre, revue de cap, lentilles) : validés tels quels ? Hypothèse : le registre et la revue entrent dans la spec 010 ; les lentilles viennent après la première mesure du volume réel.
2. **Modèle par rôle** : léger pour le tri et les lentilles, moyen pour l'interlocuteur et l'implémentation, gros seulement sur une décision structurante. Heifara choisit les modèles ; hypothèse : proposé dans la spec 010, jamais imposé.
3. **Seuil du benchmark** : hypothèse de travail, on garde si le temps actif de l'humain baisse d'au moins 30 % à qualité égale ou meilleure, avec un surcoût de jetons accepté d'avance (valeur à fixer par Heifara).
4. **Premier cobaye non-dev** : deux candidats, un media planner et un intégrateur d'une agence marketing. Hypothèse : le media planner d'abord (validateur chiffré), l'intégrateur ensuite (validateur visuel).
5. **Connecteurs du data manager** : existe-t-il un MCP ou une API pour le tag manager, le test A/B et la bannière de consentement ? Hypothèse : API officielle en lecture seule d'abord ; la bannière exacte reste à confirmer.
6. **Zoetrope** (flux de données animé entre blocs) : hors périmètre, question ouverte (décision du 19/11). Hypothèse : traitée après les couches 1 et 2.
7. **Numérotation** : 009 = cette spec, 010 = interlocuteur, 011 = mesure. Hypothèse : à confirmer avec l'orchestrateur du projet pour éviter une collision.
