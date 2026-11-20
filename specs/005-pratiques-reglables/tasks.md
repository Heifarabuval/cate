---

description: "Tâches : pratiques réglables par dev (spec 005)"
---

# Tasks: Pratiques réglables par dev

**Input**: `specs/005-pratiques-reglables/` (spec.md, plan.md, audit.md)

**Prerequisites**: plan.md, spec.md, audit.md. Tests demandés : la constitution (principe VI) les exige avant le code. Chaque tâche de test vient avant sa tâche de code et doit être vue **rouge** pour la bonne raison (sortie citée). Tout test qui écrit des fichiers tourne en faux HOME et en dossier temporaire ; `gh` se simule par un faux exécutable sur le PATH.

**Interdits à tout agent** (constitution X) : lancer Playwright, Electron, l'app Cate ou `npm run dev`, ouvrir une fenêtre, lancer `npm ci` ou `npm install`, écrire dans le vrai `~/.cate`, `~/.claude` ou `~/.config`, lancer `agence hooks`, relancer des tests sans édition depuis leur dernière exécution verte.

**État** : spec écrite, aucune tâche commencée. Q1 (lieu des fichiers) et Q2 (nom du preset `pr-tdd`) tranchées par Heifara (spec.md, Clarifications) ; Q3 à Q9 ouvertes avec hypothèse, aucune ne bloque le lot 1.

## Format: `- [ ] ID [P] [US] Description avec chemin`

- **[P]** : parallélisable (autre fichier, aucune dépendance non finie).
- **[US1] à [US4]** : récit de la spec. **[H]** : action de Heifara, jamais d'un agent.
- **Modèle** conseillé : haiku (mécanique), sonnet (implémentation courante), opus (garde `pages`, validation du schéma, évaluation de la preuve : une erreur ouvre un trou ou ferme un besoin à tort).
- Un implémenteur par lot, un worktree par agent, un vérificateur différent de l'implémenteur. Un agent ne coche une tâche que sur preuve (sortie de commande, chemin:ligne).
- Portes de chaque PR : `npm run typecheck && npm run lint && npm run lint:deps && npm test && npm run test:agence`. La PR dit ce qu'elle supprime, l'écart avec upstream, et s'il faut relancer Cate.

## Lots, vue d'ensemble

| Lot | Récits | Taille | Dépend de | Parallélisable avec |
|---|---|---|---|---|
| **1. Schéma, lecture, commande** | US1, US3 | 1,5 j | rien | aucun (il crée les fichiers que les autres lisent) |
| **2. Retrait du codé en dur** | US1, US3 | 1 j | 1 | 5 |
| **3. Preuve de fin dérivée** | US2 | 1,25 j | 1 ; après 2 sur `agence.py` | 5 |
| **4. Skill, déclencheurs, pureté** | US1, US3 | 1 j | 1 ; après le lot 3 de la spec 006 pour `SKILL.md` | 5 ; 2 et 3 si `agence.py` est rebasé |
| **5. Panneau** | US4 | 1 j | 1 | 2, 3, 4 (aucun fichier commun) |

Ordre conseillé : 1, puis {2 puis 3} et {5} ensemble, puis 4. Le lot 5 ne partage aucun fichier avec les lots 2, 3 et 4 (hors `docs/architecture.md`, un titre chacun). Les lots 2, 3 et 4 partagent `tools/agence/agence.py` (hunks disjoints) : une PR ouverte à la fois sur ce fichier, rebase de la suivante.

---

## Lot 1 : schéma, lecture, validation, commande `agence pratiques` (US1, US3)

**But** : une politique lisible, validée, affichable, réglable ; rien d'autre ne change encore dans le comportement de l'orchestrateur.

**Tests d'acceptation** : `python3 -m unittest tools.agence.test_pratiques` vert (rouge d'abord) ; `npm run test:agence` vert ; `agence pratiques show --json` en faux HOME rend les 12 valeurs de `neutre` avec la source `défaut` ; avec un fichier du projet qui pose `tests: tdd`, la source de `tests` est `projet` et celle des autres reste `défaut`.

**Fichiers touchés** : `tools/agence/pratiques.py` (nouveau), `tools/agence/pratiques.json` (nouveau), `tools/agence/test_pratiques.py` (nouveau), `tools/agence/agence.py` (parser `pratiques`, import, `un_tour`, garde `pages`), `tools/agence/test_guard.py` (ajouts), `scripts/agence-files.mjs`, `scripts/build-runtime-tarball.test.mjs`, `docs/architecture.md` (§ panneau agence : les deux fichiers de politique).

**Dépend de** : rien. **Parallélisable avec** : aucun lot (il crée `pratiques.py` et `pratiques.json`).

### Tests d'abord

- [ ] T001 [P] [US1] `tools/agence/test_pratiques.py` : **priorité** (FR-001) : défaut seul ; preset du dev ; clés du dev par-dessus ; preset du projet par-dessus ; clés du projet en dernier ; chaque clé rend sa source. Modèle : sonnet.
- [ ] T002 [P] [US1] `tools/agence/test_pratiques.py` : **refus** (FR-003, SC-003) : pour **chaque** clé du schéma, une valeur hors liste ; une clé inconnue (`livraisn.mode`) ; un type faux (`agents.max: "4"`) ; JSON invalide ; racine qui n'est pas un objet ; les 3 cohérences du plan. Le message cite le fichier, la clé et les valeurs permises. Modèle : opus.
- [ ] T003 [P] [US1] `tools/agence/test_pratiques.py` : **écriture** (FR-004) : `set` valide le résultat entier avant d'écrire (un `set` invalide ne modifie pas le fichier) ; `unset` ; `preset` ; verrou (deux écrivains, un fichier valide à la fin) ; chemin pointé `livraison.methode` produit un objet imbriqué. Modèle : sonnet.
- [ ] T004 [P] [US1] `tools/agence/test_pratiques.py` : **`brief`** : contient les invariants dans tous les cas ; `tests: tdd` donne l'exigence du test rouge ; `issue: obligatoire` donne la règle `Closes #N` ; `speckit` et `verification` donnent leur ligne ; une valeur `libre` n'ajoute aucune ligne. Modèle : sonnet.
- [ ] T005 [P] [US1] `tools/agence/test_pratiques.py` : **presets figés** (SC-005) : les 12 valeurs de `neutre` et de `pr-tdd` du plan, comparées une à une ; toutes les clés d'un preset existent dans le schéma. Modèle : haiku.
- [ ] T006 [P] [US1] `tools/agence/test_agence.py` ou `test_pratiques.py` (classe `Tour`) : `watch` écrit `st['pratiques']` (valeurs, sources, `erreur`) à chaque tour ; avec un fichier invalide, `erreur` est renseignée, les valeurs sont celles de `neutre` et le tour continue ; un état ancien sans la clé est complété. Modèle : sonnet.
- [ ] T007 [P] [US1] `tools/agence/test_guard.py` : la garde `--mode pages` refuse à un agent `Write` et `Edit` sur `*/.cate/tmp/agence/pratiques.json` et `Bash` qui lance `agence pratiques set|unset|preset` ; `show`, `check`, `brief` restent permis. Modèle : opus.
- [ ] T008 [P] `scripts/build-runtime-tarball.test.mjs` : `AGENCE_REQUIRED` contient `agence/pratiques.py` et `agence/pratiques.json`. Modèle : haiku.

### Implémentation

- [ ] T009 [US1] `tools/agence/pratiques.json` : `cles`, `coherences`, `presets` (`neutre`, `pr-tdd`) du plan. Rend T005 vert. Modèle : haiku.
- [ ] T010 [US1] `tools/agence/pratiques.py` : `charger`, `valider`, `ecrire`, `brief` (fonctions pures sauf `charger` et `ecrire`, stdlib seule). Rend T001 à T004 verts. Modèle : opus.
- [ ] T011 [US1] `tools/agence/agence.py` : sous-commande `pratiques` (`show`, `set`, `unset`, `preset`, `check`, `brief`, option `--dev`, `--json`), `un_tour` écrit `st['pratiques']`, `empty()` gagne `pratiques: None`. Moins de 150 lignes ajoutées. Rend T006 vert. Modèle : sonnet.
- [ ] T012 [US1] `tools/agence/agence.py` (`guard`, mode `pages`) : motifs de T007. Rend T007 vert. Modèle : opus.
- [ ] T013 [P] `scripts/agence-files.mjs` : les deux fichiers dans `AGENCE_REQUIRED`. Preuve : T008 vert ; `npm run runtime:tarball` puis `tar -tzf` liste `agence/pratiques.py` et `agence/pratiques.json` (sortie citée). Modèle : haiku.
- [ ] T014 [P] `docs/architecture.md` : paragraphe « The agence panel » : où vivent les deux fichiers, qui les écrit (la CLI seule), qu'ils ne sont jamais commités (`.cate/.gitignore`). Diff relu. Modèle : haiku.
- [ ] T015 Portes et PR du lot 1. Corps : `Réf. #<issue de l'epic>`, ce que la PR ne change pas (le comportement de l'orchestrateur : la politique n'est lue que par `pratiques`). Modèle : haiku.

**Checkpoint lot 1** : `agence pratiques show` rend une politique valide ; un fichier faux est refusé avec son motif ; les agents ne peuvent pas l'écrire.

---

## Lot 2 : retrait du codé en dur (US1, US3)

**But** : le merge, le jeton Slack, le plafond d'agents et le contrôle de `doctor` suivent la politique ; plus de trace de Hermes dans le code.

**Tests d'acceptation** : `test_retrait.py` vu rouge puis vert ; `grep -rniE "hermes|HERMES_ENV|\-\-rebase" tools/agence/agence.py` : 0 ligne (hors commentaire daté) ; en faux HOME avec un faux `gh`, un clic Merger passe `--squash` sous `neutre` et `--rebase` sous `pr-tdd`.

**Fichiers touchés** : `tools/agence/agence.py`, `tools/agence/test_retrait.py` (nouveau), `tools/agence/test_agence.py` (remplacement des usages de `HERMES_ENV` et de `--rebase`), `tools/agence/test_doctor.py`, `tools/agence/test_portable.py` (mots interdits).

**Dépend de** : lot 1. **Parallélisable avec** : lot 5. **Conflit** : `agence.py` avec les lots 3 et 4 (hunks disjoints, PR l'une après l'autre) et avec les lots de 002 et 004 encore ouverts.

### Tests d'abord

- [ ] T020 [P] [US1] `tools/agence/test_retrait.py` : **méthode de merge** (audit C) : `MERGE_OPTIONS` rendu avec la méthode ; le clic appelle `gh pr merge <N> -R <repo> --squash|--rebase|--merge` selon `livraison.methode` (faux `gh`). Modèle : sonnet.
- [ ] T021 [P] [US1] `tools/agence/test_retrait.py` : **`ask --merge`** : refus (code 2, cite `livraison.merge`) quand `dehors` ; refus quand `livraison.mode` vaut `main` ; question sans `--merge` possible ; politique en erreur : refus qui cite l'erreur. Modèle : sonnet.
- [ ] T022 [P] [US3] `tools/agence/test_retrait.py` : **jeton Slack** : lu dans la variable nommée par `envoi.slack.variable` ; à défaut, dans le fichier nommé par `envoi.slack.fichier` (format `NOM=valeur`) ; ni l'un ni l'autre : le refus existant (`Refus`) ; le jeton n'apparaît ni dans `show`, ni dans l'état, ni dans le journal ; `HERMES_ENV` n'est plus lu. Modèle : opus.
- [ ] T023 [P] [US1] `tools/agence/test_retrait.py` : **plafond** : `plafond(st)` rend `agents.max` ; `agence start --max-agents 6` écrit `agents.max: 6` dans le fichier du projet et plus `maxAgents` dans l'état ; un état ancien avec `maxAgents` est lu sans erreur et la clé est ignorée. Modèle : sonnet.
- [ ] T024 [P] [US1] `tools/agence/test_doctor.py` : point `pratiques` (`ok`, `erreur`, `info` si aucun fichier) ; `gh` bloquant sous `neutre` et `pr-tdd`, `info` quand `livraison.mode` vaut `main` sans issue obligatoire ni preuve GitHub. Modèle : sonnet.

### Implémentation

- [ ] T025 [US1] `tools/agence/agence.py` : `MERGE_OPTIONS` et le merge au clic (`:738-739`, `:1025`) lisent la méthode ; `cmd_ask` (`:844`) refuse selon T021. Rend T020 et T021 verts. Modèle : sonnet.
- [ ] T026 [US3] `tools/agence/agence.py` : `slack_token` (`:667-677`) selon T022 ; docstring de `send_slack` (`:700`) sans Hermes ; `HERMES_ENV` supprimé. Rend T022 vert. Modèle : opus.
- [ ] T027 [US1] `tools/agence/agence.py` : `MAX_AGENTS` supprimé, `plafond(st)` lit la politique (`:53`, `:167`), `--max-agents` (`:456-457`, `:2752`) écrit le fichier du projet. Rend T023 vert. Modèle : sonnet.
- [ ] T028 [US1] `tools/agence/agence.py` : `prerequis()` (point `pratiques`, `gh` conditionnel, `:1919`). Rend T024 vert. Modèle : sonnet.
- [ ] T029 [P] `tools/agence/test_agence.py` : remplacer les usages de `HERMES_ENV` (`:71-84`, `:2112-2144`) et de `--rebase` par les réglages ; aucune assertion supprimée sans équivalent. `tools/agence/test_portable.py` : ajouter `hermes` et `.hermes` aux mots interdits (après le merge des lots 2 et 3 de la spec 002). Modèle : sonnet.
- [ ] T030 Portes et PR du lot 2. Corps : liste du code supprimé (`HERMES_ENV`, `MAX_AGENTS`, `maxAgents`, `--rebase` en dur), phrase d'action : « sans fichier, le merge passe de rebase à squash : `agence pratiques preset pr-tdd` pour garder le flux de Heifara ». Modèle : haiku.

**Checkpoint lot 2** : `grep -rniE "hermes" tools/agence skills src/panels/agence src/shells/desktop/ui/panels/agence` (hors tests) ne rend rien côté `tools/agence`.

---

## Lot 3 : preuve de fin dérivée de la politique (US2)

**But** : `--done-when` suit une grammaire fermée, se déduit de `preuve`, et le besoin se ferme sur ce que la politique dit.

**Tests d'acceptation** : `test_preuve.py` vu rouge puis vert ; sur faux `gh` : PR `OPEN` + checks verts, besoin ouvert ; PR `MERGED` + checks verts, besoin fait avec le lien de la PR ; PR `MERGED` + checks rouges sous `ci-verte`, besoin ouvert et le suivi dit « checks non verts ».

**Fichiers touchés** : `tools/agence/pratiques.py` (ajout de `done_when_defaut`, `evaluer`), `tools/agence/agence.py` (`need add`, `need pr`, `gh_needed`, boucle de fermeture `:1375`, `:1536-1554`, `need done`), `tools/agence/test_preuve.py` (nouveau), `tools/agence/test_pratiques.py` (ajouts).

**Dépend de** : lot 1 ; après le lot 2 pour `agence.py`. **Parallélisable avec** : lot 5.

### Tests d'abord

- [ ] T040 [P] [US2] `tools/agence/test_preuve.py` : **grammaire** (FR-009, SC-004) : les 6 formes valides ; chaque forme invalide refusée (code 2, liste des formes) ; `pr-merged:` sans nombre refusé ; combinaison par virgule. Modèle : sonnet.
- [ ] T041 [P] [US2] `tools/agence/test_preuve.py` : **dérivation** : `preuve` absente et mode `pr` donne `pr-merged:`, mode `main` donne `report` ; `["ci-verte", "pr-mergee"]` donne `ci-green:,pr-merged:` ; `need add --kind task` sans `--done-when` reçoit la forme dérivée ; avec `--done-when` valide, sa valeur gagne. Modèle : sonnet.
- [ ] T042 [P] [US2] `tools/agence/test_preuve.py` : **évaluation** (`pratiques.evaluer`, pure) : les 6 conditions, vraies et fausses, avec les manques nommés ; `checks` absent : « inconnu », jamais « vert ». Modèle : opus.
- [ ] T043 [P] [US2] `tools/agence/test_preuve.py` : **fermeture** sur faux `gh` (scénarios de la spec, US2 1 et 2) ; `need pr <besoin> <N>` complète la forme ; `need done` refusé tant qu'une condition machine est fausse ; `report` et `tests-local` exigent `--evidence` ; un besoin ouvert avec `doneWhen: "pr-merged:12"` est évalué comme avant (aucune migration). Modèle : opus.
- [ ] T044 [P] [US1] `tools/agence/test_preuve.py` : `issue: obligatoire` : `need add --kind task` sans `--issue N` refusé, avec `--issue N` accepté et `N` stocké. Modèle : sonnet.

### Implémentation

- [ ] T045 [US2] `tools/agence/pratiques.py` : `done_when_defaut`, `evaluer`, validation de la grammaire. Rend T040 à T042 verts. Modèle : opus.
- [ ] T046 [US2] `tools/agence/agence.py` : `need add` (validation, défaut dérivé, `--issue`), `need pr`, `gh_needed` et la boucle de fermeture lisent les conditions par `evaluer` ; `--done-when` (`:2770`) documenté avec la grammaire. Moins de 150 lignes. Rend T043 et T044 verts. Modèle : opus.
- [ ] T047 [P] `tools/agence/agence.py` : le suivi affiche ce qui manque (« PR non mergée », « checks non verts », « tests déclarés, non revérifiés ») sur la ligne du besoin. Test dans `test_preuve.py`. Modèle : sonnet.
- [ ] T048 Portes et PR du lot 3. Corps : code mort listé (les deux regex `pr-merged|issue-closed` de `:1375` et `:1536` remplacées). Modèle : haiku.

**Checkpoint lot 3** : une saisie hors grammaire est refusée ; la même politique ferme un besoin PR et un besoin `main`.

---

## Lot 4 : skill, déclencheurs, pureté (US1, US3)

**But** : le skill `orchestrateur` lit la politique au lieu de réécrire le flux de Heifara ; la table des déclencheurs ne propose que ce que le dev a activé.

**Tests d'acceptation** : `test_politique_skill.py` vu rouge puis vert ; `test_declencheurs.py` vert avec `declencheurs.actifs` ; sous `neutre`, une condition vraie de T2 ou T3 ne produit aucune carte ; sous `pr-tdd`, T2 et T3 en produisent comme avant.

**Fichiers touchés** : `skills/orchestrateur/SKILL.md`, `tools/agence/test_politique_skill.py` (nouveau), `tools/agence/declencheurs.json`, `tools/agence/agence.py` (l'évaluateur lit `declencheurs.actifs`), `tools/agence/test_declencheurs.py`.

**Dépend de** : lot 1 ; `SKILL.md` après le lot 3 de la spec 006 (ou rebase) ; la tâche `declencheurs.actifs` après les lots ouverts de la spec 004, sinon elle leur passe (Q5). **Parallélisable avec** : lot 5.

### Tests d'abord

- [ ] T060 [P] [US1] `tools/agence/test_politique_skill.py` : lit `skills/orchestrateur/SKILL.md` et vérifie (a) il cite `agence pratiques show` et `agence pratiques brief` ; (b) aucune des chaînes `Hermes`, `Sonnet`, `--rebase`, `un vérificateur différent par implémenteur` ; (c) le texte de la condition de fin ne liste plus de formes (il renvoie à `agence pratiques show`) ; (d) les invariants (« Jamais de merge, push sur `main`, force-push ») sont toujours présents. Modèle : sonnet.
- [ ] T061 [P] [US3] `tools/agence/test_declencheurs.py` : schéma de la table sans `actif` ; `declencheurs.actifs` filtre l'évaluateur ; identifiant inconnu refusé par la cohérence de T002. Modèle : sonnet.

### Implémentation

- [ ] T062 [US1] `skills/orchestrateur/SKILL.md` : remplacer les lignes 19, 20, 25, 30, 36, 39-41, 43, 65 et 74 (audit, lignes C, D, E) par les phrases conditionnelles du plan ; garder les invariants. Rend T060 vert. Modèle : sonnet.
- [ ] T063 [US3] `tools/agence/declencheurs.json` (retrait de `actif`), `tools/agence/agence.py` (évaluateur, `TABLE_DECLENCHEURS`), `pratiques.json` (preset : `["T1"]` et `["T1","T2","T3"]` déjà posés au lot 1). Rend T061 vert. Modèle : sonnet.
- [ ] T064 [P] [H] [US3] Heifara pose son flux : `agence pratiques preset pr-tdd --dev`, et `agence pratiques set envoi.slack.fichier ~/.hermes/.env --dev` (chemin chez lui, jamais dans le fork). L'agent contrôle ensuite en lecture seule : `agence pratiques show` rend `pr-tdd` (source `dev`) et le fichier du jeton. **Avant le merge du lot 2 de 005** : la bascule de Heifara (lot 5 de la spec 002) est faite (L5-07), il tourne déjà sur le fork ; sans ce preset, son merge passerait de rebase à squash dès l'installation du lot 2.
- [ ] T065 Portes et PR du lot 4. Corps : texte du skill supprimé listé, `actif` supprimé de la table. Modèle : haiku.

**Checkpoint lot 4** : un autre dev sans `/learn` ni `/audit-config` ne reçoit aucune carte pour eux ; Heifara garde les siennes.

---

## Lot 5 : panneau (US4)

**But** : le dev voit sa politique et son origine dans le panneau agence, ouvre son fichier, et voit une erreur de politique sans lire un terminal.

**Tests d'acceptation** : Vitest vert (rouge d'abord) : `session.test.ts`, `AgenceView.test.tsx`, `QuestionCard.test.tsx` ; `npm run typecheck`, `lint`, `lint:deps`, `test` verts ; aucune exécution d'Electron (« non exécuté » pour tout e2e).

**Fichiers touchés** : `src/panels/agence/contract/types.ts`, `src/panels/agence/session.ts`, `src/panels/agence/session.test.ts`, `src/panels/agence/contract/fixtures/` (un état avec `pratiques`), `src/shells/desktop/ui/panels/agence/AgenceView.tsx`, `AgenceView.test.tsx`, `QuestionCard.tsx`, `QuestionCard.test.tsx`, `docs/architecture.md` (titre du panneau agence).

**Dépend de** : lot 1 (`st['pratiques']`) ; après le merge des lots 2 et 3 de la spec 002 sur `types.ts` et `session.ts`. **Parallélisable avec** : lots 2, 3, 4 (aucun fichier commun).

### Tests d'abord

- [ ] T080 [P] [US4] `src/panels/agence/session.test.ts` : l'instantané porte `pratiques` (valeurs, sources, erreur) ; absent de l'état : `null` ; l'op `openPratiques` crée (ou crée puis ouvre avec `{}`) le fichier du projet puis un panneau éditeur dessus ; jamais d'écriture par la vue. Modèle : sonnet.
- [ ] T081 [P] [US4] `src/shells/desktop/ui/panels/agence/AgenceView.test.tsx` : la ligne « Pratiques : <preset> (<source>) » s'affiche ; le détail liste chaque valeur et sa source ; `erreur` donne une bannière qui nomme la clé ; état sans `pratiques` : rien. Modèle : sonnet.
- [ ] T082 [P] [US4] `src/shells/desktop/ui/panels/agence/QuestionCard.test.tsx` : le libellé de Merger et « Merger quand même » portent la méthode publiée (`squash`, `rebase`, `merge`), plus de « (rebase) » en dur. Modèle : haiku.

### Implémentation

- [ ] T083 [US4] `src/panels/agence/contract/types.ts` : `pratiques` (type pur) ; `session.ts` : publie et traite `openPratiques`. Rend T080 vert. Modèle : sonnet.
- [ ] T084 [US4] `AgenceView.tsx` : ligne, détail, bannière, bouton « Ouvrir le fichier » (demande l'op, n'écrit rien) ; `QuestionCard.tsx` : libellés (`:41`, `:68`). Rend T081 et T082 verts. Modèle : sonnet.
- [ ] T085 [P] `docs/architecture.md` : une phrase sur `pratiques` dans l'instantané du panneau. Modèle : haiku.
- [ ] T086 Portes et PR du lot 5. Corps : « e2e non exécuté (constitution X) ». Modèle : haiku.

**Checkpoint lot 5** : le panneau dit « Pratiques : pr-tdd (dev) » ; une politique invalide s'affiche en bannière.

---

## Dépendances et parallélisme

- Lot 1 d'abord, seul : il crée `pratiques.py` et `pratiques.json`.
- Ensuite, en même temps : `{lot 2, puis lot 3}` (même fichier `agence.py`), `{lot 5}` (panneau, aucun fichier commun), `{lot 4}` quand `SKILL.md` est libre (spec 006, lot 3).
- **Avec les autres epics** : le lot 4 de 005 et le lot 3 de 006 visent tous deux `SKILL.md` : l'orchestrateur les sérialise (006 d'abord, son diff est de trois hunks courts). Le lot 4 de 002 (amorçage) et le lot 2 de 005 visent tous deux `prerequis()` : une PR à la fois. La bascule de Skills (002, lot 5) est faite : c'est le merge du lot 2 de 005 qui attend T064.

## Stratégie

MVP : lots 1 et 2 (la politique existe et le merge, le jeton et le plafond la suivent). Le lot 3 est ce qui rend « fini » configurable ; le lot 4 retire le dernier texte personnel ; le lot 5 rend le réglage visible. Chaque lot est livrable seul : sans le lot 3, `--done-when` garde son comportement actuel ; sans le lot 5, tout se règle en commande.
