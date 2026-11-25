# Feature Specification: Interlocuteur, backlog de fiches et garde-fous

**Feature Branch**: `docs/spec-010-interlocuteur`

**Created**: 2026-11-20 (base `docs/spec-vision-v2` `7c82ee6f`, spec 009 non poussée)

**Status**: Draft. Enfant de la spec 009 (couche 1, noyau). Couvre FR-001 à FR-007 et SC-001, SC-003, SC-006 de 009. Aucune ligne de code.

**Input**: besoin #n581 de l'orchestrateur du projet cate. Le problème de départ (009, US1) : plusieurs tâches sur un projet, un seul terminal, la discussion et l'exécution se mélangent dans le même contexte. Cette spec sépare celui qui pense (l'interlocuteur) de celui qui exécute (l'orchestrateur), et met entre les deux un fichier : le backlog de fiches.

Liens :
- `specs/009-vision-v2/spec.md` : vocabulaire (fiche, backlog, registre, lentille), FR et questions ouvertes. Cette spec ne la modifie pas.
- Spec 005 : `tools/agence/pratiques.py` et `pratiques.json` (politique de flux, `agents.max`). Le modèle par rôle s'y ajoute en clés.
- Spec 006 : `tools/agence/attente_mesure.py` (mesure de session). Spec 011 : benchmark (SC-002, SC-003 au niveau du produit).
- Spec 008 : réglages du panneau agence (mêmes fichiers de vue que le lot 5 ici : à sérialiser).
- Existant réutilisé : `agence need` (besoins, budget, `--model`, `--effort`), `agence ask` (cartes de décision), `click()` du régisseur (seul chemin d'un clic), garde `agence guard --mode pages`, panneau `agence`.

## Clarifications

### Session 2026-11-20

- Q: Les trois garde-fous de 009 (registre, revue de cap, lentilles) entrent-ils tous ici ? → A: hypothèse de 009 (Q1, `specs/009-vision-v2/spec.md:196`) : le **registre** et la **revue de cap** entrent dans les lots principaux ; les **lentilles** forment un lot tardif (lot 8), démarré seulement après la première mesure du volume réel de fiches (seuil en Q1 ci-dessous).
- Q: Le modèle par rôle est-il imposé ? → A: hypothèse de 009 (Q2, `:197`) : **proposé, jamais imposé**. Quatre clés de politique (spec 005) valent `null` par défaut ; `null` = modèle par défaut de l'agent CLI. Heifara choisit les modèles. Aucune économie qui en découle n'est rendue par défaut sans verdict de la spec 011 (SC-003).
- Q: Où vivent le backlog et le registre ? → A: `<racine>/.cate/tmp/agence/backlog.json` et `<racine>/.cate/tmp/agence/decisions.json`, à côté de `state.json` et `pratiques.json` (même dossier que la spec 005, déjà dans `.cate/.gitignore`). JSON éditable à la main, écrit par la seule CLI `agence` (FR-004, contrainte de la constitution). Choix : pas d'historique de conversation, pas de base, pas de fichier commité (un backlog commité produirait des conflits entre worktrees).
- Q: Une fiche archivée par la revue de cap a-t-elle un état ? → A: oui, `abandonnée`, état terminal ajouté aux quatre de 009 (`discussion`, `prête`, `lancée`, `faite`). 009 dit « relancée ou archivée » (`:142`) sans nommer l'état ; sans lui, l'archive serait une suppression, contraire à « rien supprimer ».
- Q: Qui écrit le registre de décisions ? → A: l'interlocuteur **propose** une décision (`agence decision add`, statut `proposée`) ; elle ne devient `active`, et une décision n'est `révoquée`, que sur un clic de l'humain (carte de l'écran central). 009 ne l'impose que pour les lentilles (`:143`) ; on l'étend à toute écriture : un registre que le modèle remplit seul n'est plus un garde-fou.
- Q: Comment l'interlocuteur est-il empêché de lancer du travail (FR-002) ? → A: deux barrières en code. (1) La CLI : les transitions `lancée` et `faite` ne passent que par le régisseur (clic « Lancer », fermeture du besoin) ; `agence need add`, `agence ask --merge` et `agence draft new` refusent un appelant qui est l'interlocuteur. (2) La garde `agence guard --mode pages` refuse à l'interlocuteur `cate agent start`, `cate panel create|link|close` et `cate terminal` en écriture. Le panneau appelant n'est identifié (sonde `caller_panel()`, `tools/agence/agence.py:336`) que sur une commande de cette liste, jamais à chaque appel.
- Q: Unité du budget d'une fiche ? → A: **jetons** (FR-006), somme `inputTokens + outputTokens` des panneaux du besoin, lue dans `cate agent usage` (`src/services/agents/contract/usage/types.ts:149-150`). Le budget en dollars et en minutes existant (`budgetUsd`, `budgetMin`, `tools/agence/agence.py:244`) reste tel quel.
- Q: Quand tombe la revue de cap ? → A: hypothèse : 7 jours après la précédente (première : 7 jours après la première fiche). Une carte unique, jamais un message à l'orchestrateur.

## Vocabulaire

Celui de 009, plus :
- **Lot `prêt`** : les fiches `prêtes` que l'humain coche avant de cliquer « Lancer ».
- **Vague** : un groupe de fiches sans fichier commun, lancées en parallèle ; les vagues se suivent en série. Calculé par code.
- **Brief de fiche** : le texte rendu par `agence fiche brief <id>`, seul contenu que l'orchestrateur reçoit pour une fiche.
- **Écran central** : le panneau `agence` existant (suivi, cartes), augmenté du backlog et du consommé contre budget.
- **Revue de cap** : une carte hebdomadaire qui liste ce qui dérive (fiches périmées, budgets, décisions structurantes de la semaine, fiches hors vision).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Je parle, l'interlocuteur fait des fiches, rien ne part sans moi (Priority: P1)

Le dev ouvre le projet ; `agence start` crée (une seule fois) le panneau Interlocuteur à côté du panneau agence, si l'orga du workspace déclare ce poste (sans fichier d'orga, profil solo : aucun interlocuteur). Il y dicte idées, bugs, retours. L'interlocuteur lit le registre et le backlog (`agence decision list`, `agence fiche list`), signale une contradiction avec une décision active ou un doublon probable, puis écrit des fiches par la CLI. Le brainstorm reste en `discussion`. Une fiche passe `prête` seulement quand tous ses champs sont remplis.

**Why this priority**: c'est le problème de départ de 009 (US1).

**Independent Test**: sur un dépôt de test, 6 retours dictés (2 brainstorms, 4 demandes complètes) donnent 4 fiches `prêtes` et 2 en `discussion` ; `cate agent list` ne montre aucun agent de plus que l'interlocuteur et l'orchestrateur.

**Acceptance Scenarios**:

1. **Given** une décision active « pas de base de données, JSON seulement », **When** le dev dicte « stocke le backlog en SQLite », **Then** l'interlocuteur cite la décision et son pourquoi et demande si elle est révoquée, avant toute fiche.
2. **Given** une fiche sans `preuve` ou sans `fichiers`, **When** l'interlocuteur la passe `prête`, **Then** la CLI refuse (code 1) et nomme les champs manquants.
3. **Given** l'interlocuteur, **When** il lance `cate agent start` ou `agence need add`, **Then** la commande est refusée avec le motif « l'interlocuteur ne lance rien ».
4. **Given** le panneau Interlocuteur déjà ouvert, **When** le dev relance `agence start`, **Then** aucun second interlocuteur n'est créé.

---

### User Story 2 - Je clique « Lancer », l'orchestrateur exécute en vagues (Priority: P1)

Dans l'écran central, le dev coche des fiches `prêtes` et clique « Lancer ». Le régisseur calcule les vagues (fichiers communs en série, dépendances respectées, plafond d'agents), crée un besoin par fiche avec ses réglages (budget, modèle proposé, condition de fin dérivée de la preuve), passe les fiches à `lancée` et envoie à l'orchestrateur le brief de chaque fiche et le plan de vagues. Quand le besoin d'une fiche se ferme `done`, la fiche passe `faite`.

**Why this priority**: c'est le contrat entre penser et exécuter (009, FR-003).

**Independent Test**: trois fiches `prêtes` dont deux partagent `src/a.ts` : le plan rend deux vagues ({F1, F3}, puis {F2}) ; aucun besoin n'existe avant le clic ; après le clic, trois besoins existent et l'orchestrateur a reçu un message unique.

**Acceptance Scenarios**:

1. **Given** un lot `prêt`, **When** le dev ne clique pas, **Then** aucun besoin n'est créé et l'orchestrateur ne reçoit rien.
2. **Given** une fiche complète, **When** l'orchestrateur reçoit son brief, **Then** le brief contient titre, type, preuve, fichiers, dépendances, budget, modèle proposé et décisions liées, et l'orchestrateur ne repose aucune de ces questions (vérifié sur le scénario de SC-001).
3. **Given** `agents.max` = 4 et 3 agents vivants, **When** le dev lance 3 fiches sans fichier commun, **Then** une seule part, les deux autres attendent et l'écran central dit « attend : plafond (4) ».
4. **Given** une fiche dont la dépendance n'est pas `faite`, **When** le dev la lance, **Then** elle va dans une vague après sa dépendance, ou attend si la dépendance n'est pas du même lot.

---

### User Story 3 - Je vois le consommé contre le budget et je tranche les dépassements (Priority: P1)

Chaque fiche porte un budget de jetons et le point de la vision qu'elle sert. L'écran central montre, par fiche `lancée`, le consommé contre le budget, et le total du lot. Un dépassement devient une carte de décision (continuer, réduire, arrêter), comme le budget en dollars aujourd'hui.

**Why this priority**: FR-006 de 009 ; la frugalité doit se voir avant de se mesurer.

**Independent Test**: un besoin de budget 10 000 jetons dont le panneau rend 6 000 en entrée et 5 000 en sortie : la ligne affiche « 11 000 / 10 000 jetons » et le besoin passe en Bloquant.

**Acceptance Scenarios**:

1. **Given** une fiche sans budget ou sans point de vision, **When** elle passe `prête`, **Then** la CLI refuse.
2. **Given** `cate agent usage` illisible, **When** le régisseur fait son tour, **Then** la ligne dit « consommé inconnu », jamais 0.

---

### User Story 4 - Le registre et la revue de cap gardent le cap (Priority: P2)

L'interlocuteur propose une décision (objet, pourquoi, alternatives écartées, ce qu'elle invalide, structurante ou non) ; elle arrive en carte et ne devient active qu'au clic. Chaque semaine, une carte de revue liste les fiches en `discussion` depuis plus de 14 jours (relancer ou abandonner, un clic chacune), les budgets dépassés, les décisions structurantes de la semaine et les fiches dont le point de vision est absent du référentiel.

**Why this priority**: garde-fous contre le flux d'idées (009, Q1), après le flux principal.

**Independent Test**: une fiche `discussion` modifiée il y a 15 jours et une modifiée il y a 13 jours : la revue n'en liste qu'une ; « Abandonner » la passe `abandonnée` ; aucune fiche n'est supprimée.

**Acceptance Scenarios**:

1. **Given** une décision `proposée`, **When** l'humain ne clique pas, **Then** elle reste `proposée` et l'interlocuteur ne la cite pas comme active.
2. **Given** une revue faite il y a 3 jours, **When** le régisseur tourne, **Then** aucune nouvelle carte de revue.

---

### User Story 5 - Un modèle par rôle est proposé, jamais imposé (Priority: P3)

La politique (spec 005) porte quatre clés `modele.tri`, `modele.interlocuteur`, `modele.implementation`, `modele.structurant`, `null` par défaut. Quand une est posée, l'interlocuteur la propose dans la fiche ; l'humain la change avant « Lancer » en éditant la fiche ; l'orchestrateur la passe à `cate agent start --model`.

**Why this priority**: levier de coût, mais son effet se prouve par la spec 011.

**Independent Test**: politique sans clé `modele.*` : aucune fiche ne porte de modèle et le besoin créé n'a pas de `model`.

### User Story 6 - Une lentille éclaire une fiche sous un autre angle (Priority: P3, lot tardif)

Sur demande (tirage au hasard) ou sur une décision marquée structurante, une lentille (inverser, supprimer, novice, dans un an, pire cas, agence réelle) reçoit la seule fiche et rend une proposition, attachée à la fiche. Elle ne tranche jamais.

**Why this priority**: hypothèse de 009 (Q1) : après la première mesure du volume réel.

**Independent Test**: le brief d'une lentille ne contient que la fiche et la consigne d'angle (vérifié par test sur le texte produit) ; sa proposition n'écrit ni dans le registre ni dans l'état de la fiche.

### Edge Cases

- Deux fiches `prêtes` sur le même fichier : deux vagues, jamais la même.
- Un dossier et un fichier qu'il contient (`src/a/` et `src/a/b.ts`) : chevauchement.
- Fichiers probables vides : la fiche ne passe pas `prête` (un lancement sans fichiers ne se planifie pas).
- Dépendance en cycle : refus à l'écriture de la fiche, avec le cycle nommé.
- Plafond atteint : la fiche reste `prête` en file d'attente (« attend : plafond »), relancée au tour où une place se libère, sans nouveau clic.
- Besoin fermé `dropped` : la fiche revient `prête` avec la ligne de journal « abandon de l'exécution », jamais `faite`.
- Fichier backlog édité à la main et invalide : la CLI refuse toute écriture et `watch` publie l'erreur (même règle que `pratiques.json`, spec 005) ; aucune fiche n'est lancée.
- Interlocuteur réinitialisé (`/clear`) : rien n'est perdu, il relit backlog et registre.
- Double clic sur « Lancer » : la seconde requête trouve des fiches `lancées` et ne crée rien (verrou de `tx()`, `tools/agence/agence.py:197`).
- Fiche dont le point de vision n'existe pas : signalée dans la revue, jamais refusée seule (009, `:141`).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (009 FR-001) : `agence start` MUST créer au plus un panneau Interlocuteur par projet, et seulement si l'orga du workspace a le poste `interlocuteur`, enregistré dans l'état (`panels.interlocuteur`) et relié au panneau agence ; relancé, il adopte le vivant.
- **FR-002** (009 FR-002) : l'interlocuteur MUST NOT créer, relier ni fermer un agent ou un panneau, créer un besoin, poser une question `--merge` ou un brouillon. La CLI et la garde le refusent.
- **FR-003** (009 FR-003) : une fiche MUST passer `lancée` uniquement par le clic « Lancer » du régisseur (`click()`), qui crée un besoin par fiche et envoie à l'orchestrateur un message unique : briefs et plan de vagues. Aucune autre commande ne fait passer une fiche `lancée`.
- **FR-004** (009 FR-004) : backlog et registre MUST être `backlog.json` et `decisions.json` dans `.cate/tmp/agence/`, validés à chaque lecture, écrits par la CLI `agence` sous le verrou de l'état ; la garde refuse `Write`, `Edit` et l'écriture shell sur ces deux fichiers à tout agent.
- **FR-005** (009 FR-005) : chevauchement, vagues, dépendances, péremption (14 jours), plafond et budgets MUST être des fonctions pures de `tools/agence/backlog.py`, sans appel de modèle ni réseau.
- **FR-006** (009 FR-006) : une fiche `prête` MUST porter `budgetJetons` (entier > 0) et `vision` (non vide). L'écran central MUST afficher, par fiche `lancée`, consommé contre budget en jetons ; un dépassement MUST mettre le besoin en Bloquant avec une carte.
- **FR-007** (009 FR-007, lot tardif) : une lentille MUST recevoir la fiche seule, proposer sans trancher, se déclencher à la demande ou sur une décision structurante ; la liste des lentilles MUST être un fichier de données éditable.
- **FR-008** : une décision MUST porter date, objet, pourquoi, alternatives écartées, invalidations, marque structurante ; elle ne MUST devenir `active` ou `révoquée` que sur clic.
- **FR-009** : la revue de cap MUST être une carte unique tous les 7 jours, calculée par code ; chaque fiche périmée a ses deux boutons (relancer, abandonner).
- **FR-010** : le modèle par rôle MUST être quatre clés de politique (spec 005), `null` par défaut ; aucun code ne choisit un modèle à la place de l'humain.
- **FR-011** : coupes nettes et écart minimal (009 FR-013) : toute la logique vit dans `tools/agence/` et dans les skills ; `src/` ne bouge que dans le panneau `agence` (écart déjà porté par le fork).
- **FR-012** (009 FR-014, constitution X) : aucun test ni agent ne lance Electron, Playwright ou l'app ; le scénario de SC-001 est joué par Heifara.

### Key Entities

- **Fiche** : `id` (`F<n>`), `titre`, `type` (`bug`, `idee`, `retour`, `audit`, `tache`), `preuve` (forme de `--done-when`, spec 005), `priorite` (`P1` à `P3`), `fichiers` (liste de chemins ou de dossiers relatifs), `dependances` (ids), `budgetJetons`, `vision` (point servi : un identifiant de couche ou de FR de 009), `modele` (proposé, ou `null`), `decisions` (ids liés), `etat`, `besoin` (id du besoin après lancement), `creee`, `maj`, `journal`.
- **Backlog** : `{"seq": n, "fiches": [...], "derniereRevue": date|null}`.
- **Décision** : `id` (`D<n>`), `date`, `objet`, `pourquoi`, `alternatives`, `invalide`, `structurante`, `statut` (`proposée`, `active`, `rejetée`, `révoquée`), `revoqueePar`.
- **Vague** : liste d'ids de fiches, sans fichier commun.
- **Lentille** (lot 8) : `nom`, `consigne`, `modele`.

## Success Criteria *(mandatory)*

- **SC-001** (009 SC-001) : sur un dépôt de test, le scénario de US1 donne 4 fiches `prêtes` et 2 en `discussion` ; le plan de vagues met en série les fiches qui partagent un fichier (test unitaire sur `backlog.plan`) ; aucun besoin ni agent avant le clic (test du régisseur, puis scénario joué par Heifara).
- **SC-003** (009 SC-003) : aucune clé `modele.*` posée dans un preset livré et aucune économie de jetons rendue par défaut tant que la spec 011 n'a pas rendu son verdict ; la tâche qui le vérifie est T120 (test sur `pratiques.json`).
- **SC-006** (009 SC-006) : les fonctions de `backlog.py` tournent sans appel externe (test qui fait échouer tout sous-processus et toute socket) ; `agence fiche plan` et `agence revue` ne lancent aucun modèle ; la mesure de session de la spec 006 (`attente_mesure.py`) sur une session d'interlocuteur ne compte, pour ces commandes, que les jetons de leur sortie.
- **SC-010** : `agence.py` ne grossit pas de plus de 150 lignes par lot (règle de la spec 005) ; la logique neuve est dans `backlog.py`.

## Assumptions

- Lot 1 de la spec 005 mergé dans la base : `tools/agence/pratiques.py` (`charger`, `:160` ; `brief`, `:241`) et `pratiques.json` présents, `agents.max` à 4 dans les deux presets (`tools/agence/pratiques.json:34`, `:39`). Le lot 3 de 005 (grammaire fermée de `--done-when`, `done_when_defaut`, `evaluer`) n'est pas dans la base (`grep` vide dans `pratiques.py`) ; il est commité en local sur `feat/preuve-politique` (bus, 20:37). Le lot 4 de cette spec en dépend.
- `cate agent usage` rend `inputTokens` et `outputTokens` par panneau (`src/services/agents/contract/usage/types.ts:149-150`) ; l'app installée chez Heifara a ce build (non vérifié ici, l'app n'est pas lancée).
- `cate agent start` accepte `--model` (`src/services/agents/contract/api.ts:79`) et un premier prompt (`:66`).
- L'interlocuteur est un agent Claude Code lancé avec le prompt `/interlocuteur` ; le skill est livré dans `skills/` comme `orchestrateur`.
- Cible macOS Apple silicon (constitution VIII).

## Questions ouvertes

1. **Seuil de démarrage des lentilles** : hypothèse : le lot 8 démarre quand le backlog d'un projet réel a reçu au moins 20 fiches en 14 jours (volume où la revue seule ne suffit plus) ; sinon il attend. Valeur à fixer par Heifara, ne bloque aucun lot 1 à 7.
2. **Référentiel des points de vision** : hypothèse : la liste des identifiants de 009 (couches 1 à 4, FR-001 à FR-014) codée en données dans `backlog.py` ; un projet tiers pose les siens plus tard (spec 008). Ne bloque rien : une fiche hors référentiel est signalée, pas refusée.
3. **Jour de la revue** : hypothèse 7 jours glissants ; un jour fixe (lundi) se règle plus tard en clé de politique si Heifara le demande.
