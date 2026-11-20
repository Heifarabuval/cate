# Feature Specification: Connecteurs et métiers (couche 3 de la vision v2)

**Feature Branch**: `docs/spec-012-connecteurs-metiers` (depuis `docs/spec-009-plan` `b8a37663`)

**Created**: 2026-11-20 (besoin n654)

**Status**: Draft. Spec d'abord, aucune ligne de code. C'est le lot S3 de `specs/009-vision-v2/tasks.md` (T042, numéro 012 donné par l'orchestrateur du projet). Questions ouvertes en fin de document, chacune avec son hypothèse de travail.

**Input**: spec 009, couche 3 : « un non-dev réel finit une tâche de son métier sans aide » (`specs/009-vision-v2/spec.md:52`). Un outil externe se branche en panneau ; chaque connecteur a des droits distincts en lecture et en écriture ; toute écriture ou tout envoi passe par la validation centrale ; aucun secret n'entre dans la politique, un brief ou le contexte d'un agent. Un métier se décrit par quatre éléments : connecteurs, panneaux, validateur « fini » avec preuve nommée, recette récurrente. FR-008, FR-009, FR-010, FR-013, SC-004, SC-005 de 009.

Liens :
- Spec `009-vision-v2` : couches, US3 (data manager), US4 (chef de projet marketing), US5 (connecteurs), Q4 (cobaye), Q5 (connecteurs du data manager) ; `plan.md` (G3, R8) ; `tasks.md` (S3 : T040, T041, T042 ; C3 ; G3 : T050, T051).
- Spec `005-pratiques-reglables` : schéma `tools/agence/pratiques.json`, clés `parmi` (`tools/agence/pratiques.py:56-60`), garde `pages`, preuve de fin dérivée (lot 3, `feat/preuve-politique` `1927a1d6`, `pratiques.py` `FORMES`, `done_when_defaut`, `evaluer`).
- Spec `008-reglages-workspace` : formulaire du panneau agence généré depuis le schéma (FR-006), premières questions (FR-013, SC-006).
- Spec `007-panneaux-perso-partage` : panneaux perso, carte d'accord, export sans secret (FR-012).
- Spec `003-apprentissage-observation` : les recettes (couche 4). Cette spec les déclare, ne les exécute pas.
- Code existant : brouillons et clic Envoyer (`tools/agence/agence.py:620-672`), garde d'envoi (`:2451-2524`), entrées de hooks (`:2582-2588`), jeton Slack par nom de variable (`:685-698`), `cate browser network` (`src/services/browser/contract/api.ts:254-259`).

## Clarifications

### Session 2026-11-20

Chaque question est tranchée par l'hypothèse de travail de 009 ou par ce qui existe déjà ; aucune n'a demandé `agence ask` (aucune ne change le périmètre sans hypothèse).

- Q: Où vit la description d'un métier et de ses connecteurs ? → A: dans `tools/agence/`, deux catalogues JSON livrés avec le runtime : `metiers.json` et `connecteurs.json`, une ligne par entrée avec un `id` (même forme que `declencheurs.json`, lue par la règle `parmi` de `pratiques.py:56-60`). Le projet choisit son métier et ouvre les droits par trois clés du schéma de 005 : `metier`, `connecteurs.lecture`, `connecteurs.ecriture`. Rien dans `src/` (FR-013 de 009, constitution IX).
- Q: Quels droits par défaut ? → A: lecture ouverte pour les connecteurs du métier, écriture fermée (009 US5 : « lecture par défaut, écriture ou envoi par carte »). Ouvrir l'écriture d'un connecteur ne la rend jamais libre : elle passe toujours par une carte validée. Comme l'accord d'import de 007 (Clarifications), la carte est un plancher de sécurité, pas une pratique réglable.
- Q: Comment une écriture passe-t-elle par la validation centrale ? → A: par le mécanisme des brouillons, généralisé. L'agent prépare une carte `agence draft new --cible outil:<connecteur>:<outil>` dont le texte est l'appel figé (JSON) ; l'humain clique Envoyer dans la page ; la garde `send` autorise **un** appel dont l'outil et les arguments sont exactement ceux de la carte, comme elle le fait déjà pour un mail (`agence.py:2451-2464`). Sans carte cliquée identique : refus (`deny`), jamais `ask`, pour qu'un non-dev ne valide pas dans un terminal.
- Q: Un connecteur par API officielle ou par navigateur peut-il écrire ? → A: non en v1. La garde ne voit que les appels d'outils MCP ; un appel d'API par script ou un clic dans une page lui échappe. Ces connecteurs sont en lecture seule ; une écriture devient une action « à faire par l'humain » avec le contenu préparé (009 Q5 : « API officielle en lecture seule d'abord »).
- Q: Où vivent les secrets (« coffre ») ? → A: hors de tout fichier de Cate et de l'agence. Un connecteur MCP garde son authentification dans le client MCP (Claude Code). Un connecteur API nomme une variable d'environnement et, au besoin, un fichier `.env` hors dépôt, sur le modèle de `envoi.slack.variable` et `envoi.slack.fichier` (`pratiques.json:18-19`, `agence.py:685-698`). Un coffre (gestionnaire de mots de passe) se branche plus tard comme un connecteur (Q3).
- Q: Le validateur « fini » d'un métier ? → A: une liste de preuves nommées déclarée dans `metiers.json`, qui remplace la preuve par défaut du dev (005 `preuve`). Trois types de preuve : `fichier` (un fichier du workspace, non vide, dont l'empreinte est notée), `lien` (une URL), `clic` (une carte « validé » cliquée par l'humain). Grammaire de 005-L3 étendue d'une forme `preuve:<nom>`.
- Q: Premier cobaye (Q4 de 009) ? → A: hypothèse de 009 retenue : le **media planner** (validateur chiffré), l'intégrateur ensuite. Le choix réel et la tâche de référence restent à Heifara (009 T041). Le data manager et le chef de projet marketing sont des scénarios cibles, joués sur des connecteurs factices.
- Q: Connecteurs du data manager (Q5 de 009) ? → A: non vérifiés. Cette spec ne nomme aucun MCP ni aucune API comme existant : elle liste ce qu'il faut vérifier (section « Connecteurs à vérifier »), et le lot 0 le vérifie en lecture seule.

## Vocabulaire

- **Connecteur** : un outil externe branché en panneau. Une ligne de `connecteurs.json` : `id`, `nom`, `explique`, `acces` (`mcp`, `api` ou `navigateur`), `serveur` (nom du serveur MCP, pour `mcp`), `lecture` et `ecriture` (noms d'outils MCP, sans le préfixe `mcp__<serveur>__`), `secret` (nom de variable et fichier, pour `api`), `panneau` (URL ou panneau perso qui le montre).
- **Ordre de choix** : pour un outil, dans l'ordre : un MCP déjà branché, un MCP existant à installer, l'API officielle, le navigateur en dernier recours.
- **Métier** : une ligne de `metiers.json` : `id`, `nom`, `explique`, `connecteurs` (ids), `panneaux`, `validateur` (preuves nommées), `recettes`.
- **Preuve nommée** : `{nom, type: fichier|lien|clic, explique}`. Une tâche du métier ne passe à `faite` qu'avec chacune de ses preuves.
- **Carte d'écriture** : un brouillon dont la cible est `outil:<connecteur>:<outil>` et le texte l'appel figé. Validée par le clic Envoyer, elle autorise un seul appel identique.
- **Recette du métier** : `{nom, declencheur, action, preuve}`, déclarée ici, exécutée par la spec 003 (couche 4).
- **Connecteur factice** : un connecteur de test (`factice`, serveur MCP `factice`, lecture `lire`, écriture `ecrire`), qui ne vit que dans les fixtures.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Un connecteur n'écrit jamais sans carte validée (Priority: P1)

L'agent d'un projet lit librement dans un outil branché (lecture ouverte). Quand il veut écrire (publier un conteneur, poster, modifier une campagne), l'appel est refusé tant qu'une carte d'écriture identique n'a pas été cliquée dans l'écran central. Après le clic, un seul appel identique passe ; le suivant redemande.

**Why this priority**: c'est la garantie qui rend les connecteurs acceptables pour un non-dev (SC-005 de 009). Sans elle, brancher un outil revient à donner à un agent le droit d'agir au nom de la personne.

**Independent Test**: test Python pur sur le connecteur factice : `mcp__factice__ecrire` sans carte, refus ; carte cliquée, arguments identiques, accord une fois ; second appel, refus ; arguments différents, refus ; `mcp__factice__lire`, aucune décision (lecture ouverte) ; lecture fermée, refus.

**Acceptance Scenarios**:

1. **Given** le connecteur factice avec écriture ouverte, **When** un agent appelle `mcp__factice__ecrire` sans carte, **Then** la garde rend `deny` avec la commande qui prépare la carte, et rien n'est écrit.
2. **Given** une carte `outil:factice:ecrire` cliquée, **When** l'agent appelle l'outil avec exactement les arguments de la carte, **Then** la garde autorise cet appel, marque la carte utilisée, et refuse un second appel.
3. **Given** une carte cliquée, **When** les arguments diffèrent d'un caractère, **Then** refus.
4. **Given** l'écriture du connecteur fermée (absent de `connecteurs.ecriture`), **When** une carte est demandée, **Then** `agence draft new` la refuse avec une phrase qui nomme le connecteur et le réglage.
5. **Given** un outil du serveur `factice` qui n'est ni dans `lecture` ni dans `ecriture`, **When** il est appelé, **Then** il est traité comme une écriture (échec fermé).
6. **Given** un serveur MCP qu'aucun connecteur ne déclare, **When** un agent l'appelle, **Then** la garde ne décide rien (comportement actuel, hors du périmètre de l'agence).

---

### User Story 2 - Un métier se déclare et se choisit sans ligne de commande (Priority: P1)

Une personne ouvre l'agence sur un nouveau workspace. Parmi les premières questions (spec 008), « Quel est votre métier ? » propose les métiers du catalogue. Elle choisit ; ses connecteurs s'ouvrent en lecture, aucun en écriture. Dans le formulaire du panneau, deux réglages listent ses connecteurs par leur nom : « Outils que les agents peuvent lire » et « Outils où les agents peuvent préparer une écriture ». Elle coche ce qu'elle veut. Elle ne voit ni JSON ni nom d'outil MCP.

**Why this priority**: FR-010 de 009 (« les questions d'installation posent les règles sans ligne de commande ») et préalable de G3 : le cobaye ne tape aucune commande.

**Independent Test**: test Python : `agence pratiques show --json` sur un faux HOME rend `metier`, `connecteurs.lecture`, `connecteurs.ecriture` avec leurs choix tirés des catalogues et la source ; une écriture ouverte hors des connecteurs du métier est refusée par une cohérence. Le formulaire et les questions sont ceux de 008 (aucun code TypeScript propre à 012).

**Acceptance Scenarios**:

1. **Given** un dépôt sans fichier du projet, **When** les premières questions s'affichent, **Then** la question du métier est la première, avec les métiers du catalogue par leur nom ; la question de `tests` n'est plus posée et il y a 4 questions au total (008 SC-006, Q4).
2. **Given** le métier `media-planner` choisi, **When** le formulaire s'ouvre, **Then** « Outils que les agents peuvent lire » liste ses connecteurs, tous cochés, et « préparer une écriture » n'en coche aucun.
3. **Given** `connecteurs.ecriture` qui contient un connecteur hors du métier, **When** la politique est validée, **Then** refus avec une phrase qui cite le nom du connecteur et du métier.
4. **Given** un fichier `metiers.json` ou `connecteurs.json` qui contient une valeur qui ressemble à un secret (`ghp_`, `sk-`, `AKIA`, `-----BEGIN`), **When** le test du catalogue tourne, **Then** il échoue en nommant la ligne, jamais la valeur.

---

### User Story 3 - Le data manager prouve qu'un pixel respecte le consentement (Priority: P2)

Scénario cible de 009 US3, joué sur connecteurs factices. Le métier `data-manager` déclare : connecteurs tag manager, analytics, bannière de consentement (lecture) ; panneaux : le site en navigateur, un panneau perso « tags présents contre attendus » ; validateur : `capture-reseau` (fichier) ; recette : audit hebdomadaire par script. Une tâche « le pixel ne part qu'après consentement » ne passe à `faite` qu'avec la capture réseau attachée ; la publication du conteneur exige une carte.

**Why this priority**: premier cas non-dev de 009, validateur technique. Ses connecteurs réels ne sont pas vérifiés (Q5) : le scénario se joue sur fixtures.

**Independent Test**: test Python : besoin créé sous le métier `data-manager` de fixture, `done_when` dérivé `preuve:capture-reseau` ; `need done` sans `--evidence` refusé ; avec un chemin absent ou vide refusé ; avec un fichier non vide accepté, empreinte SHA-256 notée dans le journal du besoin. Publication factice refusée sans carte (US1).

**Acceptance Scenarios**:

1. **Given** une tâche du métier `data-manager`, **When** `agence need done` est lancé sans preuve, **Then** refus : « preuve attendue : capture-reseau (fichier) ».
2. **Given** la sortie de `cate browser network` enregistrée dans un fichier du workspace, **When** elle est donnée en preuve, **Then** la tâche passe à `faite` et le journal porte le chemin et l'empreinte.
3. **Given** une publication de conteneur, **When** la carte n'est pas cliquée, **Then** rien n'est publié (009 US3 scénario 1).

---

### User Story 4 - Le chef de projet marketing finit sur l'accord du client (Priority: P2)

Scénario cible de 009 US4, sur fixtures. Le métier `chef-de-projet` déclare : connecteurs planning, tableur de budget, messagerie (lecture ; écriture de la messagerie par carte) ; validateur : `accord-client` (clic) ; recette : relance après 3 jours sans réponse. Le mail part au clic sur la carte ; la tâche passe à `faite` quand l'humain clique « Validé par le client » sur la carte de preuve.

**Why this priority**: second cas de 009, validateur par accord humain : il prouve que le validateur n'est pas toujours une machine.

**Independent Test**: test Python : `done_when` dérivé `preuve:accord-client` ; la carte de preuve est une question `agence ask` à deux options ; la tâche reste ouverte tant que l'option « Validé par le client » n'est pas cliquée ; elle se ferme sur ce clic.

**Acceptance Scenarios**:

1. **Given** un brouillon de mail non cliqué, **When** l'agent tente l'envoi, **Then** refus (garde existante, `agence.py:2476-2524`).
2. **Given** la carte de preuve `accord-client`, **When** l'humain répond « Pas encore », **Then** la tâche reste ouverte et son suivi dit « accord du client attendu ».

---

### User Story 5 - Le bon accès pour chaque outil, le navigateur en dernier (Priority: P3)

Pour chaque connecteur du métier choisi, `agence connecteur check` dit en une ligne comment il est branché : MCP branché, MCP à installer, API (variable du secret présente ou non, jamais sa valeur), navigateur (« dernier recours, lecture seule »). `agence doctor --prerequis` en reprend les manques.

**Why this priority**: l'ordre de choix (009 US5) se décide en code pour la partie déterministe (FR-005 de 009) : ce qui est branché se lit, ne se devine pas.

**Independent Test**: test Python avec un faux `claude` sur le PATH dont `mcp list` rend un serveur `factice` connecté : `check` rend `mcp branché` pour `factice`, `mcp absent` pour un autre ; un connecteur `api` dont la variable est absente rend `secret absent : <NOM>` ; la valeur d'une variable présente n'apparaît dans aucune sortie.

**Acceptance Scenarios**:

1. **Given** un connecteur `navigateur`, **When** `check` tourne, **Then** la ligne dit « navigateur, dernier recours, lecture seule ».
2. **Given** `GTM_FACTICE=valeur-sentinelle` dans l'environnement, **When** `check`, `show`, `brief` et le tour du régisseur tournent, **Then** `valeur-sentinelle` n'apparaît ni dans leurs sorties ni dans `state.json`.

---

### Edge Cases

- Métier absent du catalogue (fichier du projet édité à la main) : refus de la politique, bannière de 005-L5, valeurs de `neutre` (métier `dev`).
- Métier `dev` (défaut) : aucun connecteur, validateur = `preuve` de 005 inchangée ; aucun comportement actuel ne change.
- Deux cartes d'écriture identiques cliquées : chacune autorise un appel, pas plus.
- Carte cliquée puis connecteur fermé en écriture avant l'appel : refus (la garde relit la politique).
- Arguments d'outil avec un ordre de clés différent : comparés après sérialisation canonique (clés triées), donc égaux.
- Serveur MCP renommé par la personne : le connecteur ne le voit plus, `check` dit « mcp absent » ; aucune écriture ne passe sans être déclarée.
- Entrée de hook absente pour un serveur déclaré (connecteur ajouté après `agence hooks install`) : `agence hooks status` rend `partiel` et `doctor` le dit ; l'humain relance `agence hooks install`.
- Preuve `fichier` hors du workspace ou lien symbolique : refusée.
- Tâche d'un métier lancée sans validateur défini : impossible, le schéma du catalogue exige au moins une preuve (009, Edge Cases).
- Cobaye sur un poste distant : les catalogues et la garde tournent sur la machine du runtime ; la carte s'affiche sur tout client du panneau agence.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `tools/agence/connecteurs.json` et `tools/agence/metiers.json` MUST être des listes d'objets à `id`, livrées dans le runtime (`scripts/agence-files.mjs`), validées par un test qui refuse : un champ manquant, un `acces` hors `mcp|api|navigateur`, un connecteur `api` ou `navigateur` qui déclare `ecriture`, un métier qui cite un connecteur inconnu, un métier sans preuve, une preuve hors `fichier|lien|clic`, toute valeur qui ressemble à un secret (motifs de 007 FR-012).
- **FR-002**: Le schéma de 005 MUST gagner trois clés : `metier` (`parmi` `metiers.json`, défaut `dev`), `connecteurs.lecture` et `connecteurs.ecriture` (listes `parmi` `connecteurs.json` ; défaut : tous les connecteurs du métier en lecture, aucun en écriture), avec les champs de 008 FR-001 (`nom`, `explique`, `choix`, `groupe`, `portee`, et `question` pour `metier`). Une cohérence MUST refuser un connecteur de `connecteurs.lecture` ou `connecteurs.ecriture` hors du métier.
- **FR-003**: La garde `send` MUST traiter tout outil `mcp__<serveur>__<outil>` d'un serveur déclaré par un connecteur : outil de `lecture` et connecteur dans `connecteurs.lecture` : aucune décision ; outil de `lecture` et connecteur fermé en lecture : `deny` ; tout autre outil de ce serveur : écriture, `deny` sauf carte cliquée, non utilisée, besoin ouvert, dont la cible est `outil:<connecteur>:<outil>` et le texte égal aux arguments sérialisés de façon canonique. L'accord est unique (la carte est marquée utilisée dans la même transaction, comme `agence.py:2494-2498`).
- **FR-004**: `agence draft new --cible outil:<connecteur>:<outil>` MUST refuser un connecteur inconnu, un outil qui n'est pas une écriture déclarée et un connecteur absent de `connecteurs.ecriture`, et MUST exiger un texte JSON valide. La page du brouillon MUST montrer l'outil par le nom du connecteur et les arguments lisibles.
- **FR-005**: `agence hooks install` MUST poser une entrée `PreToolUse` dont le matcher couvre les serveurs des connecteurs déclarés, en plus des entrées actuelles (`agence.py:2582-2588`) ; `agence hooks status` MUST rendre `partiel` (`garde_statut`, `agence.py:2624-2630`) quand un serveur déclaré n'est pas couvert. Cate ne lance jamais `agence hooks` (CLAUDE.md, « The `cate` API and CLI »).
- **FR-006**: Aucun secret MUST entrer dans `connecteurs.json`, `metiers.json`, la politique, un brief, `state.json`, un journal ou une sortie de commande. Un connecteur `api` MUST nommer sa variable (`secret.variable`, motif de `envoi.slack.variable`) et au besoin un fichier hors dépôt (`secret.fichier`) ; la lecture du secret MUST suivre `slack_token` (`agence.py:685-698`) et ne servir qu'au script d'accès.
- **FR-007**: La grammaire de fin de 005-L3 MUST gagner la forme `preuve:<nom>` ; `done_when_defaut` MUST rendre les preuves du validateur du métier quand `metier` n'est pas `dev`, et la règle de 005 sinon. `evaluer` MUST rendre la preuve manquante par son nom et son type.
- **FR-008**: `agence need done <id> --evidence <valeur>` MUST, pour une preuve `fichier`, exiger un fichier régulier non vide sous la racine du workspace (ni lien symbolique, ni `..`) et noter son chemin et son SHA-256 au journal du besoin ; pour `lien`, une URL `https://` ; pour `clic`, refuser `--evidence` : seule la réponse de l'humain à la carte de preuve (`agence ask`) ferme la condition.
- **FR-009**: `agence connecteur check [--json]` MUST dire, pour chaque connecteur du métier actif, son accès (`mcp branché`, `mcp absent`, `api`, `navigateur`), la présence de la variable du secret (jamais sa valeur) et ses droits ; l'état MCP vient de `claude mcp list` (faux exécutable dans les tests). `agence doctor --prerequis` MUST reprendre les manques en `info`, jamais en bloquant pour le métier `dev`.
- **FR-010**: Un métier MUST déclarer ses panneaux (URL d'un panneau navigateur, ou `id` d'un panneau perso de 007) ; le skill `metier` MUST dire à l'orchestrateur de les ouvrir au lancement d'une fiche du métier. Aucun panneau n'est créé par un code nouveau de `src/`.
- **FR-011**: Un métier MUST déclarer ses recettes (`nom`, `declencheur`, `action`, `preuve`) ; le catalogue les valide. Leur exécution relève de la spec 003 (couche 4) et MUST attendre G3 (009 FR-012).
- **FR-012**: Le skill `metier` (`skills/metier/SKILL.md`) MUST décrire : l'ordre de choix d'un accès, la façon de décrire un métier avec la personne (quatre éléments), la carte d'écriture, l'interdiction de lire ou recopier un secret ; il MUST renvoyer à `agence connecteur check` et `agence pratiques show` au lieu de recopier leurs valeurs.
- **FR-013**: Écart avec upstream (009 FR-013) : 0 fichier modifié sous `src/` par cette spec ; tout vit dans `tools/agence/`, `skills/`, `scripts/agence-files.mjs` et `docs/architecture.md` (§ panneau agence).
- **FR-014**: Chaque lot MUST commencer par ses tests vus rouges (constitution VI) ; aucun agent ne lance de fenêtre, d'e2e ni l'app (constitution X) ; la recette de G3 est jouée par le cobaye et observée par Heifara.

### Key Entities

- **Connecteur** : `{id, nom, explique, acces, serveur?, lecture: [outil], ecriture: [outil], secret?: {variable, fichier?}, panneau?}`.
- **Métier** : `{id, nom, explique, connecteurs: [id], panneaux: [{type: navigateur|perso, cible}], validateur: [{nom, type, explique}], recettes: [{nom, declencheur, action, preuve}]}`.
- **Carte d'écriture** : brouillon existant (`st['drafts']`) avec `cible: "outil:<connecteur>:<outil>"`, `texte`: JSON canonique des arguments.
- **Clés de politique** : `metier`, `connecteurs.lecture`, `connecteurs.ecriture`.

## Connecteurs à vérifier (Q5 de 009)

Rien ci-dessous n'est affirmé : c'est la liste de contrôle du lot 0 (T001 à T003 de `tasks.md`). Pour chaque outil : existe-t-il un MCP officiel ou maintenu, sinon une API officielle ; outils de lecture et d'écriture séparables ; authentification (OAuth du client MCP, jeton, compte de service) ; coût ; un environnement de test (conteneur ou compte bac à sable) pour la recette.

| Métier | Outil à vérifier | Ce qu'il faut savoir | État |
|---|---|---|---|
| data manager | gestionnaire de balises (tag manager) | MCP ou API ; lecture de l'espace de travail et des balises séparée de la publication d'une version | non vérifié |
| data manager | analytics | lecture des événements reçus (temps réel ou différé) ; délai d'arrivée d'un événement | non vérifié |
| data manager | outil de test A/B | lecture des tests actifs ; écriture séparée | non vérifié |
| data manager | bannière de consentement | **produit exact inconnu** (009 Q5) ; à nommer par le cobaye ou Heifara avant toute recherche | non vérifié |
| data manager | régies publicitaires | lecture des pixels et conversions | non vérifié |
| media planner (cobaye, Q4) | régies (budgets, dépenses, diffusion) | lecture seule suffit-elle à son validateur chiffré ? Un serveur `mcp-dsp` (outils `dsp_fetch_*`) apparaît dans la liste d'outils de la session du 2026-11-20 de ce poste : périmètre, droits et propriétaire **non vérifiés** | non vérifié |
| chef de projet | planning, tableur de budget, messagerie | outil exact du cobaye ; la messagerie (Slack, mail) a déjà sa carte d'envoi (`agence.py:59-60`) | partiellement existant |

## Success Criteria *(mandatory)*

- **SC-001**: (SC-005 de 009) sur le connecteur factice, 100 % des appels d'écriture sans carte cliquée identique sont refusés : sans carte, carte non cliquée, carte utilisée, arguments différents, outil non déclaré, écriture fermée (6 cas, test Python).
- **SC-002**: un métier se choisit et ses droits se règlent sans terminal : les trois clés apparaissent dans `champs` publiés (008 FR-003) avec des libellés, 0 nom d'outil MCP ni clé technique visible (test Python sur `champs`).
- **SC-003**: une tâche d'un métier non `dev` ne passe jamais à `faite` sans chacune de ses preuves nommées (test sur les deux métiers de fixture, chaque type de preuve).
- **SC-004**: (SC-004 de 009, porté par G3) le cobaye finit sa tâche de référence, preuve attachée, 0 intervention de Heifara notée.
- **SC-005**: 0 occurrence d'une valeur de secret sentinelle dans les sorties de `check`, `show`, `brief`, `state.json` et le journal (test).
- **SC-006**: `git diff --stat origin/main -- src` vide sur chaque PR de cette spec.
- **SC-007**: coût de service : 0 € par mois côté Cate (aucun service ajouté) ; coût des outils du cobaye : non chiffré, relevé au lot 0. Calculs de droits et de preuves : 0 jeton (code pur).

## Assumptions

- 005-L3 (preuve de fin) est mergé avant le lot 3 de cette spec ; 008-L1, L3 et L4 avant le lot 4 (formulaire et questions).
- G2 est passée avant le premier lot (009 `plan.md`, H1) ; seul le lot 0 (recherche, lecture seule) peut commencer plus tôt si Heifara le veut.
- Le client MCP est Claude Code ; ses hooks `PreToolUse` voient le nom complet `mcp__<serveur>__<outil>` et les arguments (motif déjà utilisé, `agence.py:2582-2583`).
- Le cobaye travaille sur le Mac de Heifara ou un poste macOS Apple silicon (constitution VIII).

## Questions ouvertes

Chacune a une hypothèse de travail ; aucune ne bloque le plan.

- **Q1. Connecteur propre à un projet** (outil d'un seul client) : hypothèse : hors v1 ; un connecteur s'ajoute au catalogue par une PR. À rouvrir quand un cobaye en a besoin.
- **Q2. Écriture par API ou navigateur** : hypothèse : non en v1 (lecture seule, action « à faire par l'humain »). Une écriture par API demanderait un exécuteur côté régisseur par connecteur, comme `send_slack` (`agence.py:718-732`).
- **Q3. Coffre** : hypothèse : variable d'environnement et fichier `.env` hors dépôt en v1 ; un gestionnaire de mots de passe se branche plus tard comme connecteur, en lecture, sans que sa valeur entre dans un contexte d'agent.
- **Q4. Nombre de premières questions** : 008 SC-006 en prévoit 4 au plus (008 Q7 : `livraison.mode`, `tests`, `verification`, `agents.max`). Tranché : la question du métier **remplace celle de `tests`**, la seule des quatre qui ne parle qu'au dev (un media planner n'a pas de tests rouges) ; `tests` perd son champ `question`, reste dans le formulaire (groupe essentiel) avec la valeur du preset. Premières questions : `metier`, `livraison.mode`, `verification`, `agents.max`, soit 4 ; la spec 008 reste inchangée.
- **Q5. Surcharge du validateur par projet** : hypothèse : non en v1 ; le métier fixe le validateur, la clé `preuve` de 005 ne vaut que pour `dev`.
- **Q6. Cobaye et tâche de référence** : hypothèse 009 Q4 (media planner). Heifara tranche (009 T041) ; son métier entre au catalogue au lot 5.
- **Q7. Matcher des hooks** : hypothèse : un matcher généré depuis les serveurs déclarés (pas `mcp__.*`), pour ne lancer la garde que sur les serveurs connus ; coût d'un démarrage de la garde par appel : non mesuré.
