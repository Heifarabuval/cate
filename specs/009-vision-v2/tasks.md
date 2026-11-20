---

description: "Tâches : vision v2, lots transverses, gates des quatre couches et couverture (spec 009)"
---

# Tasks: Vision v2 (lots transverses et gates)

**Input**: `specs/009-vision-v2/` (spec.md, plan.md) ; `tasks.md` des specs 003 à 008 sur `origin/main` `fd91eb8c` ; `specs/010-interlocuteur/tasks.md` (branche `docs/spec-010-interlocuteur` `76d7b3bc`) ; `specs/011-mesure-benchmark/tasks.md` (branche `docs/spec-011-mesure-benchmark` `d77c191d`).

**Prerequisites**: plan.md. Cette liste ne réécrit aucune tâche d'une spec fille : un sous-lot renvoie à son `tasks.md`, qui garde ses tests d'abord (constitution VI), ses fichiers et son modèle conseillé.

**Interdits à tout agent** (constitution X) : lancer Playwright, Electron, l'app Cate ou `npm run dev`, ouvrir une fenêtre, lancer `npm ci` ou `npm install`, écrire dans le vrai `~/.cate`, `~/.claude` ou `~/.config`, jouer un rejeu ou une recette de gate à la place de l'humain, modifier `seuil.json` après son commit, merger, pousser.

**État** : plan écrit, aucune tâche commencée. Hypothèses H1 à H6 (plan.md) à confirmer par Heifara (T001) ; aucune ne bloque la vague 1.

## Format: `- [ ] ID [P] [H] Description`

- **[P]** : parallélisable (autre fichier, aucune dépendance non finie). **[H]** : action de Heifara (ou d'un cobaye), jamais d'un agent.
- `005-L3` = spec 005, lot 3. Un ID nu (`T040`) désigne une tâche de 009 ; une tâche d'une autre spec porte toujours son numéro de spec (`011 T040`, `T040 de 011`). **J** : jour d'agent compté depuis le lancement de la vague 1 ; les tailles viennent des `tasks.md` des specs, aucune n'est mesurée.
- Un implémenteur par lot, un worktree par agent, un vérificateur différent de l'implémenteur, qui prend la place de l'implémenteur à sa fermeture. Une tâche se coche sur preuve (sortie citée, `chemin:ligne`, commit).

## Lots, vue d'ensemble

| Lot | Contenu | Dépend de | Taille | Preuve de fin |
|---|---|---|---|---|
| **L0. Remise à niveau** | H1 à H6, lots déjà commités (005-L3, 007-L3) | rien | 1,25 j agent + 15 min [H] (hypothèse) | T001 coché ; 005-L3 et 007-L3 mergés sur `origin/main` (commits cités) |
| **C1. Couche 1, noyau** | 010 lots 1 à 7 et 9 ; 011 lots 1 à 4 et 6 ; 005-L4 ; 006 lots 2 à 4 ; 004 lots 3 à 5 et X | L0 (005-L3 pour 010-L4) | 20,5 j agent (somme), 6 j sur le chemin critique jusqu'à la fin de 010-L5 (dont 0,5 j d'attente de la sonde 006-L2), 6,5 j avec 010-L9 | sous-lots ci-dessous mergés, chacun avec son checkpoint ; `010-L9` fait |
| **G1. Gate couche 1** [H] | 011-L5 (campagne), verdict | C1 : 010 lots 1 à 5 et 9, 011 lots 1 à 4 | 0,5 j agent + 10 à 30 h [H] (hypothèse 011) | `rapport-benchmark.md` commité, verdict « passe » contre `seuil.json` commité avant le premier rejeu |
| **C2. Couche 2, règles** | 008 lots 1 à 4 | G1 passée (H1) ; 005-L4 ; 004 sur `declencheurs.json` | 4 j agent | 008-L4 mergé : un dépôt neuf pose ses questions, un dépôt réglé n'en pose aucune |
| **G2. Gate couche 2** [H] | recette « règles changées sans code » | C2 | 1 h [H] (hypothèse) | T021 : sorties citées, `git diff --stat` vide sur `src/` et `tools/` |
| **S3. Spec métiers et connecteurs** | recherche des MCP, spec-kit de la couche 3 | G2 passée | 1 j agent (hypothèse) + choix du cobaye [H] | spec, plan et tasks commités ; Q4 et Q5 tranchées |
| **C3. Couche 3, connecteurs et panneaux** | 007 lots 4 à 6 ; lots de S3 | S3 ; 007-L3 (L0) | 2 à 2,5 j (007) + lots de S3 (non chiffré) | 007-L6 fait [H] ; lots de S3 mergés |
| **G3. Gate couche 3** [H] | un cobaye non-dev finit une tâche de son métier | C3 | 2 h [H] + cobaye (hypothèse) | tâche `faite` par son validateur, preuve nommée attachée, 0 intervention notée |
| **C4. Couche 4, récurrences** | 003 lots 2 à 5 et X | G3 passée | 10,5 j agent | 003-L5 mergé : une recette se crée depuis une proposition |
| **G4. Gate couche 4** [H] | une recette tourne seule, preuve vérifiée | C4 | 1 semaine calendaire, 30 min [H] | 3 exécutions consécutives sans intervention (H5), preuve de chacune vérifiée (journal cité) |

---

## L0 : remise à niveau

**But** : partir d'un état net : hypothèses du plan validées, lots déjà commités mergés.

- [ ] T001 [H] Heifara confirme ou corrige H1 à H6 de `plan.md` (question posée par l'orchestrateur avec `agence ask`, une option « Recommandé » par hypothèse). L'agent note la réponse dans `plan.md` (section Hypothèses). Preuve : id de la question et réponse citée.
- [ ] T002 [P] Vérification et PR de `005-L3` (`feat/preuve-politique` `1927a1d6`) : portes de 005, rebase sur `origin/main`. Preuve : sortie de `npm run test:agence`, numéro de PR. Taille : 0,5 j (H6). Modèle : sonnet.
- [ ] T003 [P] Vérification et PR de `007-L3` (`feat/panneaux-import-accord` `0354ab26`) : portes complètes. Preuve : sorties des portes, numéro de PR. Taille : 0,5 j (H6). Modèle : sonnet.
- [ ] T004 [P] Recaler les cases des `tasks.md` de 003 à 008 sur les commits de `origin/main` (table « Livré et restant » de `plan.md`), une PR `docs(specs)` par spec ou une seule. Preuve : diff relu, chaque case cochée cite son commit. Taille : 0,25 j. Modèle : haiku.

**Checkpoint L0** : `git log origin/main` contient 005-L3 et 007-L3 ; T001 répondu.

---

## C1 : couche 1, noyau

**But** : l'interlocuteur, le backlog, le clic « Lancer », l'écran central et la mesure existent ; l'orchestrateur coûte moins sans perdre en qualité.

### Sous-lots (renvoi aux specs filles)

| Sous-lot | Taille | Dépend de | Preuve de fin (checkpoint de la spec) | Bloque G1 |
|---|---|---|---|---|
| 010-L1 fiches, registre, CLI | 1,5 j | 005-L1 (mergé) | une fiche s'écrit, se valide, se liste ; un agent ne peut pas écrire les fichiers à la main | oui |
| 010-L2 détections | 1 j | 010-L1 | `agence fiche plan` rend des vagues sans fichier commun et nomme chaque attente | oui |
| 010-L3 interlocuteur | 1 j | 010-L1 | l'interlocuteur existe une fois et ne peut pas lancer d'agent | oui (MVP de 010) |
| 010-L4 clic « Lancer », budget en jetons | 1,5 j | 010-L1, L2 ; 005-L3 ; `SKILL.md` après 005-L4 | aucun besoin sans clic ; la vague 1 part, les autres attendent avec leur motif | oui |
| 010-L5 écran central | 1,5 j | 010-L4 ; avant 008-L3 (H2) | « Lancer (2) » : une fiche part, l'autre « attend : chevauche F1 » (Vitest ; e2e non exécuté) | oui |
| 010-L6 registre au clic, revue de cap | 1 j | 010-L1, L2 | le registre ne bouge que sur clic ; la revue tombe une fois par semaine | non |
| 010-L7 modèle par rôle proposé | 0,5 j | 010-L1 ; 005-L4 sur `pratiques.json` | sans réglage rien ne change ; un modèle se pose d'une commande | non |
| 010-L9 acceptation [H] | 0,5 j [H] | 010 lots 1 à 5 | T160 et T161 de 010 faits, sorties citées | oui |
| 011-L1 mesure étendue | 1 j | 006-L1 (mergé) | sur `fixtures/bench/outil/`, jetons des trois sessions, rapport d'agent classé `machine` | oui |
| 011-L2 harnais | 1,5 j | rien | un clone préparé ne contient pas la solution ; l'arbitre la reconnaît appliquée | oui |
| 011-L3 rapport, seuil | 1 j | 011-L1, L2 | `benchmark.py rapport` rend « passe » sur la fixture ; refuse après retouche de `seuil.json` | oui |
| 011-L4 pilote | 0,5 j + ~4 h [H] | 011-L3 ; T040 de 011 [H] | temps actif mesuré à 25 % du chronomètre ; durée réelle d'un rejeu connue | oui |
| 011-L6 règle d'économie | 1 j | 011-L1, L2, L3 ; `SKILL.md` après 010-L4 | une économie qui casse un arbitre est refusée par `comparer` | non (SC-003) |
| 005-L4 skill, déclencheurs | 1 j | 005-L3 ; 006-L3 ; C8 tranché | `test_politique_skill.py` vert ; sous `neutre`, T2 et T3 ne produisent aucune carte | oui (par `SKILL.md`, avant 010-L4) |
| 006-L2 sonde | 0,5 j, 3 places | rien | rapport de sonde commité | oui (par la chaîne `SKILL.md`) |
| 006-L3 règle du skill | 0,5 j | 006-L2 | règle dans `SKILL.md`, test (e) limité aux lignes de 006 (C5) | oui (idem) |
| 006-L4 mesure après | 0,5 j + une vague réelle [H] | 006-L1, L3 mergés et installés | `rapport-mesure.md` avant et après | non (H4) |
| 004-L3 envoi de T1, cartes | 2 j | 004-L1, L2 (mergés) ; une semaine à blanc si Heifara le veut (004, « Dépendances ») | `/compact` part au repos seulement (faux `cate`) | non (H4) |
| 004-L4 `/learn`, `/audit-config` | 1,5 j | 004-L3 | cartes de classe B, aucune commande envoyée seule | non |
| 004-L5 règle de l'orchestrateur | 1 j | 004-L4 ; `SKILL.md` après 011-L6 | skill et doc à jour | non |
| 004-X fin | 0,5 j + une semaine de mesure | 004-L5 | bilan de la semaine | non |

### Tâches transverses de C1

- [ ] T010 Tenir l'ordre des PR sur `tools/agence/agence.py` : 005-L3, 010-L1, 005-L4, 010-L2, 010-L3, 010-L6, 010-L4, 010-L7, 004-L3, 004-L4 ; une PR ouverte à la fois, le chemin critique passe d'abord quand deux sont prêtes. Preuve : `gh pr list` cité à chaque merge. Responsable : l'orchestrateur.
- [ ] T011 Tenir l'ordre sur `skills/orchestrateur/SKILL.md` : 006-L3, 005-L4, 010-L4 (010 T067, T068), 011-L6 (011 T064), 004-L5. Le test de taille (006 f, 011 T062) se calcule sur le HEAD réel de chaque PR. Plafond partagé : 006-L3 pose 14 632 octets (105 % de 13 936, 006 FR-009) ; chaque lot suivant (005-L4, 010-L4, 011-L6, 004-L5) relève lui-même la constante du test (f) de 006 dans sa PR, de son ajout seulement et au plus 5 % de la taille d'avant sa PR. Preuve : `wc -c skills/orchestrateur/SKILL.md` avant et après, cité dans chaque PR.
- [ ] T012 [H] Heifara fixe le seuil (011 T040, Q3) avant tout rejeu. Preuve : `shasum -a 256 specs/011-mesure-benchmark/seuil.json` cité par l'agent après le commit.
- [ ] T013 Gel (H3) : de la préparation du premier rejeu de campagne (011 T050) au verdict, aucun merge sur `tools/agence/`, `skills/orchestrateur/`, `src/panels/agence/`. Les branches avancent, les PR attendent. Preuve : `git log origin/main` sur ces chemins entre les deux dates : vide.

**Checkpoint C1** : 010 lots 1 à 5 et 9 et 011 lots 1 à 4 mergés ou faits ; T012 fait.

---

## G1 : gate de la couche 1 [H]

- [ ] T020 L'agent conduit 011-L5 (T050, T052, T054, T055 de 011) sous le gel T013. Taille : 0,5 j agent.
- [ ] T021 [H] Heifara joue les 20 rejeux et la revue à l'aveugle (011 T051, T053). Taille : 10 à 30 h (hypothèse 011).
- [ ] T022 [H] Heifara lit le verdict et tranche : « passe » ouvre C2 ; « ne passe pas » ou « non conclusif » : retour à C1 sur l'indicateur nommé par le rapport, aucune spec de couche 2 lancée (FR-012, récit 2 scénario 2).
- [ ] T023 Le propriétaire de `specs/009-vision-v2/spec.md` reporte le verdict dans le tableau des couches (une ligne, commit `docs(specs)`). Preuve : commit cité.

**Preuve de fin G1** : `rapport-benchmark.md` commité ; empreintes concordantes ; décision T022 notée.

---

## C2 : couche 2, règles d'orchestration

| Sous-lot | Taille | Dépend de | Preuve de fin |
|---|---|---|---|
| 008-L1 schéma pour tous, champs publiés | 1 j | G1 ; 005-L2, L3, L4 ; 004 sur `declencheurs.json` | `agence pratiques show --json` et `st['pratiques']['champs']` disent la même chose |
| 008-L2 options ponctuelles | 1 j | 008-L1 ; `SKILL.md` après 006-L3 et 005-L4 | `agence start --max-agents 6` puis `agence start` : le plafond revient à celui du workspace |
| 008-L3 formulaire du panneau | 1,25 j | 008-L1 ; 005-L5 (mergé) ; après 010-L5 (H2) | le plafond se change dans le panneau et `agence pratiques show` le voit |
| 008-L4 premières questions | 0,75 j | 008-L3 | un dépôt neuf pose ses questions, un dépôt réglé n'en pose aucune |

## G2 : gate de la couche 2 [H]

- [ ] T030 [H] Recette sur un dépôt de test : Heifara change deux règles par le formulaire (méthode de merge, preuve de fin) puis lance un besoin. Taille : 1 h (hypothèse).
- [ ] T031 L'agent contrôle en lecture seule : `agence pratiques show --json` (source `projet` sur les deux clés), carte de merge avec la nouvelle méthode, condition de fin dérivée, `git diff --stat origin/main -- src tools` vide. Preuve : sorties citées.

---

## S3 : spec de la couche 3, métiers et connecteurs

- [ ] T040 [P] Recherche en lecture seule : MCP ou API officielle pour le tag manager, le test A/B et la bannière de consentement (Q5) ; pour chacun, mode d'accès, lecture et écriture séparées, coût. Preuve : `specs/<n>-metiers-connecteurs/research.md`, sources citées. Taille : 0,5 j. Modèle : sonnet.
- [ ] T041 [H] Heifara choisit le premier cobaye (Q4 ; hypothèse : le media planner) et sa tâche de référence.
- [ ] T042 Spec-kit complet (specify, clarify, plan, tasks) de la couche 3 : métier (connecteurs, panneaux, validateur, recette), droits par connecteur (FR-009), validateur par métier (FR-008), connecteur factice de SC-005. Numéro attribué par l'orchestrateur du projet. Taille : 0,5 j. Preuve : quatre fichiers commités.

## C3 : couche 3, connecteurs et panneaux

| Sous-lot | Taille | Dépend de | Preuve de fin |
|---|---|---|---|
| 007-L4 CLI `cate app`, skill | 0,5 à 1 j | 007-L2, L3 ; C10 du recoupement aligné | commandes générées depuis les specs `defineCateApi` (tests verts) |
| 007-L5 carte d'import | 1 j | 007-L3 | carte d'import en jsdom, rouge puis vert |
| 007-L6 recette à l'écran [H] | 0,5 j [H] | 007-L1, L3, L5 | recette notée par Heifara (FR-009 de 007) |
| lots de S3 | non chiffré | T042 | checkpoints de la spec S3 |

## G3 : gate de la couche 3 [H]

- [ ] T050 [H] Le cobaye (T041) joue sa tâche de référence dans Cate sans aide ; Heifara observe et compte les interventions. Taille : 2 h (hypothèse).
- [ ] T051 L'agent contrôle en lecture seule : état de la tâche `faite`, preuve nommée attachée, validateur du métier passé, aucune écriture de connecteur sans carte validée (journal des clics). Preuve : sorties citées.

---

## C4 : couche 4, récurrences

| Sous-lot | Taille | Dépend de | Preuve de fin |
|---|---|---|---|
| 003-L2 détecteur, carte de proposition | 2 j | 003-L1 (mergé) ; G3 | carte de proposition sur un geste répété (tests 003) |
| 003-L4 accord, pause, « Tout effacer » | 2 j | 003-L1 ; en parallèle de 003-L2 (panneau `agence` à coordonner) | rien n'est enregistré sans accord ; « Tout effacer » vide le dossier |
| 003-L3 enregistrement du navigateur | 4 j | 003-L4 | enregistrement jamais sans accord ni pause |
| 003-L5 recette | 2 j | 003-L2 ou L3 ; Q4 de 003 | une recette se crée depuis une proposition ou un enregistrement |
| 003-X fin | 0,5 j | 003-L5 | rapport de fin |

## G4 : gate de la couche 4 [H]

- [ ] T060 [H] Heifara valide une recette tirée d'un geste réel (carte de 003-L2).
- [ ] T061 L'agent vérifie 3 exécutions consécutives sans intervention (H5) : journal cité, preuve de chaque exécution passée par son validateur. Taille : une semaine calendaire, 30 min d'agent.

---

## Chemin critique

`006-L2` seule (J0 à J0,5, R10) → `010-L1` (J2) → `010-L2` (J3) → `010-L4` (J4,5) → `010-L5` (J6) → `010-L9` [H] (J6,5) → `T020` à `T022` (campagne, 10 à 30 h [H]) → G1.

Chaîne qui doit finir avant J3 (début de 010-L4, pour 010 T068 sur `SKILL.md`) : `006-L2` (J0,5) → `006-L3` (J1) → `005-L4` (J2), avec `005-L3` mergé à J1 (T002). Marge : 1 j.

En parallèle, hors du chemin critique : 011 lots 1 à 4 finissent à J5,5 environ, avant J6,5 ; T012 [H] doit précéder le pilote.

## Vagues sous le plafond de 4 agents

Le plafond de 4 compte tous les Claude vivants, orchestrateur compris : il reste **3 places de lot** par vague. L'interlocuteur (010-L3) n'est pas gardé ouvert pendant V1 à V5 ; il ne tourne qu'en V6 pour 010-L9, où il prend une place.

| Vague | Places de lot (3 au plus, orchestrateur en plus) | Remarque |
|---|---|---|
| V1, J0 à J0,5 | 006-L2 (implémenteur + 2 sondes = 3) | la sonde prend les 3 places (R10) : 010-L1 attend J0,5, le chemin critique glisse de 0,5 j |
| V2, J0,5 à J2 | 010-L1 ; 006-L3 puis 005-L4 ; T002 (vérif 005-L3) puis T003 (vérif 007-L3) puis 011-L1 | 006-L3 et T002 finissent à J1, T003 à J1,5 |
| V3, J2 à J3 | 010-L2 ; 010-L3 ; 011-L1 (fin J2,5) puis 011-L2 | 010-L2 et L3 : hunks disjoints de `agence.py`, PR l'une après l'autre (T010) |
| V4, J3 à J4,5 | 010-L4 ; 010-L6 puis 010-L7 ; 011-L2 (fin J4) puis 011-L3 | 010-L4 part après 005-L4 sur `SKILL.md` (T011) |
| V5, J4,5 à J6 | 010-L5 ; 011-L3 (fin J5) puis 011-L4 (agent, puis pilote [H]) ; 004-L3 | 004-L3 attend une semaine à blanc si Heifara le veut : sa place passe alors à 006-L4 |
| V6, J6 et après | 010-L9 [H] avec l'interlocuteur (1 place) ; campagne 011-L5 [H] sous gel T013 ; 2 places : 011-L6, puis 004-L4, 004-L5, 004-X, T004 | sur branche, sans merge pendant le gel ; 011-L6 touche `SKILL.md` après 010-L4 (T011) |

Parallélisables à tout moment, sans fichier commun avec la couche 1 : T004 (docs), T040 (recherche de S3, après G2 seulement par H1), chacun dans une place libre.

---

## Couverture de la spec 009

| 009 | Couvert par | Note |
|---|---|---|
| FR-001 (un interlocuteur, idées = fiches) | 010-L1 (T001), 010-L3 (T041, T045) | |
| FR-002 (l'interlocuteur ne lance rien) | 010-L3 (T042, T043, T046, T047) | |
| FR-003 (fiche `prête`, clic « Lancer ») | 010-L4 (T060 à T066), 010-L5 (T080 à T084) | |
| FR-004 (fichiers éditables, une CLI) | 010-L1 (T002 à T005, T007) | |
| FR-005 (détections en code) | 010-L2 (T020 à T025) ; 011-L1 à L3 (indicateurs) ; 005-L2 (plafond `agents.max`, livré) | |
| FR-006 (budget de jetons, vision, écran central) | 010-L1 (T001), 010-L4 (T063, T067), 010-L5 (T082) | |
| FR-007 (lentilles) | 010-L8 (tardif, Q1) | hors G1 |
| FR-008 (validateur par métier, preuve nommée) | 005-L3 (preuve de fin du dev, T002) ; S3 (T042) et C3 | le validateur par métier n'a pas encore de spec |
| FR-009 (droits de connecteur, validation centrale, aucun secret) | 007 lots 1, 3, 5 (droits et accord d'un panneau) ; 005-L2 (jeton Slack hors état, livré) ; validation centrale existante (spec 002) ; S3 (T042) | droits par connecteur : spec S3 |
| FR-010 (règles générales, surcharge par projet, sans CLI) | 005 lots 1 à 5 ; C2 (008 lots 1 à 4) ; G2 (T030, T031) | |
| FR-011 (optimisation mesurée avant et après, annulée si rouge) | 011-L6 (T060, T063, T064) | |
| FR-012 (gate par couche) | G1 (T020 à T023), G2, G3, G4 ; T013 (gel) | |
| FR-013 (coupes nettes, écart minimal) | constitution III et IX, vérifiées à chaque PR ; `plan.md`, Constitution Check | aucun lot dédié |
| FR-014 (aucune fenêtre, y compris benchmark) | 011-L2 (T015), 011-L6 (T061) ; interdits de chaque `tasks.md` ; gates jouées par l'humain | |
| SC-001 (6 retours, fiches, série, aucun agent sans clic) | 010-L2 (T020), 010-L4 (T060), 010-L9 (T160) | |
| SC-002 (quatre indicateurs par bras, verdict contre seuil) | 011-L3, 011-L5 ; G1 | |
| SC-003 (aucune économie avec un test rouge) | 011-L6 (T060, T062, T064) | |
| SC-004 (un non-dev réel finit une tâche, preuve attachée) | G3 (T050, T051) ; S3 (T041) | |
| SC-005 (aucune écriture de connecteur sans carte) | S3 (T042, connecteur factice) ; G3 (T051) | partiel avant S3 : 007-L1 (carte d'accord honnête, livré) |
| SC-006 (calculs déterministes à 0 jeton) | 010-L2 (T024) ; 011-L1 (T005), 011-L3 (T025) | |

## Questions ouvertes de 009

| Q | Question | Hypothèse | Tranchée par |
|---|---|---|---|
| Q1 | Garde-fous : registre, revue de cap, lentilles | registre et revue dans 010 (lot 6) ; lentilles après mesure du volume réel (010 lot 8, seuil hypothèse de 010 : 20 fiches en 14 jours) | spec 010 (Q1 de 010), Heifara |
| Q2 | Modèle par rôle | proposé, jamais imposé : quatre clés `modele.*` à `null` par défaut | spec 010 (lot 7), Heifara choisit les valeurs |
| Q3 | Seuil du benchmark | temps actif de l'humain en baisse d'au moins 30 % à qualité égale ou meilleure ; surcoût de jetons accepté +50 % (hypothèse 011) | spec 011 (T040), Heifara, avant le premier rejeu (T012) |
| Q4 | Premier cobaye non-dev | le media planner d'abord (validateur chiffré), l'intégrateur ensuite | S3 (T041), Heifara |
| Q5 | Connecteurs du data manager | API officielle en lecture seule d'abord ; bannière exacte à confirmer | S3 (T040, T042) |
| Q6 | Zoetrope | hors périmètre, après les couches 1 et 2 | aucune spec ; à rouvrir après G2 |
| Q7 | Numérotation | 009, 010, 011 | résolue (spec.md) |
| H1 à H6 | Hypothèses de `plan.md` (gel, ordre 010-L5 avant 008-L3, gel de campagne, couche 1 non bloquante, valeurs de G2 et G4, taille d'une vérification) | voir `plan.md` | Heifara (T001) |

## Stratégie

MVP de la vision : C1 jusqu'à G1. Tant que G1 n'est pas « passe », rien des couches 2 à 4 ne se merge hors des lots déjà commités (H1). Chaque gate est jouée par l'humain et contrôlée par un agent en lecture seule ; un agent ne coche jamais une gate.
