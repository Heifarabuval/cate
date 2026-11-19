---

description: "Tâches : orchestrateur portable (réconciliation et lots ouverts)"
---

# Tasks: Orchestrateur portable

**Input**: `specs/002-orchestrateur-portable/` (spec.md, plan.md, research.md, data-model.md, contracts/cli-agence.md, contracts/hooks.md, quickstart.md)

**Prerequisites**: plan.md, spec.md. Tests demandés : la constitution (principe VI) les exige avant le code. Chaque tâche de test vient avant sa tâche de code et doit être vue **rouge** pour la bonne raison (sortie citée). Tout test qui touche `~/.claude`, `~/.cate`, `launchctl` ou `git config --global` tourne dans un faux HOME (`tempfile.mkdtemp()` ou `mktemp -d`, `GIT_CONFIG_GLOBAL` dans ce dossier) et échoue s'il détecte le vrai HOME.

**Interdits à tout agent** (constitution X) : lancer Playwright, Electron, l'app Cate ou `npm run dev`, ouvrir une fenêtre, lancer `npm ci` ou `npm install`, charger un agent launchd réel, écrire dans le vrai `~/.claude`. Pas de merge, de push sur `main`, de force-push, de suppression de branche.

## Format: `- [ ] ID [P] [US] Description avec chemin`

- **[P]** : parallélisable (autre fichier, aucune dépendance non finie).
- **[US1] à [US4]** : récit de la spec. **[H]** : action de Heifara ou de Max, jamais d'un agent.
- **Modèle** conseillé : haiku (mécanique), sonnet (implémentation courante), opus (fusion de `settings.json`, garde d'envoi, amorçage qui écrit chez un autre : une erreur ouvre un trou de sécurité ou écrase une config).
- Un implémenteur par lot, un worktree par agent, un vérificateur différent de l'implémenteur.

## Partie A : réconciliation avec la spec 006 de Skills (au 2026-11-19)

Base lue : `origin/main` du fork, `4630c3d2`. Une case cochée porte sa preuve (PR mergée ou chemin:ligne). Une case ouverte renvoie à sa tâche de la partie B. Aucune case cochée sans preuve.

Bilan : **36 cochées**, 5 retirées (L2-01, L2-04, L2-05 par la décision q303 ; L2-08, L2-09 par le principe VIII), 40 ouvertes, plus les 3 cases de « Ce que Heifara doit faire » ouvertes. Une case retirée reste décochée : rien n'a été fait, la raison est écrite.

### Lot 0 : risques (5 sur 5)

- [x] L0-01 python3 sur un Mac sans outils développeur. Preuve : `rapport-lot0.md:20-56` (Skills `78a8fd3`). Verdict « non démontré » pour un compte sans CLT ; le risque est levé par le lanceur livré, qui n'appelle ni `xcrun` ni `/usr/bin/python3` (`tools/agence/agence:7-15`, PR #30). Compte réel sans CLT : non vérifié (X003).
- [x] L0-02 PATH d'un terminal restauré. Preuve : `rapport-lot0.md:57-94` (sonde Vitest). Vrai terminal restauré : non vérifié (X003).
- [x] L0-03 Fusion de `settings.json` hostile. Preuve : `rapport-lot0.md:95-137`, `fixtures/` de cette spec. Écart : fixtures sous la spec, pas de `heifara-neutre.json` (rien copié du vrai fichier).
- [x] L0-04 Trois hypothèses lisibles dans le code. Preuve : `rapport-lot0.md:138-147`.
- [x] L0-05 Synthèse. Preuve : `rapport-lot0.md:11-18`, commit Skills `78a8fd3` « docs(specs): rapport des sondes du lot 0 (#n166) ».

### Lot 1 : la CLI dans le runtime (18 sur 19), PR #30

- [x] L1-01 Test du lanceur. Preuve : `tools/agence/test_launcher.py:58-80` (7 tests), PR #30.
- [x] L1-02 Lanceur POSIX `agence`. Preuve : `tools/agence/agence:1-27`, PR #30.
- [x] L1-03 CLI et tests importés tels quels. Preuve : PR #30 (copie octet pour octet depuis Skills `feat/agence-speckit`, 248 tests sous `/usr/bin/python3` 3.9.6).
- [x] L1-04 Test `--version`. Preuve : `tools/agence/test_agence.py:3226` (classe `Version`).
- [x] L1-05 `agence --version`. Preuve : `tools/agence/agence.py:1833-1845`.
- [x] L1-06 Test de l'agencement. Preuve : `src/runtime/daemon/contract.test.ts:23-24` (écart : `contract.test.ts`, pas `install.test.ts`).
- [x] L1-07 `layout.agence`. Preuve : `src/runtime/daemon/contract/install.ts:93`.
- [x] L1-08 Test du tarball. Preuve : `scripts/build-runtime-tarball.test.mjs:33-45`.
- [x] L1-09 Tarball. Preuve : `scripts/build-runtime-tarball.mjs:143`, `:161`, `scripts/agence-files.mjs:9`.
- [x] L1-10 Test du lanceur de terminal. Preuve : `src/services/terminal/runtime/cateCli.test.ts:86`.
- [x] L1-11 `cateCli.ts` écrit `agence`. Preuve : `src/services/terminal/runtime/cateCli.ts:81`.
- [x] L1-12 Test du lanceur du régisseur. Preuve : `src/runtime/daemon/compose/cliEnv.test.ts:26-53`.
- [x] L1-13 `cliEnv.ts` écrit `agence`. Preuve : `src/runtime/daemon/compose/cliEnv.ts:55`.
- [x] L1-14 Câblage. Preuve : `src/runtime/daemon/compose/workspace.ts:108`, `:246`, `:257`.
- [x] L1-15 Risque `CATE_RUNTIME_BUNDLE`. Preuve : `agenceLauncher`, `src/runtime/daemon/contract/install.ts:108-115` ; test `src/runtime/daemon/contract.test.ts:31-35`.
- [x] L1-16 CI Python 3.9. Preuve : `package.json:42`, `.github/workflows/ci.yml:86-102` ; job `agence (macos-latest)` vert sur la PR #30 (run 44288098274).
- [ ] L1-17 Preuve de bout en bout du PATH (`env -i ... agence --help`). Ouverte : aucune sortie citée ; la PR #30 dit « terminal réellement restauré non vérifié ». Reprise par T048 et T049.
- [x] L1-18 Documentation. Preuve : `CLAUDE.md:266-268`, `docs/architecture.md:482`, `:1553-1560`.
- [x] L1-19 Portes et PR du lot 1. Preuve : PR #30, CI `build (macos-latest)`, `build (ubuntu-latest)`, `agence (macos-latest)` verts (run 44288098274). `build (windows-latest)` en échec : hors cible (principe VIII).

### Lot 2 : portable (2 sur 18, 5 retirées), PR #41 pour la partie livrée

- [ ] L2-01 Fixture d'un vrai état de Heifara. **Retirée** : la valeur stockée reste `heifara` sans migration (q303, besoin n304), plus de compatibilité à prouver par fixture ; la relecture d'une copie reste (T013).
- [x] L2-02 Test du nom. Preuve : `tools/agence/test_agence.py:104` (classe `Nom`), PR #41. Écart : défaut « L'humain », pas « toi ».
- [x] L2-03 `nom()` et `agence nom`. Preuve : `tools/agence/agence.py:80-96`, `:1925`, PR #41.
- [ ] L2-04 Test de compatibilité des états. **Retirée** : même raison (q303).
- [ ] L2-05 Valeur stockée `humain`. **Retirée** pour la valeur stockée (q303). Le reste est livré par la PR #41 : textes au nom de l'humain (`test_agence.py:221`, classe `NomDansLesTextes`), alias `--owner heifara` retiré.
- [ ] L2-06 Test : `watch` écrit `humain`. Ouverte : T007.
- [ ] L2-07 `watch` écrit `humain`. Ouverte : T008.
- [ ] L2-08 Test `toast()` hors macOS. **Retirée** : principe VIII ; `toast()` journalise déjà un échec (`agence.py:315-321`).
- [ ] L2-09 `toast()` dégradé. **Retirée** : même raison.
- [ ] L2-10 Test 404 sous `--token-stdin`. Ouverte : T011.
- [ ] L2-11 `do_GET` 404 sous `--token-stdin`. Ouverte : T012.
- [ ] L2-12 Test de pureté. Ouverte : la classe `SansNomEnDur` (`test_agence.py:182`) ne couvre que `agence.py` ; T003 couvre le skill et le panneau.
- [ ] L2-13 Skill livré. Ouverte : T004, T005, T006.
- [ ] L2-14 Test du suivi avec le nom. Ouverte : T009.
- [ ] L2-15 Panneau au nom de l'humain. Ouverte : T010 (`SuiviList.tsx:12` dit « À faire par Heifara »).
- [ ] L2-16 [H] Heifara règle son nom. Ouverte : `git config --global --get agence.nom` vide (code 1, lu le 2026-11-19). T014.
- [ ] L2-17 Ses états existants se relisent. Ouverte : T013.
- [ ] L2-18 Portes et PR du lot 2. Ouverte : T015.

### Lot 3 : gardes et doctor (11 sur 12), branche `feat/agence-gardes`

- [x] L3-01 Tests de l'installeur sur config hostile. Preuve : T017.
- [x] L3-02 `agence hooks`. Preuve : T018.
- [x] L3-03 Tests du garde qui échoue fermé. Preuve : T019.
- [x] L3-04 `guard --mode` et `agence-hook`. Preuve : T020 à T022.
- [x] L3-05 Tests de `doctor`. Preuve : T023 (option `--prerequis`, q305).
- [x] L3-06 `agence doctor`. Preuve : T024.
- [x] L3-07 Test : `watch` écrit `garde`. Preuve : T025.
- [x] L3-08 `watch` écrit `garde`. Preuve : T026.
- [x] L3-09 Test de la bannière. Preuve : T027.
- [x] L3-10 Panneau : `garde` et bannière. Preuve : T028.
- [x] L3-11 Documentation. Preuve : T029.
- [ ] L3-12 Portes et PR du lot 3. Ouverte : T030.

### Lot 4 : mise à jour automatique et amorçage (6 sur 11), PR #40

- [x] L4-01 Risque updater upstream. Preuve : `scripts/cate-fork-update.sh:235` (`CATE_SELF_UPDATE=0`), assertion `scripts/cate-fork-install.test.mjs:288`.
- [x] L4-02 Tests du script de mise à jour. Preuve : `scripts/cate-fork-install.test.mjs:277-583` (Node sous nvm, Homebrew, PATH ; Node absent ou trop vieux ; Cate ouvert ; build en échec ; verrou ; 5 Go ; hors macOS), `--prereq` à `:320`. Cas 7 (aucun daemon arrêté) : `scripts/cate-fork-update.sh` ne contient aucun `kill` (grep vide). Écart : fichier `cate-fork-install.test.mjs`, pas `cate-fork-update.test.mjs`.
- [x] L4-03 `scripts/cate-fork-update.sh`. Preuve : PR #40 (43 tests, shellcheck vert sur la CI ubuntu).
- [x] L4-04 Test du plist. Preuve : `scripts/cate-fork-install.test.mjs:784-810`. Écarts : étiquette `com.cate.fork-update`, pas de `RunAtLoad` (PR #40, point M3).
- [ ] L4-05 Tests de l'amorçage. Ouverte en partie : prérequis, idempotence, `main` en dernière ligne (`scripts/cate-fork-install.sh:70`, `:163`) livrés ; gardes, `doctor` et résumé : T033.
- [ ] L4-06 Script d'amorçage. Ouverte en partie : livré sous le nom `scripts/cate-fork-install.sh` ; gardes et `doctor` : T034.
- [ ] L4-07 Test de `doctor --hors-cate`. Ouverte : T031.
- [ ] L4-08 `doctor --hors-cate`. Ouverte : T032.
- [ ] L4-09 Désinstallation. Ouverte en partie : `scripts/cate-fork-uninstall.sh [--purge]` livré ; `--gardes` : T035, T036.
- [x] L4-10 Documentation de la ligne. Preuve : `scripts/cate-fork-install.md` (PR #40). Écart : ce fichier, pas `README.md`.
- [x] L4-11 Portes et PR du lot 4. Preuve : PR #40 (typecheck, lint, lint:deps, 43 tests cités ; CI verte, run 44324228492).

### Lot 4b : le daemon suit l'app (5 sur 5), PR #27

- [x] L4B-01 Tests Vitest. Preuve : `src/client/connections/runtimeUpdate.test.ts` (PR #27).
- [x] L4B-02 Correctif. Preuve : `src/client/connections/runtimeUpdate.ts:38-43`.
- [x] L4B-03 Texte de l'écran. Preuve : `src/shells/desktop/ui/app/workspace/RuntimeMismatch.tsx` et son test (PR #27). Capture réelle : non vérifiée.
- [x] L4B-04 Documentation. Preuve : `docs/architecture.md` modifié par la PR #27.
- [x] L4B-05 Portes et PR. Preuve : PR #27, Closes #26 ; CI `build (macos-latest)` et `build (ubuntu-latest)` verts (run 44285257253).

### Lot 5 : bascule de Skills (0 sur 8)

- [ ] L5-01 à L5-08 Ouvertes : T039 à T046, à confier au projet Skills.

### Transversal (0 sur 3)

- [ ] X001 Parcours en faux HOME. Ouverte : T047.
- [ ] X002 Relecture finale. Ouverte : T048.
- [ ] X003 [H] Essai réel par Max. Ouverte : T049.

### Ce que Heifara doit faire (0 sur 3)

- [ ] Régler son nom : T014.
- [ ] Merger les PR du fork. En partie : #27, #30, #40, #41 mergées ; restent celles des lots 2, 3 et 4.
- [ ] Envoyer à Max la ligne unique, une fois le lot 4 mergé. Non vérifiable depuis le dépôt.

---

## Partie B : lots ouverts

## Lots, sans fichier commun hors `agence.py`

| Lot | Récits | Fichiers (liste fermée) | Tâches | Taille |
|---|---|---|---|---|
| **2. Portable** | US1, US3 | `tools/agence/{agence.py,test_agence.py,test_portable.py}`, `skills/orchestrateur/SKILL.md`, `scripts/build-runtime-tarball.mjs`, `src/panels/agence/{contract/types.ts,contract/suivi.ts,contract/suivi.test.ts,contract/fixtures/,session.ts,session.test.ts}`, `src/shells/desktop/ui/panels/agence/{SuiviList.tsx,SuiviList.test.tsx}`, `docs/architecture.md` | 12 | 1,25 j |
| **3. Gardes et prérequis** | US2, US1 | `tools/agence/{agence.py,agence-hook,test_hooks.py,test_guard.py,test_doctor.py,test_agence.py,fixtures/settings/}`, `scripts/{agence-files.mjs,build-runtime-tarball.test.mjs}`, `src/panels/agence/{contract/types.ts,session.ts,session.test.ts}`, `src/shells/desktop/ui/panels/agence/{AgenceView.tsx,AgenceView.test.tsx,RegisseurBanner.tsx}`, `docs/architecture.md`, `CLAUDE.md` | 15 | 2 j |
| **4. Amorçage complet** | US4, US1 | `tools/agence/{agence.py,test_doctor.py}`, `scripts/{cate-fork-install.sh,cate-fork-uninstall.sh,cate-fork-install.test.mjs,cate-fork-install.md}` | 8 | 0,75 j |
| **5. Bascule de Skills** | US3 | dépôt Skills seulement | 8 (7 agent, 1 [H]) | 0,5 j, à confier au projet Skills |
| **X. Recette** | tous | `tools/agence/test_quickstart.py`, `specs/002-orchestrateur-portable/rapport-final.md` | 3 (2 agent, 1 [H]) | 0,75 j |

Lots 2 et 3 en parallèle (deux agents) : `agence.py`, `test_agence.py`, `types.ts`, `session.ts`, `session.test.ts` et `docs/architecture.md` sont communs ; ajouts disjoints, fusionner 2 avant 3 et rebaser 3. Lot 4 après le lot 3 (`doctor --prerequis`).

## Phase 1 : Setup

- [ ] T001 Chaque implémenteur crée sa branche depuis `origin/main` du fork (pas `upstream/main`) dans son worktree `.cate/worktrees/<lot>` : `feat/agence-portable` (lot 2), `feat/agence-gardes` (lot 3), `feat/agence-amorcage` (lot 4). Vérifier `git merge-base --is-ancestor origin/main HEAD`. Annoncer sur le bus `repo:cate` la liste de fichiers du lot. Modèle : haiku.
- [ ] T002 Lire avant d'écrire un test : lots 2 et 3, `tools/agence/agence.py` (`OWNER_HUMAIN` :71, `nom_source` :80, `empty()` et `load()`, `do_GET` :1164, `guard` :1770, `cmd_doctor` :1676, `parser` :1845-1930) et la classe `Tour` de `test_agence.py` ; lot 4, `scripts/cate-fork-install.sh` (`main` :70) et les aides de `scripts/cate-fork-install.test.mjs` (faux HOME, `fake()`, `called()`). Modèle : haiku.

**Checkpoint** : base vérifiée, aucun fichier modifié.

## Phase 2 : Foundational

Aucune tâche bloquante entre lots. Décisions de Heifara (2026-11-19) : valeur stockée `owner` gardée à `heifara`, sans migration (q303) ; `agence doctor --prerequis`, `doctor` seul inchangé (q305) ; `cliTerminalInputEnabled` reste coupé (q307).

---

## Lot 2 : portable (US1, US3)

**Goal**: Max voit son nom dans le panneau, le skill est semé dans ses dépôts, le jeton du régisseur ne sort jamais dans une page.

**Independent Test**: `npm run test:agence` et Vitest du panneau verts ; `python3 -m unittest tools/agence/test_portable.py` vert ; un état réel de Heifara relu sur une copie.

- [ ] T003 [P] [US1] Test rouge de pureté (SC-002, FR-005, FR-012) dans `tools/agence/test_portable.py` : aucun `Heifara`, `heifara`, `U02FQHK9FPD`, `/Users/` dans `tools/agence/*.py` hors `test_*`, dans `skills/orchestrateur/`, `src/panels/agence/` et `src/shells/desktop/ui/panels/agence/` hors `*.test.*` et `fixtures/` ; liste blanche : la seule ligne `OWNER_HUMAIN` de `agence.py` et la constante jumelle de `suivi.ts` (clé gardée, q303) ; `skills/orchestrateur/SKILL.md` doit exister. Rouge attendu : `SuiviList.tsx:12`, skill absent. Modèle : haiku.
- [ ] T004 [US1] Skill livré `skills/orchestrateur/SKILL.md` : partir de `~/.claude/skills/orchestrateur/SKILL.md` lu en lecture seule (version après la spec 001, lot C), remplacer « Heifara » par « l'humain » et `agence nom`, retirer toute référence à Skills ou à `~/Documents/`, garder la règle « brouillon seulement » et le repli sur trois panneaux. `evals.json` non copié (outil de Skills). Preuve : T003 vert pour le skill ; frontmatter valide (`scripts/skillFrontmatter.mjs`) ; `npx vitest run src/workspace/skills/runtime/seed.test.ts` vert. Modèle : sonnet.
- [ ] T005 [US1] Liste `required` du tarball : ajouter `path.join('skills', 'orchestrateur', 'SKILL.md')` à côté de `cate-cli` (`scripts/build-runtime-tarball.mjs:160`). Preuve : `npm run runtime:tarball` puis `tar -tzf` liste `skills/orchestrateur/SKILL.md` (sortie citée). Modèle : haiku.
- [ ] T006 [P] [US1] `docs/architecture.md` : section 9.6 et ligne `skills/` de l'arbre (`:2860`) nomment `orchestrateur` parmi les skills livrés. Preuve : diff relu. Modèle : haiku.
- [ ] T007 [P] [US1] Test rouge dans `tools/agence/test_agence.py` (classe `Tour`) : `watch` écrit `st['humain'] = nom()` à chaque tour ; un état ancien sans `humain` est complété par `empty()` ; avec `AGENCE_NOM=Max`, `humain` vaut `Max`. Modèle : sonnet.
- [ ] T008 [US1] `watch` écrit `humain` ; `empty()` gagne `humain: "L'humain"` (`tools/agence/agence.py`). Preuve : T007 vert, `npm run test:agence` vert. Modèle : sonnet.
- [ ] T009 [P] [US1] Test rouge du panneau : l'instantané porte `humain` (« L'humain » si absent) ; la section `aFaire` s'intitule « À faire par Max » avec `humain: 'Max'` dans l'état. Fichiers : `src/panels/agence/contract/fixtures/state.json`, `src/panels/agence/contract/suivi.test.ts`, `src/panels/agence/session.test.ts`, `src/shells/desktop/ui/panels/agence/SuiviList.test.tsx`. Modèle : sonnet.
- [ ] T010 [US1] Panneau : `humain: string` dans `src/panels/agence/contract/types.ts`, lu par `src/panels/agence/session.ts`, titre de `src/shells/desktop/ui/panels/agence/SuiviList.tsx:12` ; la valeur stockée comparée par `src/panels/agence/contract/suivi.ts:86-87` devient une constante nommée (une seule occurrence). Preuve : T009 vert ; `npm run typecheck`, `npm run lint`, `npm run lint:deps` verts. Modèle : sonnet.
- [ ] T011 [P] [US2] Test rouge dans `tools/agence/test_agence.py` : sous `watch --token-stdin`, `GET /`, `/draft/<id>`, `/ask/<id>` rendent 404 sans jeton dans le corps ; le `POST` JSON marche ; sans l'option, les pages restent. Modèle : sonnet.
- [ ] T012 [US2] `do_GET` rend 404 sous `--token-stdin` (`tools/agence/agence.py:1164-1179`). Vérifier d'abord par lecture que le panneau ne fait aucun `GET` (`src/panels/agence/session.ts`). Preuve : T011 vert. Modèle : sonnet.
- [ ] T013 [US3] Ses états se relisent (SC-005) : copier un `state.json` réel de Heifara dans un dossier jetable (jamais écrire dans `.cate/tmp/agence/` d'un projet), lancer la CLI du worktree : `agence need list` identique à celui de `~/.claude/bin/agence` hors nom ; `shasum` de l'original identique avant et après. Modèle : haiku.
- [ ] T014 [H] [US3] Heifara règle son nom : `git config --global agence.nom Heifara`. L'agent contrôle ensuite en lecture seule : `agence nom` rend `Heifara` et la source `git agence.nom`.
- [ ] T015 Portes et PR du lot 2 : `npm run typecheck && npm run lint && npm run lint:deps && npm test && npm run test:agence` ; T003 vert ; code mort listé (titre « Heifara » du suivi). Corps : `Réf. #29`, risque « `agence.py` commun avec le lot 3 : fusionner 2 avant 3 ». Modèle : haiku.

**Checkpoint lot 2** : le panneau dit « À faire par <nom> », le skill est dans le tarball, plus aucune page sous le panneau.

---

## Lot 3 : gardes et prérequis (US2, US1)

**Goal**: seul le clic de l'humain envoie, chez Max aussi ; `doctor --prerequis` dit ce qui manque.

**Independent Test**: faux HOME avec un `settings.json` existant ; `agence hooks install` deux fois puis `uninstall` ; commande réelle du hook sans CLI : `ask`.

- [x] T016 [US2] Copier `specs/002-orchestrateur-portable/fixtures/*` dans `tools/agence/fixtures/settings/` ; écrire `settings-attendu.json` (les deux entrées de `contracts/hooks.md`, texte figé ici). Modèle : haiku. **Fait** : `tools/agence/fixtures/settings/` : les 7 fixtures du lot 0 et `settings-attendu.json` extrait du bloc de `contracts/hooks.md`, égal à `HOOK_ENTREES` (`test_hooks.py`, fonction `attendu`).
- [x] T017 [US2] Tests rouges de l'installeur (FR-007, SC-003) dans `tools/agence/test_hooks.py`, faux HOME : JSON invalide : code 2, rien écrit, pas de sauvegarde ; hooks de l'utilisateur sur le même matcher : intacts, entrées agence ajoutées une fois ; fichier absent : créé ; fichier ou dossier en lecture seule : code 2, rien écrit ; mode 0444 d'un fichier inscriptible par le dossier : conservé ; lien symbolique : la cible est écrite, le lien reste ; deux `install` = un, une sauvegarde `settings.json.bak-agence-<AAAAMMJJ-HHMMSS>` ; `uninstall` rend le JSON d'origine et retire un `PreToolUse` ou `hooks` vidé ; `permissions` et clés inconnues intactes ; `status` : `actif` 0, `inactif` 1, `partiel` 1 ; `setUp` échoue si `HOME` est le vrai. Preuve : rouge, chaque cas pour sa raison ; `shasum ~/.claude/settings.json` identique avant et après la suite. Modèle : opus. **Fait** : rouge : `/usr/bin/python3 -m unittest test_hooks.py` (3.9.6) donne `Ran 23 tests`, `FAILED (failures=25, errors=2)`, `invalid choice: 'hooks'` ; les cas « code 2 » exigent le message `agence : ` (sinon l'erreur d'argparse, code 2 aussi, les rendait verts). Vert : `Ran 23 tests OK`. Le module compare l'empreinte du vrai `~/.claude/settings.json` (lecture seule) avant et après (`tearDownModule`) ; `shasum -a 256` relevé `9987e97e68de6ae8` avant et après `npm run test:agence` et `npm test`. Écarts : un fichier 0444 est refusé (code 2) et garde son mode 0444, un fichier 0640 inscriptible garde 0640 ; la sauvegarde d'un lien va à côté du chemin nommé (`~/.claude`), pas dans le dossier de la cible.
- [x] T018 [US2] `agence hooks install|uninstall|status [--settings <chemin>] [--json]` dans `tools/agence/agence.py` : json stdlib, écriture atomique comme `tx`, lien résolu, sauvegarde seulement si le fichier change, entrées reconnues à `agence-hook` dans leur commande, aucune permission ajoutée. Preuve : T017 vert, `npm run test:agence` vert. Modèle : opus. **Fait** : `tools/agence/agence.py:1946-2100` (`HOOK_ENTREES` :1946, `lire_settings` :1968 en `utf-8-sig` et clés uniques, `garde_statut` :1988, `ecrire_settings` :2020 avec `os.access`, sauvegarde `xb` puis `mkstemp` + `fsync` + `os.replace` sur `realpath`, `cmd_hooks` :2078). T017 vert ; `npm run test:agence` : `Ran 391 tests OK`.
- [x] T019 [US2] Tests rouges du garde (FR-008, US2 scénarios 4 et 5) dans `tools/agence/test_guard.py` : exécuter **réellement** la commande lue dans le `settings.json` produit par T018, via `sh -c`, faux HOME, `PreToolUse` sur stdin. `send` : `~/.cate/runtime/current` absent → `ask` ; `current` vers un dossier sans `agence-hook` → `ask` ; `agence-hook` non exécutable → `ask` ; CLI présente et brouillon cliqué identique → `allow` ; sans clic → `ask` ; aucune exception de canal. `pages` : CLI absente → sortie 0 vide ; sans `state.json` → sortie immédiate. `guard` sans `--mode` : comportement actuel. Un cas qui échouerait ouvert fait échouer le test. Modèle : opus. **Fait** : rouge : `Ran 21 tests`, `FAILED (errors=18)`, `FileNotFoundError: .../tools/agence/agence-hook` ; verts dès le départ, voulus : `current` absent et dossier sans `agence-hook` (repli `sh -c` du contrat), `pages` sans CLI, `guard` sans `--mode`. Couvre aussi python3 absent, CLI qui sort en erreur ou sans décision, stdin illisible, build courant cassé : `ask`. Vert : `Ran 21 tests OK` sous 3.9.6 et 3.14.
- [x] T020 [US2] `agence guard --mode send|pages` (`tools/agence/agence.py`, `guard` :1770, `cmd_guard` :1812) et le lanceur `tools/agence/agence-hook` (0755, même recherche de python3 que `tools/agence/agence`, `send` sans python3 → `ask`). Preuve : T019 vert. Modèle : opus. **Fait** : `tools/agence/agence-hook` (mode 0755), `agence.py:1873` (`guard(payload, mode)`, `send` jamais `None`), `:1920` (`cmd_guard`, toute exception en `ask`). T019 vert. Écart au contrat : `agence-hook send` ne fait pas un simple `exec`, il rend `ask` si la CLI échoue ou ne rend pas de décision (`contracts/hooks.md` mis à jour).
- [x] T021 [P] [US2] Test rouge : `AGENCE_REQUIRED` contient `agence/agence-hook` (`scripts/build-runtime-tarball.test.mjs:33`). Modèle : haiku. **Fait** : rouge : `npx vitest run scripts/build-runtime-tarball.test.mjs` donne `1 failed | 2 passed`, `AGENCE_REQUIRED` sans `agence/agence-hook`.
- [x] T022 [US2] `scripts/agence-files.mjs:9` gagne `agence-hook`. Preuve : T021 vert ; `npm run runtime:tarball` puis `tar -tzf` liste `agence/agence-hook`. Modèle : haiku. **Fait** : `scripts/agence-files.mjs:9`. T021 vert (`3 passed`) ; `npm run runtime:tarball` puis `tar -tvzf dist-runtime/cate-runtime-2.1.0-beta.15-darwin-arm64.tgz` liste `-rwxr-xr-x ./agence/agence-hook`.
- [x] T023 [P] [US1] Tests rouges de `doctor --prerequis` (q305) dans `tools/agence/test_doctor.py`, `RUN` simulé : python3 < 3.9, socket absent, `agence/` absent de l'install, `--model` absent de l'aide de `cate agent start`, `cate agent usage` code non nul, type `agence` absent de l'aide de `cate panel create`, réglages CLI à `false` lus en lecture seule dans `<dirname CATE_SOCKET>/settings.json`, `gh auth status` non nul, `claude --version` non nul, gardes inactifs, skill absent, nom à la source `défaut`. Une ligne par point (`ok`, `manque`, `info`) avec sa commande ; code 1 si un bloquant manque ; `--json` ; rien écrit (mtime) ; `doctor` seul et `--relance` inchangés (tests de la spec 001 verts). Modèle : sonnet. **Fait** : rouge : `Ran 21 tests`, `FAILED (errors=27)`, `unrecognized arguments: --prerequis`. Vert : `Ran 21 tests OK` (socket Unix réel, HOME et install jetables, `RUN` simulé, mtime de tout le dossier inchangés).
- [x] T024 [US1] `agence doctor --prerequis` dans `tools/agence/agence.py` (`cmd_doctor` :1676, parser :1920-1922) ; texte des réglages identique à `SETTINGS_HINT` ; `cliTerminalInputEnabled` à `false` (défaut gardé, q307) sort en `manque` bloquant avec le chemin du réglage dans Cate. Preuve : T023 vert. Modèle : sonnet. **Fait** : `agence.py:1680-1770` (`PYTHON_MIN`, `CLI_REGLAGES` avec les défauts de `settings.ts`, `prerequis()`, `cmd_doctor` :1759) ; `cliTerminalInputEnabled` coupé sort en `manque` bloquant avec « Réglages de Cate > Workspace > CLI » (`INPUT_TERMINAL` :1685), les autres réglages avec `SETTINGS_HINT`. T023 vert ; classe `Relance` (spec 001) verte.
- [x] T025 [P] [US2] Test rouge dans `tools/agence/test_agence.py` : `watch` écrit `st['garde']` (`actif`, `inactif`, `partiel`, d'après `hooks status` du HOME courant) à chaque tour ; état ancien complété. Modèle : sonnet. **Fait** : rouge : classe `TourGarde` (`test_agence.py:1684`) : `KeyError: 'garde'` et `'garde' not found`. `Base` met aussi `HOME` dans le dossier jetable (un tour lit `~/.claude/settings.json`).
- [x] T026 [US2] `watch` écrit `garde` (`tools/agence/agence.py`). Preuve : T025 vert. Modèle : sonnet. **Fait** : `agence.py:1783` (`un_tour` : `hooks_statut()` hors transaction, `st['garde']` dans la transaction), `empty()` :149 (`garde: None`). T025 vert.
- [x] T027 [P] [US2] Test rouge du panneau (FR-010, US2 scénario 3) : instantané `garde: 'actif' | 'inactif' | 'partiel' | 'inconnu'` (`inconnu` avant le premier tour) ; bannière « garde d'envoi inactif » avec `agence hooks install` pour `inactif`, « garde d'envoi partiel » pour `partiel`, et pour `inconnu` après 5 s sans tour ; rien pour `actif`, `external` ou `missing`. Fichiers : `src/panels/agence/session.test.ts`, `src/shells/desktop/ui/panels/agence/AgenceView.test.tsx`. Modèle : sonnet. **Fait** : rouge : 5 échecs, `expected undefined to be 'inconnu'` et `expected '' to match /garde d'envoi inactif/i`.
- [x] T028 [US2] Panneau : `garde` dans `src/panels/agence/contract/types.ts` et `src/panels/agence/session.ts` ; bannière dans `src/shells/desktop/ui/panels/agence/AgenceView.tsx`, en réutilisant `RegisseurBanner.tsx`. Preuve : T027 vert ; `typecheck`, `lint`, `lint:deps` verts. Modèle : sonnet. **Fait** : `types.ts:93-96` (`GardeState`) et `:184`, `session.ts` (`GARDES`, `garde` publié, `inconnu` sans état ou sans `agence`), `RegisseurBanner.tsx` (prop `garde`, minuterie de 5 s), `AgenceView.tsx`. T027 vert : `npx vitest run src/panels/agence src/shells/desktop/ui/panels/agence` donne `211 passed` ; `npm run typecheck` vert ; `npm run lint` 0 erreur ; `npm run lint:deps` « no dependency violations found ».
- [x] T029 [P] Documentation : `docs/architecture.md` (panneau agence : gardes, qui écrit `settings.json`, Cate ne lance jamais `agence hooks`), une ligne dans `CLAUDE.md` (même règle), `specs/002-orchestrateur-portable/contracts/hooks.md` avec le texte figé. Preuve : diff relu. Modèle : haiku. **Fait** : `docs/architecture.md` (paragraphe « Send guards » :2134, ligne `agence` du tableau des panneaux, install `agence/`), `CLAUDE.md:250-251` (section State), `contracts/hooks.md` (texte figé, écart de `agence-hook send`). Diff relu.
- [ ] T030 Portes et PR du lot 3 : suite complète et `npm run test:agence` ; `git grep -n "hooks install" -- src` ne rend que des textes d'aide et des tests. Corps : `Réf. #29` ; « ne pas lancer `agence hooks install` chez Heifara avant le lot 5 : deux gardes sur un même outil ». Modèle : haiku.

**Checkpoint lot 3** : deux `install` = un ; un envoi Slack sans CLI donne `ask` ; la bannière s'affiche sans garde.

---

## Lot 4 : amorçage complet (US4, US1)

**Goal**: après la ligne collée, les gardes sont branchés et `doctor` a parlé ; plus aucune commande.

**Independent Test**: `npx vitest run scripts/cate-fork-install.test.mjs` en faux HOME ; 0 appel réel à `launchctl`.

Note : l'amorçage ne lance jamais Cate, donc l'install du runtime (`~/.cate/runtime/<build>/`) n'existe pas encore. Il appelle la CLI du clone, `$CATE_BUILD_DIR/tools/agence/agence`. Tant que Cate n'a pas démarré une fois, le garde d'envoi rend `ask` (échec fermé, voulu).

- [ ] T031 [P] [US1] Test rouge de `doctor --prerequis --hors-cate` dans `tools/agence/test_doctor.py` : sans `CATE_SOCKET`, socket, réglages CLI, type `agence`, `agent usage` et skill semé sortent en `info` « à vérifier dans un terminal Cate » ; python3, `gh`, `claude`, gardes, nom gardent `ok` ou `manque` ; code 1 seulement pour un bloquant hors Cate ; rien écrit. Après T023. Modèle : sonnet.
- [ ] T032 [US1] `--hors-cate` (`tools/agence/agence.py`). Preuve : T031 vert, T023 toujours vert. Modèle : sonnet.
- [ ] T033 [US4] Tests rouges dans `scripts/cate-fork-install.test.mjs` (faux HOME, faux `agence` dans le faux clone qui consigne ses appels) : après le premier build, `agence hooks install` puis `agence doctor --prerequis --hors-cate`, dans cet ordre ; `--sans-gardes` saute `hooks install` ; build en échec : ni gardes ni doctor ; `hooks install` en échec : arrêt, code non nul, agent launchd gardé ; deux passages : un seul appel effectif de plus, `settings.json` identique ; résumé final de 3 lignes au plus (0 si rien ne reste) ; `~/.claude/settings.json` réel et `~/Library/LaunchAgents` réel inchangés (`shasum` et liste cités). Modèle : opus.
- [ ] T034 [US4] `scripts/cate-fork-install.sh` : option `--sans-gardes`, appels de T033 par `"$DIR/tools/agence/agence"`, résumé. Preuve : T033 vert ; `sh -n` sans sortie ; shellcheck vert en CI. Modèle : opus.
- [ ] T035 [P] [US4] Test rouge : `scripts/cate-fork-uninstall.sh --gardes` lance `agence hooks uninstall` avant tout `--purge` (la CLI vit dans le clone) ; sans `--gardes`, `~/.claude` jamais touché ; deuxième passage : code 0. Fichier : `scripts/cate-fork-install.test.mjs`. Modèle : sonnet.
- [ ] T036 [US4] `--gardes` dans `scripts/cate-fork-uninstall.sh`. Preuve : T035 vert. Modèle : sonnet.
- [ ] T037 [P] [US4] `scripts/cate-fork-install.md` : étape gardes et doctor, `--sans-gardes`, `--gardes`, ligne `~/.claude/settings.json` (et sa sauvegarde) dans le tableau des écritures. Preuve : diff relu ; la ligne citée est celle de `quickstart.md`. Modèle : haiku.
- [ ] T038 Portes et PR du lot 4 : `npx vitest run scripts/cate-fork-install.test.mjs`, `npm run test:agence`, `npm run typecheck`, `npm run lint`. Corps : `Réf. #29` ; pire cas chiffré (une écriture dans `~/.claude/settings.json` de Max, avec sauvegarde ; aucune coupure, rien n'est arrêté) ; relance : non. Modèle : haiku.

**Checkpoint lot 4** : en faux HOME, la ligne rejouée deux fois donne le même état, gardes compris.

---

## Lot 5 : bascule de Skills (US3), à confier au projet Skills

Ces tâches se font dans le dépôt Skills, par l'orchestrateur de ce projet ou par une issue sur son dépôt, jamais depuis le fork. Elles démarrent après la fusion des lots 2 et 3 et l'installation du build du fork chez Heifara. Texte détaillé : L5-01 à L5-08 de la spec 006 (Skills `1577235`), chemins du fork à jour.

- [ ] T039 [US3] À confier au projet Skills. Risques de transition (L5-01) : priorité entre `.claude/skills/orchestrateur/` semé par Cate et `~/.claude/skills/orchestrateur` ; fusion d'un `allow` et d'un `ask` de deux hooks sur un même outil. Modèle : sonnet.
- [ ] T040 [US3] À confier au projet Skills. Test rouge du garde d'envoi réduit (L5-02, `common/hooks/tests/cases.json`). Modèle : sonnet.
- [ ] T041 [US3] À confier au projet Skills. `send-guard.sh` réduit à l'exception personnelle (L5-03). Modèle : opus.
- [ ] T042 [US3] À confier au projet Skills. Bascule de PATH et de gardes dans l'ordre (L5-04) : `agence hooks install` d'abord, puis retrait de `agence-guard.sh` et des entrées de `common/settings.base.json`. Modèle : opus.
- [ ] T043 [P] [US3] À confier au projet Skills. Retrait du code livré par le fork (L5-05) : `common/tools/agence.py`, `test_agence.py`, `common/skills/orchestrateur/`, `common/bin/agence`. Modèle : sonnet.
- [ ] T044 [P] [US3] À confier au projet Skills. `check.py` 0 échec puis `measure.py --label "bascule orchestrateur portable"` (L5-06). Modèle : haiku.
- [ ] T045 [H] [US3] À confier au projet Skills. Heifara bascule (L5-07) : build du fork installé, `agence hooks install`, `./skills.sh install`, `agence hooks status` = actif.
- [ ] T046 [US3] À confier au projet Skills. PR sur Skills (L5-08) ; après elle, retrait de `guard` sans `--mode` dans le fork (coupe nette, une tâche du fork à créer alors). Modèle : sonnet.

---

## Phase finale : recette

- [ ] T047 Parcours « Max, première minute » en faux HOME (X001) dans `tools/agence/test_quickstart.py` : faux `gh`, `claude`, `cate`, `launchctl`, `node`, `npm` ; la ligne de `quickstart.md` rejouée par le script local ; puis `agence doctor --prerequis --hors-cate`, `agence hooks status` (actif), `agence nom`, `agence hooks uninstall`, `cate-fork-uninstall.sh --gardes --purge` ; faux HOME revenu à l'état d'origine ; 0 commande après la ligne. Après les lots 2, 3, 4. Modèle : sonnet.
- [ ] T048 Relecture finale (X002) dans `specs/002-orchestrateur-portable/rapport-final.md` : chaque FR et SC avec sa preuve ou « non vérifié » ; `quickstart.md` relu contre les commandes réelles ; grep des noms et chemins personnels hors code (README, `docs/`, messages) ; reprend L1-17 (`env -i HOME=$(mktemp -d) PATH=<process-env>:/usr/bin:/bin agence --help`, sortie citée). Modèle : opus.
- [ ] T049 [H] Premier passage réel de Max (X003) : temps total, commandes tapées après la ligne (0), agent launchd chargé, app installée, `agence hooks status`, terminal restauré (`agence need list`), deuxième passage sans `pkill`, durée du premier build. L'agent relève en lecture seule et consigne dans la PR du lot 4.

---

## Dépendances et parallélisme

- **Ordre** : T001, T002 ; lots 2 et 3 en parallèle ; fusion 2 puis 3 ; lot 4 ; T047 ; lot 5 (projet Skills) et T048 ; T049.
- **Lot 2** : T003 rouge d'abord ; T004 puis T005 ; T006 libre ; T007 avant T008 ; T009 avant T010 ; T011 avant T012 ; T008 et T012 en série dans `agence.py` ; T013 après T008 ; T015 en dernier.
- **Lot 3** : T016 avant T017 ; T017 avant T018 ; T019 après T018 (lit son `settings.json`), avant T020 ; T021 avant T022 ; T023 avant T024 ; T025 avant T026 ; série dans `agence.py` : T018, T020, T024, T026 ; panneau T027, T028 et doc T029 en parallèle du Python ; T030 en dernier.
- **Lot 4** : T031 avant T032 (après T024) ; T033 avant T034 ; T035 avant T036 (même fichier de test que T033 : un seul agent) ; T037 libre ; T038 en dernier.

## Exemples de parallélisme

- Lot 2, un agent : T003, T006, T007, T009, T011 rédigés d'abord, vus rouges, puis le code dans l'ordre.
- Lots 2 et 3, deux agents : l'un sur `skills/` et `SuiviList`, l'autre sur `test_hooks.py` et `test_guard.py` ; `agence.py` touché en ajouts disjoints.

## Stratégie

- **MVP restant** : lot 3 (seul le clic envoie chez Max). Puis lot 2 (nom et skill), puis lot 4 (zéro commande).
- **Chiffrage** : lot 2 : 12 tâches (+1 [H]), 1,25 j ; lot 3 : 15 tâches, 2 j ; lot 4 : 8 tâches, 0,75 j ; lot 5 : 8 tâches (dont 1 [H]), 0,5 j dans Skills ; recette : 3 tâches (dont 1 [H]), 0,75 j. Total : 4,75 j d'agent dans le fork, 0,5 j dans Skills, soit 5,25 j (5,75 j si q303 = `humain`). Coût mensuel : 0 €.
