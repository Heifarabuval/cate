# Tasks: Orchestrateur portable

**Input**: `specs/006-orchestrateur-portable/` (spec.md, plan.md, research.md, data-model.md, contracts/cli-agence.md, contracts/hooks.md, quickstart.md)
**Tests**: obligatoires. Chaque tâche de code est précédée de sa tâche de test, qui doit être **rouge pour la bonne raison** (sortie citée) avant d'écrire le code. Vitest pour le TypeScript du fork, `unittest` pour `agence.py` et l'installeur, `node --test` pour les scripts `.mjs`. Tout test qui touche `~/.claude`, `~/.cate` ou `git config --global` tourne dans un faux HOME (`tempfile.mkdtemp()` ou `mktemp -d`, `GIT_CONFIG_GLOBAL` pointé dans ce dossier) et **échoue s'il détecte le vrai HOME**. Rien ne s'écrit jamais dans le vrai `~/.claude`.

## Format: `[ID] [P?] Description`

- **[P]** : peut tourner en parallèle d'une autre tâche `[P]` du même groupe (fichiers disjoints).
- Chaque tâche porte : **Fichiers** exacts, **Preuve** de fin (commande et résultat attendu), **Modèle** conseillé et sa raison.
- Modèles : **haiku** = mécanique (ajouts, docs, greps, vérifs de diff) ; **sonnet** = implémentation courante ; **opus** = fusion de `settings.json`, garde d'envoi, bascule de PATH (une erreur ouvre un trou de sécurité, écrase la config d'un utilisateur ou casse la CLI chez Heifara).
- Préfixes : `L0` à `L5` = lots du plan (`L4B` = lot 4b) ; `X` = transversal ; `[H]` = action de Heifara (ou de Max), jamais d'un agent.
- Dépôts : lots 0 à 4b dans le **fork** `Heifarabuval/cate` (worktree `~/Documents/cate-wt/<lot>`, branche `feat/orchestrateur-portable-<lot>`, un worktree par agent). Lot 5 dans **Skills** (branche `feat/bascule-orchestrateur`). Les chemins de fichiers sont relatifs au dépôt du lot.
- `agence.py` d'origine : `common/tools/agence.py` de Skills au commit `6d8935d` (241 tests verts sous 3.9.6). Les numéros de ligne cités sont ceux de ce commit ; ils bougent après la copie.
- Un agent ne commit pas la sonde d'un lot 0 et ne pousse pas ; l'orchestrateur ouvre les PR.

**Révision #n189 (2026-11-18)** : exigence « aucune commande à taper soi-même ». Le lot 4 devient « mise à jour automatique et amorçage » (adopte le script `cate-fork-update` de Heifara au lieu d'écrire `agence-update.sh`) ; le lot 4b est nouveau (le daemon suit l'app). Les tâches des lots 0 et 1 gardent leurs numéros. Anciennes tâches L4-01 à L4-07 : retirées (script d'arrêt des daemons rejeté, `publish.owner` inutile : R6 réglé par `CATE_SELF_UPDATE=0`).

## Sept lots, six PR sur le fork, une PR sur Skills

| Lot | Dépôt | Livrable seul parce que |
|---|---|---|
| **0. Risques** | Skills (rapport `specs/006-orchestrateur-portable/rapport-lot0.md`, commit `docs(specs)`) | aucun code de produit ; pas de PR sur le fork. Ses conclusions règlent les tâches L1-01, L3-01, L4-01, L5-01 |
| **1. CLI dans le runtime** | fork | `agence` apparaît sur le PATH avec la CLI telle quelle ; rien d'autre ne change, Heifara garde ses gardes et son skill |
| **2. Portable** | fork | nom, `humain`, notification, skill livré ; marche sans les gardes (le panneau ne montre pas encore de bannière) |
| **3. Gardes et doctor** | fork | `agence hooks`, `guard --mode`, `doctor`, bannière ; lancés par l'utilisateur, aucun effet tant qu'il ne tape pas `agence hooks install` |
| **4. Mise à jour automatique et amorçage** | fork | trois scripts, un agent launchd généré, un drapeau de `doctor`, un README ; aucun code de runtime. Le script de mise à jour et le plist ne dépendent de rien |
| **4b. Le daemon suit l'app** | fork | un correctif de 5 lignes dans `runtimeUpdate.ts` et son texte ; indépendant de tout, peut partir tout de suite |
| **5. Bascule Skills** | Skills | retire ce que le fork livre ; ne se fusionne qu'après 2 et 3 fusionnés et installés chez Heifara |

Ordre de fusion conseillé : 0 (rapport), 4b (indépendant, dès qu'il est prêt), 1, 2, 3, 4, puis 5. Les lots 2, 3 et 4 se construisent en parallèle après le lot 1 ; la fusion suit l'ordre ci-dessus pour limiter les rebases sur `agence.py`. Max n'a **rien à taper** quand 4 et 4b sont fusionnés.

---

# Lot 0 : risques d'abord (sondes, aucun commit de code)

Résultats consignés dans `specs/006-orchestrateur-portable/rapport-lot0.md` (Skills, une section par sonde : commande, sortie, conclusion). Sondes jetables jamais commitées. Ne jamais lancer le binaire de Cate (même `--version` ouvre une seconde instance).

- [ ] L0-01 [P] **Risque python3 3.9 sur un Mac sans outils développeur.** Que fait `/usr/bin/python3` sans Command Line Tools, et le message est-il clair ? Relever sur un compte macOS sans CLT si Heifara en fournit un (`[H]`, sinon le noter « non vérifié en réel ») : `xcode-select -p`, `/usr/bin/python3 --version`, `xcrun --find python3` (code de sortie et sortie), si une boîte de dialogue s'ouvre. En local : même séquence avec un `xcrun` factice qui sort en 1 (dossier de PATH jetable) pour fixer le texte du lanceur. Lire aussi `command -v python3` hors macOS (branche POSIX du lanceur).
  - **Fichiers** : `specs/006-orchestrateur-portable/rapport-lot0.md` (Skills)
  - **Preuve** : `/usr/bin/python3 --version` sur la machine de Heifara cité ; sortie de `xcrun --find python3` cas CLT présent et cas simulé absent ; verdict « le lanceur peut tester `xcrun` sans ouvrir de dialogue : oui/non ». Si non : arrêt du lot 1, rapport à l'orchestrateur.
  - **Modèle** : sonnet (sondes guidées, sorties à interpréter).
- [ ] L0-02 [P] **Risque PATH d'un terminal restauré.** Prouver qu'un lanceur `agence` écrit à côté de `cate` dans le dossier d'un terminal est encore en tête du PATH après relance de l'app (terminal restauré) et dans les snapshots de shell des agents.
  - Méthode : lire `src/services/terminal/runtime/cateCli.ts:67-83` et `cateCli.test.ts` ; sonde Vitest jetable qui écrit un second lanceur dans `<terminalCli>/panels/<panelId>/` puis rappelle la réécriture du spawn avec le même `panelId` (cas restauration).
  - **Fichiers** : `src/services/terminal/runtime/agence.probe.test.ts` (fork, supprimé en fin de tâche), `rapport-lot0.md`
  - **Preuve** : sortie Vitest citée (lanceur présent, exécutable, absolu, après deux appels) ; `rtk proxy grep -rn "agence.probe" src` vide ; réponse écrite à « un terminal ouvert par l'ancien runtime garde l'ancien lanceur jusqu'à l'arrêt du daemon » (research R1, risque 2).
  - **Modèle** : sonnet (sonde Vitest sur du code dont les fichiers sont nommés).
- [ ] L0-03 [P] **Risque fusion de `settings.json` avec une config hostile.** Écrire les cinq cas sous forme de fichiers de fixture réutilisables par le lot 3 : JSON invalide, hooks déjà présents (les entrées de l'utilisateur, avec un matcher voisin de celui d'agence), fichier absent, fichier en lecture seule (fichier et dossier), lien symbolique. Plus une copie de `~/.claude/settings.json` de Heifara en **lecture seule**, secrets et chemins personnels remplacés par des mots neutres. Vérifier à la main dans un faux HOME avec un script Python jetable que json stdlib relit et réécrit chaque cas sans perte (clés, ordre des tableaux, `permissions`).
  - **Fichiers** : `tools/agence/fixtures/settings/{invalide,hooks-existants,absent,lecture-seule,heifara-neutre}.json` (fork, commités au lot 3 seulement), `rapport-lot0.md`
  - **Preuve** : tableau « cas, comportement de json.load/dump, risque » dans le rapport ; `jq 'keys' fixtures/settings/heifara-neutre.json` cité ; `rtk proxy grep -c -i -E "slack|U0[0-9A-Z]{8}|/Users/" fixtures/settings/heifara-neutre.json` = 0 ; le vrai `settings.json` n'a pas bougé (`shasum` avant et après identique, cité).
  - **Modèle** : sonnet (lecture d'un fichier réel et neutralisation à vérifier).
- [ ] L0-04 [P] **Trois hypothèses lisibles dans le code.** (a) `cate panel create --help` liste-t-il les types de panneaux (lire `src/cli/engine.ts` et les specs `defineCateApi` de `panel create` ; ne pas lancer l'app). (b) Avec `CATE_RUNTIME_BUNDLE`, que rend `installDirFromExecPath` (`src/runtime/daemon/contract/install.ts:82-96`) et où chercherait-on `agence/` ? (c) Existe-t-il un fichier `BUILD` dans l'install (`src/runtime/daemon/node/install.ts:50`) pour `agence --version` ?
  - **Fichiers** : `rapport-lot0.md`
  - **Preuve** : trois réponses avec chemin:ligne. (a) vrai/faux, et si faux le test alternatif de `doctor` ; (b) chemin attendu en dev ; (c) nom du fichier ou « nom du dossier du build ».
  - **Modèle** : haiku (lecture guidée, trois constats sourcés).
- [ ] L0-05 Synthèse du lot 0 : un tableau « risque, constat, décision pour le lot concerné, tâche réglée », et les risques non levés listés comme « non vérifié ».
  - **Fichiers** : `rapport-lot0.md`, commit `docs(specs): rapport des sondes du lot 0 (#n166)` sur la branche de la spec
  - **Preuve** : `git log -1 --stat` cité ; aucune ligne sans source.
  - **Modèle** : haiku (consolidation de constats déjà rendus).

**Checkpoint lot 0** : les 4 risques ont un verdict ; sinon le lot concerné ne démarre pas.

---

# Lot 1 : la CLI dans le runtime

Fork. Première tâche : lever le risque python3 par un test du lanceur.

- [ ] L1-01 Test rouge du lanceur `agence` : faux dossier de PATH avec un `xcrun` qui sort en 1 et sans python3 de Homebrew → sortie 2, message `agence : python3 requis (xcode-select --install)` sur stderr, aucune ouverture de dialogue (le faux `xcrun` n'est appelé qu'avec `--find`) ; avec un faux python3 trouvé → `exec` avec les arguments ; hors macOS (`uname` simulé) → test `command -v python3`. Le HOME du test est un dossier jetable.
  - **Fichiers** : `tools/agence/test_launcher.py`
  - **Preuve** : `python3 -m unittest tools/agence/test_launcher.py` rouge (lanceur absent).
  - **Modèle** : sonnet (scripts shell simulés par PATH).
- [ ] L1-02 Lanceur POSIX `agence` (texte de `contracts/cli-agence.md`, branche hors macOS fixée selon L0-01).
  - **Fichiers** : `tools/agence/agence` (mode 0755)
  - **Preuve** : L1-01 vert ; `sh -n tools/agence/agence` sans sortie.
  - **Modèle** : haiku (texte du contrat, quelques lignes).
- [ ] L1-03 Importer la CLI et ses tests tels quels (aucun changement de comportement).
  - **Fichiers** : `tools/agence/agence.py`, `tools/agence/test_agence.py` (copiés de Skills `6d8935d` ; SHA noté dans le message de commit)
  - **Preuve** : `/usr/bin/python3 --version` = 3.9.x puis `/usr/bin/python3 -m unittest discover -s tools/agence -p "test_agence.py"` : 241 tests OK (SC-004).
  - **Modèle** : haiku (copie et lancement).
- [ ] L1-04 [P] Test rouge `--version` : sans fichier `BUILD` ou hors install → `dev` ; avec `<install>/BUILD` → son contenu ; code 0 (forme fixée par L0-04 c).
  - **Fichiers** : `tools/agence/test_agence.py`
  - **Preuve** : rouge (option inconnue).
  - **Modèle** : sonnet.
- [ ] L1-05 [P] `agence --version`.
  - **Fichiers** : `tools/agence/agence.py` (`parser()`)
  - **Preuve** : L1-04 vert ; 241 tests toujours verts.
  - **Modèle** : sonnet.
- [ ] L1-06 [P] Test rouge de l'agencement : `installLayout` rend `agence` (`<install>/agence`), y compris pour l'install courante et pour une install sous `~/.cate/runtime/<build>/`.
  - **Fichiers** : `src/runtime/daemon/contract/install.test.ts`
  - **Preuve** : `npx vitest run src/runtime/daemon/contract/install.test.ts` rouge (`agence` absent).
  - **Modèle** : haiku (assertions sur un test existant).
- [ ] L1-07 `layout.agence`.
  - **Fichiers** : `src/runtime/daemon/contract/install.ts:82-96`
  - **Preuve** : L1-06 vert ; `npm run typecheck` et `npm run lint:deps` verts.
  - **Modèle** : sonnet (le type est partagé par plusieurs appelants à relire).
- [ ] L1-08 [P] Test rouge du tarball : la liste `required` refuse un tarball sans `agence/agence`, sans `agence/agence.py` ; un tarball complet passe. Étendre le test existant du script s'il existe, sinon créer `scripts/build-runtime-tarball.test.mjs` (même style que `build-id.test.mjs`).
  - **Fichiers** : `scripts/build-runtime-tarball.test.mjs`
  - **Preuve** : `node --test scripts/build-runtime-tarball.test.mjs` rouge.
  - **Modèle** : sonnet.
- [ ] L1-09 [P] Tarball : copie de `tools/agence/` en `agence/` (sans les tests) et entrées `required`.
  - **Fichiers** : `scripts/build-runtime-tarball.mjs:139-160`
  - **Preuve** : L1-08 vert ; `npm run runtime:tarball` puis `tar -tzf dist-runtime/*.tar.gz | rtk proxy grep "agence/"` liste `agence/agence` et `agence/agence.py` sans `test_`.
  - **Modèle** : sonnet.
- [ ] L1-10 [P] Test rouge du lanceur de terminal : `cateCli` écrit `agence` à côté de `cate` dans `<terminalCli>/panels/<panelId>/`, mode 0700, chemin **absolu** vers `<install>/agence/agence`, sans jeton, réécrit au spawn et à la restauration.
  - **Fichiers** : `src/services/terminal/runtime/cateCli.test.ts`
  - **Preuve** : rouge (modèle : `cateCli.test.ts:84-92`).
  - **Modèle** : sonnet.
- [ ] L1-11 [P] `cateCli.ts` écrit le lanceur `agence` (chemin reçu par ses deps, comme `cliPath`).
  - **Fichiers** : `src/services/terminal/runtime/cateCli.ts:67-83`
  - **Preuve** : L1-10 vert ; `lint:deps` vert (aucun import d'une autre couche).
  - **Modèle** : sonnet.
- [ ] L1-12 [P] Test rouge du lanceur du régisseur : `cliEnv` écrit `agence` dans `<terminalCli>/process-env/`, même règles (0700, absolu).
  - **Fichiers** : `src/runtime/daemon/compose/cliEnv.test.ts`
  - **Preuve** : rouge.
  - **Modèle** : sonnet.
- [ ] L1-13 [P] `cliEnv.ts` écrit le lanceur `agence`.
  - **Fichiers** : `src/runtime/daemon/compose/cliEnv.ts:41-47`
  - **Preuve** : L1-12 vert.
  - **Modèle** : sonnet.
- [ ] L1-14 Câblage : la composition passe `layout.agence` aux deux lanceurs.
  - **Fichiers** : `src/runtime/daemon/compose/workspace.ts:240-258`
  - **Preuve** : L1-10 à L1-13 verts ensemble ; `npm run typecheck` vert. Après L1-11 et L1-13 (même appelant).
  - **Modèle** : sonnet.
- [ ] L1-15 **Risque `CATE_RUNTIME_BUNDLE`.** Test rouge puis correctif selon L0-04 b : en dev, le chemin d'`agence/` pointe vers le checkout (`tools/agence`) ; sans la variable, vers l'install.
  - **Fichiers** : `src/runtime/daemon/contract/install.test.ts`, `src/runtime/daemon/contract/install.ts` (ou le point que L0-04 désigne)
  - **Preuve** : rouge puis vert ; `CATE_RUNTIME_BUNDLE=dist-runtime/runtime.cjs` : `agence --version` rend `dev`. Si L0-04 conclut que rien ne casse : la tâche se ferme avec la preuve de lecture et un test de non-régression.
  - **Modèle** : sonnet.
- [ ] L1-16 [P] CI : script `test:agence` et job Python 3.9 (macOS et Linux, **pas** Windows : le CI du fork a une matrice Windows, `agence` n'y est pas livré).
  - **Fichiers** : `package.json` (`"test:agence": "python3 -m unittest discover -s tools/agence -p \"test_*.py\""`), `.github/workflows/ci.yml`
  - **Preuve** : `npm run test:agence` : 241 tests OK en local ; job CI vert sous `actions/setup-python` 3.9 (lien du run cité, sinon « non vérifié »).
  - **Modèle** : haiku (ajout de lignes sur un workflow existant).
- [ ] L1-17 **Preuve de bout en bout du PATH.** Le régisseur démarre sans `~/.claude/bin` sur le PATH et un terminal restauré trouve `agence`. Faux HOME ; `PATH` réduit au dossier `process-env` du daemon de test et à `/usr/bin:/bin`.
  - **Fichiers** : aucun (commande)
  - **Preuve** : `env -i HOME=$(mktemp -d) PATH=<terminalCli>/process-env:/usr/bin:/bin agence --help` sort 0 avec l'aide ; `agence --version` rend le build ; sortie citée. Terminal restauré réel : « non vérifié » jusqu'à X003.
  - **Modèle** : sonnet.
- [ ] L1-18 [P] Documentation : `docs/architecture.md` (module, layout, lanceurs) ; une ligne dans `CLAUDE.md` du fork (la CLI `agence` vit dans `tools/agence/`, hors `src/`).
  - **Fichiers** : `docs/architecture.md`, `CLAUDE.md`
  - **Preuve** : diff relu ; aucun nom de fonction ni journal de mesures.
  - **Modèle** : haiku (documentation à partir du plan).
- [ ] L1-19 Portes et PR du lot 1 : `npm run typecheck && npm run lint && npm run lint:deps && npm test && npm run test:agence`. Échecs « environnementaux » du `CLAUDE.md` listés comme tels. Code rendu inutile listé (rien attendu : lot additif).
  - **Fichiers** : aucun
  - **Preuve** : sorties citées, 0 échec hors environnement. Corps de PR : `Réf. #<issue fork>`, impact prod nul, relance ou redéploiement : « arrêter le daemon du workspace pour charger le nouveau runtime ».
  - **Modèle** : haiku (portes et rédaction mécanique).

**Checkpoint lot 1** : `agence --help` répond dans un terminal Cate sans rien installer.

---

# Lot 2 : portable (nom, `humain`, skill)

Fork, après le lot 1. Première tâche : lever le risque « les états réels de Heifara se relisent sans rien perdre ».

- [ ] L2-01 **Fixture d'un VRAI état de Heifara, rendue neutre.** Choisir un état réel parmi ses projets (`<racine>/.cate/tmp/agence/` : lister les candidats sans les ouvrir en écriture), le copier **en lecture seule** par un script jetable non commité qui conserve toutes les clés, les `owner`, statuts, ids, `panels`, `agents`, dates, hashes de brouillon, et remplace tout texte libre (titres, résumés, corps de brouillon, noms de dépôts, URL, chemins) par des mots neutres numérotés (`besoin-1`, `titre-2`). Aucun contenu privé : le script écrit aussi la liste des chaînes remplacées sur la sortie standard, **pas** dans le dépôt.
  - **Fichiers** : `tools/agence/fixtures/etat-heifara-neutre/` (l'état et ses brouillons)
  - **Preuve** : `shasum` de l'original avant et après identique (non modifié) ; comparaison des clés (`jq 'paths | map(tostring) | join(".")'` avant et après identiques) ; `rtk proxy grep -r -i -E "heifara|adfinitas|https?://|/Users/" tools/agence/fixtures/etat-heifara-neutre` ne trouve que `owner: heifara` ; relecture humaine du fichier par l'orchestrateur avant commit.
  - **Modèle** : sonnet (transformation guidée, la vérification de fuite est dans la preuve ; pas opus car aucune décision de conception).
- [ ] L2-02 [P] Test rouge du nom : ordre `AGENCE_NOM` > `git config agence.nom` > premier mot de `user.name` > `toi` ; `user.name` vide → `toi` ; commande `agence nom` imprime le nom et sa source ; pas de cache entre deux appels. Les `git config` passent par un `GIT_CONFIG_GLOBAL` jetable.
  - **Fichiers** : `tools/agence/test_agence.py`
  - **Preuve** : rouge (`nom()` absent, commande `nom` inconnue).
  - **Modèle** : sonnet.
- [ ] L2-03 `nom()` et la commande `agence nom`.
  - **Fichiers** : `tools/agence/agence.py` (zone de `parser()` et des textes)
  - **Preuve** : L2-02 vert.
  - **Modèle** : sonnet.
- [ ] L2-04 **Test rouge de compatibilité des états** (FR-004, SC-005). (1) `load()` lit `owner: "heifara"` comme l'humain et réécrit `humain` au premier `tx` ; (2) `--owner heifara` reste accepté ; (3) l'état réel de L2-01 s'ouvre : mêmes besoins, mêmes statuts, mêmes brouillons (hash inchangés), mêmes `panels`, aucune clé perdue, clés nouvelles (`humain`) complétées par `empty()` ; (4) les sections rendues par `agence need list` avant et après (référence produite une fois avec la CLI d'origine de Skills `6d8935d` et commitée en `fixtures/etat-heifara-neutre/sections-avant.txt`) sont identiques au nom près.
  - **Fichiers** : `tools/agence/test_agence.py`, `tools/agence/fixtures/etat-heifara-neutre/sections-avant.txt`
  - **Preuve** : rouge ; le test copie la fixture dans un dossier jetable (jamais d'écriture dans la fixture).
  - **Modèle** : sonnet.
- [ ] L2-05 Valeur stockée `humain` : `load()` réécrit `heifara`, alias `--owner heifara`, aides et textes (`agence.py:288`, `:501`, `:657`, `:978-979`, `:1261`, `:1391`, `:1602`).
  - **Fichiers** : `tools/agence/agence.py`
  - **Preuve** : L2-04 vert ; les 241 tests d'origine verts (les attendus qui disaient `heifara` sont mis à jour dans le même commit, listés).
  - **Modèle** : sonnet.
- [ ] L2-06 [P] Test rouge : `watch` écrit `st['humain'] = nom` à chaque tour (état lisible par le panneau).
  - **Fichiers** : `tools/agence/test_agence.py`
  - **Preuve** : rouge.
  - **Modèle** : sonnet.
- [ ] L2-07 [P] `watch` écrit `humain`.
  - **Fichiers** : `tools/agence/agence.py` (boucle de `cmd_watch`, tour de démarrage `:1477-1482`)
  - **Preuve** : L2-06 vert. Après L2-05 (même fichier).
  - **Modèle** : sonnet.
- [ ] L2-08 [P] Test rouge `toast()` : `sys.platform='linux'` ou `shutil.which('osascript')` vide → aucun appel `osascript`, une ligne de journal ; macOS avec `osascript` → appel inchangé.
  - **Fichiers** : `tools/agence/test_agence.py`
  - **Preuve** : rouge.
  - **Modèle** : haiku (test court sur une fonction de 10 lignes).
- [ ] L2-09 [P] `toast()` dégradé.
  - **Fichiers** : `tools/agence/agence.py:273-283`
  - **Preuve** : L2-08 vert.
  - **Modèle** : haiku.
- [ ] L2-10 [P] Test rouge `watch --token-stdin` : `GET /`, `/draft/*`, `/ask/*` rendent 404 ; le `POST` JSON marche toujours ; sans l'option, les pages restent (comportement actuel pour les non-panneaux).
  - **Fichiers** : `tools/agence/test_agence.py`
  - **Preuve** : rouge. Décision R3 « plus de page HTML sous le panneau » : à valider par Heifara avant le merge (voir « Hypothèses »).
  - **Modèle** : sonnet.
- [ ] L2-11 [P] `do_GET` 404 sous `--token-stdin`.
  - **Fichiers** : `tools/agence/agence.py:1048-1062`
  - **Preuve** : L2-10 vert. Après L2-07 (même fichier).
  - **Modèle** : sonnet.
- [ ] L2-12 Test rouge de pureté (SC-002, FR-005, FR-012) : aucun `Heifara`, `heifara`, `U02FQHK9FPD`, `/Users/` dans `tools/agence/` et `skills/orchestrateur/`, hors tests de compatibilité (liste blanche : `test_agence.py` et `fixtures/`).
  - **Fichiers** : `tools/agence/test_portable.py`
  - **Preuve** : rouge (occurrences listées par fichier:ligne).
  - **Modèle** : haiku (grep encadré par un test).
- [ ] L2-13 Skill livré : copier `common/skills/orchestrateur/SKILL.md` de Skills, remplacer les 10 « Heifara » par « l'humain » et `agence nom`, retirer la référence à `~/Documents/Skills/specs/001-...`, garder la règle « brouillon seulement » (`SKILL.md:32`) et le repli sur trois panneaux. Aucun fichier de l'agence ne cite un chemin de Skills.
  - **Fichiers** : `skills/orchestrateur/SKILL.md`
  - **Preuve** : L2-12 vert ; `npx vitest run src/workspace/skills/runtime/seed.test.ts src/workspace/skills/runtime/bundled.test.ts` verts (le test parcourt les skills livrés, le skill est semé) ; entête (frontmatter) valide par `scripts/skillFrontmatter.mjs`.
  - **Modèle** : sonnet (réécriture de consignes sans changer le fond).
- [ ] L2-14 [P] Test rouge du suivi : fixtures d'état avec `owner: 'humain'` et champ `humain: 'Max'` ; titre de section « À faire par Max » ; défaut « toi » si `humain` absent ; le panneau **ne lit pas** `heifara` (clean cuts).
  - **Fichiers** : `src/panels/agence/contract/suivi.test.ts`, `src/panels/agence/contract/fixtures/state.json`, `src/panels/agence/contract/fixtures/sections.json`, `src/shells/desktop/ui/panels/agence/SuiviList.test.tsx`
  - **Preuve** : rouge.
  - **Modèle** : sonnet.
- [ ] L2-15 [P] Panneau : `humain` dans l'instantané et le suivi.
  - **Fichiers** : `src/panels/agence/contract/suivi.ts:86-87`, `src/panels/agence/contract/types.ts`, `src/panels/agence/session.ts` (lecture de `humain`), `src/shells/desktop/ui/panels/agence/SuiviList.tsx:11`
  - **Preuve** : L2-14 vert ; `typecheck`, `lint`, `lint:deps` verts.
  - **Modèle** : sonnet.
- [ ] L2-16 **[H] Heifara règle son nom.** Lancer une fois, chez lui, et lire le résultat :
  - **Fichiers** : aucun (`~/.gitconfig` de Heifara)
  - **Preuve** : `git config --global agence.nom Heifara` puis `git config --global --get agence.nom` rend `Heifara` ; `agence nom` (CLI du worktree du lot 2, ou installée) rend `Heifara` et la source `git config agence.nom`. Un agent ne lance pas ces commandes.
  - **Modèle** : haiku (contrôle en lecture seule de la sortie par l'agent après coup).
- [ ] L2-17 **Ses états existants se relisent.** Après L2-05 et L2-16 : sur une **copie** d'un de ses vrais états (dossier jetable, jamais le dossier `.cate/tmp/agence/` du projet), lancer la CLI du fork et comparer à L2-04.
  - **Fichiers** : aucun
  - **Preuve** : `agence need list` de la copie : sections identiques à la CLI d'origine (diff vide hors nom) ; l'état réécrit contient `humain` et plus `heifara` ; le fichier d'origine a le même `shasum` qu'avant. Chez lui, le panneau d'un projet ouvert garde « À faire par Heifara » (`[H]` : constat visuel après installation, voir X003).
  - **Modèle** : haiku (comparaison de sorties).
- [ ] L2-18 Portes et PR du lot 2 : suite complète, SC-002 par `rtk proxy grep -rniE "heifara|U02FQHK9FPD|/Users/" tools/agence skills/orchestrateur src/panels/agence` (hors fixtures et tests de compatibilité) = 0, code mort listé (anciens attendus `heifara`, texte « Heifara » de l'ancien suivi).
  - **Fichiers** : aucun
  - **Preuve** : sorties citées ; PR avec risque « `agence.py` partagé avec le lot 3 : fusionner 2 avant 3 ».
  - **Modèle** : haiku.

**Checkpoint lot 2** : le fork ne contient plus rien de personnel et l'état réel de Heifara s'ouvre sans perte.

---

# Lot 3 : gardes et doctor

Fork, après le lot 1 (rebase sur le lot 2 avant fusion : `agence.py`). Première tâche : lever le risque de la fusion de `settings.json` hostile.

- [ ] L3-01 **Tests rouges de l'installeur sur config hostile** (FR-007, SC-003). Cinq cas de L0-03 plus idempotence, dans un faux HOME : (1) JSON invalide : code 2, **rien écrit**, pas de sauvegarde ; (2) hooks de l'utilisateur déjà présents, même sur le même matcher : ses entrées restent identiques, celles d'agence s'ajoutent une fois ; (3) fichier absent : créé avec seules les entrées agence, pas de sauvegarde ; (4) lecture seule (fichier, puis dossier) : code 2, message clair, rien écrit ; (5) lien symbolique : la **cible** est écrite, le lien reste un lien ; (6) `install` deux fois = un fichier identique à une fois, une seule sauvegarde datée `settings.json.bak-agence-<AAAAMMJJ-HHMMSS>` ; (7) `uninstall` rend le fichier d'origine (comparaison JSON, hors ordre des clés) et retire un `PreToolUse` ou un `hooks` vidé ; (8) `permissions.allow` et toute clé inconnue intacts ; (9) `status` : `actif`, `inactif`, `partiel` (une seule entrée) avec codes 0/1 ; (10) test de garde : `setUp` échoue si `HOME` est le vrai.
  - **Fichiers** : `tools/agence/test_hooks.py`, `tools/agence/fixtures/settings/` (de L0-03, avec `settings-attendu.json`, le texte exact des entrées, figé ici)
  - **Preuve** : `python3 -m unittest tools/agence/test_hooks.py` rouge (`hooks` absent), chaque cas échoue pour sa raison ; `shasum ~/.claude/settings.json` avant et après le lancement de la suite identique (cité).
  - **Modèle** : opus (fusion de la config d'un utilisateur : les cas hostiles et l'atomicité décident si l'on écrase la config de Max).
- [ ] L3-02 `agence hooks install|uninstall|status` : json stdlib, écriture atomique (`tempfile` + `os.replace`, comme `tx`, `agence.py:128-131`), lien résolu, sauvegarde seulement si le fichier change, entrées reconnues par leur commande contenant `agence-hook`, aucune permission ajoutée.
  - **Fichiers** : `tools/agence/agence.py` (nouvelles fonctions et `parser()`)
  - **Preuve** : L3-01 vert ; les 241 tests d'origine verts ; `git diff` ne touche aucune fonction existante hors `parser()`.
  - **Modèle** : opus (même raison que L3-01 ; erreur = config de l'utilisateur perdue).
- [ ] L3-03 **Tests rouges du garde d'envoi qui échoue fermé** (FR-008, US2 scénarios 4 et 5). Exécuter **réellement** la commande de hook lue dans le `settings.json` produit par L3-02, via `sh -c`, avec un `PreToolUse` en entrée standard et un faux HOME : (1) `~/.cate/runtime/current` absent → sortie JSON `permissionDecision: "ask"` ; (2) `current` vers un dossier sans `agence-hook` → `ask` ; (3) `agence-hook` non exécutable → `ask` ; (4) CLI présente, brouillon cliqué identique (`send_match`, `agence.py:1501-1518`) → `allow` ; (5) CLI présente, sans clic → `ask` ; (6) aucune exception pour un DM précis. Mode `pages` : CLI absente → sortie 0 sans rien (échoue ouvert) ; sans `state.json` → sortie immédiate ; `guard` sans `--mode` garde son comportement actuel.
  - **Fichiers** : `tools/agence/test_guard.py`
  - **Preuve** : rouge (mode `--mode` inconnu) ; sortie JSON citée par cas ; un cas qui échouerait ouvert fait **échouer** le test.
  - **Modèle** : opus (garde d'envoi : l'erreur est un envoi Slack ou Gmail sans clic).
- [ ] L3-04 `agence guard --mode send|pages` et le lanceur `agence-hook` ; texte exact de la commande figé dans `settings-attendu.json`.
  - **Fichiers** : `tools/agence/agence.py` (`guard()`, `send_match`), `tools/agence/agence-hook` (mode 0755, même test python3 que le lanceur `agence`), `scripts/build-runtime-tarball.mjs` (copie et `required` : ajouter `agence/agence-hook`), `scripts/build-runtime-tarball.test.mjs`
  - **Preuve** : L3-03 vert ; `npm run test:agence` vert ; `node --test scripts/build-runtime-tarball.test.mjs` vert avec `agence-hook` requis.
  - **Modèle** : opus (même raison que L3-03).
- [ ] L3-05 [P] **Risque `cate panel create --help` et doctor.** Test rouge de chaque point de `doctor` avec `RUN` simulé (python3 < 3.9, socket absent, `agence/` absent de l'install, `--model` absent de l'aide, `agent usage` code ≠ 0, type `agence` absent de l'aide ou, si L0-04 a dit « l'aide ne liste pas les types », test alternatif retenu, réglages CLI à `false` lus en lecture seule dans `<dirname CATE_SOCKET>/settings.json`, `gh auth status` ≠ 0, `claude --version` ≠ 0, gardes inactifs, skill absent, nom par défaut, hors macOS) : une ligne par point (`ok`, `manque`, `info`) avec sa commande ; code 1 si un bloquant manque ; `--json` ; `doctor` n'écrit rien (mtime du dossier avant et après) et ne lance jamais l'app.
  - **Fichiers** : `tools/agence/test_doctor.py`
  - **Preuve** : rouge (`doctor` inconnu).
  - **Modèle** : sonnet.
- [ ] L3-06 [P] `agence doctor`.
  - **Fichiers** : `tools/agence/agence.py` (après L3-04, même fichier)
  - **Preuve** : L3-05 vert ; texte des correctifs identique à `SETTINGS_HINT` (`agence.py:372-373`) pour les réglages.
  - **Modèle** : sonnet.
- [ ] L3-07 [P] Test rouge : `watch` écrit `st['garde']` (`actif`, `inactif`, `partiel`, d'après `hooks status` du HOME courant) à chaque tour ; état ancien sans `garde` complété.
  - **Fichiers** : `tools/agence/test_agence.py`
  - **Preuve** : rouge.
  - **Modèle** : sonnet.
- [ ] L3-08 [P] `watch` écrit `garde`.
  - **Fichiers** : `tools/agence/agence.py` (après L3-06)
  - **Preuve** : L3-07 vert.
  - **Modèle** : sonnet.
- [ ] L3-09 [P] **Test rouge du panneau : l'état du garde s'affiche** (FR-010, US2 scénario 3). Instantané porte `garde: 'actif' | 'inactif' | 'partiel' | 'inconnu'` (`inconnu` avant le premier tour du régisseur) ; la bannière « garde d'envoi inactif » avec la commande `agence hooks install` apparaît pour `inactif`, `partiel` (texte « garde d'envoi partiel ») et **aussi** pour `inconnu` après 5 s sans tour ; pas de bannière pour `actif` ; régisseur externe ou `missing` : pas de bannière trompeuse.
  - **Fichiers** : `src/panels/agence/session.test.ts`, `src/shells/desktop/ui/panels/agence/AgenceView.test.tsx`
  - **Preuve** : rouge (jsdom).
  - **Modèle** : sonnet.
- [ ] L3-10 [P] Panneau : `garde` dans le contrat, la session et la vue (bannière).
  - **Fichiers** : `src/panels/agence/contract/types.ts`, `src/panels/agence/session.ts`, `src/shells/desktop/ui/panels/agence/AgenceView.tsx`
  - **Preuve** : L3-09 vert ; `typecheck`, `lint`, `lint:deps` verts.
  - **Modèle** : sonnet.
- [ ] L3-11 [P] Documentation : `docs/architecture.md` (gardes, qui écrit quoi), `CLAUDE.md` du fork (« Cate ne lance jamais `agence hooks` »), `contracts/hooks.md` de la spec mis à jour avec le texte figé.
  - **Fichiers** : `docs/architecture.md`, `CLAUDE.md`, `specs/006-orchestrateur-portable/contracts/hooks.md` (Skills)
  - **Preuve** : diff relu.
  - **Modèle** : haiku.
- [ ] L3-12 Portes et PR du lot 3 : suite complète, `npm run test:agence`, vérification que le fork n'appelle `hooks install` nulle part (`rtk proxy grep -rn "hooks install" src` : uniquement des textes d'aide et le test).
  - **Fichiers** : aucun
  - **Preuve** : sorties citées. Corps de PR : « à ne pas installer chez Heifara avant le lot 5 : deux gardes sur un même outil ».
  - **Modèle** : haiku.

**Checkpoint lot 3** : `agence hooks install` deux fois = une fois ; un envoi Slack sans CLI donne `ask`.

---

# Lot 4 : mise à jour automatique et amorçage

Fork. **Aucune commande à taper** après une ligne collée une fois (research R7, R10). On adopte le script `cate-fork-update` de Heifara (copie lue : `/private/tmp/claude-502/-Users-ADFINITAS-Documents-cate/05a5ab7d-a055-4781-bd02-b91581440289/scratchpad/cate-fork-update.heifara.sh`, original `~/.local/bin/cate-fork-update`, agent `com.heifara.cate-fork-update`) : il ne s'écrit pas à nouveau, il se porte. Ne jamais modifier ni charger l'original ni le vrai `~/Library/LaunchAgents` : tous les tests tournent dans un faux HOME sous `mktemp -d`, avec un faux `launchctl` dans le PATH qui consigne ses appels (0 appel attendu) et qui échoue le test s'il voit le vrai HOME. Variables de test des scripts (défauts en production) : `CATE_BUILD_DIR` (`~/.local/share/cate-build`), `CATE_APPS_DIR` (`/Applications`), `LAUNCH_AGENTS_DIR` (`~/Library/LaunchAgents`), `AGENCE_NO_LOAD=1` (génère le plist, ne charge rien).

Dépendances : L4-01 à L4-06 et L4-10 **ne dépendent de rien** (peuvent partir tout de suite). L4-07 à L4-09 : lot 1 (la CLI est dans le clone) et lot 3 (`hooks`, `doctor`). Fichier partagé : `README.md` (lot 4 seul).

- [ ] L4-01 **Risque updater upstream (R6), résolu à la lecture, à figer par un test.** Sur `origin/main` du fork (`4c640482`) : `electron.vite.config.ts:23-24` (`__CATE_SELF_UPDATE__` vaut `false` si `CATE_SELF_UPDATE=0`) et `src/shells/desktop/main/index.ts:310` (`selfUpdate`). Test rouge : dans `cate-fork-update.test.mjs`, la commande de paquet (`scripts/package.mjs`) est appelée avec `CATE_SELF_UPDATE=0` dans son environnement ; sans cette variable le test échoue. Plus une phrase sourcée dans `research.md` R6 (déjà écrite) : `publish.owner` est abandonné, les anciennes L4-02 et L4-03 sont fermées « non nécessaire ».
  - **Fichiers** : `scripts/cate-fork-update.test.mjs` (cas inclus dans L4-02)
  - **Preuve** : sortie citée du cas ; `rtk proxy git grep -n "CATE_SELF_UPDATE" origin/main` cité.
  - **Modèle** : haiku (lecture sourcée et une assertion).
- [ ] L4-02 **Tests rouges du script de mise à jour**, commandes simulées par le PATH (`git`, `npm`, `node`, `codesign`, `ditto`, `xattr`, `osascript`, `pgrep`, `df`, `launchctl`) :
  1. **Node** : `node` du PATH dans la plage → utilisé ; sinon trouvé sous nvm (`v22.x` et `v24.x` présents : choisit 22), volta, fnm (deux emplacements), `node@22` de Homebrew (Apple Silicon et Intel) ; PATH réduit à `/usr/bin:/bin` comme sous launchd → trouvé quand même. Plage lue dans `package.json` du checkout (`engines.node`), pas écrite dans le script.
  2. **Version vérifiée avant `npm ci`** : Node 20 seul → sortie 3, message « Node >=22.16 <23 requis, trouvé v20.x ; cherché : PATH, nvm, volta, fnm, homebrew », **aucun** appel à `npm`, notification une seule fois pour cette version trouvée (deuxième passage : pas de seconde notification).
  3. Aucun `/Users/` ni nom de personne dans le script (grep dans le test), aucun chemin hors `$HOME`, `$CATE_BUILD_DIR`, `$CATE_APPS_DIR`.
  4. SHA déjà installé ou en attente → rien construit ; build en échec (`npm ci` ou paquet sortent 1) → `CATE_APPS_DIR` identique octet pour octet (US4 scénario 2), notification d'échec une fois, `staged` inchangé ; signature durcie détectée → refus de mettre en attente.
  5. Cate ouvert (`pgrep -x Cate` simulé) → installation différée, `staged` conservé, sortie 0 ; Cate fermé → ancienne app en `.old` puis supprimée, quarantaine retirée, SHA noté.
  6. Verrou : un second passage pendant le premier sort 0 « already running » ; le verrou se libère à la sortie, aussi en échec.
  7. **Aucun daemon arrêté** : aucun appel à `kill`, `pkill`, `ps` sur `runtime.cjs` ; le binaire de Cate n'est jamais lancé (aucun appel sous `Cate.app/Contents/MacOS`).
  8. Espace disque : `df` simulé sous 5 Go libres → sortie 4 avant le build, message clair.
  9. Hors macOS (`uname` simulé) → sortie 2, message clair.
  10. `--prereq` : rend une ligne par prérequis (`ok`, `manque`) sans rien construire ni écrire (mtime du faux HOME avant et après identique) ; c'est la fonction que L4-05 appelle.
  - **Fichiers** : `scripts/cate-fork-update.test.mjs`
  - **Preuve** : `node --test scripts/cate-fork-update.test.mjs` rouge (script absent), chaque cas échoue pour sa raison (sortie citée) ; `shasum` du vrai `~/.local/bin/cate-fork-update` et de son plist avant et après identiques (cité).
  - **Modèle** : sonnet (scripts shell simulés par PATH ; pas opus : aucune décision de sécurité).
- [ ] L4-03 `scripts/cate-fork-update.sh` : port du script local, **mêmes étapes et même ordre** (verrou, clone, fetch, build quand le SHA bouge, mise en attente, installation quand Cate est fermé), plus : détection de Node (R7), version vérifiée avant `npm ci`, espace disque, notification d'échec dédupliquée, chemins en variables d'environnement avec défauts, plus de `~/.bun/bin` ni de v24.21.0 codés en dur (vérifier d'abord par `rtk proxy grep -rn "bun" scripts package.json` que le build n'appelle pas `bun` ; sinon le chemin entre dans la détection), `--prereq`, `--force` et la branche en argument conservés.
  - **Fichiers** : `scripts/cate-fork-update.sh` (mode 0755)
  - **Preuve** : L4-02 vert ; `zsh -n scripts/cate-fork-update.sh` sans sortie ; `rtk proxy grep -nE "/Users/|heifara|ADFINITAS" scripts/cate-fork-update.sh` = 0 ; `diff` avec la copie de Heifara cité (changements listés un par un dans le message de commit). Le build réel et l'installation dans `/Applications` ne sont **pas** lancés par l'agent (X003).
  - **Modèle** : sonnet (port d'un script qui marche, cas limites nommés par les tests).
- [ ] L4-04 **Test rouge du plist généré** (agent launchd) : avec `HOME` = faux dossier et `AGENCE_NO_LOAD=1`, `agence-install.sh --plist-seulement` écrit `<LAUNCH_AGENTS_DIR>/fr.adfinitas.cate-fork-update.plist` ; le test relit le fichier : `Label` neutre, `ProgramArguments` = `<faux HOME>/.local/bin/cate-fork-update` (chemin absolu, pas de `~`), `StartInterval` 600, `RunAtLoad`, `Nice` 10, `LowPriorityIO`, journaux sous `<faux HOME>/Library/Logs/` ; **aucune** occurrence du vrai HOME ni de `heifara` ; `plutil -lint` rend `OK` (cas ignoré, marqué, hors macOS) ; le faux `launchctl` n'a reçu **aucun** appel ; le vrai `~/Library/LaunchAgents` est inchangé (liste et `shasum` avant et après, cités).
  - **Fichiers** : `scripts/agence-install.test.mjs`
  - **Preuve** : rouge (script absent), puis les assertions citées une par une.
  - **Modèle** : sonnet.
- [ ] L4-05 **Tests rouges de l'amorçage**, faux HOME, faux `git`, `gh`, `node`, `xcode-select`, `launchctl`, `curl`, faux `agence` :
  1. **Prérequis nommés, rien déclenché** : `xcode-select -p` en échec → message « outils développeur manquants : `xcode-select --install` puis recoller la même ligne », sortie 5, **aucun appel** à `git`, `python3` ni `/usr/bin/*` qui ouvre la fenêtre ; Node hors plage → message de R7 ; `gh` absent → « `brew install gh` » (la commande, sans l'exécuter) ; `gh` non connecté avec terminal → `gh auth login --web` lancé avec `< /dev/tty`, sans terminal → manque nommé.
  2. **Étapes** : copie `cate-fork-update` dans `~/.local/bin` (0755), plist de L4-04, remplacement d'un agent existant qui lance `cate-fork-update` sous une autre étiquette (déchargé puis supprimé, sans que le script contienne son nom), construction et installation via le script de mise à jour, `agence hooks install` puis `agence doctor --hors-cate` (faux `agence` : ordre des appels vérifié) ; `--sans-gardes` saute `hooks install` ; échec d'une étape = arrêt, message, code ≠ 0, rien de ce qui précède n'est défait ni doublé.
  3. **Idempotence** : deux passages = un seul plist, un seul script, un seul agent chargé, `settings.json` identique (le faux `agence` consigne les appels), même sortie utile ; un passage interrompu après le clone reprend sans recloner.
  4. **Une fonction `main` appelée à la dernière ligne** : le script tronqué à la moitié n'exécute rien (test : `head -c <moitié>` du script, lancé, 0 effet de bord).
  5. **Résumé final** : au plus 3 lignes « reste à faire » (par exemple régler `agence.nom` si `agence nom` rend un nom manifestement faux ; le réglage `cliTerminalInputEnabled` du workspace) ; 0 ligne si rien ne reste ; jamais plus de 3.
  6. `HOME` égal au HOME réel du processus de test → le test échoue avant tout appel.
  - **Fichiers** : `scripts/agence-install.test.mjs`
  - **Preuve** : rouge ; `shasum` de `~/.claude/settings.json` et liste de `~/Library/LaunchAgents` avant et après le test, identiques (cités).
  - **Modèle** : opus (le script écrit dans `~/.claude`, `~/Library/LaunchAgents` et `/Applications` de quelqu'un d'autre : une erreur d'idempotence ou de remplacement d'agent s'observe chez Max, pas chez nous).
- [ ] L4-06 `scripts/agence-install.sh` (POSIX `sh`, fonction `main`) : prérequis (L4-05 cas 1, via `cate-fork-update.sh --prereq` pour Node, une seule source), clone si absent (`https://github.com/Heifarabuval/cate.git`, public) vers `CATE_BUILD_DIR`, copie du script, génération du plist, remplacement de l'agent existant, première construction **au premier plan** avec l'avancement et « 10 à 20 min attendues » (durée non mesurée : à mesurer en X003), `launchctl bootstrap gui/$(id -u)` sauf `AGENCE_NO_LOAD`, puis gardes et `doctor` (L4-08), résumé de 3 lignes. Options : `--sans-gardes`, `--plist-seulement` (tests).
  - **Fichiers** : `scripts/agence-install.sh` (mode 0755)
  - **Preuve** : L4-04 et L4-05 verts ; `sh -n scripts/agence-install.sh` sans sortie ; `rtk proxy grep -nE "/Users/|heifara|ADFINITAS" scripts/agence-install.sh` = 0. Les appels réels (`launchctl`, build, `/Applications`) restent à X003.
  - **Modèle** : opus (même raison que L4-05).
- [ ] L4-07 [P] Test rouge de `doctor --hors-cate` : sans `CATE_SOCKET` (lancé par l'amorçage, hors terminal Cate), les points qui exigent une app ouverte (socket, réglages CLI du workspace, type `agence`, `agent usage`, skill semé) sortent en `info` avec « à vérifier dans un terminal Cate : `agence doctor` » ; les autres (python3, `gh`, `claude`, gardes, nom, `agence/` du build installé) gardent `ok` ou `manque` ; code 1 seulement si un bloquant hors Cate manque ; n'écrit rien.
  - **Fichiers** : `tools/agence/test_doctor.py`
  - **Preuve** : rouge (option inconnue). Après L3-05 (même fichier).
  - **Modèle** : sonnet.
- [ ] L4-08 [P] `agence doctor --hors-cate`.
  - **Fichiers** : `tools/agence/agence.py` (après L3-06, même fichier)
  - **Preuve** : L4-07 vert ; les tests de L3-05 toujours verts.
  - **Modèle** : sonnet.
- [ ] L4-09 **Test rouge puis `scripts/agence-uninstall.sh`** : décharge l'agent (`launchctl bootout`, faux dans le test), supprime le plist généré et `~/.local/bin/cate-fork-update` ; `--gardes` lance `agence hooks uninstall` ; `--tout` supprime en plus `CATE_BUILD_DIR` (jamais l'app, jamais `~/.cate`, jamais `~/.claude` hors `hooks uninstall`) ; idempotent (deuxième passage : « rien à défaire », code 0) ; liste ce qu'il va faire et ce qu'il laisse avant d'agir.
  - **Fichiers** : `scripts/agence-install.test.mjs` (cas désinstallation), `scripts/agence-uninstall.sh` (mode 0755)
  - **Preuve** : rouge puis vert ; état du faux HOME avant l'installation = après désinstallation `--tout --gardes` (diff vide, cité).
  - **Modèle** : sonnet.
- [ ] L4-10 [P] README du fork, section « Orchestrateur » : la ligne unique, ce qu'elle fait en 5 lignes, le premier build (durée à mesurer), « le script de mise à jour est la seule voie de construction : un build manuel sans `CATE_SELF_UPDATE=0` peut être remplacé par la release d'upstream », désinstallation, `--sans-gardes`. Aucun secret ni nom de personne ; le fork est public.
  - **Fichiers** : `README.md`
  - **Preuve** : diff relu ; `rtk proxy grep -n "agence-install\|agence-uninstall" README.md` ; la commande du README est celle de `quickstart.md`, comparée par X001.
  - **Modèle** : haiku (documentation depuis le quickstart).
- [ ] L4-11 Portes et PR du lot 4 : `npm test`, `npm run test:agence`, `node --test scripts/*.test.mjs` verts. Corps de PR : **pire cas** chiffré : une construction de 10 à 20 min (non mesurée) à `Nice 10` toutes les fois que `origin/main` bouge, aucune coupure de service puisque rien n'est arrêté ; installation d'une app seulement Cate fermé ; ressource lue : espace disque libre (`df -h ~` cité) et taille de `~/.local/share/cate-build` chez Heifara (`du -sh`, cité). Relance ou redéploiement : non ; backfill : non.
  - **Fichiers** : aucun
  - **Preuve** : sorties citées.
  - **Modèle** : haiku.
**Checkpoint lot 4** : en faux HOME, la ligne d'amorçage rejouée deux fois donne le même état ; le script de mise à jour ne construit rien sous Node hors plage et n'installe rien si le build échoue ; aucun daemon n'est arrêté ; 0 appel réel à `launchctl`.

---

# Lot 4b : le daemon suit l'app

Fork. **Dépendance : aucune, peut partir tout de suite** (fichiers : `src/client/connections/`, un composant d'écran, `docs/architecture.md` ; aucun commun avec les lots 1 à 4 hors `docs/architecture.md`, additif). Décision et options écartées : research R9. Annoncer sur le bus `repo:cate` les fichiers pris.

- [ ] L4B-01 **Tests rouges Vitest** dans `src/client/connections/runtimeUpdate.test.ts` (modèle : les cas existants, `build: '2.0.4+b'` de la ligne 32) :
  1. même version, `rpc.remote.build` = `2.0.4+a`, app `2.0.4+b` → `runtime.update` appelé une fois avec `{ version, build, ifIdle: true }` ;
  2. même version, même build → aucun appel ;
  3. `deps.build` absent, ou `rpc.remote.build` absent → aucun appel (comparaison impossible, pas de boucle) ;
  4. même version, build différent, refus `dirty` raison `busy`, client seul → `required` posé (la demande de confirmation existante) ; raison `shared` → `required` **non** posé, le workspace reste utilisable ;
  5. version du runtime **supérieure** à celle de l'app, build différent → aucun appel (jamais rétrogradé) ;
  6. après le redémarrage le build diffère encore → le message d'erreur existant (« still does not run this build »), un seul essai (`tried`), pas de boucle ;
  7. runtime d'une version **inférieure** : comportement inchangé (non-régression des cas existants) ;
  8. la demande pour deux versions égales porte les deux builds (champs optionnels `runtimeBuild`, `appBuild` de `RuntimeMismatch`).
  - **Fichiers** : `src/client/connections/runtimeUpdate.test.ts`
  - **Preuve** : `npx vitest run src/client/connections/runtimeUpdate.test.ts` rouge, cas 1, 4 et 8 en échec pour la bonne raison (sortie citée) ; cas 2, 3, 5, 7 verts dès le départ (ce sont les garde-fous).
  - **Modèle** : sonnet (état asynchrone et simulateurs de connexion à relire).
- [ ] L4B-02 Correctif dans `updateCandidate` (`runtimeUpdate.ts:40-45`) : à la condition `compareSemver(...) < 0`, ajouter « ou versions égales et builds définis et différents », qui rend le même `{ update: 'runtime', ... }` ; `updateCandidate` reçoit la connexion (ou le build lu de `connection.rpc.remote`) ; `RuntimeMismatch` gagne `runtimeBuild?` et `appBuild?`. Les deux appelants (`check`, la reprise après échec) passent par la même fonction : une seule règle. Grep des appelants avant (`rtk proxy grep -rn "updateCandidate\|RuntimeMismatch" src`) : le cœur mobile (`src/shells/mobile/core/state.ts`) est relu, le champ ajouté est optionnel donc sans effet.
  - **Fichiers** : `src/client/connections/runtimeUpdate.ts`, `src/client/connections/status.ts` si le type y vit
  - **Preuve** : L4B-01 vert ; `npm run typecheck`, `npm run lint`, `npm run lint:deps` verts ; `git diff --stat` : moins de 30 lignes hors tests.
  - **Modèle** : sonnet.
- [ ] L4B-03 [P] Test rouge puis texte de l'écran : quand les versions sont égales, `RuntimeMismatch.tsx` dit « même version, autre build » avec les deux builds (court, tronqués à 8 caractères), et ce que la mise à jour arrête (terminaux et agents du workspace) ; pas de « 2.1.0-beta.15 → 2.1.0-beta.15 ». Les écrans voisins (`ConnectionBlocker.tsx`, `WorkspaceGate.tsx`, `connectionStatus.tsx`) relus : une exigence sur un écran vaut pour les écrans liés.
  - **Fichiers** : `src/shells/desktop/ui/app/workspace/RuntimeMismatch.tsx` (+ son test jsdom), éventuellement les trois écrans voisins
  - **Preuve** : jsdom rouge puis vert ; capture de l'écran réel (Playwright ou Chrome sur l'app de dev, 1280 px) citée, sinon « non vérifié ».
  - **Modèle** : sonnet.
- [ ] L4B-04 [P] Documentation : `docs/architecture.md` (la phrase « An older release is updated immediately when… » gagne « or another build of the same release » ; la phrase « Runtimes never update on their own; a client asks » reste vraie) ; aucune règle de « clean cuts » violée (pas de shim).
  - **Fichiers** : `docs/architecture.md`
  - **Preuve** : diff relu ; le document reste la référence du code.
  - **Modèle** : haiku.
- [ ] L4B-05 Portes et PR sur le fork : `npm run typecheck && npm run lint && npm run lint:deps && npm test` (échecs environnementaux du `CLAUDE.md` listés comme tels). Corps de PR : cause racine en une phrase (« une version identique à chaque build du fork ne déclenche rien »), ce qui évite la récidive (les 8 cas), code mort : aucun. **Pire cas** : un workspace inactif redémarre une fois à l'ouverture de l'app (terminaux et agents du workspace arrêtés, quelques secondes à une minute) ; un workspace occupé ne bouge pas sans demande ; ressource lue : `info.clients` du daemon (nombre de clients), valeur citée. Relance : le daemon du workspace se met à jour au prochain build installé, pas de `pkill`.
  - **Fichiers** : aucun
  - **Preuve** : sorties citées. Essai réel : X003 (deux installations de suite).
  - **Modèle** : haiku.

**Checkpoint lot 4b** : après l'installation d'un nouveau build de l'app, un workspace inactif repart sur le nouveau runtime sans `pkill`, un workspace occupé demande avant.

---

# Lot 5 : bascule de Skills (PR sur Skills)

Dépôt Skills, branche `feat/bascule-orchestrateur`. Ne démarre qu'après la fusion des lots 2 et 3 et l'installation du build du fork chez Heifara. Première tâche : lever les deux risques de transition.

- [ ] L5-01 **Risques de transition.** (a) Priorité entre un skill de projet (`.claude/skills/orchestrateur/` semé par Cate) et un skill utilisateur du même nom (`~/.claude/skills/orchestrateur`, lien de `skills.sh`) : lequel Claude Code charge-t-il ? (b) Deux hooks `PreToolUse` sur un même outil, l'un `allow`, l'autre `ask` : la décision finale ? Sonde avec un dossier de configuration isolé (`CLAUDE_CONFIG_DIR=$(mktemp -d)`, hooks factices qui impriment leur décision) ; si l'isolation empêche la connexion, lire la documentation officielle (agent `claude-code-guide`) et marquer « non vérifié en réel ».
  - **Fichiers** : `specs/006-orchestrateur-portable/research.md` (R2 et note de `contracts/hooks.md`, Skills)
  - **Preuve** : sortie des deux sondes ou citation de la doc ; verdict (a) et (b). Si (b) = « un `allow` lève un `ask` » : l'ordre du lot, voir L5-04, devient obligatoire ; si (a) = « le skill utilisateur gagne » : le retrait du lien (L5-06) précède tout essai.
  - **Modèle** : sonnet (sonde guidée, sources à citer).
- [ ] L5-02 Test rouge du garde d'envoi réduit : les cas de `common/hooks/tests/cases.json` pour `send-guard` ne gardent que l'exception personnelle (envoi dans son propre DM Slack autorisé) ; tout autre envoi Slack ou Gmail : **aucune décision** du garde de Skills (celle d'agence fait foi), jamais un `allow` ; un `slack_send_message` vers un autre canal ne reçoit pas `allow`.
  - **Fichiers** : `common/hooks/tests/cases.json`
  - **Preuve** : `python3 ~/.claude/setup/check.py` rouge sur les nouveaux cas (cités).
  - **Modèle** : sonnet.
- [ ] L5-03 `send-guard.sh` réduit à l'exception du DM de Heifara, en entrée personnelle séparée de celle d'agence ; plus d'`allow` pour un brouillon cliqué (agence s'en charge).
  - **Fichiers** : `common/hooks/send-guard.sh`
  - **Preuve** : L5-02 vert ; `check.py` 0 échec.
  - **Modèle** : opus (garde d'envoi : une décision `allow` en trop envoie sans clic).
- [ ] L5-04 **Bascule de PATH et de gardes, dans le bon ordre.** Test de chemin : dans un terminal Cate, `command -v agence` rend le lanceur du runtime et non `~/.claude/bin/agence` ; `agence --version` ≠ une version de Skills. Puis retrait de `agence-guard.sh` et des entrées de `common/settings.base.json:43` et `:62` remplacées par la seule entrée personnelle de L5-03. **Ordre pour Heifara** : (1) `agence hooks install` d'abord (les deux gardes tournent ensemble un court moment : double `ask`, jamais un trou) ; (2) puis `./skills.sh install` qui retire les anciens ; (3) `agence hooks status` = `actif`. Jamais l'inverse (un trou de garde entre les deux).
  - **Fichiers** : `common/settings.base.json`, `common/hooks/agence-guard.sh` (supprimé), `common/hooks/tests/cases.json`
  - **Preuve** : `jq '.hooks.PreToolUse | length' common/settings.base.json` avant et après cités ; test de PATH : sortie de `command -v agence` citée (`[H]` pour le terminal Cate réel, sinon « non vérifié ») ; `check.py` 0 échec.
  - **Modèle** : opus (bascule de PATH et de gardes : l'ordre d'application décide s'il y a un trou de sécurité chez Heifara).
- [ ] L5-05 [P] Retrait du code livré par le fork : `common/tools/agence.py`, `common/tools/test_agence.py`, `common/skills/orchestrateur/` (avec son `evals.json`), `common/bin/agence`. Grep des références avant suppression (`skills.sh`, `common/cate/MANQUES.md`, `common/agence/BRIEF.md`, `check.py`, `common/settings.base.json`) et mise à jour de chaque référence trouvée ; liste du code mort dans la PR.
  - **Fichiers** : `common/tools/agence.py`, `common/tools/test_agence.py`, `common/skills/orchestrateur/`, `common/bin/agence`, `skills.sh` et les docs qui les citent
  - **Preuve** : `rtk proxy grep -rn "tools/agence.py\|bin/agence\|skills/orchestrateur" . --include="*" -l` = uniquement l'historique des specs ; `check.py` 0 échec.
  - **Modèle** : sonnet (grep des références et suppressions ciblées).
- [ ] L5-06 [P] Mesure et contrôle du setup : `python3 ~/.claude/setup/check.py` 0 échec, puis `python3 ~/.claude/setup/measure.py --label "bascule orchestrateur portable"`.
  - **Fichiers** : aucun
  - **Preuve** : valeurs citées avant et après (le coût de contexte baisse du skill retiré, ou le reste dans la copie semée du fork).
  - **Modèle** : haiku.
- [ ] L5-07 **[H] Heifara bascule.** Voir « Ce que Heifara doit faire » : installer le build du fork, lancer `agence hooks install`, puis `./skills.sh install`, vérifier `agence hooks status` et `command -v agence`.
  - **Fichiers** : aucun (poste de Heifara)
  - **Preuve** : liste à cocher ; l'agent contrôle ensuite en lecture seule : `agence hooks status` = actif, `jq '.hooks.PreToolUse' ~/.claude/settings.json` ne contient plus `agence-guard.sh`, `ls ~/.claude/bin/agence` absent, un projet ouvert se relit (`agence need list`).
  - **Modèle** : haiku (contrôles en lecture seule après coup).
- [ ] L5-08 PR sur Skills : `Closes #<issue Skills>` seulement si tout est fait ; sinon `Réf.`. Impact prod : config personnelle de Heifara. Rollback : `git revert` de la PR et `./skills.sh install` rétablit l'ancien skill et ses gardes.
  - **Fichiers** : aucun
  - **Preuve** : PR ouverte, brouillon seulement ; Heifara merge.
  - **Modèle** : sonnet.

**Checkpoint lot 5** : Heifara orchestre avec la CLI livrée par le fork, ses états s'ouvrent, un seul jeu de gardes actif.

---

# Transversal : relecture finale « Max, premier lancement »

Après les lots 1 à 4 et 4b fusionnés (le lot 5 peut suivre).

- [ ] X001 Test du parcours « Max, première minute » dans un **faux HOME** : `HOME=$(mktemp -d)`, `GIT_CONFIG_GLOBAL` jetable, faux `gh`, `claude`, `cate`, `xcrun`, `launchctl`, `node` dans un PATH jetable ; `AGENCE_NO_LOAD=1`. Rejouer **la ligne unique** de `quickstart.md` (le script local à la place du `curl`, texte de la commande comparé à celui du quickstart), puis dans l'ordre ce qui se rejoue sans app : `agence doctor --hors-cate`, `agence hooks status` (actif), `agence nom`, envoi simulé d'un brouillon, `agence hooks uninstall` puis `scripts/agence-uninstall.sh --tout`, état du faux HOME identique à l'origine. Compter les commandes tapées après la ligne : **0**.
  - **Fichiers** : `tools/agence/test_quickstart.py`
  - **Preuve** : `python3 -m unittest tools/agence/test_quickstart.py` vert ; le test échoue si le vrai HOME est touché (`shasum` du vrai `~/.claude/settings.json` et liste de `~/Library/LaunchAgents` avant et après, cités) ; la ligne du quickstart est comparée par le test.
  - **Modèle** : sonnet.
- [ ] X002 **Relecture finale** : repasser spec.md contre le fork construit, exigence par exigence (FR-001 à FR-012, SC-001 à SC-005, 5 cas limites), chacune avec sa preuve (commande et sortie) ou « non vérifié » ; relire `quickstart.md` mot à mot contre les commandes réelles (une commande qui n'existe plus est une erreur) ; chercher des « Heifara » et des chemins personnels qui auraient échappé au grep (README, `docs/`, messages d'erreur) ; vérifier que Max n'a **aucun fichier à éditer à la main** (SC-001) ; lister les écarts sous forme d'issues proposées.
  - **Fichiers** : `specs/006-orchestrateur-portable/rapport-final.md` (Skills)
  - **Preuve** : tableau exigence → preuve, 0 ligne sans source ; écarts listés ; commit `docs(specs): relecture finale de l'orchestrateur portable (#n166)`.
  - **Modèle** : opus (jugement transversal sur six lots : trouve ce qu'un test par lot ne voit pas).
- [ ] X003 **[H] Essai réel : le premier passage de Max sert de recette** (pas de compte de test à fournir). Max colle la ligne ; l'agent, en lecture seule, relève ensuite avec lui : temps total (< 30 min hors installation des prérequis, SC-001), nombre de commandes tapées après la ligne (0 attendu), `launchctl print gui/<uid>/fr.adfinitas.cate-fork-update` (agent chargé), `/Applications/Cate.app` présente, `agence hooks status`, terminal restauré après relance (`agence need list` répond). **Deuxième passage** : après un nouveau commit sur `origin/main`, l'agent attend l'installation par l'agent launchd (Cate fermé), Max rouvre Cate : le workspace inactif est sur le nouveau build **sans `pkill`** (lot 4b), constaté par `ps` sur `runtime.cjs` (SHA du build) avant et après. Mesure du premier build (durée, espace du dossier).
  - **Fichiers** : constats dans la PR du lot 4 (captures et sorties)
  - **Preuve** : sorties citées, sinon « non vérifié » ; ferme SC-001, les hypothèses sur macOS, les CLT et Node 22, et mesure la durée du premier build (aujourd'hui « non mesuré »).
  - **Modèle** : haiku (consigne des constats par l'agent à partir du retour de l'humain).

---

## Dépendances et parallélisme

- **Ordre des lots** : **4b dès maintenant, sans dépendance** ; 0 → 1 → (2, 3, 4 en parallèle) → X001 → 5 → X002 → X003. Lot 5 après fusion de 2 et 3. X001 après 1 à 4 et 4b. Dans le lot 4, L4-01 à L4-06 (script, plist, amorçage sur faux `agence`) partent sans attendre le lot 1 ; seuls le branchement réel des gardes et de `doctor` (L4-06 en vrai, L4-07, L4-08) attendent 1 et 3.
- **Lot 0** : L0-01, L0-02, L0-03, L0-04 en parallèle (sondes sur des fichiers disjoints ; L0-02 écrit une sonde dans le fork, les autres seulement le rapport : un agent par sonde, rapport assemblé par L0-05).
- **Lot 1** : L1-01 → L1-02 ; L1-03 avant L1-04, L1-05, L1-16 ; paires `[P]` : (L1-04, L1-05), (L1-06, L1-07), (L1-08, L1-09), (L1-10, L1-11), (L1-12, L1-13), les cinq paires touchant des fichiers disjoints ; L1-07 avant L1-11 et L1-13 (type d'agencement) ; L1-14 après L1-11 et L1-13 ; L1-15 après L1-07 ; L1-17 après L1-14 et L1-09 ; L1-18 `[P]` ; L1-19 en dernier.
- **Lot 2** : tout `agence.py` et `test_agence.py` : L2-03 → L2-05 → L2-07 → L2-09 → L2-11 en série (mêmes fichiers) ; les tests L2-02, L2-04, L2-06, L2-08, L2-10 sont écrits d'abord, un par un, dans `test_agence.py` (un seul agent). Seuls disjoints : le panneau TypeScript (L2-14, L2-15), le skill (L2-13) et la fixture (L2-01), en parallèle du Python. L2-12 (pureté) rouge dès le départ, vert après L2-13. L2-16 `[H]` en parallèle ; L2-17 après L2-05 et L2-16.
- **Lot 3** : Python en série (`agence.py`) : L3-02 → L3-04 → L3-06 → L3-08 ; leurs tests dans trois fichiers distincts (`test_hooks.py`, `test_guard.py`, `test_doctor.py`) peuvent s'écrire en parallèle (L3-01, L3-03, L3-05), mais chaque test reste rouge **avant** son code. Le panneau (L3-09, L3-10) et la doc (L3-11) en parallèle du Python. L3-09 dépend du contrat `garde` écrit par L3-10 seulement pour la compilation.
- **Lot 4** : L4-02 (tests du script) → L4-03 (script) ; L4-01 est un cas de L4-02 ; L4-04 et L4-05 (tests de l'amorçage, même fichier : un agent) → L4-06 ; L4-07 → L4-08 en série dans `test_doctor.py` et `agence.py` (après L3-05 et L3-06) ; L4-09 après L4-06 ; L4-10 `[P]` ; L4-11 en dernier. Les scripts du lot 4 sont dans des fichiers disjoints de ceux des lots 1 à 3.
- **Lot 4b** : L4B-01 → L4B-02 ; L4B-03 et L4B-04 `[P]` (fichiers disjoints) ; L4B-05 en dernier. Aucune dépendance sur un autre lot ; `docs/architecture.md` partagé en additif avec les lots 1 et 3 (rebase trivial).
- **Fichiers partagés entre lots** : `agence.py` (lots 1, 2, 3 et 4 pour `doctor --hors-cate` : rebaser 4 sur 3), `scripts/build-runtime-tarball.mjs` et son test (lots 1 et 3 : L3-04 après la fusion du lot 1), `docs/architecture.md` et `CLAUDE.md` (lots 1, 3 et 4b), `README.md` (lot 4 seul). Aucun worktree n'est partagé : un agent par worktree, bus `repo:cate` pour annoncer les fichiers pris.
- **Stratégie** : MVP = lot 1 (la CLI livrée). Lot 2 puis lot 3 apportent la portabilité et la sécurité ; Max a un système utilisable après 1 + 2 + 3 + 4. Le lot 5 ne sert qu'à Heifara.

## Hypothèses à confirmer

| Hypothèse (plan) | Si fausse | Tâche qui la lève |
|---|---|---|
| Max est sur macOS | pas de notification système, lanceur POSIX sans `xcrun`, pas de `.app` à copier : les scripts du lot 4 s'arrêtent hors macOS (sortie 2) | L0-01 (branche POSIX du lanceur), L1-01, L4-02 (cas 9), X003 |
| Max a les Command Line Tools (`/usr/bin/python3` 3.9.6) | `agence` sort 2 avec `xcode-select --install` ; l'amorçage s'arrête et le nomme (sortie 5), Max recolle la ligne | L0-01, L1-01, L4-05 (cas 1), X003 |
| ~~Max a accès au dépôt du fork~~ | **levée** : le fork est public (`gh api repos/Heifarabuval/cate --jq .private` = `false`, 2026-11-18) | aucune ; à relire si le fork passe privé |
| Max a Node 22.16 à 22.x (nvm, volta, fnm ou Homebrew) | l'amorçage s'arrête avec le manque et la commande ; deuxième collage | L4-02 (cas 1 et 2), L4-05 (cas 1), X003 |
| Max a `gh` (ou Homebrew pour l'installer) | l'amorçage nomme `brew install gh` ; sans Homebrew, lien de téléchargement dans le message | L4-05 (cas 1), X003 |
| `launchctl bootstrap gui/<uid>` disponible (macOS 13 ou plus) | repli `launchctl load` ; sinon pas de mise à jour automatique, l'amorçage le dit | L4-06, X003 (non vérifié en local : version de macOS de Max inconnue) |
| Une app signée ad hoc, construite sur place, s'ouvre sur le Mac de Max sans réglage | Gatekeeper bloque : clic droit, Ouvrir (une fois) | X003 (marche chez Heifara ; non vérifié chez Max) |
| Le build n'appelle pas `bun` (le PATH du script local le contenait) | build en échec sur un Mac sans bun | L4-03 (grep avant le port) |
| Premier build de 10 à 20 min, ressource disque suffisante (5 Go libres) | seuil mal placé, refus à tort ou espace plein | X003 (mesure), L4-02 (cas 8) |
| `rpc.remote.build` est publié par tout runtime du fork et comparable au build de l'app (`deps.build`) | pas de candidat, le `pkill` reste nécessaire | L4B-01 (cas 3), X003 (deuxième passage) |
| Priorité skill de projet ou skill utilisateur du même nom | le skill de Heifara masque le skill semé, ou l'inverse : mauvaise version | L5-01 (a), L5-05 |
| `cate panel create --help` liste les types de panneaux | `doctor` ne peut pas vérifier le type `agence` par l'aide | L0-04 (a), L3-05 |
| Le mode `CATE_RUNTIME_BUNDLE` ne couvre pas `agence/` (`installDirFromExecPath`) | en dev, `agence` introuvable ou ancienne version | L0-04 (b), L1-15 |
| ~~L'updater peut remplacer le fork par la release upstream (R6)~~ | **réglé** par `CATE_SELF_UPDATE=0` à la construction (`electron.vite.config.ts:23-24` sur `origin/main`) ; reste exposé : un build manuel sans la variable | L4-01 (test), L4-10 (README) |
| Un `allow` d'un hook ne lève pas l'`ask` d'un autre | deux gardes sur un même outil se contredisent chez Heifara | L5-01 (b), L5-04 |
| Valeur `humain` stockée et alias `--owner heifara` (R4) | autre forme de compatibilité | L2-04, L2-05 (validée avec le plan, brief #n189) |
| Plus de page HTML sous le panneau (R3) | le repli à la main change | L2-10, L2-11 (validée avec le plan, brief #n189) |

## Ce que Heifara doit faire

Une seule liste à cocher. Un agent ne lance aucune de ces actions. Elle est courte parce que le reste se fait tout seul : l'amorçage de Max, ses mises à jour, le daemon.

- [ ] **Régler son nom** : `git config --global agence.nom Heifara` (L2-16). Pourquoi lui seul : son `user.name` vaut `Heifarabuval`, le défaut « premier mot » donnerait un mauvais nom. Max n'a rien à régler si son `user.name` commence par son prénom (l'amorçage le lui dit sinon). Sans risque avant le lot 5 : l'ancienne CLI ignore ce réglage.

Deux autres choses, que je ne peux pas faire à sa place, avec la raison :

- [ ] **Merger les PR du fork** (4b d'abord, puis 1, 2, 3, 4) : seul lui merge. 4b peut partir dès qu'elle est prête.
- [ ] **Envoyer à Max la ligne unique** (`quickstart.md`, « Max, première minute ») à la place du brouillon d185 (quatre commandes) une fois le lot 4 mergé : seul lui publie un message. Je prépare le brouillon.

À trancher (une question, pas une action) : **garder `cliTerminalInputEnabled` coupé par défaut ?** Recommandé : oui. C'est un réglage de sécurité (un agent pourrait écrire dans un terminal) et aucun script ne peut l'activer à la place du workspace. Conséquence : Max garde un clic par workspace orchestré, nommé par `doctor` et par le skill. Si non, une ligne dans le fork change le défaut (0,1 j, à proposer à part).

Plus tard, lot 5 (inchangé) : sur son poste, `agence hooks install`, puis `./skills.sh install`, puis `agence hooks status`. Jamais `skills.sh install` **avant** `agence hooks install` (un trou de garde entre les deux). S'il adopte l'amorçage du fork chez lui : `--sans-gardes` tant que le lot 5 n'est pas fait.

Retirées depuis la version précédente : accès au dépôt (le fork est public), compte macOS de test (le premier passage de Max sert de recette, X003), validation de R3 et R4 (validées avec le plan), installation du build avec `agence-update.sh` (il garde son agent actuel, qui marche ; il s'ouvre sur le nouveau build sans `pkill` grâce au lot 4b).
