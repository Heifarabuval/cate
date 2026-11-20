# Rapport du lot 0 : sondes de l'apprentissage par observation

**Issue** : Heifarabuval/cate#76. **Spec** : [spec.md](spec.md), [plan.md](plan.md), [tasks.md](tasks.md).

**Besoin** : #n448. **Branche** : `feat/observation-journal`, base `origin/main` au 2026-11-20.

**Périmètre** : lecture seule du code, deux expériences jetables hors dépôt (jsdom, zsh et bash sur un dossier temporaire). Aucune fenêtre, aucun Electron, aucun Playwright, aucun réseau, aucune écriture dans `~/.cate` ni `~/.claude`.

**Décisions de Heifara déjà prises** (relayées par l'orchestrateur) : Q1, la ligne de commande d'un terminal est hors du premier lot. Q2, seuil de 3 fois en 14 jours. Q3, détecteur déterministe sans modèle de langage.

## T002 : sonde terminal

**Question** : un hook de shell peut-il rapporter la ligne soumise, sans lire d'entrée clavier ?

### Ce que le code fait aujourd'hui

- Le shell se lance **sans argument** : `defaultResolveShell` rend `args: []` (`src/services/terminal/runtime/terminalService.ts:223-226`). Il charge donc les fichiers de configuration de la personne.
- Les shells admis sont `bash`, `zsh`, `sh`, `fish`, `dash`, `ksh` (`shellResolver.ts:6`).
- L'environnement du PTY se construit à `spawnWithEnv` (`terminalService.ts:555-579`). Chaque contributeur enregistré par `registerEnvContributor` (`terminalService.ts:802-805`) ajoute des variables.
- Le contributeur de la CLI écrit déjà des fichiers privés par panneau, en `0700`, dans `terminal-cli/panels/<panelId>/` (`cateCli.ts:69-90`), et pose `PATH`, `CATE_SOCKET`, `CATE_TOKEN`. Un fichier de hook se génère au même endroit : jamais un fichier global.
- Deux observateurs existent et sont **interdits** pour le journal :
  - `onInput` (`terminalService.ts:662-670`, `721-729`, `818-821`) reçoit les octets tapés, donc des frappes ;
  - `onOutput` (`terminalService.ts:653`, `813-816`) reçoit la sortie du PTY.
- `onActivity` (`terminalService.ts:424-434`, `828-830`) donne `{type: 'running', processName}`. Le nom vient de `ps -axo pid=,ppid=,comm=` (`procScan.ts:15`) : le nom du programme, jamais ses arguments.

### Expériences jetables (dossier temporaire, aucun fichier de la personne)

| Shell | Mécanisme | Résultat lu |
|---|---|---|
| zsh | `.zshrc` dans un `ZDOTDIR` temporaire avec `preexec()` | `HOOK1=[echo bonjour]` puis `HOOK1=[ls /nonexistent-dir 2>/dev/null; true]` : la ligne soumise arrive, avant l'exécution, sans lire de touche |
| bash 3.2 (celui de macOS) | variable d'environnement `PROMPT_COMMAND="history 1 >> fichier"` | `1  echo bonjour`, `2  true` : la ligne arrive au prompt suivant, sans fichier de configuration |

### Ce que le hook demanderait

1. **zsh** : un `ZDOTDIR` généré qui source le `.zshrc` de la personne puis installe `preexec`. Cela déplace `ZDOTDIR` pour le shell et tous ses sous-shells. Une personne qui l'a déjà réglé doit voir sa valeur conservée.
2. **bash** : `PROMPT_COMMAND` en variable d'environnement. Un `.bashrc` qui écrase la variable au lieu de l'allonger coupe le hook. La ligne n'arrive qu'au retour du prompt : un programme long n'apparaît pas avant sa fin.
3. **fish, sh, dash, ksh** : non étudiés par une expérience. fish demande un fichier de configuration ou un argument de ligne de commande (le shell se lance sans argument). dash et sh n'ont pas de hook avant exécution. Hors de portée de cette sonde.
4. **Un canal du hook vers le runtime**. Le seul canal existant est la CLI `cate` sur la socket locale, authentifiée par `CATE_TOKEN` (architecture, section 14). Tout processus du terminal le tient, un agent compris. Le runtime ne distingue pas le hook d'un agent. Une méthode d'écriture permettrait de **fabriquer** des observations (menace M2) et contredit FR-016 (« aucune commande n'écrit une observation à la place de l'utilisateur »).
5. **Les secrets** (menace M5). `$1` contient la ligne telle que tapée : `curl -H "Authorization: Bearer ..."`, `export TOKEN=...`, mot de passe en argument. Le masquage de FR-008 reste un motif : il ne peut pas être exhaustif.
6. **Les commandes des agents** ne passent pas par le shell interactif (leurs outils lancent des shells non interactifs) : le hook ne les voit pas.

### Verdict T002

**Possible, mais pas propre.** Le hook rapporte bien la ligne soumise sans lire de touche. Il coûte un `ZDOTDIR` généré, ne couvre que zsh et bash, exige un canal que n'importe quel processus du terminal peut forger, et laisse passer des secrets hors motifs.

**Option B, non demandée par la spec** (à valider avant tout code) : un événement `terminal.process` portant seulement `processName`, lu par `onActivity`. Aucune frappe, aucun argument, donc aucun secret, aucun hook, aucun canal forgeable. Défauts : la mesure est un échantillon (le scan tourne à intervalle, les commandes courtes et les commandes internes du shell comme `cd` n'apparaissent pas) et la précision est faible (« git », pas « git push »).

## T003 : décision sur `terminal.command`

- Q1 est tranchée par Heifara : **hors du premier lot**. T001 est donc fermé.
- Le verdict de T002 n'est pas « propre ». Conséquence pour le lot 1 :
  - **aucun événement `terminal.command`**, aucun hook, aucune méthode d'écriture ;
  - **T011 n'est pas écrit** (sa condition, « seulement si T003 valide l'événement », n'est pas remplie) ;
  - `redactCommand` et FR-008 ne sont pas implémentés dans le lot 1. Ils n'ont aucune entrée tant que l'événement n'existe pas.
- Reste à faire par une PR de spec, hors de ce lot : retirer `terminal.command` de FR-002 et de la liste de la spec, ou le planifier en lot 1b avec l'option B. Choix de Heifara.

## T004 : sonde page

**Questions** : comment injecter un script, tourne-t-il dans un monde isolé, comment un événement revient-il au client ?

### Ce que le code fait aujourd'hui

- Le page driver attache le débogueur d'Electron au guest (`pageDriver.ts:219-245`, CDP 1.3, `Target.setAutoAttach`, `Runtime.enable`).
- Il injecte déjà du code dans un **monde isolé** : `Page.createIsolatedWorld({frameId, worldName: 'cate-browser-input'})` puis `Runtime.evaluate({contextId, ...})` (`pageDriver.ts:652-672`, `727-729`, `1375-1377`). Les écouteurs posés ainsi (`wheel`, `{capture: true, passive: true}`) voient le DOM, pas les variables de la page.
- **Le retour est une promesse attendue par le driver** (`Runtime.callFunctionOn` avec `awaitPromise`, `pageDriver.ts:678-683`). Le code n'emploie aucun canal en poussée du type `Runtime.addBinding` : une recherche de `addBinding` et `bindingCalled` dans `src/services/browser` ne donne rien.
- Le **script de précharge du guest** (`src/services/browser/desktop/preload/guest.ts`) est un meilleur support pour un enregistrement :
  - il tourne dans le monde de préchargement d'Electron, isolé de la page : `webSecurity.ts:172-177` pose `contextIsolation = true`, `sandbox = true`, `nodeIntegration = false`, et `guest.ts:11,15,23` emploie `contextBridge` ;
  - il pose déjà des écouteurs en capture sur `document` et parle à l'hôte : `ipcRenderer.send` (`guest.ts:82`, `96`) et `ipcRenderer.sendToHost` (`guest.ts:88`, pont des mots de passe) ;
  - il reçoit des ordres du processus principal (`ipcRenderer.on(AUTOMATION_INPUT_CHANNEL, ...)`, `guest.ts:72`) : un ordre « démarrer » et un ordre « arrêter » s'y branchent de la même façon.
- Les opérations de page entre le runtime et le client sont déclarées dans `src/services/browser/contract/surface.ts` (`page.ready`, `page.history`, `page.execute`, `page.download`, toutes `pageDriver`). Un enregistrement ajoute une opération de ce type, réservée aux clients qui déclarent `pageDriver`.

### Test jetable jsdom (`autocomplete` et `type` lus sur l'élément réel)

Script hors dépôt, jsdom du dépôt, aucune fenêtre. Résultats lus :

| Élément | `el.type` | `el.autocomplete` |
|---|---|---|
| `autocomplete="cc-number"` | `text` | `cc-number` |
| `autocomplete="section-pay billing cc-csc"` | `text` | `section-pay billing cc-csc` (chaîne entière, non découpée) |
| `autocomplete="one-time-code"` | `text` | `one-time-code` |
| `type="PassWord"` | `password` (normalisé en minuscules) | `` (vide) |
| `autocomplete="Current-Password"` | `text` | `Current-Password` (**casse conservée**) |
| `autocomplete="new-password"` | `text` | `new-password` |
| champ `off`, puis `setAttribute('autocomplete', 'cc-exp')` | `text` | `cc-exp` (la lecture suit l'élément réel) |
| champ créé après coup, `autocomplete = 'one-time-code'` | `text` | `one-time-code` |

**Conséquence pour `isSensitiveField` (T010)** : lire `type` (déjà normalisé) et `autocomplete` **brut**, le passer en minuscules, le découper en mots, puis tester chaque mot (`cc-*`, `one-time-code`, `current-password`, `new-password`). Une comparaison de la chaîne entière rate `section-pay billing cc-csc` et `Current-Password`. La règle s'évalue au moment du geste, sur l'élément réel.

### Verdict T004

**Possible, avec un point de vigilance (ci-dessous).** Le support recommandé est le script de précharge du guest : monde isolé, écouteurs passifs en capture, retour par `sendToHost` vers le client, jamais vers le runtime directement (menace M2 : la page ne parle pas au runtime).

### Point de vigilance pour le lot 3 : `passwordBridge.ts` envoie déjà un mot de passe par `sendToHost`

Le canal que l'enregistrement emprunterait porte **déjà des identifiants** :

- `guest.ts:87-90` installe `installPasswordBridge` dans le cadre principal, avec `ipcRenderer.sendToHost` comme `send`.
- `passwordBridge.ts:43-48` envoie `cate-browser-password-submit` avec `username`, **`password`** (la valeur du champ), `origin` et les noms des champs. Il part sur un `submit` (`:49-51`), sur un clic d'un bouton de connexion (`:53-62`) et sur `Enter` dans un champ (`:63-66`).
- `passwordBridge.ts:18-30` pose sur le champ focalisé un attribut `data-cate-autofill-target` (une page peut le lire) et envoie son rectangle (`cate-browser-password-focus`).
- Le même fichier écoute déjà `click`, `submit`, `focusin`, `scroll` et `keydown` (`event.key`, jamais envoyé).

Conséquences pour le lot 3, à écrire dans les tests avant le code :

1. L'enregistrement a **son propre canal** (un nom à lui) et une charge stricte (type, libellé ou nom de champ, rien d'autre). Il n'appelle jamais le `send` du pont et n'importe pas `passwordBridge.ts`.
2. Le gestionnaire côté hôte de l'enregistrement n'écoute jamais les canaux `cate-browser-password-*`, et celui des mots de passe n'écoute pas le canal de l'enregistrement.
3. Test jsdom (T060, T064) : sur une page avec un champ mot de passe rempli puis envoyé, le pont émet et **rien** n'arrive sur le canal de l'enregistrement. Un champ nommé `username` ou `email` (que le pont lit par `isUsername`) ne donne à l'enregistrement que son nom, jamais `value`.
4. L'enregistrement n'ajoute ni écouteur `key*` ni attribut sur la page. Le guest en pose déjà (`webFrame.insertCSS` pour les barres de défilement, `guest.ts:46`, et `data-cate-autofill-target`) : la page peut déjà y voir Cate, l'enregistrement ne l'aggrave pas.

### Écart avec tasks.md, à corriger avant le lot 3

- T070 demande un `grep` « aucun écouteur `key*` dans `src/services/browser/desktop/` ». Il échouerait **aujourd'hui** : `guest.ts:80` écoute `keydown` (avec `pointerdown`) et `guest.ts:94` écoute `input` et `change`. Ces écouteurs n'envoient **aucune** touche ni valeur : `guest.ts:76-79` précise que `USER_INPUT_CHANNEL` est un signal d'annulation, et `guest.ts:96` envoie `cate-browser-dirty` sans contenu. Le grep doit viser `recorder.ts` seul. Le test T060 aussi : il compte les écouteurs que **l'enregistreur** ajoute, pas ceux du fichier voisin.
- Les écouteurs `keydown`, `input` et `change` du guest existent hors de l'enregistrement et ne capturent rien. Le lot 3 ne doit ni les lire ni s'y brancher.

## T005 : relecture des risques

| Risque du plan | Levé par les sondes ? | Motif |
|---|---|---|
| Commande de terminal : aucune lecture propre sans frappes | **Non levé**, contourné | Un hook existe (zsh, bash) mais n'est pas propre (canal forgeable, secrets, couverture). L'événement reste hors du premier lot, comme Q1 le décide. |
| Le script de page change le comportement du site ou se voit | **Levé pour le support** | Monde isolé de préchargement, écouteurs passifs. L'enregistrement n'ajoute ni style ni attribut (le guest en pose déjà, voir `passwordBridge.ts` ci-dessus). À confirmer au vrai poste (X001) : aucune fenêtre n'a été ouverte. |
| Un canal du guest transporte déjà un mot de passe (`sendToHost`) | **Non levé**, à traiter au lot 3 | `passwordBridge.ts:43-48`. Canal distinct, charge stricte, tests croisés : voir le point de vigilance. |
| `autocomplete` et `type` illisibles sur l'élément réel | **Levé** | jsdom les lit, y compris après changement et sur un champ ajouté. Casse et valeurs composées à gérer. |
| La pastille ment (script resté actif) | **Levé sur le principe** | Le guest reçoit des ordres du processus principal (`guest.ts:72`) : un ordre d'arrêt retire les écouteurs. Le test d'arrêt (T064) reste obligatoire. |

**Validation** : la relecture avec Heifara que T005 demande **n'a pas eu lieu** (T005 est décoché dans `tasks.md`). Ce rapport est son entrée. Le lot 1 a été lancé par l'orchestrateur sur les décisions Q1, Q2 et Q3, que la spec porte déjà.

## Non vérifié

- Le comportement réel dans Electron (monde de préchargement, `sendToHost` depuis un `recorder.ts`) : aucune fenêtre n'a été ouverte. À vérifier par Heifara au lot 3 (X001).
- Le hook sur un vrai terminal Cate : les expériences zsh et bash tournent hors de Cate, sur un dossier temporaire.
- Les versions de zsh et de bash d'autres machines : bash 3.2.57 de macOS seulement.
