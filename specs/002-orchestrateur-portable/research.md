# Research: Orchestrateur portable

Sources d'origine (2026-11-18) : fork `feat/panneau-agence` (`f729834b`), CLI `common/tools/agence.py` de Skills (`6d8935d`). Les numéros de ligne de R1 à R10 sont ceux de ces commits.

Relecture du 2026-11-19 sur `origin/main` du fork (`4630c3d2`) : chaque R porte une ligne **Statut**. R11 est nouvelle.

Coût mensuel de toutes les options retenues : 0 €. Les tailles sont en jours d'agent (j).

## R1. Où livrer la CLI `agence` : dans le tarball du runtime

- **Constat**: le tarball embarque déjà la CLI `cate` et les skills (`scripts/build-runtime-tarball.mjs:15-17`, `:139-140`) ; sa liste `required` refuse un tarball incomplet (`:146-160`). Le chemin d'une install est calculé une fois (`src/runtime/daemon/contract/install.ts:82-96`). Chaque terminal reçoit un dossier de lanceurs en tête de PATH, réécrit à chaque spawn, restauration comprise (`src/services/terminal/runtime/cateCli.ts:1-4`, `:67-83`). Le régisseur a son propre lanceur sans PTY (`src/runtime/daemon/compose/cliEnv.ts:37-60`) et lance `agence` par le PATH (`src/panels/agence/parts/runtime/regisseur.ts:114`, `:223`).
- **Options**:
  - A. **Recommandé** : `tools/agence/agence.py` dans le fork, copié en `agence/` du tarball ; `installLayout` gagne `agence` ; `cateCli.ts` et `cliEnv.ts` écrivent un second lanceur `agence` à côté de `cate` (`exec python3 '<install>/agence/agence.py' "$@"`). 1 j. Versions CLI, panneau et skill toujours alignées ; rien à installer ; PATH du terminal restauré couvert par le même code que `cate`.
  - B. `cate agence ...` : sous-commande de la CLI Node qui lance python. Réécrit le routage de `src/cli/engine.ts` (générée depuis les specs `defineCateApi`) pour un cas hors API. 1,5 j. Rejeté : casse « declare once ».
  - C. Lien dans `~/.local/bin` par un installeur. 0,5 j. Rejeté : un fichier global de plus, une version qui dérive du runtime.
- **Risque 1, python3 sur Mac neuf**: `/usr/bin/python3` est un stub qui ouvre la boîte « installer les outils de développement » sans Command Line Tools. Les CLT sont déjà requis pour `git` et le build du fork. Vérifié ici : `/usr/bin/python3` = 3.9.6, `py_compile` OK, **241 tests de `test_agence.py` OK sous 3.9.6** (2026-11-18). Le lanceur teste `xcrun --find python3` avant d'exécuter, pour ne jamais ouvrir la boîte de dialogue depuis le régisseur. Garde-fou : le test `test_agence.py` tourne en CI sous 3.9 (`actions/setup-python` 3.9).
- **Risque 2, PATH du terminal restauré**: les snapshots de shell des agents gardent PATH ; le dossier de lanceurs est stable par panneau (`cateCli.ts:70`) et réécrit au spawn. Un lanceur `agence` dans ce même dossier suit donc la même règle. Non vérifié : un terminal ouvert par l'ancien runtime avant la mise à jour garde l'ancien lanceur jusqu'à l'arrêt du daemon (qui tue de toute façon ses PTY).
- **Dev** : avec `CATE_RUNTIME_BUNDLE`, le chemin d'`agence.py` doit pointer vers le checkout. À vérifier au lot 1 (hypothèse à confirmer : `installDirFromExecPath` ne couvre pas ce cas).
- **Statut** : livré par la PR #30, option A. Écart avec le texte ci-dessus : le lanceur ne teste pas `xcrun --find` mais `xcode-select -p` puis exécute le python3 testé (`tools/agence/agence:7-27`), suite au lot 0. Mode dev couvert par `agenceLauncher` (`src/runtime/daemon/contract/install.ts:111-115`).

## R2. Le skill `orchestrateur` : skill livré du fork

- **Constat**: les skills de `skills/` sont listés comme source `cate` (`src/workspace/skills/runtime/bundled.ts:11-37`) et semés dans chaque dépôt dont le dossier d'outil existe (`.claude`), suivis par `.cate/skills.json`, rafraîchis quand le bundle change sauf copie éditée (`src/workspace/skills/runtime/seed.ts:1-10`, `service.ts:165-172`), sous `cliSkillInstallEnabled`.
- **Options**:
  - A. **Recommandé** : `skills/orchestrateur/` dans le fork. 0,25 j. Même version que la CLI ; mise à jour avec le runtime.
  - B. `~/.claude/skills/orchestrateur` par l'installeur. Rejeté : fichier global, version libre.
- **Coût caché**: une copie par dépôt (`.claude/skills/orchestrateur/`), visible par git. Même règle que `cate-cli` aujourd'hui. Un dépôt sans `.claude` n'a pas le skill : `agence doctor` le dit.
- **Doublon chez Heifara**: son `~/.claude/skills/orchestrateur` (lien de `skills.sh`) entre en concurrence avec la copie du dépôt. Au lot 5, Skills retire le skill et le lien `common/bin/agence`. Hypothèse à confirmer : priorité de Claude Code entre skill de projet et skill utilisateur du même nom.
- Le skill cite `~/Documents/Skills/specs/001-...` (`SKILL.md:8`) et « Heifara » 10 fois : réécrit en « l'humain » et `agence nom`.
- **Statut** : ouvert (lot 2). `skills/` du fork ne contient que `cate-cli` et `cate-theme`. Le mécanisme lit le dossier (`src/workspace/skills/runtime/bundled.ts:30`) : aucun code à ajouter, seulement le skill, son entrée `required` du tarball (`scripts/build-runtime-tarball.mjs:160`) et la ligne « bundled skills » de `docs/architecture.md` (section 9.6). La source du skill est aujourd'hui `~/.claude/skills/orchestrateur/SKILL.md` de Heifara (lien de Skills, modifié par la spec 001, lot C).

## R3. Les gardes : `agence hooks install`, lancé par l'utilisateur

- **Constat**: Cate n'écrit jamais un fichier global de l'utilisateur (CLAUDE.md du fork, section State : « Cate writes only repo-local agent files »). Chez Heifara, `send-guard.sh` et `agence-guard.sh` sont branchés dans `~/.claude/settings.json:61` et `:89`. `send-guard.sh` dépend de `jq` (`send-guard.sh:6-7`, présent dans macOS 15+ : `/usr/bin/jq` 1.7.1-apple vérifié ici) et contient une exception personnelle, le DM Slack de Heifara (`send-guard.sh:4`, `:8`). `agence-guard.sh` appelle `../tools/agence.py` (`agence-guard.sh:12`).
- **Options**:
  - A. **Recommandé** : `agence hooks install|uninstall|status` dans `agence.py` (json stdlib, pas de `jq`). Deux entrées `PreToolUse` reconnues par leur commande (`contracts/hooks.md`). La commande du hook appelle la CLI du runtime courant par `~/.cate/runtime/current` (maintenu par `src/runtime/daemon/node/install.ts:151`), fallback `ask` pour les outils d'envoi. 1 j avec tests en faux HOME.
  - B. `.claude/settings.json` du dépôt écrit par Cate au seed. Rejeté : Cate écrirait la config d'agent d'un dépôt client, versionnée, partagée avec des gens qui n'ont pas agence.
  - C. Script shell + `jq` à côté du fork. Rejeté : seconde logique de fusion, non testable en unittest.
- **Sans les gardes** : un agent peut lire la page HTML du régisseur (le jeton est dans le formulaire, `agence.py:903`), puis poster le clic ; ou écrire `state.json` pour marquer un brouillon cliqué ; et un `slack_send_message` part selon les seules permissions de Max. Le panneau affiche une bannière (FR-010).
- **Réduction structurelle (proposée)**: sous `--token-stdin` (régisseur du panneau), `watch` ne sert plus aucune page HTML (`do_GET` 404, `agence.py:1048-1062`) : le jeton ne sort plus du daemon. Le garde reste nécessaire pour `state.json` et pour Slack/Gmail. 0,25 j.
- **Statut** : ouvert (lot 3 pour les gardes, lot 2 pour le 404). Sur `origin/main`, `guard()` est à `agence.py:1770-1809`, `cmd_guard` à `:1812`, `do_GET` à `:1164-1179` ; aucune commande `hooks` ni option `--mode`.

## R4. Le nom de l'humain

- **Constat**: 22 lignes d'`agence.py` et 10 du skill disent « Heifara » ; la valeur `owner: 'heifara'` est stockée (`agence.py:501`, `:657`, `:1391`), lue (`:288`, `:978-979`, `:1261`) et proposée en choix (`:1602`). Côté fork : `src/panels/agence/contract/suivi.ts:86-87`, `SuiviList.tsx:11`, fixtures. `git config user.name` de Heifara vaut `Heifarabuval` : le défaut « premier mot » donnerait « Heifarabuval ».
- **Options**:
  - A. **Recommandé** : valeur stockée neutre `humain` ; `load()` (`agence.py:114-122`) réécrit `heifara` en `humain` (seul écrivain : la CLI) ; `--owner heifara` reste accepté comme alias. Nom affiché : `AGENCE_NOM`, puis `git config agence.nom`, puis premier mot de `user.name`, puis « toi ». Le régisseur écrit `st['humain'] = nom` à chaque tour ; le panneau l'affiche (« À faire par <nom> »). Heifara lance une fois `git config --global agence.nom Heifara`. 0,5 j.
  - B. Garder la valeur `heifara` comme clé opaque, changer seulement les textes. 0,25 j. Rejeté : Max voit `heifara` dans `need list` et `--owner`.
  - C. Fichier de config `~/.config/agence.json`. Rejeté : un fichier de plus pour une valeur.
- **Fenêtre de compatibilité**: un panneau qui lit un vieil état avant tout `tx` classerait mal les lignes `heifara`. Le régisseur fait un tour au démarrage (`agence.py:1477-1482`), donc la fenêtre dure un tour (2 s). Accepté ; pas de shim dans le fork (règle « clean cuts »).
- **Statut** : en partie livré par la PR #41, avec trois écarts. (1) Défaut « L'humain » au lieu de « toi ». (2) Alias `--owner heifara` retiré (coupe nette) ; `need add --owner humain`, `need list` affiche `humain` (`qui()`, `agence.py:99-101`). (3) Valeur stockée gardée à `heifara` (`OWNER_HUMAIN`, `agence.py:71`), lue telle quelle par le panneau (`src/panels/agence/contract/suivi.ts:86-87`). Le nom est nettoyé (une ligne, 40 caractères, `agence.py:74-77`). Reste : `watch` écrit `humain`, le panneau l'affiche (`SuiviList.tsx:12` dit « Heifara »). La réécriture de `heifara` en `humain` par `load()` est du code de migration (constitution, principe III) : Heifara garde la clé opaque (q303, 2026-11-19). L'option A ci-dessus est donc abandonnée pour la valeur stockée ; elle reste pour le nom affiché.

## R5. Notification et dépôt courant

- `toast()` (`agence.py:273-283`) appelle `osascript` sans condition. Décision : `sys.platform == 'darwin' and shutil.which('osascript')`, sinon une ligne de journal. 0,1 j.
- `gh_repo()` (`agence.py:315-319`) lit déjà `gh repo view` et met le résultat en cache dans l'état. Rien à changer. Aucun `/Users/` dans `agence.py` ni dans le skill (grep 2026-11-18).
- **Statut** : `toast()` n'est plus à changer. Le fork ne vise que macOS (principe VIII : hors macOS, absence d'effet sans erreur). `toast()` journalise déjà un échec (`agence.py:315-321`) et `_run` rend 127 sur `OSError` : aucune commande n'échoue sans `osascript`. Tâches L2-08 et L2-09 retirées.

## R6. Max sur Cate upstream ou fork

- Upstream n'a ni type `agence` ni CLI livrée. Avec la décision « le code vit dans le fork », Max **doit** builder le fork pour orchestrer. Le repli trois panneaux (`agence.py:345-370`) reste dans la CLI, mais la CLI n'existe pas sur upstream. Recommandé : le dire dans le README du fork, ne rien porter vers upstream avant rodage (constitution, principe V).
- **Risque mise à jour automatique : réglé par le script (R7)**. `electron-builder.yml:44` publie vers `0-AI-UG/cate` et un build du fork empaqueté peut s'y mettre à jour. Sur `origin/main` du fork (`4c640482`, lu 2026-11-18, pas dans le checkout local qui retarde), `electron.vite.config.ts:23-24` fixe `__CATE_SELF_UPDATE__` à `false` quand `CATE_SELF_UPDATE=0` à la construction, et `src/shells/desktop/main/index.ts:310` le passe à l'updater (`selfUpdate`). Le script de R7 construit avec `CATE_SELF_UPDATE=0` : `publish.owner` n'est plus nécessaire. Reste exposé : un build du fork fait à la main sans cette variable. Le script est donc la seule voie de construction documentée (README).

## R7. Mise à jour pour Max : adopter `cate-fork-update` (remplace l'ancienne R7 « agence-update.sh »)

- **Constat**: Heifara a déjà le mécanisme complet, depuis `~/.local/bin/cate-fork-update` (copie lue le 2026-11-18, 58 lignes) et l'agent launchd `com.heifara.cate-fork-update` (toutes les 600 s, `RunAtLoad`, `Nice 10`). Il clone le fork dans `~/.local/share/cate-build`, construit `origin/main` quand le SHA bouge (`npm ci`, `npm run runtime:tarball`, `scripts/package.mjs --mac dir`, signature ad hoc sans runtime durci), garde le résultat dans `cate-build.staged/`, attend que Cate soit fermé (`pgrep -xq Cate`), installe dans `/Applications` (ancienne app en `.old`), retire la quarantaine, note le SHA installé, notifie. Un verrou `mkdir` évite deux passages. Il n'arrête aucun daemon et n'ouvre jamais Cate. C'est ce que l'ancienne R7 voulait écrire, en mieux : build en échec = rien d'installé, installation différée, aucune commande à taper.
- **Défauts de portabilité relevés** (autant de tâches, voir lot 4) : `PATH` avec `~/.nvm/versions/node/v24.21.0/bin` codé en dur alors que le fork exige Node `>=22.16 <23` (`package.json:20-22`, `.nvmrc` 22.22.2) ; `~/.bun/bin` dans le PATH sans usage trouvé dans `scripts/` (à vérifier) ; chemins `/Users/ADFINITAS` dans le plist ; aucune vérification de version de Node avant `npm ci` (un mauvais Node échoue tard, avec une erreur de build illisible, toutes les 10 minutes) ; une notification seulement en cas de succès ; l'étiquette `com.heifara...` est personnelle (FR-012) ; `#!/bin/zsh` : acceptable, zsh est livré avec macOS depuis 10.15.
- **Options**:
  - A. **Recommandé** : livrer le script dans le fork (`scripts/cate-fork-update.sh`), le rendre portable, l'installer par un amorçage unique (`scripts/agence-install.sh`, R10) qui écrit le plist avec les chemins du HOME courant. 2 j pour le lot 4 entier. 0 €.
  - B. Écrire `agence-update.sh` comme prévu (fetch, build, copie, arrêt des daemons après « o »). Rejeté : doublon du script qui marche, demande une commande à Max à chaque mise à jour, et l'arrêt des daemons coupe des agents.
  - C. Mise à jour par l'updater d'Electron (release publiée du fork). Rejeté : exige signature, notarisation et un canal de release (coût et maintenance) pour deux utilisateurs.
- **Détection de Node** (dans le script, une seule source pour l'amorçage et la boucle) : `node` du PATH s'il est dans la plage ; sinon, dans l'ordre, `~/.nvm/versions/node/v22*` (le plus haut), `~/.volta/bin`, `fnm` (`~/Library/Application Support/fnm/node-versions/v22*/installation/bin`, `~/.local/share/fnm/...`), `/opt/homebrew/opt/node@22/bin`, `/usr/local/opt/node@22/bin`, `/opt/homebrew/bin`, `/usr/local/bin`. launchd donne un PATH réduit : le script ne s'en remet jamais au PATH hérité. La plage est lue dans `package.json` (`engines.node`) du checkout, pas écrite en dur. Hors plage : sortie 3, une ligne claire dans le journal (« Node >=22.16 <23 requis, trouvé v20.11.0 ; cherché : PATH, nvm, volta, fnm, homebrew »), une notification **une fois par version trouvée** (marqueur dans `~/.local/share/cate-build.node-warned`), aucune construction.
- **Agent launchd**: étiquette neutre `fr.adfinitas.cate-fork-update`. Le plist est **généré** avec `$HOME` (launchd n'expande pas `~`) ; chargé par `launchctl bootstrap gui/$(id -u)`. Un agent existant qui lance déjà `cate-fork-update` sous une autre étiquette (cas de Heifara) est déchargé puis remplacé, sans que le script cite son nom : il cherche dans `~/Library/LaunchAgents/*.plist` la chaîne `cate-fork-update`.
- **Pire cas du script** : une construction de 10 à 20 min (non mesuré) à `Nice 10` pendant que Max travaille ; aucun arrêt de quoi que ce soit. L'installation attend que Cate soit fermé. Ressource : disque du dossier de build (`node_modules` et `release/`), à lire par `df` avant le premier build (le script refuse sous 5 Go libres, valeur à confirmer en L4-03).
- Ne jamais lancer le binaire de Cate pour lire sa version (mémoire du projet) : le script lit le SHA, pas l'app.
- **Statut** : livré par la PR #40 (`scripts/cate-fork-update.sh`, 43 tests dans `scripts/cate-fork-install.test.mjs`). Écarts avec le texte ci-dessus, tous gardés (coupes nettes) : étiquette `com.cate.fork-update` (et non `fr.adfinitas...`) ; pas de `RunAtLoad` (le premier passage de l'agent attend le verrou du build en cours) ; trois essais par commit en échec ; la copie de `~/.local/bin` se rafraîchit depuis le commit suivi après `--self-test` ; un agent existant sous une autre étiquette est **laissé** et signalé, pas remplacé (`cate-fork-install.sh:109-114`) ; `CATE_SELF_UPDATE=0` au paquet (`cate-fork-update.sh:235`).

## R9. Le daemon suit l'app : mise à jour sur différence de build

- **Constat**: après une mise à jour de l'app, le daemon du workspace (processus détaché qui survit à l'app, `docs/architecture.md` « Processes ») continue de servir l'ancien runtime. `createRuntimeUpdates` ne retient un runtime comme candidat que si `compareSemver(runtimeVersion, appVersion) < 0` (`src/client/connections/runtimeUpdate.ts:40-45`). Chaque build du fork porte la même version (`2.1.0-beta.15`) : l'égalité ne déclenche rien. Aujourd'hui : `pkill` à la main.
- **Ce qui existe déjà** : le daemon sait redémarrer sur un autre build de la même version (`docs/architecture.md`, section `runtime.update { version, build }` : « It restarts too when the versions are equal (another build of it) »), refuse `dirty` avec la raison `shared` ou `busy` quand un autre client est connecté ou qu'un travail tourne, et `runUpdate` vérifie déjà après redémarrage que le build est celui de l'app (`runtimeUpdate.ts`, message « still does not run this build »). Le build du runtime arrive dans le handshake (`connection.rpc.remote.build`, lu par `runUpdate`). Le trou est donc seulement la condition de candidature, côté client.
- **Décision**: dans `updateCandidate`, un runtime `connected` de **même version** dont `rpc.remote.build` est défini, différent de `deps.build` (défini lui aussi), est un candidat `update: 'runtime'`, avec exactement le même parcours qu'une version plus ancienne : essai unique par connexion avec `ifIdle` ; refus `shared` : le workspace reste utilisable, rien ne s'affiche ; refus `busy` pour un client seul : la demande de confirmation existante (`required`) montre ce que la mise à jour arrête avant de le faire ; jamais de coupure silencieuse d'un agent. Build absent d'un côté : pas de candidat (impossible de comparer, évite une boucle). Version du runtime **supérieure** : jamais touché, même si le build diffère (« never downgraded »). Le message de la demande doit dire « autre build, même version » quand les versions sont égales (sinon l'écran affiche « 2.1.0-beta.15 → 2.1.0-beta.15 »).
- **Options écartées**:
  - **Un script qui tue les daemons après l'installation de l'app** : rejeté. Il coupe les terminaux et les agents en cours sans les voir (le pire cas de l'ancienne R7), contourne la règle « busy : demander », et ne couvre pas le cas où l'app est mise à jour pendant que le workspace tourne.
  - **Incrémenter la version semver à chaque build du fork** : rejeté. La comparaison avec l'upstream (`compareSemver`, `COMPATIBILITY_VERSION`) et les rebases perdraient leur sens, chaque rebase toucherait `package.json`, et une version du fork supérieure à celle d'upstream changerait la décision « runtime plus récent : jamais rétrogradé ».
  - **Redémarrer le daemon à chaque ouverture de l'app** : rejeté. Coupe les workspaces partagés et les agents en cours ; contraire à « Runtimes never update on their own; a client asks ».
- **Risques** : (1) deux apps de builds différents (fork et upstream) ouvertes sur un même workspace partagé : `shared` empêche la mise à jour, aucune boucle, mais l'une des deux affichera un runtime d'un autre build ; (2) égalité de version sans pouvoir dire qui est le plus récent : un runtime d'un build plus récent que l'app serait ramené au build de l'app (rare : l'app est toujours installée avant le runtime) ; (3) le client mobile partage le même cœur (`src/shells/mobile/core/state.ts` consomme `RuntimeMismatch`) : le champ ajouté est optionnel ; (4) `tried` n'autorise qu'un essai par connexion : si le redémarrage rend le même build, un seul message d'erreur, pas de boucle.
- Taille : 0,75 j (tests Vitest, correctif de 5 lignes, texte de l'écran, PR). Dépendance : aucune. Coût : 0 €.
- **Statut** : livré par la PR #27 (Closes #26). `updateCandidate` (`src/client/connections/runtimeUpdate.ts:38-43`) ; ajout non prévu : `followBuild`, fourni par le shell desktop seulement et coupé sous `CATE_RUNTIME_BUNDLE` ; `tried` effacé seulement par un verdict stable.

## R10. Amorçage en une ligne

- **Besoin** (Heifara, 2026-11-18) : « Éviter les commandes à taper soi-même. Je dois pouvoir passer le projet à quelqu'un et qu'il le lance sans problème. »
- **Décision**: une ligne collée une seule fois dans Terminal : `curl -fsSL https://raw.githubusercontent.com/Heifarabuval/cate/main/scripts/agence-install.sh | sh` (le fork est **public** : `gh api repos/Heifarabuval/cate --jq .private` rend `false`, 2026-11-18). Le script est une fonction `main` appelée à la dernière ligne : un téléchargement tronqué n'exécute rien. Il fait, dans l'ordre : (1) prérequis nommés sans rien déclencher : `xcode-select -p` pour git et python3 (jamais `git --version` ni `python3 --version`, qui ouvrent la boîte « installer les outils »), Node par la détection de R7, `gh` présent puis `gh auth status` ; si `gh` n'est pas connecté et qu'un terminal est là, `gh auth login --web < /dev/tty` ; sinon il nomme le manque et s'arrête ; (2) installe le script de mise à jour et son agent launchd ; (3) clone et construit une première fois, installe l'app dans `/Applications` ; (4) `agence hooks install` (sauvegarde de `settings.json` par la CLI) sauf avec `--sans-gardes`, puis `agence doctor --hors-cate` ; (5) dit en 3 lignes ce qui reste à la main. Idempotent. `scripts/agence-uninstall.sh` défait l'agent, le script et, sur demande, les gardes ; il ne touche ni `/Applications/Cate.app` ni `~/.cate`.
- **Options**:
  - A. **Recommandé** : une ligne `curl | sh`. `curl` est livré avec macOS et ne pose pas la quarantaine de Gatekeeper. 0 €.
  - B. Fichier `.command` à double-clic. Gardé en repli seulement : un fichier reçu par mail ou Slack porte la quarantaine et macOS refuse de l'ouvrir au premier double-clic (clic droit, Ouvrir) : ce serait une manipulation de plus.
  - C. Paquet `.pkg` signé. Rejeté : certificat développeur payant et notarisation pour deux utilisateurs.
- **Ce qui ne peut pas être automatisé** : installer Node 22, `gh` ou les Command Line Tools à la place de Max (un `brew install` suppose Homebrew, et `xcode-select --install` ouvre une fenêtre système). Le script les nomme avec la commande, Max la lance, puis recolle la même ligne. C'est le seul cas de deuxième collage.
- **Gardes chez Heifara** : l'amorçage lancé chez lui installerait `agence hooks` à côté de ses gardes de Skills (deux gardes sur un même outil, risque du plan). Chez lui : `--sans-gardes` jusqu'au lot 5.
- **Réglages CLI** : `cliTerminalInputEnabled` est coupé par défaut et se règle par workspace dans Cate ; aucun script ne peut l'écrire (les réglages du workspace appartiennent au daemon). `doctor` le dit ; reste un clic. Heifara le garde coupé (q307, 2026-11-19).
- **Statut** : livré par la PR #40 sous le nom `scripts/cate-fork-install.sh` (ligne dans `scripts/cate-fork-install.md:10`), avec `scripts/cate-fork-uninstall.sh [--purge]`. Prérequis vérifiés par `cate-fork-update.sh --prereq` (une seule source). Pas encore fait : étapes (4) gardes et `doctor`, `--sans-gardes`, `--gardes` à la désinstallation. Écart gardé : `gh` n'est pas un prérequis de l'amorçage (il ne sert qu'à l'orchestration) ; il passe dans `doctor --prerequis`.

## R11. `agence doctor` existe déjà : où mettre les prérequis

- **Constat**: la spec 001 (PR #58) a livré `agence doctor [--relance]` : « peut-on relancer Cate sans rien perdre ? », code 0 oui, 1 non ; sans option, même résultat (`agence.py:1676`, `:1920-1922`). Le `doctor` des prérequis de ce plan (FR-009) a un autre sens.
- **Options**:
  - A. **Recommandé** : `agence doctor --prerequis [--hors-cate] [--json]`. `doctor` seul et `--relance` restent ceux de la spec 001. 0,5 j, 0 €.
  - B. `doctor` seul = prérequis puis relance ; `--relance` seul garde l'ancien. Change le contrat écrit par la spec 001. +0,25 j.
  - C. Commande séparée `agence prerequis`. Rejeté : deux commandes de diagnostic à retenir.
- **Décision** : A, choisie par Heifara (q305, 2026-11-19).

## R8. Ce qui reste personnel

| Élément | Statut pour l'orchestrateur | Part dans le fork |
|---|---|---|
| CLI `agence`, skill `orchestrateur`, panneau | requis | oui |
| `agence-guard` (pages, `state.json`) | requis | oui, dans `agence hooks` |
| `send-guard` (Slack, Gmail) | requis si Max a ces MCP | oui, sans l'exception du DM de Heifara |
| `gh` connecté, `claude`, python3 | requis | non (prérequis, vérifiés par `doctor`) |
| Connecteurs Slack, Gmail | optionnel (brouillons `slack:`/`mail:`) | non |
| Bus pub/sub (`bus.sh`, `bus.py`) | optionnel : ni `agence.py` ni le skill ne l'appellent (grep) | non |
| Google Tasks (`taches`), Hermes, rules, `CLAUDE.md`, mémoire, `rtk` | sans lien | non |
| Règle « brouillon seulement » du `CLAUDE.md` de Heifara | portée par le skill et le garde | le skill la dit déjà (`SKILL.md:32`) |
