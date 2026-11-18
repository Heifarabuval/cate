---

description: "Tâches : fiabiliser l'orchestration d'agents"
---

# Tasks: Fiabiliser l'orchestration d'agents

**Input**: `specs/001-fiabiliser-agents/` (spec.md, plan.md, research.md, data-model.md, contracts/interfaces.md, quickstart.md)

**Prerequisites**: plan.md, spec.md. Tests demandés : la constitution (principe VI) les exige avant le code. Dans chaque récit, les tâches de test viennent d'abord et doivent être vues **rouges** (échec pour la bonne raison) avant la tâche de code.

**Interdits à tout agent** (constitution X) : lancer Playwright, Electron, l'app Cate ou `npm run dev`, ouvrir une fenêtre, lancer `npm ci` ou `npm install`. Pas de merge, de push sur `main`, de force-push, de suppression de branche.

## Format: `- [ ] ID [P] [US] Description avec chemin`

- **[P]** : parallélisable (autre fichier, aucune dépendance non finie).
- **[US1] à [US6]** : récit de la spec.
- Un seul implémenteur par lot. Un vérificateur différent de l'implémenteur, par lot.

## Issues du fork

Récit 1 = #50 (plafond à 4), récit 2 = #51 (`agence doctor`, relance possible), récit 3 = #52 (panneaux orphelins), récit 4 = #53 (`node_modules` dans `addWorktree`), récit 5 = #54 (gabarit de brief), récit 6 = #55 (hook Playwright et Electron). La PR de spec écrit `Réf.` (elle ne règle aucune issue) ; chaque PR d'implémentation écrit `Closes #N` de son récit.

## Trois lots parallèles, sans fichier commun

| Lot | Récits | Implémenteur | Fichiers (liste fermée) |
|-----|--------|--------------|--------------------------|
| **A** | 1, 2, 3 | n° 1 | `tools/agence/agence.py`, `tools/agence/test_agence.py` |
| **B** | 4 | n° 2 | `src/workspace/repository/runtime/nodeModules.ts`, `nodeModules.test.ts`, `git.ts` |
| **C** | 5, 6 | n° 3 | `~/.claude/skills/orchestrateur/SKILL.md`, `~/.claude/skills/orchestrateur/evals.json`, `~/.claude/hooks/window-guard.sh`, `~/.claude/hooks/window_guard.py`, `~/.claude/hooks/tests/cases.json`, `~/.claude/settings.json` |

Un agent qui doit toucher un fichier hors de sa liste écrit d'abord à l'orchestrateur.

## Phase 1 : Setup

- [ ] T001 Chaque implémenteur crée sa branche depuis `origin/main` du fork dans son worktree (lots A et B : `feat/agence-fiabilite` et `feat/worktree-node-modules` ; lot C : aucun dépôt git, travail direct dans `~/.claude` sur accord de l'humain). Vérifier `git log --oneline -1` = `main` du fork, pas `main` local.
- [ ] T002 Lot A : lire `tools/agence/agence.py` (plafond lignes 40, 145, 1396-1401 ; offre de worktree 791-815, 1017, 1468-1477 ; `un_tour` 1526 ; `parser` 1678) et la classe `Tour` de `tools/agence/test_agence.py:1332` avant d'écrire un test.

**Checkpoint** : base du lot vérifiée. Aucun fichier modifié.

## Phase 2 : Foundational

Aucune tâche bloquante entre lots. Dans le lot A, les récits 1, 2, 3 s'enchaînent dans cet ordre (même fichier).

---

## Phase 3 : Lot A, récit 1 : plafond de 4 agents vivants (Priority: P1) [US1]

**Goal**: plafond 4, agents en attente comptés, message « place libre » sur le total.

**Independent Test**: `npm run test:agence` (classe `Tour`).

### Tests d'abord (rouges)

- [ ] T003 [US1] Dans `tools/agence/test_agence.py` (classe `Tour`), réécrire en rouge les tests dont le sens change : `test_place_liberee_dans_la_file` (4 agents en plein tour, puis 3 : une place), `test_agent_en_attente_ne_bloque_pas_la_file` devient `test_agent_en_attente_compte_dans_le_plafond` (2 en plein tour et 2 en attente : 4 sur 4, aucun message ; puis 1 en attente part : un message), `test_orchestrateur_et_regisseur_ne_comptent_pas` (4 agents plus `o1` et `r1`), `test_une_place_libre_une_fois_par_liberation`, `test_plafond_reglable` (inchangé en sens), `test_etat_ancien_plafond_par_defaut` (`agence.plafond(...) == 4` et état sans `agentsWaiting`). Lancer : ils échouent parce que `MAX_AGENTS` vaut 8.
- [ ] T004 [US1] Dans `tools/agence/test_agence.py`, ajouter un test de l'aide : `agence start --help` contient « défaut 4 » et « en attente de saisie comptent » (FR-005).

### Implémentation

- [ ] T005 [US1] Dans `tools/agence/agence.py` : `MAX_AGENTS = 4` (ligne 40) ; dans `tick`, `vivants = active + waiting`, le message part quand `st['agentsActive'] + st['agentsWaiting'] >= plafond(st) > vivants` (lignes 1396-1401, texte « Une place est libre : {vivants} en cours sur {plafond} ») ; ordre : calculer `waiting` avant d'écraser `st['agentsActive']`. Mettre à jour le docstring (ligne 8) et l'aide de `--max-agents` (ligne 1686). Supprimer toute phrase « les agents en attente ne comptent pas ». Faire passer T003 et T004 au vert.

**Checkpoint** : `npm run test:agence` vert.

---

## Phase 4 : Lot A, récit 2 : `agence doctor --relance` (Priority: P2) [US2]

**Goal**: verdict oui ou non, lecture seule.

**Independent Test**: classe `Relance` de `test_agence.py`, faux `RUN`.

### Tests d'abord (rouges)

- [ ] T006 [US2] Dans `tools/agence/test_agence.py`, nouvelle classe `Relance(Base)` avec un faux `RUN` (réponses préparées pour `cate agent list`, `cate panel list`, `git worktree list --porcelain`, `git -C <chemin> status --porcelain`, `git -C <chemin> rev-list`, `gh pr list`) et un faux `CATE_HOME` temporaire contenant `workspaces/<id>/runtime.json` et `runtime/current`. Cas : rien en cours donne `oui` et code 0 ; un agent `running` donne `non` et le nomme ; un agent `waitingForInput` seul reste `oui` avec une ligne `info` ; l'orchestrateur, le régisseur et le panneau `caller` ne comptent pas ; un worktree sale donne `non` ; un commit non poussé donne `non` ; une branche sans upstream avec commit absent des distantes donne `non` ; une PR ouverte donne `non` ; build du daemon différent donne une ligne `info` sans changer `oui` ; chaque source en échec (`cate`, `git`, `gh`, `runtime.json` illisible) donne `non : <source> illisible`, jamais `oui` ; aucun appel `close`, `push` ni `worktree remove` dans `fake.calls` et `state.json` identique avant et après (FR-010).
- [ ] T007 [US2] Dans `tools/agence/test_agence.py`, tester le code de retour (0 pour `oui`, 1 pour `non`, 2 hors terminal Cate) et la première ligne exacte (`oui` ou `non : ...`) par `agence.main(['doctor', '--relance'])` avec stdout capturé. Les voir rouges (sous-commande inconnue).

### Implémentation

- [ ] T008 [US2] Dans `tools/agence/agence.py`, ajouter la fonction pure `verdict_relance(faits)` rendant `(oui, lignes)` (contrat : `contracts/interfaces.md` section 2, données : `data-model.md` « Verdict de relance »).
- [ ] T009 [US2] Dans `tools/agence/agence.py`, ajouter `lire_faits_relance(st, base=None)` : agents par `cate('agent','list')`, `caller` et ids du projet par `cate('panel','list')`, worktrees par `git worktree list --porcelain` (modèle `worktree_offers`, ligne 1494), état par `git -C <chemin> status --porcelain`, commits non poussés par `git -C <chemin> rev-list --count @{u}..HEAD` et, sans upstream, `git -C <chemin> rev-list --count HEAD --not --remotes`, PR par `gh pr list -R <repo> --state open --json number,title,headRefName` (`gh_repo(st)`), builds par `<CATE_HOME>/workspaces/*/runtime.json` dont `root` vaut la racine et `<CATE_HOME>/runtime/current` (`CATE_HOME` vaut `~/.cate` par défaut). Toute lecture en échec ajoute son nom à `illisibles`. Aucune écriture.
- [ ] T010 [US2] Dans `tools/agence/agence.py`, ajouter `cmd_doctor` (option `--relance`, sans option : même contrôle), l'entrée du `parser()` (ligne 1678) et la ligne du docstring du module. Faire passer T006 et T007 au vert.

**Checkpoint** : `npm run test:agence` vert ; `doctor --relance` lancé à la main (lecture seule) dans un terminal Cate rend une première ligne `oui` ou `non`.

---

## Phase 5 : Lot A, récit 3 : balayage des panneaux orphelins (Priority: P2) [US3]

**Goal**: offres Fermer ou Garder au suivi, sur la page du régisseur seulement (décision de l'humain, besoin n273) ; terminal orphelin = titre `#n<chiffres>` seulement (besoin n271).

**Independent Test**: classe `Orphelins` de `test_agence.py`.

### Tests d'abord (rouges)

- [ ] T011 [US3] Dans `tools/agence/test_agence.py`, nouvelle classe `Orphelins(Base)` sur `tick` avec des lignes `cate panel list` (`panelId`, `type`, `title`, `relations`) : (a) un terminal titré `#n12 implémenteur` sans agent n'est proposé qu'au 2e tour ; (b) un terminal sans agent titré autrement n'est jamais proposé ; (c) un panneau relié par `trigger` depuis l'orchestrateur, hors de tout besoin, est proposé au 2e tour ; (d) jamais proposés : orchestrateur, régisseur, suivi (`protege`), panneau d'un besoin ouvert, panneau d'un agent `running`, type `editor`, panneau du `caller` ; (e) un terminal qui a retrouvé un agent entre deux tours repart à zéro ; (f) le besoin créé a `kind 'human'`, `ref 'orphan:<panelId>'`, `owner OWNER_HUMAIN`, champ `orphan` ; un seul besoin ouvert par panneau.
- [ ] T012 [US3] Dans `tools/agence/test_agence.py`, tester les routes par la machinerie de `click(path, form)` : `POST /orphan/<n>/close` appelle `cate panel close <id>` **sans** `--discard`, ferme le besoin `done` ; sur refus de Cate, 409 avec le motif et besoin ouvert ; `POST /orphan/<n>/keep` ferme le besoin `dropped`, ajoute le panneau à `orphanGardes` et le tour suivant ne le repropose pas ; besoin déjà clos : 409 ; jeton absent : refusé ; la page de suivi affiche les deux boutons de l'offre.
- [ ] T013 [US3] Dans `tools/agence/test_agence.py`, tester qu'un panneau gardé qui meurt est retiré de `orphanGardes` et que `load()` d'un état sans `orphanVus` ni `orphanGardes` les complète (pas de migration). Les voir rouges.

### Implémentation

- [ ] T014 [US3] Dans `tools/agence/agence.py` : ajouter `orphanVus` et `orphanGardes` à `empty()` (ligne 140) ; ajouter `orphelins(st, rows, agents)` (titre `^#n\d+ `, relation `trigger` de l'orchestrateur, exclusions de `protege()` et du plan) ; appeler depuis `tick` avec un paramètre optionnel `panneaux=None` rempli par `un_tour` avec `rows` ; créer l'offre par `add_need(st, 'human', 'Fermer le panneau « <titre> » (sans agent) ?', ref='orphan:<id>', owner=OWNER_HUMAIN)` avec `n['orphan']`. Le besoin se clôt `dropped` si le panneau meurt ou devient protégé.
- [ ] T015 [US3] Dans `tools/agence/agence.py` : routes `/orphan/<n>/(close|keep)` dans `click()` sur le modèle de `/wt/` (lignes 791-815), boutons dans `need_line` (ligne 1017, `Garder` et `Fermer`), phrase d'attente dans `action_attendue` (ligne 333, « fermer ou garder le panneau »). Faire passer T011 à T013 au vert.
- [ ] T016 [US3] Dans `tools/agence/agence.py`, vérifier par `rg "orphan"` qu'aucune offre ne ferme sans clic et que le panneau agence TS (`src/panels/agence/`) n'est pas modifié (décision n273).

**Checkpoint** : `npm run test:agence` vert, `npm run typecheck` inchangé.

---

## Phase 6 : Lot B, récit 4 : clone de `node_modules` (Priority: P1) [US4]

**Goal**: `node_modules` cloné à la création du worktree, sans jamais échouer.

**Independent Test**: `npx vitest run src/workspace/repository/runtime/nodeModules.test.ts`.

### Tests d'abord (rouges)

- [ ] T017 [P] [US4] Créer `src/workspace/repository/runtime/nodeModules.test.ts` (modèle : `git.worktreePr.test.ts`, dossiers temporaires `fs.mkdtemp`, `test.skipIf(process.platform !== 'darwin')`). Cas contre `cloneNodeModules(rootDir, targetPath)` : racine avec `node_modules` et lockfile identique donne un `node_modules` dans la cible avec le même contenu ; racine sans `node_modules` donne rien et pas d'erreur ; lockfiles différents donne rien ; aucun lockfile des deux côtés donne rien ; cible qui a déjà un `node_modules` donne aucun écrasement ; copie qui échoue (fichier source `chmod 000`) donne cible sans `node_modules` partiel et pas d'erreur ; un lien symbolique relatif de `.bin` est conservé comme lien. Les voir rouges (module absent).
- [ ] T018 [P] [US4] Dans le même fichier, test d'intégration `addWorktree` sur un dépôt git temporaire (`testGitHost` de `src/test/testGit`, comme `git.worktreePr.test.ts`) : après `addWorktree`, `<cible>/node_modules` existe quand les conditions sont réunies ; avec un `cloneNodeModules` qui échoue, `addWorktree` rend quand même `{ path, branch }`.

### Implémentation

- [ ] T019 [US4] Créer `src/workspace/repository/runtime/nodeModules.ts` : `cloneNodeModules(rootDir: string, targetPath: string): Promise<void>` selon `research.md` R4 (darwin seul, premier lockfile parmi `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` comparé octet à octet, `execFile('cp', ['-cR', …])` asynchrone avec délai de 120 s, `fsp.rm(<cible>/node_modules, { recursive: true, force: true })` si échec, aucune exception ne sort). Pas de dépendance nouvelle.
- [ ] T020 [US4] Dans `src/workspace/repository/runtime/git.ts`, `addWorktree` (ligne 956) : importer et appeler `await cloneNodeModules(<racine du dépôt>, targetPath)` entre `git.raw(args)` et `deps.addCheckout(targetPath)` (une ligne plus l'import). Ne rien changer d'autre. Faire passer T017 et T018 au vert.
- [ ] T021 [US4] `npm run typecheck`, `npm run lint`, `npm run lint:deps` : 0 erreur. Vérifier que `git.ts` n'a gagné que l'import et l'appel (`git diff --stat`).
- [ ] T022 [US4] (T-B05) Preuve des modules natifs pour la PR : dans un dossier du scratchpad, `cp -cR <racine>/node_modules .` puis le `node` du runtime (`quickstart.md`, lot B) charge `@parcel/watcher` et `node-pty`. Consigner commande, résultat et durée de la copie. Ne pas lancer l'app.

**Checkpoint** : tests verts, preuve consignée. Écart `src/` listé dans la PR (constitution IX).

---

## Phase 7 : Lot C, récit 5 : gabarit de brief (Priority: P3) [US5]

**Goal**: l'interdit des fenêtres et l'état du HEAD figurent dans le gabarit ; hors du fork.

**Independent Test**: `python3 ~/.claude/setup/check.py` et `rg` sur `SKILL.md`.

- [ ] T023 [P] [US5] Dans `~/.claude/skills/orchestrateur/evals.json`, ajouter un cas qui échoue tant que le gabarit ne contient pas « ouvrir une fenêtre » et « poussé : oui ou non », et tant que l'étape 2 dit encore « 8 agents » ou « ne compte pas » (suivre le format des cas existants du fichier). Lancer `python3 ~/.claude/setup/check.py --only skills` et le voir rouge.
- [ ] T024 [US5] Dans `~/.claude/skills/orchestrateur/SKILL.md`, bloc « Brief d'un sous-agent » : ajouter à la ligne `Interdit` « lancer Playwright, Electron ou l'app Cate, ouvrir une fenêtre » et à la ligne `Fin` « HEAD <sha>, poussé : oui ou non » (texte exact : `contracts/interfaces.md` section 6). Étape 2 de « Pour chaque tâche que Heifara te donne » : remplacer « Au plus 8 agents en plein tour par projet (réglable : `agence start --max-agents <n>`) ; un agent qui attend une saisie ne compte pas. » par « Au plus 4 agents vivants par projet (réglable : `agence start --max-agents <n>`) ; un agent qui attend une saisie compte. » (FR-024, complément du contradicteur pour #54, aligné sur #50). Chercher la phrase par son texte, pas par un numéro de ligne. Garder le français, phrases courtes, aucun tiret long. Faire passer T023 au vert.
- [ ] T025 [US5] Vérifier que la copie versionnée `~/Documents/Skills` n'est pas la source à jour (rapport A : `~/.claude` fait foi) et le dire dans le rapport ; ne rien y écrire sans accord.

---

## Phase 8 : Lot C, récit 6 : hook anti-fenêtre (Priority: P3) [US6]

**Goal**: refuser Playwright, Electron et `npm run dev` dans `.cate/worktrees/`.

**Independent Test**: `python3 ~/.claude/setup/check.py --only hooks`.

### Tests d'abord (rouges)

- [ ] T026 [US6] Dans `~/.claude/hooks/tests/cases.json`, ajouter les cas (format des cas existants : `name`, `hook: "window-guard.sh"`, `stdin` avec `tool_name`, `tool_input.command`, `cwd`, `exit`, `stderr_has`) : **bloqués** (exit 2, `cwd` sous `.cate/worktrees/x`) `npx playwright test x`, `npm run test:e2e`, `electron .`, `npm run dev`, `cd e2e && npx playwright test` ; **autorisés** (exit 0) `npx vitest run`, `npm run typecheck`, `grep playwright fichier`, `git commit -m "docs: playwright"`, `ALLOW_E2E=1 npx playwright test x` ; **hors worktree** (exit 0) `npx playwright test x` avec un `cwd` ordinaire. Les voir rouges (hook absent).

### Implémentation

- [ ] T027 [US6] Créer `~/.claude/hooks/window-guard.sh` (préfiltre bash `grep -qiE 'playwright|test:e2e|electron|npm run dev'` puis `python3 "$HOME/.claude/hooks/window_guard.py"`, modèle `workflow-guard.sh`) et `~/.claude/hooks/window_guard.py` : lit le JSON, sort 0 si `cwd` ne contient pas `/.cate/worktrees/` ; découpe la commande en instructions (`;`, `&&`, `||`, `|`, retour à la ligne), ignore les chaînes entre guillemets, retire les préfixes `VAR=valeur` en notant `ALLOW_E2E=1`, bloque une instruction qui commence par `playwright test`, `npx playwright`, `pnpm exec playwright`, `npm run test:e2e`, `npm run dev`, `electron`, `npx electron` ; sortie 2 avec le message de `contracts/interfaces.md` section 5. Pas de dépendance. Faire passer T026 au vert.
- [ ] T028 [US6] Enregistrer le hook dans le groupe `Bash` de `PreToolUse` de `~/.claude/settings.json` (après `workflow-guard.sh`). **Écriture d'un fichier de réglages : accord explicite de l'humain avant, voir `~/.claude/CLAUDE.md`**. Puis `python3 ~/.claude/setup/check.py` : 0 échec ; `python3 ~/.claude/setup/measure.py --label "hook window-guard"` consigné.
- [ ] T029 [US6] Dire dans le rapport la limite : les appels MCP Playwright ne passent pas par `Bash` et ne sont pas couverts.

---

## Phase 9 : Polish et clôture

- [ ] T030 Lot A : `npm run test:agence` complet vert, `python3 tools/agence/agence.py --help` liste `doctor`, relecture de `git diff --stat` (deux fichiers seulement).
- [ ] T031 Lot B : `npm test -- src/workspace/repository` vert, `npm run lint:deps` vert, `git diff --stat` (trois fichiers).
- [ ] T032 Pour chaque lot : PR vers `main` du fork (`gh pr create -R Heifarabuval/cate --base main`), corps court, `Closes #N` pour chaque récit réglé en entier (lot A : #50, #51, #52 ; lot B : #53), `Réf. #N` si le récit est partiel, écart upstream listé (lot B), « relance ou redéploiement nécessaire : oui, rebuild et arrêt du daemon pour embarquer `agence.py` » (lot A), « non exécuté : e2e » (tous).
- [ ] T033 Vérificateur de chaque lot : relire les fichiers modifiés, relancer les tests du lot, vérifier l'absence de code mort (grep des textes « ne comptent pas » dans `agence.py`, `test_agence.py`, le skill) et rendre le rapport à l'orchestrateur.

---

## Dépendances et ordre d'exécution

- Lots A, B, C : **indépendants**, lançables ensemble. Aucun fichier commun (tableau plus haut).
- Dans le lot A : récit 1, puis 2, puis 3 (même fichier ; `tick`, `parser` et `empty()` sont touchés par plusieurs récits).
- Dans chaque récit : tests rouges, puis code, puis vérification.
- Lot C : T028 attend l'accord de l'humain pour `settings.json`.
- T032 et T033 en dernier, par lot.

### Exemple de parallélisme

```text
Agent 1 (lot A) : T001 T002 T003 T004 T005 T006 ... T016 T030
Agent 2 (lot B) : T001 T017 T018 T019 T020 T021 T022 T031      [P] avec le lot A
Agent 3 (lot C) : T023 T024 T025 T026 T027 T028 T029            [P] avec A et B
Vérificateurs   : un par lot, T033, jamais l'implémenteur du lot
```

## Stratégie

- Priorité de livraison : récit 1 (P1, quelques lignes) et récit 4 (P1) d'abord. Récits 2 et 3 (P2) ensuite. Récits 5 et 6 (P3).
- MVP : récit 1 seul supprime la cause directe du force quit.
- Plafond d'agents au lancement des lots : 4 agents vivants au plus (trois implémenteurs plus un vérificateur à la fois).
- Chaque lot est livrable seul : l'échec d'un lot ne bloque pas les autres.
