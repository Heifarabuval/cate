---

description: "Tâches : connecteurs et métiers, couche 3 de la vision v2 (spec 012)"
---

# Tasks: Connecteurs et métiers

**Input**: `specs/012-connecteurs-metiers/` (spec.md, plan.md) ; `specs/009-vision-v2/tasks.md` (S3, C3, G3).

**Prerequisites**: plan.md, spec.md. Tests exigés par la constitution (VI) : chaque tâche de test vient avant sa tâche de code et doit être vue **rouge** pour la bonne raison (sortie citée). Tout test qui écrit tourne en faux HOME et dossier temporaire ; `claude`, `cate` et `gh` se simulent par un faux exécutable sur le PATH.

**Interdits à tout agent** (constitution X) : lancer Playwright, Electron, l'app Cate ou `npm run dev`, ouvrir une fenêtre, lancer `npm ci` ou `npm install`, écrire dans le vrai `~/.cate`, `~/.claude` ou `~/.config`, lancer `agence hooks`, appeler un outil d'écriture d'un vrai connecteur, lire ou recopier la valeur d'un secret, jouer la recette ou G3 à la place de l'humain, merger, pousser.

**État** : spec écrite, aucune tâche commencée. Q1 à Q7 de la spec ouvertes avec hypothèse ; aucune ne bloque le lot 1. Gel (009 `plan.md`, H1) : seul le lot 0 peut partir avant G2.

## Format: `- [ ] ID [P] [H] [US] Description avec chemin`

- **[P]** : parallélisable (autre fichier, aucune dépendance non finie). **[H]** : action de Heifara ou du cobaye, jamais d'un agent. **[US1] à [US5]** : récit de la spec.
- **Modèle** conseillé : haiku (mécanique), sonnet (implémentation courante), opus (garde, sérialisation canonique, preuves : une erreur ouvre une écriture ou ferme une tâche à tort).
- Un implémenteur par lot, un worktree par agent, un vérificateur différent de l'implémenteur. Une tâche se coche sur preuve (sortie de commande, `chemin:ligne`, commit).
- Portes de chaque PR : `npm run typecheck && npm run lint && npm run lint:deps && npm test && npm run test:agence`, plus `git diff --stat origin/main -- src` vide (SC-006). La PR dit ce qu'elle supprime, l'écart avec upstream (aucun dans `src/`) et s'il faut relancer Cate ou `agence hooks install`.
- Tailles : estimations sans mesure (hypothèse P1 du plan).

## Lots, vue d'ensemble

| Lot | Récits | Taille | Dépend de | Parallélisable avec | Preuve de fin |
|---|---|---|---|---|---|
| **0. Recherche des connecteurs, cobaye** | US5 | 0,5 j agent + 30 min [H] | 009 T041 [H] pour T001 ; rien d'autre (lecture seule) | tous | `research.md` commité, chaque outil classé, sources citées |
| **1. Catalogues et clés de politique** | US2 | 1,5 j | G2 (009) ; 005-L1 (mergé) | 0 | `agence pratiques show --json` rend les trois clés ; un catalogue piégé est refusé |
| **2. Garde des connecteurs, carte d'écriture** | US1, US3, US4 | 1,5 j | 1 | 3 et 4 hors `agence.py` (PR l'une après l'autre) | les 6 cas de SC-001 verts sur le connecteur factice |
| **3. Validateur par métier** | US3, US4 | 1 j | 1 ; 005-L3 mergé | 2 et 4 hors `agence.py` | une tâche de métier ne finit qu'avec ses preuves nommées |
| **4. Accès, secrets, installation** | US2, US5 | 1 j | 1 ; 008-L1, L3, L4 mergés | 2 et 3 hors `agence.py` | `connecteur check` vert sur faux `claude` ; secret sentinelle absent partout |
| **5. Skill et métier du cobaye** | US2, US5 | 1 j | 0, 2, 3, 4 | aucun | métier du cobaye au catalogue, skill avec ses evals |
| **6. Recette avant G3** [H] | tous | 0,5 j agent + 1 h [H] | 5 ; 007-L6 fait | aucun | recette notée par Heifara, contrôle en lecture seule cité |

Ordre sur `tools/agence/agence.py` : L2, L3, L4, une PR ouverte à la fois, après les lots de 008 et 010 déjà dans la file (009 T010).

---

## Lot 0 : recherche des connecteurs et cobaye (US5)

**But** : savoir, sans rien inventer, quels outils du cobaye et du data manager se branchent comment (Q5 de 009, liste « Connecteurs à vérifier » de la spec).

**Tests d'acceptation** : `research.md` répond à chaque ligne de la table « Connecteurs à vérifier » de la spec : accès (MCP branché, MCP existant, API, navigateur), outils de lecture et d'écriture séparés, authentification, coût mensuel, environnement de test ; chaque affirmation a sa source (URL de doc officielle, dépôt, sortie de `claude mcp list` citée) ou est marquée « non vérifié ». Aucune écriture dans un vrai outil.

**Fichiers touchés** : `specs/012-connecteurs-metiers/research.md` (nouveau).

**Dépend de** : 009 T041 [H] pour le périmètre du cobaye. **Parallélisable avec** : tous les lots.

- [ ] T001 [H] Heifara choisit le cobaye et sa tâche de référence (009 T041, Q6 de la spec ; hypothèse : le media planner), et nomme la bannière de consentement du data manager (Q5 de 009). L'agent pose la question par `agence ask` (une option « Recommandé »). Preuve : id de la question et réponse citée dans `research.md`.
- [ ] T002 [P] Outils du cobaye : pour chacun, l'ordre de choix appliqué (MCP déjà branché par `claude mcp list` en lecture, MCP existant cherché sur GitHub et dans la doc de l'éditeur, API officielle, navigateur), le classement de chaque outil MCP en lecture ou écriture, la variable de secret nécessaire (nom seulement). Le serveur `mcp-dsp` vu dans la session du 2026-11-20 se vérifie ici (propriétaire, outils, droits). Taille : 0,25 j. Modèle : sonnet.
- [ ] T003 [P] Outils du data manager (tag manager, analytics, test A/B, bannière, régies) : même grille, en lecture seule. Taille : 0,25 j. Modèle : sonnet.
- [ ] T004 La tâche de référence du cobaye tient-elle en lecture et en cartes (R3 du plan) ? Une phrase, avec la preuve nommée du validateur proposée (`fichier`, `lien` ou `clic`). Preuve : section « Tâche de référence » de `research.md`. Modèle : sonnet.

**Checkpoint lot 0** : `research.md` commité ; aucune ligne « à vérifier » sans source ou mention « non vérifié ».

---

## Lot 1 : catalogues et clés de politique (US2)

**But** : un métier et ses connecteurs se déclarent une fois ; le projet choisit son métier et ses droits par la politique de 005 ; rien ne change encore dans la garde.

**Tests d'acceptation** : `python3 -m unittest tools.agence.test_metiers` vu rouge puis vert ; `npm run test:agence` vert ; en faux HOME, `agence pratiques show --json` rend `metier: dev`, `connecteurs.lecture: []`, `connecteurs.ecriture: []`, source `défaut` ; avec un fichier du projet qui pose le métier de fixture `data-manager`, `connecteurs.lecture` vaut ses connecteurs et `connecteurs.ecriture` reste vide.

**Fichiers touchés** : `tools/agence/connecteurs.json` (nouveau, vide hors `dev`), `tools/agence/metiers.json` (nouveau, `dev`), `tools/agence/metiers.py` (nouveau), `tools/agence/fixtures/metiers/` (nouveau : `connecteurs.json` avec `factice` et les connecteurs de fixture, `metiers.json` avec `data-manager` et `chef-de-projet`), `tools/agence/test_metiers.py` (nouveau), `tools/agence/pratiques.json` (trois clés, une cohérence), `tools/agence/pratiques.py` (cohérence « dans le métier », défaut dérivé, chemin des catalogues injectable pour les fixtures), `tools/agence/test_pratiques.py` (ajouts), `scripts/agence-files.mjs`, `scripts/build-runtime-tarball.test.mjs`, `docs/architecture.md` (§ panneau agence).

**Dépend de** : G2 de 009 (gel H1) ; 005-L1 (mergé). **Parallélisable avec** : lot 0.

### Tests d'abord

- [ ] T010 [P] [US2] `tools/agence/test_metiers.py` : **schéma des catalogues** (FR-001) : un champ manquant ; `acces` hors liste ; `ecriture` sur un connecteur `api` ou `navigateur` ; métier qui cite un connecteur inconnu ; métier sans preuve ; preuve de type inconnu ; `id` en double. Chaque refus nomme le fichier, l'`id` et le champ. Modèle : opus.
- [ ] T011 [P] [US2] `tools/agence/test_metiers.py` : **aucun secret** (FR-001, FR-006) : une valeur `ghp_x`, `sk-x`, `AKIAX`, `-----BEGIN PRIVATE KEY-----` dans n'importe quel champ d'une fixture est refusée, le message nomme le fichier et le champ, jamais la valeur ; les catalogues livrés passent. Modèle : opus.
- [ ] T012 [P] [US2] `tools/agence/test_pratiques.py` : **trois clés** (FR-002) : défauts (`dev`, listes vides) ; `connecteurs.lecture` dérivé du métier quand il n'est pas posé ; cohérence : un connecteur hors du métier dans `lecture` ou `ecriture` est refusé avec le `nom` du connecteur et du métier ; métier inconnu refusé. Modèle : sonnet.
- [ ] T013 [P] `scripts/build-runtime-tarball.test.mjs` : `AGENCE_REQUIRED` contient `agence/metiers.py`, `agence/metiers.json`, `agence/connecteurs.json`. Modèle : haiku.

### Implémentation

- [ ] T014 [US2] `tools/agence/metiers.py` (stdlib seule) : `charger(chemin)`, `valider(catalogue)`, motifs de secret ; fixtures. Rend T010 et T011 verts. Modèle : opus.
- [ ] T015 [US2] `tools/agence/pratiques.json`, `pratiques.py` : trois clés (`parmi`, `pratiques.py:56-60`), cohérence, défaut dérivé ; si 008-L1 est mergé, les champs `nom`, `explique`, `groupe`, `portee`, `question` (`metier` seulement) ; sinon `dit`, et le lot 4 ajoute les champs. Rend T012 vert. Modèle : sonnet.
- [ ] T016 [P] `scripts/agence-files.mjs` (`:9`) : trois fichiers. Rend T013 vert. Modèle : haiku.
- [ ] T017 [P] `docs/architecture.md`, § « The agence panel » : les deux catalogues, les trois clés, qui les écrit. Diff relu. Modèle : haiku.
- [ ] T018 Portes et PR du lot 1. Corps : `Réf. #<issue de l'epic>`, « aucun comportement ne change : la garde ne lit pas encore les catalogues ». Modèle : haiku.

**Checkpoint lot 1** : la politique porte le métier et les droits ; un catalogue faux ou piégé est refusé.

---

## Lot 2 : garde des connecteurs et carte d'écriture (US1, US3, US4)

**But** : SC-005 de 009 : aucune écriture par un connecteur sans carte validée.

**Tests d'acceptation** : `test_connecteurs.py` et `test_guard.py` vus rouges puis verts sur le connecteur factice : les 6 cas de SC-001 de la spec, plus la lecture ouverte (aucune décision), la lecture fermée (`deny`) et un serveur non déclaré (aucune décision) ; `test_hooks.py` : `hooks install` en faux HOME pose l'entrée des serveurs déclarés, `hooks status` rend `partiel` quand un serveur manque.

**Fichiers touchés** : `tools/agence/agence.py` (`CIBLE_RE` `:59-60`, `cmd_draft` `:620-672`, `send_match` `:2451-2464`, `est_envoi` `:2467-2468` remplacée, `guard` `:2476-2524`, `HOOK_ENTREES` `:2582-2588`, `garde_statut` `:2624-2630`), `tools/agence/metiers.py` (classement d'un outil), `tools/agence/test_connecteurs.py` (nouveau), `tools/agence/test_guard.py`, `tools/agence/test_hooks.py`.

**Dépend de** : lot 1. **Parallélisable avec** : lots 3 et 4 pour les fichiers hors `agence.py` ; PR après celle du lot 1, avant celles des lots 3 et 4.

### Tests d'abord

- [ ] T020 [P] [US1] `tools/agence/test_connecteurs.py` : **classement** (pur) : `mcp__factice__lire` = lecture, `mcp__factice__ecrire` = écriture, `mcp__factice__autre` = écriture (échec fermé), `mcp__inconnu__x` = hors périmètre. Modèle : sonnet.
- [ ] T021 [P] [US1] `tools/agence/test_guard.py` : **SC-005** sur l'état de fixture : sans carte, `deny` qui cite `agence draft new --cible outil:factice:ecrire` ; carte `à valider` (non cliquée), `deny` ; carte cliquée et arguments identiques, `allow` puis `deny` au second appel (carte marquée utilisée dans la même transaction) ; arguments différents d'un caractère, `deny` ; ordre des clés différent, `allow` (sérialisation canonique) ; besoin de la carte fermé, `deny` ; écriture fermée entre le clic et l'appel, `deny`. Modèle : opus.
- [ ] T022 [P] [US1] `tools/agence/test_agence.py` ou `test_connecteurs.py` : **`draft new --cible outil:`** (FR-004) : connecteur inconnu, outil de lecture, connecteur hors `connecteurs.ecriture`, texte non JSON : refus code 1 avec une phrase ; cible valide : brouillon créé, texte normalisé. Modèle : sonnet.
- [ ] T023 [P] [US1] `tools/agence/test_hooks.py` : **matcher généré** (FR-005) : `hooks install` pose `mcp__(factice)__.*` en mode `send` avec la sortie `ask` si la garde est introuvable ; les entrées actuelles restent ; catalogue avec un serveur de plus : `hooks status` rend `partiel` ; aucun connecteur MCP : les entrées actuelles seules. Modèle : sonnet.
- [ ] T024 [P] [US3] [US4] `tools/agence/test_guard.py` : **scénarios de 009** sur fixtures : publication du conteneur du data manager refusée sans carte ; envoi du chef de projet par la carte de mail existante inchangé (`ask` sans brouillon, `agence.py:2471-2473`). Modèle : sonnet.

### Implémentation

- [ ] T025 [US1] `tools/agence/metiers.py` : `classer(outil, catalogue)`. Rend T020 vert. Modèle : sonnet.
- [ ] T026 [US1] `tools/agence/agence.py` : `CIBLE_RE` gagne `outil:<id>:<outil>` ; `cmd_draft new` valide (FR-004) ; `send_match` compare l'outil et le JSON canonique ; `guard` en mode `send` : lecture, écriture, `deny` (FR-003) ; `est_envoi` remplacée (coupe nette). Moins de 120 lignes ajoutées (hypothèse). Rend T021, T022, T024 verts. Modèle : opus.
- [ ] T027 [US1] `tools/agence/agence.py` : `HOOK_ENTREES` construit depuis le catalogue ; `garde_statut` compare au matcher attendu. Rend T023 vert. Modèle : sonnet.
- [ ] T028 Portes et PR du lot 2. Corps : code supprimé (`est_envoi`) ; phrase d'action : « après installation, `agence hooks install` pour couvrir les serveurs déclarés ». Modèle : haiku.

**Checkpoint lot 2** : sur le connecteur factice, aucune écriture ne passe sans carte cliquée identique ; une carte vaut un appel.

---

## Lot 3 : validateur par métier (US3, US4)

**But** : FR-008 de 009 : une tâche d'un métier ne passe à `faite` qu'avec ses preuves nommées.

**Tests d'acceptation** : `test_preuve.py` (de 005-L3) étendu, vu rouge puis vert : `preuve:capture-reseau` (fichier) et `preuve:accord-client` (clic) sur les métiers de fixture ; sous le métier `dev`, les tests de 005-L3 passent sans changement.

**Fichiers touchés** : `tools/agence/pratiques.py` (`FORMES`, `CONDITION_RE`, `done_when_defaut`, `evaluer`, `MANQUE`), `tools/agence/metiers.py` (preuves d'un métier, contrôle d'un fichier ou d'un lien), `tools/agence/agence.py` (`need done --evidence`, `:596` et suivantes ; fermeture sur la réponse d'une carte de preuve), `tools/agence/test_preuve.py`.

**Dépend de** : lot 1 ; 005-L3 mergé (`feat/preuve-politique` `1927a1d6`) ; PR après celle du lot 2 sur `agence.py`. **Parallélisable avec** : lots 2 et 4 hors `agence.py`.

### Tests d'abord

- [ ] T030 [P] [US3] `tools/agence/test_preuve.py` : **grammaire** : `preuve:capture-reseau` valide ; `preuve:` sans nom, nom inconnu du métier actif : refus qui liste les preuves du métier. Modèle : sonnet.
- [ ] T031 [P] [US3] `tools/agence/test_preuve.py` : **dérivation** (FR-007) : métier `data-manager` : `done_when_defaut` rend `preuve:capture-reseau` ; métier `dev` : règle de 005 inchangée ; `--done-when` explicite valide l'emporte. Modèle : sonnet.
- [ ] T032 [P] [US3] `tools/agence/test_preuve.py` : **preuve fichier** (FR-008) : sans `--evidence`, refus « preuve attendue : capture-reseau (fichier) » ; chemin absent, vide, répertoire, lien symbolique, hors racine, avec `..` : refus ; fichier non vide : fait, chemin et SHA-256 au journal du besoin. Lien : `http://` refusé, `https://` accepté. Modèle : opus.
- [ ] T033 [P] [US4] `tools/agence/test_preuve.py` : **preuve clic** : `--evidence` refusé ; la carte de preuve (`agence ask`, options « Validé par le client » et « Pas encore ») : « Pas encore » laisse la tâche ouverte avec « accord du client attendu » au suivi ; « Validé » la ferme. Modèle : opus.

### Implémentation

- [ ] T034 [US3] `tools/agence/pratiques.py`, `metiers.py` : forme `preuve:`, dérivation, contrôle des preuves. Rend T030 à T032 verts. Modèle : opus.
- [ ] T035 [US4] `tools/agence/agence.py` : `need done` et fermeture sur la carte de preuve. Rend T033 vert. Modèle : opus.
- [ ] T036 Portes et PR du lot 3. Modèle : haiku.

**Checkpoint lot 3** : une tâche du data manager ne finit qu'avec sa capture ; une tâche du chef de projet ne finit que sur le clic « Validé par le client ».

---

## Lot 4 : accès, secrets, installation (US2, US5)

**But** : l'ordre de choix se lit en code ; les secrets restent des références ; le métier et les droits se posent sans ligne de commande (FR-010 de 009).

**Tests d'acceptation** : `test_connecteurs.py` vu rouge puis vert avec un faux `claude` ; secret sentinelle absent de toutes les sorties (SC-005 de la spec) ; `test_pratiques.py` : `champs` publiés (008 FR-003) portent les trois clés avec leurs libellés et `question` pour `metier` ; `test_doctor.py` : point `connecteurs`.

**Fichiers touchés** : `tools/agence/agence.py` (sous-commande `connecteur check`, `prerequis` `:1892`, `slack_token` `:685-698` devenu un appel de la lecture de secret commune), `tools/agence/metiers.py` (`secret(connecteur)`), `tools/agence/pratiques.json` (champs de 008 si le lot 1 a posé `dit`), `tools/agence/test_connecteurs.py`, `tools/agence/test_doctor.py`, `tools/agence/test_pratiques.py`, `tools/agence/test_retrait.py` (jeton Slack, inchangé dans son comportement).

**Dépend de** : lot 1 ; 008-L1, L3, L4 mergés ; PR après celle du lot 3 sur `agence.py`. **Parallélisable avec** : lots 2 et 3 hors `agence.py`.

### Tests d'abord

- [ ] T040 [P] [US5] `tools/agence/test_connecteurs.py` : **`connecteur check`** (FR-009) : faux `claude mcp list` (format figé d'après une sortie réelle citée, hypothèse P3) : `factice` connecté, `mcp branché` ; absent, `mcp absent` ; connecteur `api` sans variable, `secret absent : <NOM>` ; connecteur `navigateur`, « dernier recours, lecture seule » ; `--json` rend les mêmes faits. Modèle : sonnet.
- [ ] T041 [P] [US5] `tools/agence/test_connecteurs.py` : **secret sentinelle** (FR-006) : `GTM_FACTICE=valeur-sentinelle` : absente de `check`, `pratiques show`, `pratiques brief`, `state.json` après un tour, journal ; le jeton Slack suit la même fonction (tests de 005-L2 verts sans changement). Modèle : opus.
- [ ] T042 [P] [US2] `tools/agence/test_pratiques.py` : **installation** : `champs` portent `metier` (groupe essentiel, `question`, choix = noms des métiers), `connecteurs.lecture` et `connecteurs.ecriture` (choix = noms des connecteurs du métier, jamais un nom d'outil MCP) ; la question `metier` vient en premier des premières questions ; `tests` ne porte plus de `question` ; les premières questions sont 4 : `metier`, `livraison.mode`, `verification`, `agents.max` (008 SC-006, Q4 de la spec). Modèle : sonnet.
- [ ] T043 [P] `tools/agence/test_doctor.py` : point `connecteurs` : `info` par manque, jamais bloquant ; absent sous `dev`. Modèle : haiku.

### Implémentation

- [ ] T044 [US5] `tools/agence/metiers.py`, `agence.py` : `secret()`, `connecteur check`, `slack_token` par `secret()`. Rend T040 et T041 verts. Modèle : opus.
- [ ] T045 [US2] `tools/agence/pratiques.json` : champs de 008 sur les trois clés, `metier` en tête des essentiels, champ `question` retiré de `tests` (Q4). Rend T042 vert. Modèle : sonnet.
- [ ] T046 `tools/agence/agence.py` : point `connecteurs` de `prerequis`. Rend T043 vert. Modèle : sonnet.
- [ ] T047 Portes et PR du lot 4. Corps : Q4 de la spec (la question `metier` remplace celle de `tests`, 4 premières questions, 008 SC-006 tenu). Modèle : haiku.

**Checkpoint lot 4** : un dépôt neuf demande le métier en premier ; `connecteur check` dit l'accès de chaque outil sans jamais montrer un secret.

---

## Lot 5 : skill et métier du cobaye (US2, US5)

**But** : le cobaye a son métier au catalogue ; tout agent sait décrire un métier et préparer une carte d'écriture.

**Tests d'acceptation** : `test_metiers.py` vert sur le catalogue livré (métier du cobaye inclus) ; `skills/metier/evals.json` : au moins 3 cas (décrire un métier en quatre éléments ; refuser de recopier un secret ; écrire par une carte, jamais par un appel direct) ; `python3 ~/.claude/setup/check.py` hors périmètre (le skill vit dans le dépôt) ; le skill ne recopie aucune valeur de `connecteurs.json` (test : aucun `id` de connecteur dans `SKILL.md`).

**Fichiers touchés** : `tools/agence/connecteurs.json`, `tools/agence/metiers.json` (entrées du cobaye, d'après `research.md`), `skills/metier/SKILL.md` (nouveau), `skills/metier/evals.json` (nouveau), `tools/agence/test_metiers.py` (test du skill).

**Dépend de** : lots 0, 2, 3, 4. **Parallélisable avec** : aucun.

- [ ] T050 [P] `tools/agence/test_metiers.py` : le skill cite `agence connecteur check`, `agence pratiques show` et la cible `outil:` ; aucun `id` du catalogue ni nom de variable de secret dans `SKILL.md`. Modèle : haiku.
- [ ] T051 [US2] `tools/agence/connecteurs.json`, `metiers.json` : métier du cobaye (connecteurs classés par T002, panneaux, preuve de T004, recette déclarée). Rend le test du catalogue vert. Modèle : sonnet.
- [ ] T052 [US5] `skills/metier/SKILL.md`, `evals.json` (FR-012) : ordre de choix, quatre éléments, carte d'écriture, secrets, ouverture des panneaux du métier au lancement d'une fiche. Rend T050 vert. Modèle : sonnet.
- [ ] T053 Portes et PR du lot 5. Modèle : haiku.

**Checkpoint lot 5** : `agence pratiques set metier <cobaye>` (fait par l'humain) ouvre ses connecteurs en lecture ; le skill est chargé par l'orchestrateur.

---

## Lot 6 : recette avant G3 [H]

**But** : vérifier à l'écran, avec Heifara, ce que les tests ne voient pas (vraie carte, vrai MCP en lecture), avant de faire venir le cobaye.

**Tests d'acceptation** : recette notée par Heifara ; contrôle de l'agent en lecture seule, sorties citées.

**Fichiers touchés** : aucun (compte rendu dans la PR ou le besoin).

**Dépend de** : lot 5 ; 007-L6 fait (panneaux perso vus à l'écran). **Parallélisable avec** : aucun.

- [ ] T060 [H] Heifara relance `agence hooks install`, choisit le métier du cobaye dans les premières questions d'un dépôt de test, ouvre l'écriture d'un connecteur, valide une carte d'écriture réelle sans effet de bord (outil de bac à sable relevé au lot 0) et vérifie qu'un appel non validé est refusé. Taille : 1 h [H].
- [ ] T061 L'agent contrôle en lecture seule : `agence hooks status` (`actif`), `agence pratiques show --json` (trois clés, source `projet`), `agence connecteur check`, état de la carte (`utilisée`), journal du besoin. Note le cas R1 du plan (arguments réels contre carte). Preuve : sorties citées. Taille : 0,5 j. Modèle : sonnet.

**Checkpoint lot 6** : la recette passe ; G3 peut être jouée (009 T050, T051).

---

## Dépendances et parallélisme

- Lot 0 à tout moment (lecture seule), T001 dès que Heifara répond.
- Lot 1 après G2 (gel H1 de 009), seul : il crée les catalogues que les autres lisent.
- Ensuite lots 2, 3, 4 en parallèle pour leurs fichiers propres ; une PR à la fois sur `agence.py` (L2, L3, L4) et sur `pratiques.json` (L1, L4).
- Lot 5 après 0, 2, 3, 4 ; lot 6 après 5.
- **Avec les autres specs** : 005-L3 avant le lot 3 ; 008-L1, L3, L4 avant le lot 4 ; 007 lots 3 à 6 en parallèle (aucun fichier commun) ; file de `agence.py` tenue par 009 T010.

## Couverture de la spec 009

| 009 | Couvert par | Note |
|---|---|---|
| FR-008 (validateur par métier, preuve nommée) | lot 3 (T030 à T035) ; catalogue (T010 : un métier sans preuve est refusé) | |
| FR-009 (droits lecture et écriture, validation centrale, aucun secret) | lot 1 (T012, T011), lot 2 (T020 à T027), lot 4 (T041, T044) | écriture par API ou navigateur : hors v1 (Q2) |
| FR-010 (règles générales et par projet, sans ligne de commande) | lot 4 (T042, T045) sur le formulaire et les questions de 008 | deux niveaux de règles : 005 et 008 ; ici seulement les trois clés du métier |
| FR-013 (coupes nettes, écart minimal) | toutes les PR : `git diff --stat origin/main -- src` vide ; `est_envoi` supprimée (T026) | |
| SC-004 (un non-dev finit une tâche, preuve attachée) | lot 6 (préparation) ; G3 : 009 T050 [H], T051 | renvoyé à 009 G3 |
| SC-005 (aucune écriture sans carte, connecteur factice) | lot 2 (T021) | |
| US3 (data manager) | T024, T031, T032 sur fixtures ; connecteurs réels : lot 0 (T003) | audit hebdomadaire : recette déclarée, exécution 003 (couche 4) |
| US4 (chef de projet) | T024, T033 sur fixtures | relance à 3 jours : recette déclarée, exécution 003 |
| US5 (ordre de choix, droits, coffre) | lot 4 (T040), lot 2 | coffre : Q3 |
| FR-005 (détections en code) | T020, T040 (classement, accès en code pur) | |
| FR-007 (lentilles éditables par métier) | renvoyé à 010 (lot 8) | hors de cette spec |
| FR-011 (optimisation mesurée) | renvoyé à 011 | |
| FR-012 (gate par couche) | gel : lot 1 après G2 ; lot 6 avant G3 | |
| FR-014 (aucune fenêtre) | interdits ci-dessus ; recette et G3 jouées par l'humain | |
| Q4 (cobaye) | T001 [H] (009 T041) | hypothèse : media planner |
| Q5 (connecteurs du data manager) | T003 | non vérifié jusqu'au lot 0 |

## Couverture de la spec 012

| FR | Tâches |
|---|---|
| FR-001 | T010, T011, T014 |
| FR-002 | T012, T015 |
| FR-003 | T020, T021, T025, T026 |
| FR-004 | T022, T026 |
| FR-005 | T023, T027 |
| FR-006 | T011, T041, T044 |
| FR-007 | T031, T034 |
| FR-008 | T032, T033, T034, T035 |
| FR-009 | T040, T043, T044, T046 |
| FR-010 | T051, T052 (skill : ouverture des panneaux) |
| FR-011 | T010 (recettes validées), exécution : spec 003 |
| FR-012 | T050, T052 |
| FR-013 | portes de chaque PR (SC-006) |
| FR-014 | interdits, lot 6, G3 |

## Stratégie

MVP de la spec : lots 1 et 2 (le métier existe et aucune écriture ne passe sans carte : SC-005 de 009). Le lot 3 rend « fini » propre au métier ; le lot 4 rend l'installation possible sans terminal ; le lot 5 amène le cobaye ; le lot 6 prépare G3. Total : 7 j agent + 1 h 30 [H] hors G3 (somme des tailles ci-dessus, hypothèse P1). Chaque lot est livrable seul : sans le lot 3, une tâche de métier garde la preuve de 005 ; sans le lot 4, le métier se règle par `agence pratiques set`.
