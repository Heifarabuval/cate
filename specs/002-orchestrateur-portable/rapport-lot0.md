# Rapport du lot 0 : sondes de risques (orchestrateur portable)

Historique, rapatrié de Skills (commit `78a8fd3`) le 2026-11-19. Les chemins et numéros de ligne sont ceux de la base du lot 0 ; l'état livré est dans `tasks.md`, partie A.

Date : 2026-11-18. Fork lu : worktree `cate-wt/orch-portable`, branche `feat/orchestrateur-portable-lot0`, base `origin/main` = `88a5c821`. Aucune app Cate lancée, rien écrit dans `~/.claude`, `~/.cate` ni `/Applications`. Les essais tournent dans le scratchpad avec `HOME` redéfini. Aucun commit dans le fork.

## Écarts avec le plan, à connaître avant le lot 1

1. **Le panneau agence n'est pas dans `origin/main`** (`git merge-base --is-ancestor origin/feat/panneau-agence origin/main` : non). `src/runtime/daemon/compose/cliEnv.ts` et le régisseur (`src/panels/agence/parts/runtime/regisseur.ts`) n'existent que sur `origin/feat/panneau-agence` (`a911d9ac`). Sur la base du lot 0, `PANEL_TYPES` n'a pas `agence` (`src/workspace/document/contract/schema.ts:24`). Le lot 1 doit partir d'une base qui contient le panneau, sinon L1-12 et L1-13 n'ont pas de fichier à modifier.
2. **Numéros de ligne** : `installDirFromExecPath` est à `src/runtime/daemon/contract/install.ts:100-104` (le plan dit 82-96, qui est `installLayout`). La lecture du fichier `BUILD` est à `src/runtime/daemon/node/install.ts:74` (le plan dit :50).
3. **Fixtures** : `tasks.md` demande cinq fichiers sous `tools/agence/fixtures/settings/` dont `heifara-neutre.json`. Ce brief les demande sous `specs/002-orchestrateur-portable/fixtures/`, sans rien copier du vrai `settings.json`. `heifara-neutre.json` n'est donc pas produit. Le lot 3 copie le dossier vers le fork.

## Tableau de synthèse (L0-05)

| Risque | Constat | Décision pour le lot concerné | Tâche réglée |
|---|---|---|---|
| python3 sur Mac sans CLT | `/usr/bin/python3` est un binaire Mach-O (shim `xcode-select`), pas un script. Cas sans CLT : non observable ici. Le lanceur du contrat teste `xcrun --find python3` : son innocuité (pas de dialogue) n'est pas démontrée. Deuxième défaut trouvé : le lanceur teste un binaire (`/usr/local/bin/python3`) puis exécute un autre (`python3` résolu par le PATH). | Lot 1 : tester `xcode-select -p` puis le binaire `$(xcode-select -p)/usr/bin/python3`, et exécuter exactement le chemin testé. À confirmer par Heifara ou Max sur un compte sans CLT (`[H]`). | L0-01 : verdict **non démontré** (voir section) |
| PATH d'un terminal restauré | Le dossier de lanceurs est stable par panneau et réécrit à chaque spawn, restauration comprise. Un second lanceur déposé dans ce dossier est présent, 0700, absolu après deux spawns (sonde Vitest). Sans réécriture au spawn, il pointerait vers une install supprimée. | Lot 1 : `cateCli.ts` et `cliEnv.ts` réécrivent `agence` à chaque appel, comme `cate`. L1-10 couvre le cas « install remplacée ». | L0-02 : réglé par lecture et sonde ; **vrai terminal restauré non vérifié** |
| Fusion de `settings.json` | `json` stdlib relit et réécrit sans perte de données (clés, ordre, grands entiers, Unicode). Trois pièges : octets non identiques (mise en forme), mode 0444 écrasé en 0600 par `os.replace`, clé dupliquée perdue en silence. JSON invalide et commentaires : refusés, fichier intact. | Lot 3 : refuser si le fichier n'est pas inscriptible, conserver le mode, résoudre le lien avant d'écrire, et ne pas promettre l'octet près pour `uninstall` sans restaurer la sauvegarde. | L0-03 : réglé |
| Hypothèses de lecture (a, b, c) | (a) vrai. (b) faux en mode `CATE_RUNTIME_BUNDLE` : le chemin calculé est faux. (c) le fichier s'appelle `BUILD`. | (a) `doctor` garde son test sur l'aide, sans plan B. (b) Lot 1 : ne pas supporter `agence` en mode bundle, ou copier `agence/` à côté du bundle (choix à faire). (c) `agence --version` lit `<install>/BUILD`. | L0-04 : réglé |

## L0-01. python3 sur un Mac sans Command Line Tools

Sorties relevées sur cette machine (CLT présentes, macOS 26.1, 2026-11-18) :

| Commande | Sortie | Code |
|---|---|---|
| `xcode-select -p` | `/Library/Developer/CommandLineTools` | 0 |
| `/usr/bin/python3 --version` | `Python 3.9.6` | 0 |
| `xcrun --find python3` | `/Library/Developer/CommandLineTools/usr/bin/python3` | 0 |
| `file /usr/bin/python3` | Mach-O universal binary (x86_64, arm64e) | |
| `command -v python3` (PATH de cette session) | `/usr/local/bin/python3` (cadre Python 3.14) | |

Lanceur du contrat (`contracts/cli-agence.md`), copié dans le scratchpad, seuls les deux chemins Homebrew redirigés vers un dossier jetable, `HOME` jetable, `xcrun` factice qui journalise ses arguments puis sort en 1 :

| Cas | Sortie | Code |
|---|---|---|
| A. vrai `xcrun`, CLT présentes | `agence.py ok (3, 9) ['a', 'b']` | 0 |
| B. `xcrun` factice (exit 1), pas de python3 Homebrew | `agence : python3 requis (xcode-select --install)` sur stderr ; journal du faux `xcrun` : `--find python3` (un seul appel, avec `--find`) | 2 |
| C. `xcrun` factice + python3 Homebrew présent | le lanceur passe le test puis exécute `python3` du PATH | 0 |

Constats :

- Le texte du lanceur et le code 2 sont conformes au contrat (cas B). Le faux `xcrun` n'est appelé qu'avec `--find`.
- **Défaut du contrat (cas C)** : le test accepte un python3 Homebrew mais l'exécution écrit `exec python3`, résolu par le PATH. Sur un Mac sans CLT, avec Homebrew installé et un PATH minimal (le régisseur du daemon), `python3` peut résoudre vers le shim `/usr/bin/python3`. C'est précisément le dialogue qu'on veut éviter. Le lanceur doit exécuter le chemin qu'il a testé.
- Sur cette machine, `/opt/homebrew/bin/python3` n'existe pas et `/usr/local/bin/python3` existe : le test Homebrew du contrat passerait même sans CLT.
- Branche hors macOS : `command -v python3` rend un chemin ici. Rien à fixer au-delà du test existant.

Comportement attendu sans CLT, **non vérifié ici** (CLT installées, ne pas déclencher l'installation) :

- `/usr/bin/python3` et `/usr/bin/xcrun` sont des shims `xcode-select`. Sans dossier développeur actif, le shim python3 affiche une note du type « No developer tools were found, requesting install » et ouvre la boîte d'installation de macOS.
- `xcode-select -p` sans CLT : message d'erreur « unable to get active developer directory » et code non nul, sans dialogue d'après sa page de manuel. À confirmer sur un compte réel.
- `xcrun --find python3` sans CLT : peut lui aussi demander l'installation, d'après les retours d'usage de `xcrun`. Non vérifié.

**Comment `agence doctor` détecte l'absence sans lancer python3** : `doctor` est écrit en Python, il ne peut pas tourner sans python3. La détection appartient au lanceur shell : `xcode-select -p >/dev/null 2>&1 && [ -x "$(xcode-select -p)/usr/bin/python3" ]`, qui ne lance jamais le shim. Le lanceur imprime alors la ligne `manque : python3 (xcode-select --install)` avec le code 2. Une fois python3 là, `doctor` garde son contrôle de version (`sys.version_info >= (3, 9)`).

**Verdict : « le lanceur peut tester `xcrun` sans ouvrir de dialogue » : non démontré.** Je ne le tiens pas pour acquis. Le lot 1 n'est pas bloqué : L1-01 et L1-02 passent à `xcode-select -p` (lecture seule, documenté sans dialogue) et à l'exécution du chemin testé. Une vérification réelle reste à faire par Heifara ou Max (`[H]`) sur un compte macOS sans CLT : `xcode-select -p; echo $?`, puis `agence --help` avec le lanceur du lot 1, en notant si une fenêtre s'ouvre.

## L0-02. PATH d'un terminal restauré

Par lecture (fork `88a5c821`) :

- `spawnWithEnv` appelle chaque contributeur d'environnement à chaque spawn (`src/services/terminal/runtime/terminalService.ts:549-569`). Une restauration passe par le même chemin : `launch.kind === TERMINAL_RESTORE_LAUNCH.kind` (`:544`), écran relu avec `params.restore` (`:634-649`). Rien ne distingue un terminal restauré d'un terminal neuf pour le contributeur.
- `envForTerminal` calcule `binDir = <launcherDir>/panels/<panelId>` (`src/services/terminal/runtime/cateCli.ts:70`), écrit `cate` en 0700 (`:73`) et met `binDir` en tête du PATH (`:83`). `binDir` ne contient ni terminalId ni build : stable par panneau.
- Le test existant `cateCli.test.ts:57-81` prouve déjà, pour `cate`, qu'un PATH sauvegardé avant une mise à jour trouve le nouveau lanceur après le spawn du nouveau runtime.
- Une install est gardée tant qu'un daemon vivant la lance (`markRuntimeInUse`, `pruneRuntimeInstalls`, `src/runtime/daemon/node/install.ts:211-273`).

Sonde Vitest jetable `src/services/terminal/runtime/agence.probe.test.ts` (second lanceur `agence` écrit comme le fera L1-11, puis `envForTerminal` rappelé avec le même `panelId` et un autre `terminalId`), lancée avec un faux HOME :

```
PROBE binDir = <tmp>/ws/terminal-cli/panels/panel-1
PROBE mode agence = 700 cate = 700
PROBE contenu agence = #!/bin/sh | exec '<tmp>/install/build-1/agence/agence' "$@"
PROBE sans réécriture, cible existe = false
PROBE après réécriture = exec '<tmp>/install/build-new/agence/agence' "$@"
PROBE après dispose, dossier existe = false
PROBE agence après exit de l'ancien PTY = true
PROBE agence après exit du dernier PTY = false
Test Files 1 passed (1) / Tests 4 passed (4)
```

Réponse à « un terminal ouvert par l'ancien runtime garde l'ancien lanceur jusqu'à l'arrêt du daemon » (research R1, risque 2) : **oui, et c'est sans danger.**

- Le terminal vit dans le daemon de l'ancien build. Son PATH désigne un `agence` qui pointe vers l'install de cet ancien build, que le nettoyage garde tant que le daemon tourne.
- À l'arrêt propre du daemon, `dispose()` supprime le dossier (`cateCli.ts:86-88`, `compose/workspace.ts:408` et `:446`) : `agence` est absent jusqu'au prochain spawn du panneau, puis réécrit au même chemin vers la nouvelle install.
- Arrêt dur (kill) : le dossier reste avec un `agence` périmé qui vise une install possiblement supprimée (sonde : « cible existe = false »). Cela ne tient que jusqu'au spawn suivant, mais impose que L1-11 **réécrive `agence` à chaque appel**, pas seulement quand il manque.
- Le lanceur du régisseur (`cliEnv.ts` de la branche panneau) écrit `cate` une seule fois par daemon (`written ??=`) : sans danger, le daemon est lié à son build. L1-13 doit suivre la même règle.

À vérifier en vrai au lot 1 (la lecture ne le prouve pas) :

- Un shell de connexion qui remet un autre dossier avant `binDir` (`path_helper`, `.zprofile`) : cas de l'ancien `~/.claude/bin/agence` de Heifara (spec, scénario US3-3).
- Un terminal réellement restauré après relance de l'app, avec `agence --help` tapé dedans.
- Un snapshot de shell d'agent (Claude Code) pris avant la mise à jour : chemin stable, donc attendu bon, jamais lancé.

Nettoyage : la sonde est restée dans le fork (voir « Fichiers à supprimer » en fin de rapport).

## L0-03. Fusion de `settings.json` avec une config hostile

Fixtures écrites sous `specs/002-orchestrateur-portable/fixtures/` (neutres : chemins `/opt/outils/...`, aucun nom, aucun identifiant). Forme des hooks observée en lecture seule sur le vrai `~/.claude/settings.json` : `hooks.PreToolUse` et `PostToolUse` sont des tableaux d'objets `{matcher, hooks: [{type: "command", command}]}` ; un même matcher peut porter plusieurs commandes ; `matcher` peut être absent. Rien n'a été recopié.

| Fixture | Contenu |
|---|---|
| `invalide.json` | accolades et crochet non fermés |
| `hooks-existants.json` | hooks d'utilisateur dont deux matchers voisins de ceux d'agence (`slack_send_message_draft`, `Bash\|WebFetch`), un matcher identique, `permissions`, `Stop` |
| `absent.txt` | décrit le cas sans fichier (le test crée un HOME vide) |
| `lecture-seule.json` + `lecture-seule.txt` | JSON valide ; le test pose 0444 sur le fichier ou 0555 sur le dossier, et crée le cas du lien symbolique |
| `commentaires.json` | commentaires `//` et `/* */`, virgules finales |
| `cles-inconnues.json` | clés futures, grand entier, décimal, Unicode, ordre de tableaux, événement de hook inconnu |

Essai dans un faux HOME avec un script Python jetable (`/usr/bin/python3 -I`, 3.9.6), lecture par `json.load`, écriture atomique `tempfile` + `os.replace` + `json.dump(indent=2, ensure_ascii=False)` :

| Cas | Comportement de json | Risque |
|---|---|---|
| `hooks-existants.json` | relu == écrit ; ordre des clés et des tableaux conservé | Aucun sur les données. Octets non identiques (mise en forme recompactée) |
| `cles-inconnues.json` | idem ; `12345678901234567890` reste un `int` ; `1.0` reste `1.0` ; Unicode intact | Aucun sur les données |
| `invalide.json` | `json.load` refuse (`Expecting ',' delimiter`, ligne 5) ; fichier intact | Aucun si l'installeur refuse sans écrire (FR-007) |
| `commentaires.json` | `json.load` refuse (`Expecting property name enclosed in double quotes`, ligne 2) ; fichier intact | Un fichier annoté à la main sera refusé : le message doit le dire |
| absent | `FileNotFoundError` sans dossier `.claude` ; écriture OK après `makedirs` | L'installeur doit créer le dossier |
| fichier 0444, dossier ouvert | `open('w')` : `PermissionError` ; **`os.replace` réussit** et le mode devient 0600 | Le contrat de refus « lecture seule » ne tient pas tout seul : il faut `os.access(W_OK)` et conserver le mode |
| dossier 0555 | `PermissionError`, fichier intact | Refus propre, à tester |
| lien symbolique, écriture via `realpath` | lien conservé, cible modifiée | OK (règle du contrat) |
| lien, `os.replace` sans `realpath` | le lien est remplacé par un fichier ordinaire, la cible d'origine reste orpheline | Casse `skills.sh` de Heifara si l'on oublie `realpath` |
| clé dupliquée (chaîne en ligne) | `json.loads` garde la dernière, perd la première sans erreur | Perte silencieuse : détecter avec `object_pairs_hook` et refuser |
| BOM UTF-8 | `utf-8` refuse ; `utf-8-sig` accepte | Lire en `utf-8-sig` |

Preuves :

- `settings.json` réel : `shasum -a 256` avant et après identiques (`6b4dce6eccb7bb78...`). Il n'a pas bougé.
- Aucune donnée personnelle dans les fixtures. Le `grep -c -i -E "slack|U0[0-9A-Z]{8}|/Users/"` donne 0 sur `invalide`, `commentaires`, `cles-inconnues`, `lecture-seule`, et 2 sur `hooks-existants` : ces deux occurrences sont le mot `slack` dans deux matchers voisins voulus, aucun identifiant ni chemin personnel.
- Le faux HOME est supprimé en fin de script (« faux HOME supprimé: True »).

Décisions pour le lot 3 :

1. `uninstall` ne peut pas promettre « l'octet près » (SC-003) avec `json.dump`, car la mise en forme change dès la première écriture. Soit restaurer la sauvegarde si aucune autre modification n'a eu lieu depuis, soit reformuler SC-003 en « même contenu JSON, hors mise en forme ». À trancher par Heifara.
2. Avant d'écrire : refuser (code 2, rien écrit) si le fichier ou son dossier n'est pas inscriptible ; copier le mode d'origine sur le fichier temporaire.
3. Lire avec `utf-8-sig` et un `object_pairs_hook` qui refuse les clés dupliquées.
4. Résoudre le lien avec `os.path.realpath` avant `mkstemp` et `os.replace`.
5. Le test `test_hooks.py` reprend ces fixtures et échoue s'il voit le vrai HOME.

## L0-04. Trois hypothèses lisibles dans le code

| | Constat | Source |
|---|---|---|
| (a) `cate panel create --help` liste les types ? | **Vrai.** L'argument `type` a pour aide `The panel type: ${PANEL_TYPES.join(', ')}` et `argHelp` l'imprime. Le test de `doctor` sur le mot `agence` est donc valable, une fois `agence` dans `PANEL_TYPES` (c'est le cas sur la branche panneau, pas sur `origin/main`). Contrôle sur l'app installée de Heifara, commande d'aide seule : la ligne `<type>  The panel type: terminal, editor, browser, review, canvas, surface, agence` est rendue. | `src/workspace/document/contract/api.ts:104` ; `src/cli/engine.ts:463-468` ; `schema.ts:24` (base) et `:23` (branche panneau, après ajout de `agence`) |
| (b) `CATE_RUNTIME_BUNDLE` : que rend `installDirFromExecPath`, où chercher `agence/` ? | Avec la variable, l'app lance `node <bundle>` (`node` pris dans le PATH, ou `CATE_RUNTIME_NODE`) et ne passe pas d'`installDir`. Le daemon calcule alors `installDirFromExecPath(process.execPath)`, qui retire trois segments : pour `<nvm>/versions/node/v24.21.0/bin/node` il rend `<nvm>/versions/node`. `layout.agence` donnerait `<nvm>/versions/node/agence`, qui n'existe pas. Le même défaut touche déjà `layout.cateCli` en mode bundle. Chemin attendu en dev : `<checkout>/tools/agence/agence`. Hypothèse du plan (R1, « Dev ») **confirmée**. | `src/shells/desktop/main/index.ts:356-360` ; `src/runtime/daemon/entry.ts:134` ; `src/runtime/daemon/contract/install.ts:100-104` ; `startLocal.ts:36-39` |
| (c) Un fichier `BUILD` dans l'install pour `agence --version` ? | **Oui, nommé `BUILD`** (contenu : l'identifiant du build, une ligne). Le tarball l'écrit, l'installeur le lit et le valide, `installLayout().build` le désigne. `agence --version` lit `<dossier de agence/>/../BUILD` ; hors install (checkout : `tools/agence/`, pas de `BUILD` dans `tools/`), il rend `dev`. | `scripts/build-runtime-tarball.mjs:141` ; `src/runtime/daemon/contract/install.ts:57` et `:95` ; `src/runtime/daemon/node/install.ts:74` |

Décision pour le lot 1 sur (b) : le mode `CATE_RUNTIME_BUNDLE` n'est pas le chemin normal (`npm run dev` installe via `runtime:dev`, `CLAUDE.md` du fork). Recommandé : ne pas le supporter pour `agence` et le dire dans `agence doctor` (« version Cate » : `agence/` absent de l'install). Alternative plus chère : faire copier `agence/` à côté du bundle par `build:runtime`.

## Non vérifié

| Point | Pourquoi | Qui, quand |
|---|---|---|
| Comportement de `/usr/bin/python3`, `xcode-select -p` et `xcrun --find` sans CLT, ouverture ou non d'un dialogue | CLT installées ici, installation non déclenchée par consigne | `[H]` sur un compte macOS sans CLT, avant la fusion du lot 1 |
| `agence` sur le PATH d'un terminal réellement restauré après relance de l'app, y compris derrière `path_helper` ou `.zprofile` | l'app n'est pas lancée par consigne ; la sonde Vitest ne couvre que le code du service | Lot 1, essai réel |
| Ordre de priorité entre l'ancien `~/.claude/bin/agence` de Heifara et le lanceur du terminal | dépend du shell de connexion | Lot 1, essai réel chez Heifara |
| Mise en forme de `settings.json` à la réécriture (SC-003) | décision de produit | Heifara, avant le lot 3 |
| Comportement de Claude Code quand deux hooks `PreToolUse` donnent `allow` et `ask` sur le même outil | non sondé dans ce lot (`hooks.md`, section « Chez Heifara ») | Lot 5, essai réel |
| Fonctionnement d'`agence.py` sous Python 3.14 (cadre `/usr/local/bin/python3` de cette machine) | hors périmètre ; les 241 tests sont cités sous 3.9.6 par `research.md` | Lot 1, CI |

## Fichiers à supprimer ou à traiter

- Fork : `src/services/terminal/runtime/agence.probe.test.ts` (sonde jetable) et `.vitest/` (généré par Vitest, non suivi). Un `rm` a été retenu par un garde et annulé faute de réponse : à supprimer par l'orchestrateur ou par Heifara. Vérification attendue : `git status --short` du worktree ne montre que `node_modules`.
- Scratchpad : `l001/` (lanceur, faux `xcrun`), `l003/roundtrip.py`. Hors dépôt, sans suite.
