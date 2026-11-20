# Feature Specification: Ajouts de la veille du 20/11 à la vision v2

**Feature Branch**: `docs/spec-013-ajouts-veille`

**Created**: 2026-11-21 (base `origin/docs/spec-009-plan`)

**Status**: Draft. Spec fille de 009. Elle range dans les quatre couches les idées retenues après la veille du 20/11 et dit, pour chacune, ce qui existe déjà. Aucune ligne de code. Questions ouvertes en fin de document, chacune avec son hypothèse de travail.

**Input**: veille de Heifara (Obsidian, Meta^n, Shepherd, kern, Headlong), élargie à 12 projets proches (Beads, Backlog.md, Gas Town, vibe-kanban, Emdash, Orca, Paradev, OpenCove, Horizon, ccanvas, ccusage, claude-squad). Seuls les README ont été lus, pas le code. Croisement avec la spec 009 fait en séance le 20/11. Demande : passer les ajouts retenus par spec-kit, puis en tirer fiches et issues.

Liens :
- Spec `009-vision-v2` : couches, FR-005 (détections par code), FR-006 (budget visible), FR-011 (mesure avant et après), FR-012 (une couche à la fois), FR-013 (écart minimal avec upstream).
- Spec `006-cout-attente-orchestrateur` et issue #100 : coût de l'attente.
- Spec `010-interlocuteur` : `backlog.json`, `decisions.json`, `agence fiche`, `agence decision`.
- Spec `012-connecteurs-metiers` : droits par connecteur, carte d'écriture (#161).
- Spec `004-cercle-vertueux` : déclencheurs sur `contextTokens`.
- Issues nées de la veille : #174, #175, #176, #177.
- Schéma : fichier Penpot de la vision, board « Vision v2 + veille : proposition ».

## Clarifications

### Session 2026-11-21

- Q: Les ajouts passent-ils tous maintenant ? → A: non. 009 FR-012 interdit d'étendre une couche avant sa mesure. Chaque ajout est rangé dans sa couche ; seuls ceux de la couche 1 peuvent partir.
- Q: Qu'est-ce qui existe déjà ? → A: lu sur `feat/v2-mvp-l4` (`838d1e54`), non mergé. Le consommé contre budget s'affiche déjà (`agence.py`, suivi d'un besoin). `contextTokens` est déjà lu par `cate agent usage` pour les déclencheurs de 004, mais n'est pas affiché. Le plafond `agents.max` fait déjà attendre une fiche, mais aucune garde ne refuse un lancement. Une fiche porte déjà ses décisions liées (`decisions`).
- Q: #176 fait-elle doublon avec #100 ? → A: en partie. #100 retient déjà l'attente par événement (les agents rapportent, personne ne boucle). Le recul exponentiel ne vaut que pour les tours qui restent malgré cela. Hypothèse en Q2.
- Q: #174 est-elle déjà couverte ? → A: en partie. Pour un dev, la proposition existe : un worktree et une PR, gardés par le merge. Pour un connecteur, la carte d'écriture de 012 la couvre. Il manque le geste « jeter » depuis l'écran central et les droits lisibles dans le brief.
- Q: Que garde-t-on de #177 ? → A: les liens entre fiches et décisions. L'export JSON Canvas est écarté : la vision dit « un canvas dont on ne sort plus ».

## Vocabulaire

- **Jauge de contexte** : jetons de contexte d'un agent vivant, lus par code, affichés dans le suivi.
- **Lien de fiche** : `remplace` (cette fiche rend l'autre caduque) ou `doublonDe` (même besoin qu'une autre).
- **Registre durable** : copie du registre de décisions qui survit à un clone.
- **Proposition** : travail fini d'un agent, pas encore accepté par l'humain.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Je vois ce que coûte chaque agent avant qu'il coûte trop (Priority: P1)

Dans le suivi, chaque agent vivant montre son contexte en jetons, à côté du consommé contre budget de sa fiche. Le dev voit qu'un agent approche du seuil et le compacte ou le ferme.

**Why this priority**: 006 mesure que 66 % des jetons lus viennent de la taille du contexte. Aujourd'hui cette taille ne se voit pas.

**Independent Test**: avec un faux `cate agent usage` qui rend 180 000 jetons pour un panneau, le suivi affiche la valeur ; sans mesure, il affiche « contexte inconnu », jamais 0.

**Acceptance Scenarios**:

1. **Given** un agent dont Cate rend `contextTokens`, **When** le suivi se rafraîchit, **Then** la valeur s'affiche sans appel à un modèle.
2. **Given** un agent sans mesure, **When** le suivi se rafraîchit, **Then** il affiche « contexte inconnu ».

---

### User Story 2 - Le plafond d'agents ne dépend plus d'une consigne (Priority: P1)

L'orchestrateur lance un agent alors que le plafond est atteint. La garde refuse le lancement et dit combien d'agents tournent.

**Why this priority**: 13 agents ont forcé un force quit sur un Mac de 24 Go. La fiche attend déjà, mais rien n'empêche un lancement direct.

**Independent Test**: plafond 4, 4 agents vivants : `cate agent start` reçoit `deny` avec le compte ; à 3 vivants, aucune décision.

**Acceptance Scenarios**:

1. **Given** le plafond atteint, **When** un agent lance `cate agent start`, **Then** la garde rend `deny` et le message cite vivants et plafond.
2. **Given** une place libre, **When** le lancement arrive, **Then** la garde ne décide rien.

---

### User Story 3 - Les fiches et les décisions se répondent (Priority: P2)

L'interlocuteur marque qu'une fiche en remplace une autre ou en est le doublon. Le dev ouvre une décision et voit les fiches qui la citent.

**Why this priority**: 009 demande à l'interlocuteur de repérer doublons et contradictions ; sans lien écrit, le repérage se perd à chaque `/clear`.

**Independent Test**: F2 `doublonDe` F1 : F2 ne peut pas passer `prête` ; `agence decision show D1` liste les fiches dont `decisions` contient D1.

**Acceptance Scenarios**:

1. **Given** une fiche marquée doublon, **When** on la passe `prête`, **Then** la CLI refuse et nomme la fiche d'origine.
2. **Given** un lien vers une fiche inconnue, **When** on l'écrit, **Then** la CLI refuse et rien ne change.

---

### User Story 4 - Le registre de décisions survit à un clone (Priority: P2)

Le dev change de poste. Les décisions actives et leur pourquoi sont dans le dépôt, pas seulement dans `.cate/tmp/`.

**Why this priority**: le registre est le garde-fou contre les contradictions. Aujourd'hui il disparaît avec le dossier temporaire.

**Independent Test**: après l'export, un clone neuf contient le fichier ; il liste chaque décision active avec sa date et son pourquoi.

---

### User Story 5 - L'attente coûte le moins possible, mesure à l'appui (Priority: P2)

Avant de coder un recul, on mesure ce qui reste de l'attente une fois les pistes de #100 appliquées.

**Why this priority**: 009 FR-011 impose la mesure avant et après. Un recul codé sans mesure peut ne rien rapporter.

**Independent Test**: `attente_mesure.py` donne la part de l'attente avant et après ; le recul n'est gardé que si elle baisse et que la qualité ne bouge pas.

---

### User Story 6 - Je règle si un plan se valide avant le code (Priority: P3, couche 2)

Une clé de la politique dit quand l'agent doit faire valider son plan : jamais, sur décision structurante, toujours.

**Why this priority**: l'idée vient de Backlog.md. Par défaut elle ajoute du temps actif humain, le critère que le benchmark doit faire baisser.

**Independent Test**: clé absente : aucun arrêt ; clé `structurante` : seule une fiche liée à une décision structurante demande la validation.

---

### User Story 7 - Je jette une proposition en un clic et je lis les droits d'une tâche (Priority: P3, couche 3)

Dans l'écran central, une carte permet de jeter le travail d'un agent : PR fermée, worktree retiré, fiche remise en `discussion`. Le brief d'une fiche cite les connecteurs ouverts en écriture.

**Why this priority**: #174. Le geste « garder » existe (merge), « jeter » demande aujourd'hui plusieurs commandes.

**Independent Test**: sans clic, rien n'est fermé ni supprimé ; après le clic, la PR est fermée et la fiche revient en `discussion`.

---

### User Story 8 - Je montre un élément de la page à l'agent (Priority: P3, couche 3)

L'intégrateur clique un élément dans le panneau navigateur ; l'agent relié reçoit son sélecteur, son HTML et une capture.

**Why this priority**: sert le cobaye intégrateur, dont le validateur est visuel. Faisabilité non vérifiée (Q5).

**Independent Test**: fixé par la recherche du lot 0.

---

### User Story 9 - Une recette ne tourne seule que si elle ne dégrade rien (Priority: P3, couche 4)

Une recette proposée passe par le rejeu du benchmark avant d'être proposée à l'humain (#175).

**Why this priority**: même règle que 009 FR-011, appliquée aux recettes. Gelée jusqu'à la couche 4.

**Independent Test**: un rejeu rouge annule la recette et note la raison.

### Edge Cases

- `cate agent usage` refusé ou illisible : « contexte inconnu », aucun lancement bloqué pour cela.
- État du régisseur périmé : la garde de plafond lit le dernier compte publié et le dit dans son message.
- Lien `remplace` en cycle (F1 remplace F2, F2 remplace F1) : refusé, cycle nommé.
- Fiche `lancée` marquée doublon après coup : le lien s'écrit, rien n'est arrêté ; l'écran central le signale.
- `backlog.json` écrit avant cette spec : il n'a pas les nouveaux champs et devient invalide (coupe nette, constitution III). Le message dit quoi ajouter à la main.
- Carte « jeter » sur une PR déjà mergée : refusée.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Le suivi MUST afficher, pour chaque agent vivant, ses jetons de contexte lus par `cate agent usage`, sans modèle. Sans mesure : « contexte inconnu », jamais 0.
- **FR-002**: La garde MUST refuser (`deny`) un `cate agent start` quand le nombre d'agents vivants atteint `agents.max`. Le message MUST citer vivants et plafond.
- **FR-003**: Une fiche MUST pouvoir porter `remplace` et `doublonDe` (listes d'identifiants de fiches). Une fiche doublon ou remplacée MUST NOT passer `prête`. Identifiant inconnu ou cycle : refus sans écriture.
- **FR-004**: `agence decision show` MUST lister les fiches qui citent la décision. Ce lien inverse MUST être calculé, jamais stocké (#177).
- **FR-005**: Les décisions actives MUST exister dans un fichier versionné du dépôt, produit par la CLI (forme en Q1).
- **FR-006**: Toute réduction du coût d'attente MUST être mesurée avant et après avec `attente_mesure.py` et annulée si la qualité baisse (#176, #100).
- **FR-007**: La politique MUST porter une clé qui règle la validation du plan avant le code : `jamais` (défaut), `structurante`, `toujours`.
- **FR-008**: L'écran central MUST offrir une carte « jeter » pour un besoin ; rien n'est fermé ni supprimé sans clic (#174).
- **FR-009**: Le brief d'une fiche MUST citer les connecteurs ouverts en écriture pour le projet (dépend de 012).
- **FR-010**: Le clic sur un élément du navigateur MUST passer par un lien entre panneaux et MUST NOT ajouter de code dans `src/` sans décision écrite (009 FR-013).
- **FR-011**: La porte des recettes (#175) et le résumé des fiches closes MUST rester gelés jusqu'à leur couche et leur mesure.
- **FR-012**: Aucune nouvelle dépendance. Tout calcul de cette spec MUST être du code sans modèle (009 FR-005).

### Key Entities

- **Fiche** (010) : gagne `remplace` et `doublonDe`.
- **Décision** (010) : inchangée ; la liste des fiches qui la citent est calculée.
- **Politique** (005) : gagne une clé de validation du plan.

## Success Criteria *(mandatory)*

- **SC-001**: avec un faux `cate`, le suivi affiche le contexte de chaque agent vivant et « contexte inconnu » sans mesure (test).
- **SC-002**: plafond atteint, un lancement est refusé ; une place libre, il passe (test de garde).
- **SC-003**: une fiche doublon ne passe pas `prête` ; une décision liste ses fiches (tests de `backlog.py`).
- **SC-004**: un clone neuf contient les décisions actives.
- **SC-005**: le rapport d'attente donne la part avant et après, avec le même outil.
- **SC-006**: aucun calcul de cette spec ne consomme de jeton (mesure de session).
- **SC-007**: `git diff --stat origin/main -- src` reste vide pour les lots 1 à 6.

## Assumptions

- Les lots de 010 (backlog, interlocuteur, lancer) sont mergés avant les lots 3 et 4 de cette spec.
- `cate agent usage` rend `contextTokens` (vérifié dans le code de 004, pas à l'écran).
- Ce que le panneau Review et `cate browser` savent déjà faire n'est pas vérifié : c'est l'objet du lot 0.
- Les gains ne sont pas mesurés. Les chiffres cités viennent de la spec 006.

## Écarté

- Le même prompt envoyé à 5 agents (Orca) : 5 fois les jetons.
- La pensée permanente d'un agent (Headlong) : 1 à 2 $ de l'heure.
- L'export JSON Canvas (partie de #177) : on ne sort plus du canvas.
- Interroger une session fermée (Gas Town) : l'état vit dans les fichiers (009 FR-004).
- kern, Dolt, tmux : hors cible macOS arm64 ou sans besoin. Code de claude-squad : licence AGPL.
- File de merge avec portes (Gas Town) : le merge final reste à l'humain ; à revoir en couche 4.

## Questions ouvertes

1. **Registre durable** : sous quelle forme ? Hypothèse : `agence decision export` écrit `docs/decisions.md` (décisions actives seulement), commité par une PR de docs. Les fiches ne sont pas exportées : une fiche lancée a déjà son issue.
2. **#176 contre #100** : hypothèse : #176 devient une sous-tâche de #100. On mesure d'abord ; si l'attente par événement suffit, #176 se ferme sans code.
3. **Garde de plafond** : `deny` ou `ask` ? Hypothèse : `deny`, avec la sortie de secours habituelle pour l'humain.
4. **Carte « jeter »** : supprime-t-elle la branche distante ? Hypothèse : non, elle ferme la PR et retire le worktree ; la branche reste (suppression de branche = accord explicite).
5. **Clic navigateur** : skill, panneau perso ou contribution à upstream ? Hypothèse : tranché par la recherche du lot 0.
6. **Résumé des fiches closes** : à partir de quand ? Hypothèse : pas avant 50 fiches ou 5 % des jetons lus par l'interlocuteur.
7. **Validation du plan** : défaut `jamais` confirmé ? Hypothèse : oui.
