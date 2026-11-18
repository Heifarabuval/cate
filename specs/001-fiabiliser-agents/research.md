# Recherche : fiabiliser l'orchestration d'agents

Chaque décision cite sa preuve. Source des chiffres : rapports de vérification A, B, C du 2026-11-18 et lectures du code de ce dépôt (`527049d6`).

## R1. Compter le plafond

- **Décision** : le plafond compare `running + waitingForInput` (hors orchestrateur et régisseur) à `maxAgents`, `MAX_AGENTS = 4`. Le message « place libre » part quand le total du tour précédent atteignait le plafond et que le total courant est dessous.
- **Preuve** : `tools/agence/agence.py:1396-1401` ne compte que `running` ; `agentsWaiting` est déjà stocké au même endroit. Le total précédent se lit donc dans l'état existant (`agentsActive + agentsWaiting`) : aucune clé nouvelle, un état ancien sans `agentsWaiting` retombe sur 0 (`empty()` et `load()`).
- **Alternatives** : (a) garde mémoire (`memory_pressure`) : rejetée, 13 agents à 400 Mo expliquent l'incident et un seuil est bruité (rapport B, P4). (b) plafond dur par hook sur `cate agent start` : hors périmètre, demandé en consultatif par l'issue.
- **Textes à aligner** : docstring du module (ligne 8), aide `--max-agents` (ligne 1686), page de suivi (ligne 1054, déjà « en cours, en attente »).

## R2. `agence doctor --relance`

- **Décision** : une sous-commande `doctor` avec une option `--relance`, et une fonction pure `verdict_relance(faits)` qui prend des faits déjà lus (agents, worktrees, PR, builds, sources en échec) et rend `(oui, [raisons])`. Les lectures passent par `RUN` (déjà simulé dans `test_agence.py`).
- **Sources** :
  - agents : `cate agent list --json` ; `running` bloque, `waitingForInput` informe. On retire l'orchestrateur et le régisseur (état de l'agence) et le panneau qui appelle (`caller` dans `cate panel list --json`, vérifié le 2026-11-18).
  - worktrees : `git worktree list --porcelain` depuis la racine (déjà utilisé par `worktree_offers`), puis `git -C <chemin> status --porcelain` et le nombre de commits hors de l'upstream ; sans upstream, les commits absents de toute branche distante.
  - PR : `gh pr list -R <owner/repo> --state open --json number,title,headRefName` (`gh_repo(st)` existe).
  - daemon : `<CATE_HOME>/workspaces/<runtimeId>/runtime.json` dont `root` égale la racine du projet, champ `build` (lu le 2026-11-18 : `"build": "2.1.0-beta.15+337c78bd35a7"`) ; build de l'app : contenu du fichier texte `<CATE_HOME>/runtime/current` (27 octets, lu le 2026-11-18 : `2.1.0-beta.15+337c78bd35a7` ; `docs/architecture.md`, section Install : « names the last install made or updated to »). `CATE_HOME` vaut `~/.cate` par défaut.
- **Verdict** : « non » si un agent tourne, un worktree est sale ou non poussé, une PR est ouverte, ou une source est illisible. Un build différent ne change pas le verdict, il s'ajoute en raison (« le daemon redémarrera : terminaux et agents arrêtés »). Code de retour 0 pour oui, 1 pour non.
- **Alternatives** : script shell séparé dans `~/.local/bin` (rapport C) : rejeté, `agence` est livré à Max par le tarball et c'est la place prévue par l'issue 29, lot 3.

## R3. Balayage des panneaux orphelins

- **Décision** : le régisseur détecte, à chaque tour, les orphelins et ouvre pour chacun un besoin `human` (`ref = orphan:<panelId>`, champ `orphan = {panel, title}`), sur le modèle exact de l'offre « Supprimer le worktree » (`agence.py:791-815`, `1017-1018`, `1468-1477`). Routes `/orphan/<besoin>/close` et `/orphan/<besoin>/keep`. Un clic Fermer lance `cate panel close <id>` sans `--discard`.
- **Orphelin** : (1) terminal absent de `cate agent list` dont le titre suit la convention `#n<chiffres> <rôle>` (confirmé par l'humain, besoin n271) ; (2) panneau relié par une relation `trigger` depuis l'orchestrateur (`cate panel list --json`, champ `relations`, vu le 2026-11-18) et qui n'est dans aucun besoin ni protégé. Dans les deux cas : vu orphelin sur 2 tours consécutifs (état `orphanVus`), jamais si son agent est `running`.
- **Exclus** : `protege()` (panneaux du projet et panneaux d'un autre besoin ouvert, `agence.py:1423`), le panneau qui appelle, tout type autre que `terminal`, `browser`, `canvas` pour le critère 2 (un éditeur n'est jamais proposé : ses modifications non enregistrées seraient perdues).
- **Garder** : le besoin se clôt `dropped` et le panneau entre dans `orphanGardes` : il n'est plus proposé tant qu'il vit.
- **Panneau agence (TS)** : `src/panels/agence/contract/suivi.ts:71-80` ne donne un bouton qu'aux brouillons et aux questions ; l'offre de worktree n'en a pas non plus. Le plan suit ce précédent : boutons sur la page du régisseur seulement (confirmé par l'humain, besoin n273).
- **Alternatives** : commande `agence sweep` à la demande : rejetée, l'issue veut le suivi qui liste. Fermeture automatique : exclue (principe : rien ne se ferme sans clic, rapport B).

## R4. Cloner `node_modules`

- **Décision** : une fonction `cloneNodeModules(rootDir, targetPath)` dans un fichier nouveau `src/workspace/repository/runtime/nodeModules.ts`, appelée par `addWorktree` après `git worktree add` (une ligne dans `git.ts`). `execFile('cp', ['-cR', source, cible])` asynchrone, sur darwin seulement.
- **Conditions** : `<racine>/node_modules` existe ; `<cible>/node_modules` n'existe pas ; le premier lockfile trouvé parmi `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` à la racine est présent dans la cible et identique octet à octet ; sinon rien, sans erreur. Échec de `cp` : suppression de la copie partielle (`fsp.rm`) et retour sans erreur.
- **Preuves mesurées le 2026-11-18, dans le scratchpad, sans toucher au dépôt** : `cp -cR` de `node_modules` (1,3 Go, 636 entrées de premier niveau) : 14,1 s ; `require('@parcel/watcher')` et `require('node-pty')` réussissent dans l'original et dans la copie, avec le `node` du système et avec le Node du runtime (`~/.cate/runtime/<build>/runtime/bin/node`) ; lockfile de ce worktree identique à celui de la racine (`cmp`). Les liens de `.bin` sont relatifs et survivent. Limite : le Node d'Electron n'a pas été essayé (il faudrait lancer l'app, interdit) ; l'implémenteur refait la preuve du runtime dans sa PR (tâche T-B05).
- **Coût en attente** : la création du worktree dure environ 14 s de plus sur ce dépôt. Elle remplace un `npm ci` qui prend plusieurs minutes et du réseau. La copie est asynchrone : le daemon reste réactif.
- **Alternatives** : `cp` synchrone (bloque le daemon) ; lien symbolique (un `npm install` dans le worktree écrirait dans la racine) ; `fs.cp` de Node (pas de clonefile, copie réelle de 1,3 Go) ; consigne dans le skill (pas une garantie).

## R5. Gabarit de brief (hors fork)

- **Décision** : deux ajouts de texte dans `~/.claude/skills/orchestrateur/SKILL.md` : la ligne `Interdit` du gabarit et la ligne `Fin`. Plus la règle du plafond (SKILL.md ligne 20) alignée sur R1. Preuve : le gabarit actuel dit « Interdit : merge, push sur main, force-push, envoi en son nom hors `agence draft` » et ne cite pas les fenêtres (rapport A, P1).
- **Vérification** : la ligne `evals.json` du skill ajoute un cas (le skill livre son `evals.json`, règle du setup), `python3 ~/.claude/setup/check.py` rend 0 échec.

## R6. Hook anti-fenêtre (hors fork)

- **Décision** : `~/.claude/hooks/window-guard.sh` (préfiltre bash : ne démarre le python que si la commande cite l'un des mots) et `window_guard.py`, sur le modèle de `workflow-guard.sh` / `workflow_guard.py`. Enregistré dans le groupe `Bash` de `PreToolUse` de `~/.claude/settings.json`.
- **Règle** : actif seulement si `cwd` contient `/.cate/worktrees/`. Bloque quand une instruction de la commande **commence** par `playwright test`, `npx playwright`, `pnpm exec playwright`, `npm run test:e2e`, `npm run dev`, `electron` ou `npx electron`. L'analyse découpe sur `;`, `&&`, `||`, `|` et retours à la ligne et ignore les mots dans une chaîne entre guillemets, un message de commit ou un heredoc (limite connue : un heredoc est lu comme texte). `ALLOW_E2E=1` en préfixe de l'instruction autorise.
- **Cas de test** (`hooks/tests/cases.json`, format du fichier : `name`, `hook`, `stdin`, `exit`, `stderr_has`) : bloqué (`npx playwright test x`, `npm run test:e2e`, `electron .`, `npm run dev`), autorisé (`npx vitest run`, `grep playwright f`, `git commit -m "playwright"`), sortie de secours, hors worktree.
- **Limite dite** : les appels MCP Playwright ne passent pas par `Bash` : non couverts (67 appels le 2026-11-18, rapport A).
- **Alternatives** : variable d'environnement posée aux agents : aucune n'existe (`CATE_TOKEN` est posé dans tout terminal Cate, rapport A) ; le dossier `.cate/worktrees/` est le seul critère disponible.

## Questions

Deux questions posées à l'humain, deux réponses (voir `spec.md`, Clarifications) : critère d'un terminal orphelin (n271), boutons sur la page du régisseur seulement (n273). Aucune question ouverte.
