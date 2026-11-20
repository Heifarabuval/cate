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

## Partie A : réconciliation avec la spec 006 de Skills (au 2026-11-20)

Base lue : `origin/main` du fork, `455a23b2`. Une case cochée porte sa preuve (PR mergée ou chemin:ligne). Une case ouverte renvoie à sa tâche de la partie B. Aucune case cochée sans preuve. PR citées : celles de `Heifarabuval/cate` (`gh pr list -R Heifarabuval/cate --state all`) : #63 (lot 2), #65 (lot 3), #68 et #70 (lot 4), #96 (`guard` sans `--mode` retiré). Le lot 5 vit dans le dépôt Skills (PR Skills#36 et #37).

Bilan : **115 cochées** (85 la veille, 30 de plus cochées avec preuve après relecture de `origin/main`), 5 retirées (L2-01, L2-04, L2-05 par la décision q303 ; L2-08, L2-09 par le principe VIII), **14 ouvertes** dont 6 tâches de la partie B (T014, T044, T047, T048, T049, T050), le reste étant des renvois (L1-17, L2-16, L5-06, X001 à X003, deux cases « Heifara doit faire »). Une case retirée n'a plus de case : rien n'a été fait, la raison est écrite.


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
- [ ] L1-17 Preuve de bout en bout du PATH (`env -i ... agence --help`). Ouverte : aucune sortie citée ; la PR #30 dit « terminal réellement restauré non vérifié ». Reprise par T048 (lot 5-B) pour `agence --help`, et par T049 (lot 5-C) pour le terminal restauré.
- [x] L1-18 Documentation. Preuve : `CLAUDE.md:266-268`, `docs/architecture.md:482`, `:1553-1560`.
- [x] L1-19 Portes et PR du lot 1. Preuve : PR #30, CI `build (macos-latest)`, `build (ubuntu-latest)`, `agence (macos-latest)` verts (run 44288098274). `build (windows-latest)` en échec : hors cible (principe VIII).

### Lot 2 : portable (12 sur 13, 5 retirées), PR #41 puis PR #63 (`bcb0ca6a`)

- [x] L2-02 Test du nom. Preuve : `tools/agence/test_agence.py:119` (classe `Nom`), PR #41. Écart : défaut « L'humain », pas « toi ».
- [x] L2-03 `nom()` et `agence nom`. Preuve : `tools/agence/agence.py:99-120`, PR #41.
- [x] L2-06 Test : `watch` écrit `humain`. Preuve : `tools/agence/test_agence.py:1376` (`test_watch_ecrit_humain_a_chaque_tour`) et `:1384`, T007, PR #63.
- [x] L2-07 `watch` écrit `humain`. Preuve : `tools/agence/agence.py:164` (`empty()`) et `:1996` (`un_tour`), T008, PR #63.
- [x] L2-10 Test 404 sous `--token-stdin`. Preuve : `tools/agence/test_agence.py:2560` (`test_sous_token_stdin_aucune_page_et_aucun_jeton_dans_le_corps`), T011, PR #63.
- [x] L2-11 `do_GET` 404 sous `--token-stdin`. Preuve : `tools/agence/agence.py:63` (`PAGES`), `:1326`, `:2018`, T012, PR #63.
- [x] L2-12 Test de pureté. Preuve : `tools/agence/test_portable.py:33-50` (classe `Purete`), T003, PR #63. Relu le 2026-11-20 : `grep -rnE "Heifara|heifara|U02FQHK9FPD|/Users/"` sur `tools/agence/*.py`, `skills/orchestrateur`, `src/panels/agence`, `src/shells/desktop/ui/panels/agence` (hors tests et fixtures) ne rend que `agence.py:90` et `suivi.ts:9` (clé opaque, liste blanche).
- [x] L2-13 Skill livré. Preuve : `skills/orchestrateur/SKILL.md`, `scripts/build-runtime-tarball.mjs:161`, `docs/architecture.md`, T004 à T006, PR #63. Le tarball réel n'a pas été listé (`npm run runtime:tarball` interdit sans `node_modules`) : voir T005.
- [x] L2-14 Test du suivi avec le nom. Preuve : `src/shells/desktop/ui/panels/agence/SuiviList.test.tsx:56` (« À faire par Max (2) »), `AgenceView.test.tsx:84`, T009, PR #63.
- [x] L2-15 Panneau au nom de l'humain. Preuve : `src/shells/desktop/ui/panels/agence/SuiviList.tsx:12` (`À faire par {humain}`), `src/panels/agence/contract/suivi.ts:9` (`OWNER_HUMAIN`), T010, PR #63.
- [ ] L2-16 [H] Heifara règle son nom. Ouverte : `git config --global --get agence.nom` vide (code 1) et `agence nom` rend « Heifarabuval (git user.name) », lus le 2026-11-20. Reprise par T014 (lot 5-C).
- [x] L2-17 Ses états existants se relisent. Preuve : T013 (copie de l'état réel, 197 besoins, `shasum` identique avant et après), PR #63.
- [x] L2-18 Portes et PR du lot 2. Preuve : T015, PR #63 (`Réf. #29`).

Retirées, sans case : L2-01 (fixture d'un vrai état) et L2-04 (compatibilité des états) : la valeur stockée reste `heifara` sans migration (q303, besoin n304) ; L2-05 (valeur stockée `humain`) : même raison, le reste est livré par la PR #41 (textes au nom de l'humain, `test_agence.py:236`, classe `NomDansLesTextes`, alias `--owner heifara` retiré) ; L2-08 (test `toast()` hors macOS) et L2-09 (`toast()` dégradé) : principe VIII, `toast()` journalise déjà un échec.

### Lot 3 : gardes et doctor (12 sur 12), PR #65 (`c23a5c0d`)

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
- [x] L3-12 Portes et PR du lot 3. Preuve : T030, PR #65.

### Lot 4 : mise à jour automatique et amorçage (11 sur 11), PR #40, #68 et #70

- [x] L4-01 Risque updater upstream. Preuve : `scripts/cate-fork-update.sh:235` (`CATE_SELF_UPDATE=0`), assertion `scripts/cate-fork-install.test.mjs:288`.
- [x] L4-02 Tests du script de mise à jour. Preuve : `scripts/cate-fork-install.test.mjs:277-583` (Node sous nvm, Homebrew, PATH ; Node absent ou trop vieux ; Cate ouvert ; build en échec ; verrou ; 5 Go ; hors macOS), `--prereq` à `:320`. Cas 7 (aucun daemon arrêté) : `scripts/cate-fork-update.sh` ne contient aucun `kill` (grep vide). Écart : fichier `cate-fork-install.test.mjs`, pas `cate-fork-update.test.mjs`.
- [x] L4-03 `scripts/cate-fork-update.sh`. Preuve : PR #40 (43 tests, shellcheck vert sur la CI ubuntu).
- [x] L4-04 Test du plist. Preuve : `scripts/cate-fork-install.test.mjs:784-810`. Écarts : étiquette `com.cate.fork-update`, pas de `RunAtLoad` (PR #40, point M3).
- [x] L4-05 Tests de l'amorçage. Preuve : `scripts/cate-fork-install.test.mjs:1006` (bloc « send guards and doctor », 7 cas), T033, PR #68 (`5a85aca4`). Ces tests utilisent un faux `agence` : la vraie CLI n'est jamais lancée par l'amorçage en test, d'où le lot 5-A.
- [x] L4-06 Script d'amorçage. Preuve : `scripts/cate-fork-install.sh:109` (`--sans-gardes`), `:193` (`hooks install`), `:91` (doctor), T034, PR #68.
- [x] L4-07 Test de `doctor --hors-cate`. Preuve : `tools/agence/test_doctor.py` (6 tests `test_hors_cate_*`), T031.
- [x] L4-08 `doctor --hors-cate`. Preuve : `tools/agence/agence.py:1857` (`DANS_CATE`), `:1860` (`prerequis(hors_cate)`), T032.
- [x] L4-09 Désinstallation. Preuve : `scripts/cate-fork-uninstall.sh:32` (`--gardes`), `:55` (`hooks uninstall` avant `--purge`), T035, T036, PR #68 ; PR #70 (`684034d2`) garde le script de mise à jour quand la purge échoue.
- [x] L4-10 Documentation de la ligne. Preuve : `scripts/cate-fork-install.md` (PR #40). Écart : ce fichier, pas `README.md`.
- [x] L4-11 Portes et PR du lot 4. Preuve : PR #40 (typecheck, lint, lint:deps, 43 tests cités ; CI verte, run 44324228492).

### Lot 4b : le daemon suit l'app (5 sur 5), PR #27

- [x] L4B-01 Tests Vitest. Preuve : `src/client/connections/runtimeUpdate.test.ts` (PR #27).
- [x] L4B-02 Correctif. Preuve : `src/client/connections/runtimeUpdate.ts:38-43`.
- [x] L4B-03 Texte de l'écran. Preuve : `src/shells/desktop/ui/app/workspace/RuntimeMismatch.tsx` et son test (PR #27). Capture réelle : non vérifiée.
- [x] L4B-04 Documentation. Preuve : `docs/architecture.md` modifié par la PR #27.
- [x] L4B-05 Portes et PR. Preuve : PR #27, Closes #26 ; CI `build (macos-latest)` et `build (ubuntu-latest)` verts (run 44285257253).

### Lot 5 : bascule de Skills (7 sur 8), Skills#36 et Skills#37, fork #96

- [x] L5-01 Risques de transition. Preuve : Skills `specs/006-orchestrateur-portable/rapport-lot5.md` (Skills `10e904d`, PR Skills#36) : le skill utilisateur masque le skill semé, `ask` l'emporte sur `allow`.
- [x] L5-02 Test rouge du garde d'envoi réduit. Preuve : Skills#37, `common/hooks/tests/cases.json`, 10 cas dont 9 rouges avant le script.
- [x] L5-03 `send-guard.sh` réduit. Preuve : Skills#37 (aucune décision, jamais d'`allow` ni d'`ask`). Écart : l'exception du DM de Heifara reste en défaut, voir T050.
- [x] L5-04 Bascule de PATH et de gardes dans l'ordre. Preuve : Skills#37 (`skills.sh install` appelle `agence hooks install --settings` avant le retrait de la liste fermée). Lu le 2026-11-20 : `~/.claude/settings.json` cite `agence-hook send` (ligne 109) et `agence-hook pages` (ligne 118).
- [x] L5-05 Retrait du code livré par le fork. Preuve : Skills#37 (`common/tools/agence.py`, `test_agence.py`, `common/skills/orchestrateur/`, `common/bin/agence`, `common/hooks/agence-guard.sh`).
- [ ] L5-06 `check.py` et `measure.py`. Ouverte en partie : `check.py` 0 échec cité dans Skills#37 ; `measure.py` « à lancer après l'installation », non fait. Reprise par T044 (lot 5-D).
- [x] L5-07 [H] Heifara bascule. Preuve, lue le 2026-11-20 en lecture seule : `agence hooks status` rend `actif (~/.claude/settings.json)` ; `~/.claude/skills/orchestrateur` et `~/.claude/bin` n'existent plus ; le runtime courant `2.1.0-beta.15+fc236063715e` rend 2 lignes pour `agence need add --help | grep budget-usd`.
- [x] L5-08 PR sur Skills et retrait de `guard` sans `--mode` dans le fork. Preuve : Skills#37 mergée le 2026-11-20 14:06 UTC ; fork #96 (`7b41cd32`) : `agence guard` exige `--mode` (`agence.py:2428`, `guard(payload, mode)`).

### Transversal (0 sur 3)

- [ ] X001 Parcours en faux HOME. Ouverte : T047 (lot 5-A).
- [ ] X002 Relecture finale. Ouverte : T048 (lot 5-B).
- [ ] X003 [H] Essai réel par Max. Ouverte : T049 (lot 5-C).

### Ce que Heifara doit faire (1 sur 3)

- [ ] Régler son nom : T014 (lot 5-C). Lu le 2026-11-20 : `agence.nom` vide.
- [x] Merger les PR du fork. Preuve : #27, #30, #40, #41, #63, #65, #68, #70, #96 mergées (`gh pr list -R Heifarabuval/cate --state merged`).
- [ ] Envoyer à Max la ligne unique, une fois les lots 5-A et 5-B mergés. Non vérifiable depuis le dépôt.

---

## Partie B : le reste, en 4 lots macro

État réel au 2026-11-20 (`origin/main` `455a23b2`) : les lots 0, 1, 2, 3, 4 et 4b sont livrés ; le lot 5 est livré côté Skills (Skills#37) et côté fork (#96). Les cases ouvertes de la veille étaient presque toutes des cases livrées jamais cochées (partie A) ou retirées. Reste **6 tâches** : T014 [H], T044, T047, T048 (avec L1-17), T049 [H] et T050 [H]. Elles tiennent en 4 lots, une PR chacun. Aucun code produit du fork n'est à écrire : le seul fichier de code est un test (lot 5-A).

| Lot | But | Fichiers (liste fermée) | Dépend de | Parallélisable avec | Taille |
|---|---|---|---|---|---|
| **5-A. Parcours en faux HOME** | prouver la ligne d'amorçage avec la vraie CLI (X001) | `tools/agence/test_quickstart.py` | rien (lots 2, 3, 4 mergés) | 5-B (autres fichiers), 5-D | 0,5 j |
| **5-B. Relecture finale** | chaque FR et SC avec sa preuve, PATH prouvé (X002, L1-17) | `specs/002-orchestrateur-portable/{rapport-final.md,quickstart.md}` | 5-A pour les lignes FR-013 et SC-003 ; le reste s'écrit avant | 5-A, 5-D | 0,25 j |
| **5-C. Recette réelle de Max** | premier passage de Max, nom de Heifara (X003, T014) | aucun fichier de code ; relevé ajouté à `specs/002-orchestrateur-portable/rapport-final.md` | 5-A et 5-B mergés | 5-D | 0,25 j d'agent, plus la durée de Max |
| **5-D. Suites côté Skills** | `measure.py`, exception du DM de Heifara (T044, T050) | dépôt Skills seulement | rien | tous | 0,25 j, à confier au projet Skills |

5-A et 5-B ne partagent aucun fichier et peuvent partir ensemble ; 5-B ne ferme ses lignes FR-013 et SC-003 qu'une fois 5-A mergé. 5-C écrit dans le fichier créé par 5-B : après lui. 5-D ne touche pas le dépôt cate. Aucun de ces lots ne touche `tools/agence/agence.py`, `src/` ni `scripts/` : pas de conflit avec les specs 003, 004 ou 005 sur ces fichiers.

### Lot 5-A : parcours en faux HOME (X001)

**But** : un test qui rejoue la ligne d'amorçage avec la **vraie** CLI `tools/agence/agence`. Aujourd'hui `scripts/cate-fork-install.test.mjs:1006` pose un faux `agence` qui consigne ses appels, et `tools/agence/test_hooks.py` teste `hooks` sans l'amorçage : rien ne relie les deux.

**Tests d'acceptation** (un seul fichier de test ; Python 3.9 stdlib, sans réseau, tourne dans le job CI `agence (macos-latest)` via `npm run test:agence`) :

1. Faux HOME avec un `~/.claude/settings.json` qui porte déjà des hooks (copie d'une fixture de `tools/agence/fixtures/settings/`) ; faux `gh`, `claude`, `cate`, `launchctl`, `node`, `npm` et `git` (le clone vient d'un dossier local) sur le PATH ; `scripts/cate-fork-install.sh` lancé avec `CATE_FORK_REPO` sur ce dossier. Attendu : code 0 ; `tools/agence/agence hooks status` rend `actif` code 0 ; les entrées d'origine sont intactes ; une sauvegarde `settings.json.bak-agence-*` ; résumé de 3 lignes au plus ; le journal du faux `launchctl` ne montre aucun appel réel.
2. Deuxième passage : `settings.json` identique (`shasum`), pas de seconde sauvegarde.
3. `--sans-gardes` : `settings.json` octet pour octet identique.
4. `scripts/cate-fork-uninstall.sh --gardes --purge` : le JSON de `settings.json` égale l'original (hors ordre des clés et mise en forme, comme SC-003).
5. Le test échoue si `HOME` est le vrai ; empreinte de `~/.claude/settings.json` et liste de `~/Library/LaunchAgents` identiques avant et après (même garde que `test_hooks.py`, `tearDownModule`).
6. Rouge d'abord : le test est vu en échec sur une copie jetable du script sans l'appel `hooks install` (rien n'est commité de cette copie).

**Fichiers touchés** : `tools/agence/test_quickstart.py` (nouveau). **Dépend de** : rien. **Parallélisable avec** : 5-B, 5-D. Modèle : sonnet ; vérificateur : un autre agent, qui relance la suite une fois sur le HEAD annoncé.

- [ ] T047 [US1] Écrire `tools/agence/test_quickstart.py` (cas 1 à 6) ; preuve : sortie rouge de la copie sans `hooks install`, puis `npm run test:agence` vert (sortie citée) et `shasum` du vrai `~/.claude/settings.json` identique avant et après.

### Lot 5-B : relecture finale (X002, L1-17)

**But** : le rapport qui dit ce que la spec promet et ce qui est prouvé.

**Tests d'acceptation** : chaque ligne du rapport se vérifie par une commande ou un chemin:ligne cité, ou porte « non vérifié » ; `quickstart.md` ne contient plus de « lot 4 » ni de « avant le lot 5 » (tout est livré) ; une ligne par occurrence de `Heifara` ou `heifara` hors code produit (README, `docs/`, `scripts/`, messages), classée « adresse du fork » ou « à corriger ».

**À faire** (T048) :

- Tableau FR-001 à FR-013 et SC-001 à SC-005 dans `rapport-final.md`, preuve ou « non vérifié ». Points déjà établis le 2026-11-20 : SC-002 tient (grep de la partie A, L2-12) ; SC-003 par `test_hooks.py` ; SC-004 par la CI `agence (macos-latest)` ; SC-001 et SC-005 ne se prouvent que par Max (lot 5-C).
- L1-17 : depuis un terminal Cate, `env -i HOME=$(mktemp -d) PATH=<PATH du processus de Cate>:/usr/bin:/bin agence --help`, sortie citée. Lecture seule, aucune fenêtre.
- `quickstart.md` : retirer les mentions de lot devenues fausses, réécrire « Chez Heifara » (lot 5 livré : `agence hooks status` rend `actif`, la ligne `git config --global agence.nom Heifara` est T014) et pointer la liste de recette du lot 5-C.

**Fichiers touchés** : `specs/002-orchestrateur-portable/rapport-final.md` (nouveau), `specs/002-orchestrateur-portable/quickstart.md`. **Dépend de** : 5-A pour FR-013 et SC-003. **Parallélisable avec** : 5-A, 5-D. Modèle : opus ; vérificateur différent de l'implémenteur de 5-A.

- [ ] T048 [US1] Écrire `rapport-final.md`, relire `quickstart.md` contre les commandes réelles, citer la sortie de L1-17 (case L1-17 cochée avec cette sortie).

### Lot 5-C : recette réelle de Max (X003, T014)

**But** : le premier dev qui n'est pas Heifara passe de la ligne collée au panneau agence. Aucun agent ne lance cette recette : Max l'exécute, un agent relève en lecture seule et ajoute le résultat à `rapport-final.md` (PR docs minuscule). Aucune installation d'app, aucun lancement de l'amorçage par un agent (constitution X).

**Étape 0 [H] (Heifara, avant d'envoyer la ligne)** :

- [ ] T014 [US3] [H] `git config --global agence.nom Heifara`. Contrôle en lecture seule : `agence nom` rend `Heifara (git agence.nom)` (aujourd'hui « Heifarabuval (git user.name) »).

**Liste de recette pour Max** (chaque ligne : commande, résultat attendu ; noter l'heure de début) :

Prérequis, à relever avant de coller la ligne :

| # | Commande | Attendu |
|---|---|---|
| P1 | `uname -m` | `arm64` |
| P2 | `xcode-select -p` | un chemin, code 0 |
| P3 | `node -v` | `v22.16` à `v22.x` |
| P4 | `gh auth status` | code 0, compte de Max |
| P5 | `claude --version` | code 0 |
| P6 | `git config user.name` ; `git config --global --get agence.nom` | « Max Croquet » ou équivalent ; le second vide (cas par défaut, `agence nom` dira « Max (git user.name) ») |
| P7 | `ls ~/.cate/runtime /Applications/Cate.app ~/Library/LaunchAgents/com.cate.fork-update.plist` ; `shasum -a 256 ~/.claude/settings.json` | absents (état de départ) ; empreinte notée |

Parcours :

| # | Commande ou geste | Attendu |
|---|---|---|
| R1 | coller la ligne de `quickstart.md` (`curl -fsSL https://raw.githubusercontent.com/Heifarabuval/cate/main/scripts/cate-fork-install.sh \| sh`) | code 0, résumé de 3 lignes au plus ; si un prérequis est nommé avec sa commande : la lancer et recoller la même ligne (seul cas de deuxième collage) |
| R2 | compter les commandes tapées après R1 | 0 (SC-001) |
| R3 | durée de R1 au premier passage | moins de 30 min hors prérequis ; durée du premier build notée (non mesurée aujourd'hui) |
| R4 | `launchctl list \| grep com.cate.fork-update` ; `ls -d /Applications/Cate.app` ; `tail -n 3 ~/Library/Logs/cate-fork-update.log` | une ligne ; l'app présente ; aucune erreur |
| R5 | `ls ~/.claude/settings.json.bak-agence-*` ; `~/.local/share/cate-build/tools/agence/agence hooks status` | une sauvegarde si `settings.json` existait ; `actif`, code 0 |
| R6 | ouvrir Cate sur un dépôt de test, dans un terminal Cate : `agence --version` ; `agence nom` ; `agence doctor --prerequis` | `2.1.0-beta.15+<build>` égal à `cat ~/.cate/runtime/current` ; `Max (git user.name)` ; aucune ligne `manque` sauf `cliTerminalInputEnabled` (réglage CLI du workspace à activer une fois, la ligne nomme le chemin dans les réglages) |
| R7 | dans Claude Code : `/orchestrateur` | un panneau agence s'ouvre ; section « À faire par Max » ; aucune bannière « garde d'envoi inactif » |
| R8 | `agence draft new --cible issue:<compte>/<dépôt-test> --from <orch> "test"`, puis « Envoyer » dans le panneau | `gh issue list -R <compte>/<dépôt-test>` montre l'issue, créée au nom de Max |
| R9 | `printf '{"hook_event_name":"PreToolUse","tool_name":"mcp__claude_ai_Slack__slack_send_message","tool_input":{}}' \| agence guard --mode send` | une décision `ask` (échec fermé, FR-008) |
| R10 | dans un sous-agent : `curl -s -o /dev/null -w '%{http_code}' 127.0.0.1:<port-du-régisseur>/` | refusé par le garde des pages ; `state.json` non modifiable |
| R11 | fermer puis rouvrir Cate ; dans le terminal restauré : `agence need list` | la commande répond (lot 0, risque L0-02 enfin vérifié) |
| R12 | pousser un commit sur `origin/main` du fork (Heifara), attendre le journal `cate-fork-update.log`, rouvrir Cate | `cat ~/.cate/runtime/current` rend le nouveau build, sans aucun `pkill` |
| R13 | `cate-fork-uninstall.sh --gardes` | `agence hooks status` rend `inactif` ; `shasum -a 256 ~/.claude/settings.json` revient à l'empreinte de P7 (hors ordre des clés si le fichier a été réécrit) |

Relevé à consigner : durée totale, commandes tapées après la ligne, durée du premier build, sortie de chaque ligne, écarts. Une ligne en échec ouvre une issue sur `Heifarabuval/cate` ; elle ne se corrige pas dans ce lot.

**Fichiers touchés** : `specs/002-orchestrateur-portable/rapport-final.md` (section « Passage de Max »). **Dépend de** : 5-A et 5-B mergés. **Parallélisable avec** : 5-D.

- [ ] T049 [H] [US1] Premier passage réel de Max (P1 à P7, R1 à R13) ; relevé ajouté à `rapport-final.md` ; case L1-17 « terminal restauré » cochée avec R11.

### Lot 5-D : suites côté Skills

À confier au projet Skills (orchestrateur de Skills ou issue sur son dépôt), jamais depuis le fork. Deux restes de Skills#37.

- [ ] T044 [US3] `python3 ~/.claude/setup/measure.py --label "bascule orchestrateur portable"` après l'installation chez Heifara (Skills#37 : « non fait, il écrit sous `~/.claude` »). Modèle : haiku.
- [ ] T050 [H] [US3] Le garde du fork rend `ask` pour tout envoi Slack non cliqué, y compris dans le DM de Heifara : `pro/tools/slack-moi.sh` et l'assistant de 8 h 30 (`~/.claude/tools/assistant-taches.sh`) postent encore par `slack_send_message` en `claude -p --allowedTools` ; `ask` l'emporte sur `allow` (rapport lot 5 de Skills). Lu le 2026-11-20 : les deux appellent toujours l'outil MCP. Recommandé, 0 € : les faire poster par Hermes (skill `hermes`), puis supprimer `send-guard.sh`. Décision de Heifara ; effet attendu si rien n'est fait : le message « Ta journée » ne part plus (non vérifié en réel). Aucun changement dans le fork.

---

## Partie C : lots livrés (historique des tâches)

Ce qui suit est l'historique. Chaque case cochée porte sa preuve ; les cases ouvertes de cette partie sont reprises en partie B.

## Phase 1 : Setup

- [x] T001 Chaque implémenteur crée sa branche depuis `origin/main` du fork (pas `upstream/main`) dans son worktree `.cate/worktrees/<lot>` : `feat/agence-portable` (lot 2), `feat/agence-gardes` (lot 3), `feat/agence-amorcage` (lot 4). Vérifier `git merge-base --is-ancestor origin/main HEAD`. Annoncer sur le bus `repo:cate` la liste de fichiers du lot. Modèle : haiku. Preuve : `git merge-base --is-ancestor origin/main HEAD` = 0 sur `feat/agence-portable` (base `64b03c68`) ; fichiers annoncés sur le bus `repo:cate`.
- [x] T002 Lire avant d'écrire un test : lots 2 et 3, `tools/agence/agence.py` (`OWNER_HUMAIN` :71, `nom_source` :80, `empty()` et `load()`, `do_GET` :1164, `guard` :1770, `cmd_doctor` :1676, `parser` :1845-1930) et la classe `Tour` de `test_agence.py` ; lot 4, `scripts/cate-fork-install.sh` (`main` :70) et les aides de `scripts/cate-fork-install.test.mjs` (faux HOME, `fake()`, `called()`). Modèle : haiku. Preuve : `OWNER_HUMAIN`, `nom_source`, `empty()`, `load()`, `do_GET`, classe `Tour` lus avant les tests.

**Checkpoint** : base vérifiée, aucun fichier modifié.

## Phase 2 : Foundational

Aucune tâche bloquante entre lots. Décisions de Heifara (2026-11-19) : valeur stockée `owner` gardée à `heifara`, sans migration (q303) ; `agence doctor --prerequis`, `doctor` seul inchangé (q305) ; `cliTerminalInputEnabled` reste coupé (q307).

---

## Lot 2 : portable (US1, US3)

**Goal**: Max voit son nom dans le panneau, le skill est semé dans ses dépôts, le jeton du régisseur ne sort jamais dans une page.

**Independent Test**: `npm run test:agence` et Vitest du panneau verts ; `python3 -m unittest tools/agence/test_portable.py` vert ; un état réel de Heifara relu sur une copie.

- [x] T003 [P] [US1] Test rouge de pureté (SC-002, FR-005, FR-012) dans `tools/agence/test_portable.py` : aucun `Heifara`, `heifara`, `U02FQHK9FPD`, `/Users/` dans `tools/agence/*.py` hors `test_*`, dans `skills/orchestrateur/`, `src/panels/agence/` et `src/shells/desktop/ui/panels/agence/` hors `*.test.*` et `fixtures/` ; liste blanche : la seule ligne `OWNER_HUMAIN` de `agence.py` et la constante jumelle de `suivi.ts` (clé gardée, q303) ; `skills/orchestrateur/SKILL.md` doit exister. Rouge attendu : `SuiviList.tsx:12`, skill absent. Modèle : haiku. Preuve : `tools/agence/test_portable.py`, rouge avant (3 échecs : `suivi.ts:86-87`, `SuiviList.tsx:12`, skill absent), vert après (`python3 -m unittest tools/agence/test_portable.py` : 4 tests OK).
- [x] T004 [US1] Skill livré `skills/orchestrateur/SKILL.md` : partir de `~/.claude/skills/orchestrateur/SKILL.md` lu en lecture seule (version après la spec 001, lot C), remplacer « Heifara » par « l'humain » et `agence nom`, retirer toute référence à Skills ou à `~/Documents/`, garder la règle « brouillon seulement » et le repli sur trois panneaux. `evals.json` non copié (outil de Skills). Preuve : T003 vert pour le skill ; frontmatter valide (`scripts/skillFrontmatter.mjs`) ; `npx vitest run src/workspace/skills/runtime/seed.test.ts` vert. Modèle : sonnet. Preuve : `skills/orchestrateur/SKILL.md` (72 lignes, copie de `~/.claude/skills/orchestrateur/SKILL.md` lue sans la modifier) ; `parseFrontmatter` rend `name: orchestrateur` ; `npx vitest run src/workspace/skills/runtime/seed.test.ts` : 14 tests OK. Écart : `src/workspace/skills/runtime/service.test.ts` attendait 2 skills livrés, mis à 3 (hors liste du lot).
- [x] T005 [US1] Liste `required` du tarball : ajouter `path.join('skills', 'orchestrateur', 'SKILL.md')` à côté de `cate-cli` (`scripts/build-runtime-tarball.mjs:160`). Preuve : `npm run runtime:tarball` puis `tar -tzf` liste `skills/orchestrateur/SKILL.md` (sortie citée). Modèle : haiku. Preuve : `scripts/build-runtime-tarball.mjs:161`. `npm run runtime:tarball` échoue à `stageNodePty` faute de `node_modules` dans le worktree (`npm install` interdit). Non vérifié : `tar -tzf`.
- [x] T006 [P] [US1] `docs/architecture.md` : section 9.6 et ligne `skills/` de l'arbre (`:2860`) nomment `orchestrateur` parmi les skills livrés. Preuve : diff relu. Modèle : haiku. Preuve : `docs/architecture.md:1481` et `:2860` nomment `orchestrateur`.
- [x] T007 [P] [US1] Test rouge dans `tools/agence/test_agence.py` (classe `Tour`) : `watch` écrit `st['humain'] = nom()` à chaque tour ; un état ancien sans `humain` est complété par `empty()` ; avec `AGENCE_NOM=Max`, `humain` vaut `Max`. Modèle : sonnet. Preuve : `tools/agence/test_agence.py`, classe `Tour` (`test_watch_ecrit_humain_a_chaque_tour`, `test_humain_par_defaut_sans_reglage`, `test_etat_ancien_sans_humain_complete_par_load`), rouge `KeyError: 'humain'` (3 erreurs).
- [x] T008 [US1] `watch` écrit `humain` ; `empty()` gagne `humain: "L'humain"` (`tools/agence/agence.py`). Preuve : T007 vert, `npm run test:agence` vert. Modèle : sonnet. Preuve : `tools/agence/agence.py` (`empty()` et `un_tour`), `python3 -m unittest tools.agence.test_agence.Tour` : 20 tests OK ; `npm run test:agence` : 333 tests OK.
- [x] T009 [P] [US1] Test rouge du panneau : l'instantané porte `humain` (« L'humain » si absent) ; la section `aFaire` s'intitule « À faire par Max » avec `humain: 'Max'` dans l'état. Fichiers : `src/panels/agence/contract/fixtures/state.json`, `src/panels/agence/contract/suivi.test.ts`, `src/panels/agence/session.test.ts`, `src/shells/desktop/ui/panels/agence/SuiviList.test.tsx`. Modèle : sonnet. Preuve : `session.test.ts` (nom du suivi), `SuiviList.test.tsx`, `AgenceView.test.tsx` (« À faire par Max »), rouge avant (4 échecs). Écart : `fixtures/etat.json` et `suivi.test.ts` inchangés, `classify` ne lit pas `humain`.
- [x] T010 [US1] Panneau : `humain: string` dans `src/panels/agence/contract/types.ts`, lu par `src/panels/agence/session.ts`, titre de `src/shells/desktop/ui/panels/agence/SuiviList.tsx:12` ; la valeur stockée comparée par `src/panels/agence/contract/suivi.ts:86-87` devient une constante nommée (une seule occurrence). Preuve : T009 vert ; `npm run typecheck`, `npm run lint`, `npm run lint:deps` verts. Modèle : sonnet. Preuve : `types.ts` (`SuiviView.humain`, `AgenceState.humain`), `suivi.ts` (`OWNER_HUMAIN`, `HUMAIN_DEFAUT`), `session.ts`, `SuiviList.tsx` ; `npx vitest run src/panels/agence src/shells/desktop/ui/panels/agence` : 206 tests OK ; `typecheck` et `lint:deps` verts, `lint` 0 erreur.
- [x] T011 [P] [US2] Test rouge dans `tools/agence/test_agence.py` : sous `watch --token-stdin`, `GET /`, `/draft/<id>`, `/ask/<id>` rendent 404 sans jeton dans le corps ; le `POST` JSON marche ; sans l'option, les pages restent. Modèle : sonnet. Preuve : `test_agence.py`, classe `Regisseur` (`test_sous_token_stdin_aucune_page_et_aucun_jeton_dans_le_corps`, `test_sans_token_stdin_les_pages_restent`), rouge `AssertionError: 200 != 404 : /`.
- [x] T012 [US2] `do_GET` rend 404 sous `--token-stdin` (`tools/agence/agence.py:1164-1179`). Vérifier d'abord par lecture que le panneau ne fait aucun `GET` (`src/panels/agence/session.ts`). Preuve : T011 vert. Modèle : sonnet. Preuve : `agence.py` (`PAGES`, `do_GET`, `cmd_watch`) ; le panneau ne fait que des `POST` (`src/panels/agence/parts/runtime/regisseur.ts:297-298`) ; `npm run test:agence` : 333 tests OK.
- [x] T013 [US3] Ses états se relisent (SC-005) : copier un `state.json` réel de Heifara dans un dossier jetable (jamais écrire dans `.cate/tmp/agence/` d'un projet), lancer la CLI du worktree : `agence need list` identique à celui de `~/.claude/bin/agence` hors nom ; `shasum` de l'original identique avant et après. Modèle : haiku. Preuve : copie de l'état réel (197 besoins) dans un dossier jetable : `need list` du worktree et de l'ancienne CLI de Skills identiques à `heifara` près (colonne 4 `humain`), `shasum` de l'original identique avant et après (`2d469760...`). L'ancienne CLI est `Skills/common/tools/agence.py` : `~/.claude/bin/agence` n'existe pas.
- T014 [H] [US3] Heifara règle son nom : `git config --global agence.nom Heifara`. Pas de case ici : la tâche est suivie au lot 5-C (partie B).
- [x] T015 Portes et PR du lot 2 : `npm run typecheck && npm run lint && npm run lint:deps && npm test && npm run test:agence` ; T003 vert ; code mort listé (titre « Heifara » du suivi). Corps : `Réf. #29`, risque « `agence.py` commun avec le lot 3 : fusionner 2 avant 3 ». Modèle : haiku. Preuve : PR https://github.com/Heifarabuval/cate/pull/63 (`Réf. #29`) ; `typecheck`, `lint` (0 erreur), `lint:deps` verts ; `npm run test:agence` 333 OK ; T003 vert ; vitest ciblé vert. `npm test` complet : 7 fichiers rouges faute de `node_modules` dans le worktree (monaco-editor, dependency-cruiser), hors lot.

**Checkpoint lot 2** : le panneau dit « À faire par <nom> », le skill est dans le tarball, plus aucune page sous le panneau.

---

## Lot 3 : gardes et prérequis (US2, US1)

**Goal**: seul le clic de l'humain envoie, chez Max aussi ; `doctor --prerequis` dit ce qui manque.

**Independent Test**: faux HOME avec un `settings.json` existant ; `agence hooks install` deux fois puis `uninstall` ; commande réelle du hook sans CLI : `ask`.

- [x] T016 [US2] Copier `specs/002-orchestrateur-portable/fixtures/*` dans `tools/agence/fixtures/settings/` ; écrire `settings-attendu.json` (les deux entrées de `contracts/hooks.md`, texte figé ici). Modèle : haiku. **Fait** : `tools/agence/fixtures/settings/` : les 7 fixtures du lot 0 et `settings-attendu.json` extrait du bloc de `contracts/hooks.md`, égal à `HOOK_ENTREES` (`test_hooks.py`, fonction `attendu`).
- [x] T017 [US2] Tests rouges de l'installeur (FR-007, SC-003) dans `tools/agence/test_hooks.py`, faux HOME : JSON invalide : code 2, rien écrit, pas de sauvegarde ; hooks de l'utilisateur sur le même matcher : intacts, entrées agence ajoutées une fois ; fichier absent : créé ; fichier ou dossier en lecture seule : code 2, rien écrit ; mode 0444 d'un fichier inscriptible par le dossier : conservé ; lien symbolique : la cible est écrite, le lien reste ; deux `install` = un, une sauvegarde `settings.json.bak-agence-<AAAAMMJJ-HHMMSS>` ; `uninstall` rend le JSON d'origine et retire un `PreToolUse` ou `hooks` vidé ; `permissions` et clés inconnues intactes ; `status` : `actif` 0, `inactif` 1, `partiel` 1 ; `setUp` échoue si `HOME` est le vrai. Preuve : rouge, chaque cas pour sa raison ; `shasum ~/.claude/settings.json` identique avant et après la suite. Modèle : opus. **Fait** : rouge : `/usr/bin/python3 -m unittest test_hooks.py` (3.9.6) donne `Ran 23 tests`, `FAILED (failures=25, errors=2)`, `invalid choice: 'hooks'` ; les cas « code 2 » exigent le message `agence : ` (sinon l'erreur d'argparse, code 2 aussi, les rendait verts). Vert : `Ran 23 tests OK`. Le module compare l'empreinte du vrai `~/.claude/settings.json` (lecture seule) avant et après (`tearDownModule`) ; `shasum -a 256` relevé `9987e97e68de6ae8` avant et après `npm run test:agence` et `npm test`. Écarts : un fichier 0444 est refusé (code 2) et garde son mode 0444, un fichier 0640 inscriptible garde 0640 ; la sauvegarde d'un lien va à côté du chemin nommé (`~/.claude`), pas dans le dossier de la cible.
- [x] T018 [US2] `agence hooks install|uninstall|status [--settings <chemin>] [--json]` dans `tools/agence/agence.py` : json stdlib, écriture atomique comme `tx`, lien résolu, sauvegarde seulement si le fichier change, entrées reconnues à `agence-hook` dans leur commande, aucune permission ajoutée. Preuve : T017 vert, `npm run test:agence` vert. Modèle : opus. **Fait** : `tools/agence/agence.py:1946-2100` (`HOOK_ENTREES` :1946, `lire_settings` :1968 en `utf-8-sig` et clés uniques, `garde_statut` :1988, `ecrire_settings` :2020 avec `os.access`, sauvegarde `xb` puis `mkstemp` + `fsync` + `os.replace` sur `realpath`, `cmd_hooks` :2078). T017 vert ; `npm run test:agence` : `Ran 391 tests OK`.
- [x] T019 [US2] Tests rouges du garde (FR-008, US2 scénarios 4 et 5) dans `tools/agence/test_guard.py` : exécuter **réellement** la commande lue dans le `settings.json` produit par T018, via `sh -c`, faux HOME, `PreToolUse` sur stdin. `send` : `~/.cate/runtime/current` absent → `ask` ; `current` vers un dossier sans `agence-hook` → `ask` ; `agence-hook` non exécutable → `ask` ; CLI présente et brouillon cliqué identique → `allow` ; sans clic → `ask` ; aucune exception de canal. `pages` : CLI absente → sortie 0 vide ; sans `state.json` → sortie immédiate. `guard` sans `--mode` : comportement actuel. Un cas qui échouerait ouvert fait échouer le test. Modèle : opus. **Fait** : rouge : `Ran 21 tests`, `FAILED (errors=18)`, `FileNotFoundError: .../tools/agence/agence-hook` ; verts dès le départ, voulus : `current` absent et dossier sans `agence-hook` (repli `sh -c` du contrat), `pages` sans CLI, `guard` sans `--mode`. Couvre aussi python3 absent, CLI qui sort en erreur ou sans décision, stdin illisible, build courant cassé : `ask`. Vert : `Ran 21 tests OK` sous 3.9.6 et 3.14. Correctif de relecture (PR #65) : matcher d'envoi élargi à `slack_schedule_message`, `Gmail__reply` et `Gmail__forward` (`agence.py:1952`, `settings-attendu.json`, `contracts/hooks.md`). Classe `OutilsDEnvoi` de `test_guard.py` rouge avant (`Lists differ: [] != ['ask']`, aucun garde déclenché pour ces trois outils) puis verte ; `guard --mode send` rend déjà `ask` pour un outil hors `est_envoi`, même avec un brouillon cliqué d'un autre outil. Ancien matcher installé : `status` rend `partiel`, un nouvel `install` le remplace sans doublon (`test_hooks.py`, `test_ancien_matcher_d_envoi_partiel_puis_mis_a_jour_sans_doublon`).
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
- [x] T030 Portes et PR du lot 3 : suite complète et `npm run test:agence` ; `git grep -n "hooks install" -- src` ne rend que des textes d'aide et des tests. Corps : `Réf. #29` ; « ne pas lancer `agence hooks install` chez Heifara avant le lot 5 : deux gardes sur un même outil ». Modèle : haiku. **Fait** : `npm test` : 476 fichiers, 4267 tests verts, 3 ignorés ; `npm run test:agence` : `Ran 391 tests OK` (aussi sous `/usr/bin/python3` 3.9.6) ; `git grep -n "hooks install" -- src` : `RegisseurBanner.tsx:34` (texte de la bannière) et `AgenceView.test.tsx` seulement. PR #65 (`Réf. #29`, avertissement en tête du corps).

**Checkpoint lot 3** : deux `install` = un ; un envoi Slack sans CLI donne `ask` ; la bannière s'affiche sans garde.

---

## Lot 4 : amorçage complet (US4, US1)

**Goal**: après la ligne collée, les gardes sont branchés et `doctor` a parlé ; plus aucune commande.

**Independent Test**: `npx vitest run scripts/cate-fork-install.test.mjs` en faux HOME ; 0 appel réel à `launchctl`.

Note : l'amorçage ne lance jamais Cate, donc l'install du runtime (`~/.cate/runtime/<build>/`) n'existe pas encore. Il appelle la CLI du clone, `$CATE_BUILD_DIR/tools/agence/agence`. Tant que Cate n'a pas démarré une fois, le garde d'envoi rend `ask` (échec fermé, voulu).

- [x] T031 [P] [US1] Test rouge de `doctor --prerequis --hors-cate` dans `tools/agence/test_doctor.py` : sans `CATE_SOCKET`, socket, réglages CLI, type `agence`, `agent usage` et skill semé sortent en `info` « à vérifier dans un terminal Cate » ; python3, `gh`, `claude`, gardes, nom gardent `ok` ou `manque` ; code 1 seulement pour un bloquant hors Cate ; rien écrit. Après T023. Modèle : sonnet. **Fait** : `tools/agence/test_doctor.py`, 6 tests `test_hors_cate_*` (sans socket, sans `runtime/current`, `cate` en code 127) ; rouge : `Ran 27 tests`, `FAILED (errors=6)`, `unrecognized arguments: --hors-cate`. Écart : `CLI livrée` et `agent start --model` sortent aussi en `info` (avec `skill`, liste `DANS_CATE`) : l'amorçage ne lance jamais Cate, donc ni install du runtime ni `cate` sur le PATH ; sinon le doctor de l'amorçage rendrait toujours 1.
- [x] T032 [US1] `--hors-cate` (`tools/agence/agence.py`). Preuve : T031 vert, T023 toujours vert. Modèle : sonnet. **Fait** : `tools/agence/agence.py:1691` (`DANS_CATE`), `:1694` (`prerequis(hors_cate)`), `:1704` (`cate` jamais lancé), `:1764` (points en `info`, « à vérifier dans un terminal Cate », commande `agence doctor --prerequis`), `:2217` (option). `python3 -m unittest test_doctor` : `Ran 27 tests OK` (T023 compris) ; `npm run test:agence` : `Ran 411 tests OK`.
- [x] T033 [US4] Tests rouges dans `scripts/cate-fork-install.test.mjs` (faux HOME, faux `agence` dans le faux clone qui consigne ses appels) : après le premier build, `agence hooks install` puis `agence doctor --prerequis --hors-cate`, dans cet ordre ; `--sans-gardes` saute `hooks install` ; build en échec : ni gardes ni doctor ; `hooks install` en échec : arrêt, code non nul, agent launchd gardé ; deux passages : un seul appel effectif de plus, `settings.json` identique ; résumé final de 3 lignes au plus (0 si rien ne reste) ; `~/.claude/settings.json` réel et `~/Library/LaunchAgents` réel inchangés (`shasum` et liste cités). Modèle : opus. **Fait** : `scripts/cate-fork-install.test.mjs:1006` (bloc « send guards and doctor », 7 cas d'amorçage) ; faux `agence` posé dans le faux clone par le faux `git clone` (`:264`), qui consigne ses appels ; contrôle du vrai HOME en `afterAll` (`:82`, empreinte de `~/.claude/settings.json` et liste de `~/Library/LaunchAgents`). Rouge : 10 échecs, `expected [] to deeply equal [ 'hooks install', …(1) ]` et `expected 64 to be +0` (option inconnue).
- [x] T034 [US4] `scripts/cate-fork-install.sh` : option `--sans-gardes`, appels de T033 par `"$DIR/tools/agence/agence"`, résumé. Preuve : T033 vert ; `sh -n` sans sortie ; shellcheck vert en CI. Modèle : opus. **Fait** : `scripts/cate-fork-install.sh:75` (`build_dir`, même lecture que `cate-fork-update` : environnement, conf, défaut), `:89` (`rest` : lignes `manque` du doctor, 3 au plus, aucune si rien ne reste ; code 2 et plus : une ligne), `:108` (`--sans-gardes`), `:192` (`hooks install`, échec : code 1, agent gardé), `:194` (doctor). Code 0 quand Cate est installé et que des prérequis restent : dit, pas en échec. T033 vert ; `sh -n` sans sortie. shellcheck absent en local : CI.
- [x] T035 [P] [US4] Test rouge : `scripts/cate-fork-uninstall.sh --gardes` lance `agence hooks uninstall` avant tout `--purge` (la CLI vit dans le clone) ; sans `--gardes`, `~/.claude` jamais touché ; deuxième passage : code 0. Fichier : `scripts/cate-fork-install.test.mjs`. Modèle : sonnet. **Fait** : même bloc, 4 cas de désinstallation (`--gardes --purge`, sans `--gardes`, `hooks uninstall` en échec, CLI absente avec gardes encore là) ; rouge : `expected 64 to be +0` et `expected 64 to be 1`.
- [x] T036 [US4] `--gardes` dans `scripts/cate-fork-uninstall.sh`. Preuve : T035 vert. Modèle : sonnet. **Fait** : `scripts/cate-fork-uninstall.sh:14` (`build_dir`), `:32` (`--gardes`), `:55` (`hooks uninstall` avant `--purge` ; échec : code 1 et dossier de build gardé ; CLI absente : code 1 seulement si `settings.json` cite encore `agence-hook`). T035 vert.
- [x] T037 [P] [US4] `scripts/cate-fork-install.md` : étape gardes et doctor, `--sans-gardes`, `--gardes`, ligne `~/.claude/settings.json` (et sa sauvegarde) dans le tableau des écritures. Preuve : diff relu ; la ligne citée est celle de `quickstart.md`. Modèle : haiku. **Fait** : `scripts/cate-fork-install.md` étapes 5 et 6, `--sans-gardes`, `--gardes`, ligne `~/.claude/settings.json` et sa sauvegarde dans le tableau des écritures (texte de `quickstart.md:18` : sauvegarde d'abord), « Ce que l'installation ne fait pas » et « Non vérifié » à jour. Diff relu.
- [x] T038 Portes et PR du lot 4 : `npx vitest run scripts/cate-fork-install.test.mjs`, `npm run test:agence`, `npm run typecheck`, `npm run lint`. Corps : `Réf. #29` ; pire cas chiffré (une écriture dans `~/.claude/settings.json` de Max, avec sauvegarde ; aucune coupure, rien n'est arrêté) ; relance : non. Modèle : haiku. **Fait** : `npx vitest run scripts/cate-fork-install.test.mjs` : `54 passed` ; `npm run test:agence` : `Ran 411 tests OK` ; `npm run typecheck` code 0 ; `npm run lint` 0 erreur (10 avertissements hors lot) ; `sh -n` sans sortie sur les deux scripts ; `shasum -a 256 ~/.claude/settings.json` `65e21226...` avant et après les suites. PR du lot 4 (`Réf. #29`).

**Checkpoint lot 4** : en faux HOME, la ligne rejouée deux fois donne le même état, gardes compris.

---

## Lot 5 : bascule de Skills (US3), livré dans le dépôt Skills

Fait dans le dépôt Skills (PR Skills#36 et #37) et par le fork (#96). Preuves : voir L5-01 à L5-08 de la partie A.

- [x] T039 [US3] Risques de transition (L5-01). Preuve : Skills `specs/006-orchestrateur-portable/rapport-lot5.md` (Skills `10e904d`, PR Skills#36).
- [x] T040 [US3] Test rouge du garde d'envoi réduit (L5-02). Preuve : Skills#37, `common/hooks/tests/cases.json` (10 cas, 9 rouges avant).
- [x] T041 [US3] `send-guard.sh` réduit (L5-03). Preuve : Skills#37. Écart : exception du DM gardée par défaut, voir T050.
- [x] T042 [US3] Bascule de PATH et de gardes dans l'ordre (L5-04). Preuve : Skills#37 (`skills.sh install`).
- [x] T043 [P] [US3] Retrait du code livré par le fork (L5-05). Preuve : Skills#37.
- T044 [P] [US3] `check.py` 0 échec (cité dans Skills#37), `measure.py` non fait. Pas de case ici : la tâche est suivie au lot 5-D (partie B).
- [x] T045 [H] [US3] Heifara bascule (L5-07). Preuve : relevé du 2026-11-20 en L5-07 (`agence hooks status` = `actif`).
- [x] T046 [US3] PR sur Skills, puis retrait de `guard` sans `--mode` dans le fork (L5-08). Preuve : Skills#37 mergée ; fork #96 (`7b41cd32`).

---

## Dépendances et parallélisme

- **Reste** : 5-A et 5-B en parallèle (aucun fichier commun) ; 5-B ferme FR-013 et SC-003 après 5-A ; 5-C après 5-A et 5-B ; 5-D à tout moment, dans le dépôt Skills.
- **Lots livrés** (historique) : T001, T002 ; lots 2 et 3 en parallèle ; fusion 2 puis 3 ; lot 4.
- **Lot 2** : T003 rouge d'abord ; T004 puis T005 ; T006 libre ; T007 avant T008 ; T009 avant T010 ; T011 avant T012 ; T008 et T012 en série dans `agence.py` ; T013 après T008 ; T015 en dernier.
- **Lot 3** : T016 avant T017 ; T017 avant T018 ; T019 après T018 (lit son `settings.json`), avant T020 ; T021 avant T022 ; T023 avant T024 ; T025 avant T026 ; série dans `agence.py` : T018, T020, T024, T026 ; panneau T027, T028 et doc T029 en parallèle du Python ; T030 en dernier.
- **Lot 4** : T031 avant T032 (après T024) ; T033 avant T034 ; T035 avant T036 (même fichier de test que T033 : un seul agent) ; T037 libre ; T038 en dernier.

## Stratégie

- **MVP restant** : 5-A (preuve automatisée de la ligne d'amorçage), puis 5-C (Max). 5-B est le rapport qui ferme la spec.
- **Chiffrage** : 5-A 0,5 j, 5-B 0,25 j, 5-C 0,25 j d'agent plus la durée de Max, 5-D 0,25 j dans Skills : environ 1,25 j d'agent, dont 0,5 j dans le fork pour le seul fichier de code. Le plan du 2026-11-19 comptait 5,25 j ; lots 2, 3, 4 et 5 sont livrés depuis. Coût en jetons : non chiffré. Coût mensuel : 0 €.
- **Ce qui sort de cette spec** : tout ce qui est codé en dur à la façon de Heifara dans le code livré (clé `owner` `heifara`, textes et règles du skill `orchestrateur`, matcher des gardes, envoi Slack par Hermes) va à `specs/005-pratiques-reglables/` ; voir « Liens » dans `plan.md`.
