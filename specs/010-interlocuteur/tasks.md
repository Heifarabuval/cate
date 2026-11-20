---

description: "Tâches : interlocuteur, backlog de fiches et garde-fous (spec 010)"
---

# Tasks: Interlocuteur, backlog de fiches et garde-fous

**Input**: `specs/010-interlocuteur/` (spec.md, plan.md), parent `specs/009-vision-v2/spec.md`.

**Prerequisites**: plan.md, spec.md. Tests demandés : la constitution (principe VI) les exige avant le code. Chaque tâche de test vient avant sa tâche de code et doit être vue **rouge** pour la bonne raison (sortie citée). Tout test qui écrit des fichiers tourne en faux HOME et en dossier temporaire ; `cate` et `gh` se simulent par de faux exécutables sur le PATH.

**Interdits à tout agent** (constitution X) : lancer Playwright, Electron, l'app Cate ou `npm run dev`, ouvrir une fenêtre, lancer `npm ci` ou `npm install`, écrire dans le vrai `~/.cate`, `~/.claude` ou `~/.config`, lancer `agence hooks`, relancer des tests sans édition depuis leur dernière exécution verte.

**État** : spec écrite, aucune tâche commencée. Questions de 009 tranchées par leurs hypothèses (spec.md, Clarifications) ; Q1 à Q3 de cette spec ouvertes avec hypothèse, aucune ne bloque les lots 1 à 7.

## Format: `- [ ] ID [P] [US] Description avec chemin`

- **[P]** : parallélisable (autre fichier, aucune dépendance non finie).
- **[US1] à [US6]** : récit de la spec. **[H]** : action de Heifara, jamais d'un agent.
- **Modèle** conseillé : haiku (mécanique), sonnet (implémentation courante), opus (garde, transitions d'état, clic « Lancer » : une erreur lance du travail sans l'humain ou en perd).
- Un implémenteur par lot, un worktree par agent, un vérificateur différent de l'implémenteur. Un agent ne coche une tâche que sur preuve (sortie de commande, chemin:ligne).
- Portes de chaque PR : `npm run typecheck && npm run lint && npm run lint:deps && npm test && npm run test:agence`. La PR dit ce qu'elle supprime, l'écart avec upstream, et s'il faut relancer Cate.

## Couverture de 009

| 009 | Lot, tâche | Note |
|---|---|---|
| FR-001 (un interlocuteur, idées = fiches) | lot 3 (T041, T045), lot 1 (T001) | |
| FR-002 (l'interlocuteur ne lance rien) | lot 3 (T042, T043, T046, T047) | |
| FR-003 (fiche `prête`, clic « Lancer ») | lot 4 (T060 à T066) | |
| FR-004 (fichiers éditables, une CLI) | lot 1 (T002, T003, T005) | |
| FR-005 (détections en code) | lot 2 (T020 à T025) | |
| FR-006 (budget de jetons, vision, écran central) | lot 1 (T001), lot 4 (T063, T068), lot 5 | |
| FR-007 (lentilles) | lot 8 (tardif) | conditionné à Q1 |
| SC-001 | lot 2 (T020), lot 4 (T060), lot 9 (T160) | |
| SC-003 | lot 7 (T120) | le verdict est rendu par la spec 011 |
| SC-006 | lot 2 (T024) ; mesure de session : spec 011 | |
| FR-008 à FR-014, SC-002, SC-004, SC-005 | specs 005, 007, 008, 011 et couches 2 à 4 | hors périmètre de 010 |

## Lots, vue d'ensemble

| Lot | Récits | Taille | Dépend de | Parallélisable avec |
|---|---|---|---|---|
| **1. Schéma, fichiers, CLI `fiche` et `decision`** | US1, US4 | 1,5 j | lot 1 de 005 (mergé) | aucun (il crée `backlog.py`) |
| **2. Détections déterministes** | US2, US4 | 1 j | 1 | 3 (hunks disjoints de `agence.py`, PR l'une après l'autre) |
| **3. Interlocuteur : skill, démarrage, garde** | US1 | 1 j | 1 | 2 |
| **4. Clic « Lancer », contrat, budget en jetons** | US2, US3 | 1,5 j | 1, 2 ; lot 3 de 005 (grammaire de `--done-when`) | 6 si `agence.py` est rebasé |
| **5. Écran central** | US2, US3 | 1,5 j | 4 (op et état publié) ; après le lot panneau de 008 | 6, 7 |
| **6. Registre au clic, revue de cap** | US4 | 1 j | 1, 2 | 5, 7 |
| **7. Modèle par rôle proposé** | US5 | 0,5 j | 1 ; après le lot 4 de 005 sur `pratiques.json` | 5, 6 |
| **8. Lentilles (tardif)** | US6 | 1 j | 1 à 6 mergés ; Q1 atteinte | aucun |
| **9. Acceptation [H]** | US1 à US3 | 0,5 j (Heifara) | 1 à 5 | 6, 7 |

Ordre conseillé : 1, puis {2, 3} en même temps, puis 4, puis {5, 6, 7}, puis 9. Le lot 8 attend la mesure du volume réel (spec.md, Q1). Taille totale hors lot 8 : 8,5 jours.

---

## Lot 1 : schéma, fichiers, CLI `agence fiche` et `agence decision` (US1, US4)

**But** : backlog et registre existent, sont validés, écrits par la seule CLI ; aucun comportement de l'orchestrateur ne change.

**Tests d'acceptation** : `python3 -m unittest tools.agence.test_backlog` vu rouge puis vert ; `npm run test:agence` vert ; en dossier temporaire, `agence fiche add "x" --type idee` rend `F1` en `discussion` ; `agence fiche etat F1 prête` refuse (code 1) et nomme les 6 champs manquants ; `agence decision add` rend `D1` en `proposée` ; un `backlog.json` invalide édité à la main fait refuser toute écriture (code 2) avec le motif.

**Fichiers touchés** : `tools/agence/backlog.py` (nouveau), `tools/agence/test_backlog.py` (nouveau), `tools/agence/agence.py` (parsers `fiche`, `decision`, lecture sous `tx()`), `tools/agence/test_guard.py` (ajouts), `scripts/agence-files.mjs`, `scripts/build-runtime-tarball.test.mjs`, `docs/architecture.md` (§ panneau agence : les deux fichiers).

**Dépend de** : lot 1 de 005 (mergé). **Parallélisable avec** : aucun.

### Tests d'abord

- [ ] T001 [P] [US1] `tools/agence/test_backlog.py` : **schéma de fiche** : champs et types du plan ; ids `F<n>` croissants ; `etat` initial `discussion` ; `prête` exige `titre`, `type`, `preuve`, `priorite`, `fichiers` non vide, `budgetJetons` > 0, `vision` non vide, chacun refusé seul avec son nom ; `dependances` inconnue ou en cycle refusée (cycle nommé). Modèle : opus.
- [ ] T002 [P] [US1] `tools/agence/test_backlog.py` : **transitions** : la CLI ne fait que `discussion` <-> `prête` ; `lancée`, `faite`, `abandonnée` refusés par `agence fiche etat` (code 1, « par le clic seulement ») ; une fiche `faite` ou `abandonnée` ne change plus. Modèle : opus.
- [ ] T003 [P] [US4] `tools/agence/test_backlog.py` : **décision** : `add` écrit `proposée` avec date, objet, pourquoi, alternatives, invalide, structurante ; `list --active` ne rend que `active` ; aucune commande CLI ne pose `active`, `rejetée` ou `révoquée`. Modèle : sonnet.
- [ ] T004 [P] [US1] `tools/agence/test_backlog.py` : **fichier à la main** : JSON invalide, racine qui n'est pas un objet, champ inconnu, état inconnu : erreur publiée, écriture refusée (code 2), fichier inchangé ; fichier absent : backlog vide ; deux écrivains concurrents : fichier valide à la fin (verrou de `tx()`). Modèle : sonnet.
- [ ] T005 [P] `tools/agence/test_guard.py` : la garde `--mode pages` refuse à un agent `Write` et `Edit` sur `*/.cate/tmp/agence/backlog.json` et `decisions.json`, et l'écriture shell (`>`, `tee`, `sed -i`) sur ces chemins ; `agence fiche list` reste permis. Modèle : opus.
- [ ] T006 [P] `scripts/build-runtime-tarball.test.mjs` : `AGENCE_REQUIRED` contient `agence/backlog.py`. Modèle : haiku.

### Implémentation

- [ ] T007 [US1] `tools/agence/backlog.py` : schéma, `charger`, `valider`, `ajouter`, `modifier`, `transition`, `decision_ajouter` (stdlib, fonctions pures sauf lecture et écriture). Rend T001 à T004 verts. Modèle : opus.
- [ ] T008 [US1] `tools/agence/agence.py` : sous-commandes `fiche add|edit|etat|list|show|note` et `decision add|list|show` (`--json`) ; écriture sous `tx()` ; docstring d'en-tête. Moins de 150 lignes. Modèle : sonnet.
- [ ] T009 `tools/agence/agence.py` (`guard`, `:2476`) : motifs de T005. Rend T005 vert. Modèle : opus.
- [ ] T010 [P] `scripts/agence-files.mjs` : `backlog.py` dans `AGENCE_REQUIRED` (`:9`). Rend T006 vert. Modèle : haiku.
- [ ] T011 [P] `docs/architecture.md` : où vivent `backlog.json` et `decisions.json`, qui les écrit (la CLI seule), jamais commités. Modèle : haiku.
- [ ] T012 Portes et PR du lot 1. Corps : `Réf. #<issue de l'epic>`, « l'orchestrateur ne lit pas encore les fiches ». Modèle : haiku.

**Checkpoint lot 1** : une fiche s'écrit, se valide, se liste ; un agent ne peut pas écrire les fichiers à la main.

---

## Lot 2 : détections déterministes (US2, US4)

**But** : chevauchement, vagues, dépendances, plafond, péremption, budget et brief en fonctions pures, appelables par `agence fiche plan` et `agence fiche brief`.

**Tests d'acceptation** : `test_backlog.py` (classe `Detections`) vu rouge puis vert ; `agence fiche plan F1 F2 F3 --json` rend les vagues de US2 ; T024 vert (aucun appel externe).

**Fichiers touchés** : `tools/agence/backlog.py` (ajouts), `tools/agence/test_backlog.py` (ajouts), `tools/agence/agence.py` (`fiche plan`, `fiche brief`).

**Dépend de** : lot 1. **Parallélisable avec** : lot 3 (deux hunks de `agence.py` disjoints ; PR l'une après l'autre).

### Tests d'abord

- [ ] T020 [P] [US2] `test_backlog.py` : **chevauchement et vagues** (SC-001) : même fichier ; dossier parent (`src/a/` et `src/a/b.ts`) ; préfixe sans séparateur (`src/a` et `src/ab.ts`) : pas de chevauchement ; trois fiches dont deux partagent `src/a.ts` : `[[F1, F3], [F2]]` ; priorité puis ancienneté décident de l'ordre. Modèle : opus.
- [ ] T021 [P] [US2] `test_backlog.py` : **dépendances et plafond** : dépendance dans le lot : vague suivante ; hors lot et non `faite` : `attente: dépendance F<n>` ; `place = 1` et 3 fiches sans chevauchement : une part, deux en `attente: plafond (4)` ; `place = 0` : toutes en attente. Modèle : opus.
- [ ] T022 [P] [US4] `test_backlog.py` : **péremption** : `maj` à 15 jours listée, à 13 jours non, à 14 jours pile non (« plus de 14 jours », `specs/009-vision-v2/spec.md:142`) ; seules les fiches `discussion` comptent ; `revue_due` à 6 et 7 jours. Modèle : sonnet.
- [ ] T023 [P] [US3] `test_backlog.py` : **consommé** : somme `inputTokens + outputTokens` des panneaux du besoin ; panneau absent des mesures ignoré ; aucune mesure lisible : `None`, jamais 0 ; valeur non numérique ignorée. **Brief** : tous les champs dans un ordre fixe, décisions liées actives en une ligne, aucune décision `proposée` citée. Modèle : sonnet.
- [ ] T024 [P] [US2] `test_backlog.py` : **zéro appel** (SC-006) : `plan`, `perimees`, `consomme`, `revue_due`, `brief` tournent avec `subprocess.run`, `subprocess.Popen` et `socket.socket` remplacés par une fonction qui lève ; aucune levée. Modèle : sonnet.

### Implémentation

- [ ] T025 [US2] `tools/agence/backlog.py` : `chevauche`, `plan`, `perimees`, `consomme`, `revue_due`, `brief`. Rend T020 à T024 verts. Modèle : opus.
- [ ] T026 [US2] `tools/agence/agence.py` : `fiche plan <ids>` (place lue par `plafond`, `:181`, et les agents vivants de l'état) et `fiche brief <id>`. Moins de 40 lignes. Modèle : sonnet.
- [ ] T027 Portes et PR du lot 2. Modèle : haiku.

**Checkpoint lot 2** : `agence fiche plan` rend des vagues sans fichier commun et nomme chaque attente.

---

## Lot 3 : interlocuteur, skill, démarrage, garde (US1)

**But** : un seul interlocuteur par projet, qui écrit des fiches et ne peut rien lancer.

**Tests d'acceptation** : `test_interlocuteur.py` vu rouge puis vert ; avec un faux `cate`, `agence start` deux fois n'appelle `cate agent start ... /interlocuteur` qu'une fois ; la garde refuse `cate agent start` à l'interlocuteur et le permet à l'orchestrateur.

**Fichiers touchés** : `skills/interlocuteur/SKILL.md` (nouveau), `tools/agence/agence.py` (`cmd_start`, `guard`, refus dans `cmd_need` et `cmd_draft`), `tools/agence/test_interlocuteur.py` (nouveau), `tools/agence/test_guard.py` (ajouts), `scripts/build-runtime-tarball.test.mjs` (le skill est livré, si la liste des skills y est vérifiée).

**Dépend de** : lot 1. **Parallélisable avec** : lot 2.

### Tests d'abord

- [ ] T040 [P] [US1] `tools/agence/test_interlocuteur.py` : lit `skills/interlocuteur/SKILL.md` et vérifie : il cite `agence fiche add`, `agence fiche list`, `agence decision list --active`, `agence decision add` ; il ne cite ni `cate agent start`, ni `agence need add`, ni `agence ask`, ni un nom de modèle, ni `Hermes` ; il dit « ne lance rien ». Modèle : sonnet.
- [ ] T041 [P] [US1] `test_interlocuteur.py` : **démarrage** (FR-001) : `agence start` avec faux `cate` crée l'interlocuteur et l'enregistre (`panels.interlocuteur`) ; relancé avec le panneau vivant : aucun second `agent start` ; panneau mort : recréé ; vivant du même titre non enregistré : adopté ; lien `context` vers le panneau agence. Modèle : sonnet.
- [ ] T042 [P] [US1] `tools/agence/test_guard.py` : **garde** (FR-002) : appelant = interlocuteur (faux `cate` qui rend son id à la sonde) : refus de `cate agent start`, `cate panel create`, `cate panel link`, `cate panel close`, `cate terminal send`, `agence need add`, `agence ask ... --merge`, `agence draft new` ; appelant = orchestrateur : permis ; `agence fiche add`, `git status` : aucune sonde (le faux `cate` compte zéro appel `panel title`). Sonde en échec : la garde laisse passer. Modèle : opus.
- [ ] T043 [P] [US1] `test_interlocuteur.py` : **seconde barrière** : `agence need add` et `agence draft new` lancés depuis l'interlocuteur refusés (code 1) même sans hook. Modèle : sonnet.

### Implémentation

- [ ] T044 [US1] `skills/interlocuteur/SKILL.md` : rôle, commandes, quand proposer une décision, quand citer une décision active, ce qu'il ne fait pas ; la table des rôles renvoie à `agence pratiques show` (aucun modèle écrit). Rend T040 vert. Modèle : sonnet.
- [ ] T045 [US1] `tools/agence/agence.py` (`cmd_start`, `:462`) : création idempotente de l'interlocuteur. Rend T041 vert. Modèle : sonnet.
- [ ] T046 [US1] `tools/agence/agence.py` (`guard`, `:2476`) : motifs et sonde bornée. Rend T042 vert. Modèle : opus.
- [ ] T047 [US1] `tools/agence/agence.py` (`cmd_need`, `:577` ; `cmd_draft`, `:620`) : refus pour l'interlocuteur. Rend T043 vert. Modèle : sonnet.
- [ ] T048 Portes et PR du lot 3. Corps : « le skill orchestrateur ne change pas encore ». Modèle : haiku.

**Checkpoint lot 3** : l'interlocuteur existe une fois et ne peut pas lancer d'agent.

---

## Lot 4 : clic « Lancer », contrat fiche vers orchestrateur, budget en jetons (US2, US3)

**But** : rien ne part sans le clic ; le clic crée les besoins de la première vague et un message unique ; le budget en jetons se suit comme le budget en dollars.

**Tests d'acceptation** : `test_lancer.py` vu rouge puis vert ; sur faux `cate` : avant le clic, zéro besoin et zéro `agent send` ; après le clic, un besoin par fiche de la vague 1 et un seul `agent send` à l'orchestrateur ; second clic identique : 409, rien de créé.

**Fichiers touchés** : `tools/agence/agence.py` (`click`, `add_need`, tour du régisseur `:1600-1630`, carte budget `:1202-1205`, `empty()` : `backlog`), `tools/agence/test_lancer.py` (nouveau), `skills/orchestrateur/SKILL.md` (section « Lancer »), `tools/agence/test_politique_skill.py` (ajout).

**Dépend de** : lots 1 et 2 ; lot 3 de 005 (`preuve` validée par la grammaire de `--done-when`). **Parallélisable avec** : lot 6 si `agence.py` est rebasé.

### Tests d'abord

- [ ] T060 [P] [US2] `tools/agence/test_lancer.py` : **clic** (FR-003, SC-001) : `/fiches/lancer` avec trois `prêtes` dont deux chevauchent : deux besoins (`ref fiche:F<n>`), fiches `lancées`, `besoin` renseigné, journal `clic` ; la troisième reste `prête` avec `attente` ; un id qui n'est pas `prête` : refusé sans rien créer ; double clic : 409. Modèle : opus.
- [ ] T061 [P] [US2] `test_lancer.py` : **message** : un seul `cate agent send` à l'orchestrateur, qui contient la vague, les attentes avec leur motif et le brief de chaque fiche lancée ; aucun message libre ne crée de besoin. Modèle : sonnet.
- [ ] T062 [P] [US2] `test_lancer.py` : **suite** : tour du régisseur, place libérée : la fiche en attente part sans clic, un message de plus ; besoin `done` : fiche `faite` ; besoin `dropped` : fiche `prête` avec la ligne « abandon de l'exécution ». Modèle : opus.
- [ ] T063 [P] [US3] `test_lancer.py` : **budget en jetons** (FR-006) : besoin `budgetJetons` 10 000, mesures 6 000 + 5 000 : `overBudget` et `overBudgetJetons`, la carte dit « 11 000 / 10 000 jetons » ; mesures illisibles : rien posé, ligne « consommé inconnu » ; aucun appel `cate` de plus par tour (compteur du faux `cate`). Modèle : sonnet.
- [ ] T064 [P] [US2] `tools/agence/test_politique_skill.py` : `skills/orchestrateur/SKILL.md` a une section « Lancer » qui dit : lire le message, lancer la vague telle quelle, ne reposer aucune question couverte par le brief, `agence fiche brief` en cas de doute. Modèle : haiku.

### Implémentation

- [ ] T065 [US2] `tools/agence/agence.py` (`click`, `:909`) : chemin `/fiches/lancer` (plan, besoins, message, transitions). Rend T060 et T061 verts. Modèle : opus.
- [ ] T066 [US2] `tools/agence/agence.py` (tour du régisseur) : relance des attentes, fiche `faite` ou `prête` à la fermeture du besoin, vue `backlog` publiée dans l'état (fiches, vagues, attentes, consommé, erreur). Rend T062 vert. Modèle : opus.
- [ ] T067 [US3] `tools/agence/agence.py` : `add_need(budget_jetons=)` (`:231`), `need add --budget-jetons`, dépassement au tour (`:1625-1630`), ligne de carte (`:1202-1205`). Rend T063 vert. Modèle : sonnet.
- [ ] T068 [P] [US2] `skills/orchestrateur/SKILL.md` : section « Lancer ». Rend T064 vert. Sérialisé avec le lot 3 de 006 et le lot 4 de 005 sur ce fichier. Modèle : sonnet.
- [ ] T069 Portes et PR du lot 4. Corps : « Lancer n'existe qu'en route du régisseur : le bouton arrive au lot 5 ». Modèle : haiku.

**Checkpoint lot 4** : aucun besoin sans clic ; la vague 1 part, les autres attendent avec leur motif.

---

## Lot 5 : écran central (US2, US3)

**But** : le dev voit le backlog, coche et lance, lit le consommé contre budget et les attentes, sans terminal.

**Tests d'acceptation** : Vitest vu rouge puis vert (`session.test.ts`, `AgenceView.test.tsx`, `Backlog.test.tsx`) ; `npm run typecheck`, `lint`, `lint:deps`, `test` verts ; aucune exécution d'Electron (« non exécuté » pour tout e2e).

**Fichiers touchés** : `src/panels/agence/contract/types.ts` (`BacklogView`, op `fiches.lancer`), `src/panels/agence/session.ts`, `src/panels/agence/session.test.ts`, `src/panels/agence/contract/fixtures/` (un état avec `backlog`), `src/shells/desktop/ui/panels/agence/Backlog.tsx` (nouveau), `Backlog.test.tsx` (nouveau), `AgenceView.tsx`, `AgenceView.test.tsx`, `docs/architecture.md` (une phrase).

**Dépend de** : lot 4 (route et vue publiée) ; après le lot panneau de 008 sur `types.ts`, `session.ts` et `AgenceView.tsx`. **Parallélisable avec** : lots 6 et 7 (aucun fichier commun).

### Tests d'abord

- [ ] T080 [P] [US2] `src/panels/agence/session.test.ts` : l'instantané porte `backlog` (ou `null`) ; l'op `fiches.lancer` poste `/fiches/lancer` avec les ids ; un id hors `SAFE_ID` : `invalid` sans requête ; refus 409 du régisseur rendu en `conflict` avec son message. Modèle : sonnet.
- [ ] T081 [P] [US2] `src/shells/desktop/ui/panels/agence/Backlog.test.tsx` : groupes par état, `discussion` replié ; cases sur les seules `prêtes` ; « Lancer (n) » désactivé à 0 et pendant l'envoi (double clic) ; motif d'attente affiché ; bannière d'erreur de fichier. Modèle : sonnet.
- [ ] T082 [P] [US3] `Backlog.test.tsx` : par fiche `lancée`, « 11 000 / 10 000 jetons » ; consommé inconnu : « inconnu », jamais 0 ; total du lot. Modèle : haiku.

### Implémentation

- [ ] T083 [US2] `types.ts` et `session.ts` : `BacklogView`, op `fiches.lancer` (même chemin que `draft.send`, `src/panels/agence/session.ts:110`). Rend T080 vert. Modèle : sonnet.
- [ ] T084 [US2] `Backlog.tsx` et une ligne dans `AgenceView.tsx`. Rend T081 et T082 verts. Modèle : sonnet.
- [ ] T085 [P] `docs/architecture.md` : `backlog` dans l'instantané du panneau agence. Modèle : haiku.
- [ ] T086 Portes et PR du lot 5. Corps : « e2e non exécuté (constitution X) », écart avec upstream : panneau `agence` seul. Modèle : haiku.

**Checkpoint lot 5** : le dev coche deux fiches, clique « Lancer (2) », voit l'une partir et l'autre « attend : chevauche F1 ».

---

## Lot 6 : registre au clic et revue de cap (US4)

**But** : une décision n'est active que sur clic ; chaque semaine une carte unique liste ce qui dérive.

**Tests d'acceptation** : `test_revue.py` vu rouge puis vert ; une décision `proposée` crée une question à options « Valider », « Rejeter » ; le clic la pose `active` ou `rejetée` ; une revue due crée une seule question, aucune si la précédente a moins de 7 jours.

**Fichiers touchés** : `tools/agence/agence.py` (`decision add` crée la question ; `click` : `/decision/<id>/valider|rejeter|revoquer`, `/fiche/<id>/relancer|abandonner` ; tour du régisseur : revue), `tools/agence/backlog.py` (`revue` : contenu de la carte), `tools/agence/test_revue.py` (nouveau), `skills/interlocuteur/SKILL.md` (une ligne : proposer la révocation).

**Dépend de** : lots 1 et 2. **Parallélisable avec** : lots 5 et 7.

### Tests d'abord

- [ ] T100 [P] [US4] `tools/agence/test_revue.py` : **registre au clic** (FR-008) : `decision add` crée une question (`QuestionCard` existante) ; clic Valider : `active`, journal `clic` ; Rejeter : `rejetée` ; Révoquer une `active` : `révoquée` et `revoqueePar` ; aucune transition sans clic ; décision `structurante` marquée dans la carte. Modèle : opus.
- [ ] T101 [P] [US4] `test_revue.py` : **revue** (FR-009) : contenu = fiches périmées (lot 2), besoins `overBudget`, décisions structurantes des 7 derniers jours, fiches dont `vision` est hors référentiel (spec.md, Q2) ; une seule question par revue ; `derniereRevue` mise à jour ; aucune revue avant 7 jours ; backlog vide : aucune carte. Modèle : sonnet.
- [ ] T102 [P] [US4] `test_revue.py` : clic Relancer : `maj` remise à maintenant ; Abandonner : `abandonnée`, rien supprimé du fichier. Modèle : sonnet.

### Implémentation

- [ ] T103 [US4] `tools/agence/backlog.py` : `revue` (pure). Modèle : sonnet.
- [ ] T104 [US4] `tools/agence/agence.py` : routes de clic, création des questions, revue au tour. Moins de 120 lignes. Rend T100 à T102 verts. Modèle : opus.
- [ ] T105 [P] `skills/interlocuteur/SKILL.md` : une ligne sur la révocation. Modèle : haiku.
- [ ] T106 Portes et PR du lot 6. Modèle : haiku.

**Checkpoint lot 6** : le registre ne bouge que sur clic ; la revue tombe une fois par semaine.

---

## Lot 7 : modèle par rôle proposé (US5)

**But** : quatre clés de politique, `null` par défaut ; un modèle n'est jamais choisi par le code.

**Tests d'acceptation** : `test_pratiques.py` et `test_backlog.py` verts ; T120 vert.

**Fichiers touchés** : `tools/agence/pratiques.json` (4 clés), `tools/agence/test_pratiques.py`, `tools/agence/backlog.py` (`modele` par défaut d'une fiche), `tools/agence/agence.py` (`cmd_start` : `--model` de l'interlocuteur si posé), `tools/agence/test_backlog.py`.

**Dépend de** : lot 1 ; après le lot 4 de 005 sur `pratiques.json`. **Parallélisable avec** : lots 5 et 6 (fichiers disjoints, sauf `agence.py` : un hunk dans `cmd_start`).

### Tests d'abord

- [ ] T120 [P] [US5] `tools/agence/test_pratiques.py` : **SC-003** : les clés `modele.tri`, `modele.interlocuteur`, `modele.implementation`, `modele.structurant` existent, type chaîne ou `null`, défaut `null`, absentes de `neutre` et de `pr-tdd`. Modèle : haiku.
- [ ] T121 [P] [US5] `tools/agence/test_backlog.py` : fiche sans `--modele` : `modele.implementation` s'il est posé, `modele.structurant` si elle cite une décision structurante, sinon `null` ; le besoin créé au lancement porte ce `model` ou aucun. Modèle : sonnet.

### Implémentation

- [ ] T122 [US5] `pratiques.json`, `backlog.py`, `agence.py` (`cmd_start`). Rend T120 et T121 verts. Modèle : sonnet.
- [ ] T123 Portes et PR du lot 7. Corps : « aucun preset ne pose de modèle ; une économie se prouve par la spec 011 ». Modèle : haiku.

**Checkpoint lot 7** : sans réglage, rien ne change ; Heifara pose un modèle par rôle d'une commande.

---

## Lot 8 : lentilles (US6, tardif)

**Démarrage** : seulement quand la mesure du volume réel atteint le seuil de Q1 (spec.md : 20 fiches en 14 jours, hypothèse) et sur accord de Heifara. Avant : rien.

**But** : une lentille reçoit la fiche seule, propose, ne tranche jamais.

**Tests d'acceptation** : `test_lentilles.py` vu rouge puis vert ; le brief d'une lentille ne contient que la fiche et la consigne ; sa proposition, attachée par `agence fiche note`, ne change ni l'état de la fiche ni le registre.

**Fichiers touchés** : `tools/agence/lentilles.json` (nouveau), `tools/agence/backlog.py` (`brief_lentille`, tirage), `tools/agence/agence.py` (`lentille`), `tools/agence/test_lentilles.py` (nouveau), `skills/orchestrateur/SKILL.md` (lancer une lentille sur clic), `scripts/agence-files.mjs`.

**Dépend de** : lots 1 à 6 mergés ; Q1. **Parallélisable avec** : aucun.

### Tests d'abord

- [ ] T140 [P] [US6] `test_lentilles.py` : `brief_lentille` = fiche + consigne, sans décision, sans journal, sans autre fiche ; `--hasard` tire dans la liste avec une graine fixée par le test ; liste éditable (une lentille ajoutée au fichier est tirée). Modèle : sonnet.
- [ ] T141 [P] [US6] `test_lentilles.py` : une décision `structurante` validée crée une carte « Éclairer » ; la note de lentille ne change ni `etat` ni `decisions.json`. Modèle : opus.

### Implémentation

- [ ] T142 [US6] `lentilles.json` (six lentilles de 009), `backlog.py`, `agence.py`, `agence-files.mjs`, section du skill. Rend T140 et T141 verts. Modèle : sonnet.
- [ ] T143 Portes et PR du lot 8. Modèle : haiku.

**Checkpoint lot 8** : une lentille éclaire une fiche sans rien trancher.

---

## Lot 9 : acceptation par Heifara [H]

- [ ] T160 [H] [US1] Scénario de SC-001 sur un dépôt de test dans Cate : 6 retours dictés à l'interlocuteur (2 brainstorms, 4 demandes, dont deux sur le même fichier) ; attendu : 4 `prêtes`, 2 `discussion`, aucun agent avant le clic, deux vagues au clic. L'agent contrôle ensuite en lecture seule : `agence fiche list --json`, `cate agent list` (sortie citée).
- [ ] T161 [H] [US1] Contradiction : une décision `active`, une idée qui la contredit ; attendu : l'interlocuteur cite la décision avant la fiche. Résultat noté dans le rapport du lot (jugement du modèle, non testable par unittest).

---

## Dépendances et parallélisme

- Lot 1 seul d'abord (il crée `backlog.py`).
- Puis {2, 3} : hunks disjoints de `agence.py`, une PR ouverte à la fois sur ce fichier.
- Puis 4 (il lit les détections du lot 2 et la grammaire du lot 3 de 005).
- Puis {5, 6, 7} : 5 n'a aucun fichier commun avec 6 et 7 ; 6 et 7 partagent `agence.py` (hunks disjoints).
- **Avec les autres epics** : `skills/orchestrateur/SKILL.md` est visé par le lot 3 de 006, le lot 4 de 005 et le lot 4 ici : 006, puis 005, puis 010. Le panneau `agence` est visé par le lot 5 de 005, un lot de 008 et le lot 5 ici : une PR à la fois. `pratiques.json` : lot 4 de 005 avant le lot 7 ici.

## Stratégie

MVP : lots 1 à 4 (fiches, détections, interlocuteur, clic « Lancer » par la route du régisseur). Le lot 5 rend le clic visible ; sans lui, le clic n'existe pas pour l'humain : le MVP utilisable est donc 1 à 5 (6,5 jours). Les lots 6 et 7 ajoutent les garde-fous et le levier de coût ; le lot 8 attend la mesure. Chaque lot est livrable seul : sans le lot 4, l'orchestrateur travaille comme aujourd'hui (besoins à la main).
