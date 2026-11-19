# Fork Cate : installation et mise à jour automatique (macOS)

Installe le fork et le garde à jour sans rien taper après la première fois.

## Installer

Coller une fois dans Terminal :

```sh
curl -fsSL https://raw.githubusercontent.com/Heifarabuval/cate/main/scripts/cate-fork-install.sh | sh
```

## Ce que la ligne fait

1. Refuse, sans rien écrire, un `HOME` vide, relatif, `/` ou absent, et l'utilisateur root (`sudo` garde le `HOME` de l'utilisateur : tout serait créé root). Puis vérifie et nomme d'un coup ce qui manque : outils développeur (`xcode-select -p`, sans ouvrir la fenêtre d'installation), git, Node 22 (version lue dans `engines` de `package.json`), npm, connexion. Si quelque chose manque, elle s'arrête sans rien écrire : installer, puis recoller la même ligne.
2. Copie `cate-fork-update` dans `~/.local/bin`.
3. Écrit l'agent launchd `com.cate.fork-update` (toutes les 10 minutes, priorité basse) dans `~/Library/LaunchAgents` et le charge.
4. Construit le fork une première fois et l'installe dans `/Applications` (10 à 20 min, durée non mesurée). Fermer Terminal pendant ce temps ne casse rien : l'agent est déjà chargé et reprend la construction dans les 10 minutes.
5. Après un premier build réussi, branche les gardes d'envoi avec la CLI du clone (`~/.local/share/cate-build/tools/agence/agence hooks install`) : sauvegarde de `~/.claude/settings.json` d'abord, puis deux entrées `PreToolUse` ajoutées, les hooks existants gardés. Un échec arrête la ligne (code non nul) ; l'agent reste chargé ; recoller la même ligne. `--sans-gardes` saute cette étape et ne touche pas à `~/.claude`.
6. Lance `agence doctor --prerequis --hors-cate` (lecture seule) et dit en 3 lignes au plus ce qui reste à faire à la main (`Reste : <point> → <commande>`, rien si tout est là). Les points qui exigent Cate (réglages CLI du workspace, skill semé) sont à vérifier ensuite dans un terminal Cate : `agence doctor --prerequis`.

Un build en échec ne branche aucun garde et ne lance pas `doctor`.

Ensuite, à chaque nouveau commit de `main`, l'agent construit le fork. Le remplacement de `/Applications/Cate.app` attend que Cate soit fermé. Aucun daemon n'est arrêté, Cate n'est jamais lancé.

Un build en échec laisse l'app installée intacte. Il est retenté aux passages suivants (réseau coupé, build interrompu), 3 échecs au plus par commit ; au troisième, une notification, puis l'agent attend le commit suivant. Relancer à la main : `~/.local/bin/cate-fork-update --force`.

Le script `~/.local/bin/cate-fork-update` se met à jour lui-même : à chaque passage, il prend la version de `scripts/cate-fork-update.sh` du commit suivi, seulement si elle est non vide, syntaxiquement valide et passe `--self-test` (contrôle de démarrage qui ne touche à rien). Sinon la copie en place reste et prendra le correctif suivant. Un correctif du script arrive donc sans recoller la ligne. Limite : `--self-test` couvre le démarrage jusqu'au contrôle du dossier de build, pas les étapes de build qui suivent.

Relancer la ligne est sans risque : même résultat, pas de doublon. Si un agent d'un autre nom lance déjà `cate-fork-update`, rien n'est installé.

## L'app Cate déjà installée est remplacée

Le fork s'installe sous le même nom, `/Applications/Cate.app`. Une app Cate officielle déjà installée est **remplacée** par le fork au premier build réussi, puis à chaque mise à jour. Le fork ne se met jamais à jour depuis les releases officielles.

Ce que la ligne et l'agent écrivent (relevé dans les scripts et les outils du build (npm, Electron), pas par une trace système) :

| Chemin | Contenu |
| ------ | ------- |
| `/Applications/Cate.app` (et `Cate.app.old` le temps du remplacement) | l'app, remplacée par le fork (ou `CATE_APPS_DIR`) |
| `~/.local/bin/cate-fork-update` (et `.new` le temps de la mise à jour du script) | le script de mise à jour |
| `~/Library/LaunchAgents/com.cate.fork-update.plist` | l'agent launchd |
| `~/.local/share/cate-build` | le clone du fork, `node_modules`, `release/`, `dist-runtime/` (dont `dist-runtime/cache/` : Node et ripgrep téléchargés) |
| `~/.local/share/cate-build.staged`, `.installed`, `.failed`, `.notified`, `.lock` | l'état de l'agent, à côté du clone, jamais dedans |
| `~/.config/cate-fork-update.conf` | les réglages, seulement si un réglage est donné |
| `~/.claude/settings.json` (et sa sauvegarde `settings.json.bak-agence-<AAAAMMJJ-HHMMSS>` à côté, faite d'abord) | les gardes d'envoi agence (deux entrées `PreToolUse`), sauf `--sans-gardes` |
| `~/Library/Logs/cate-fork-update.log` (et `.log.1` au-delà de 1 Mo) | le journal |
| `~/.npm/` | le cache de `npm ci` |
| `~/Library/Caches/electron/`, `~/Library/Caches/electron-builder/` | Electron et les outils de packaging, téléchargés par `npm ci` et le packaging |
| `$TMPDIR` (`cate-npmpack-*`, `cate-node-*`, `cate-rg-*`, et le script téléchargé par `curl \| sh`) | dossiers temporaires, supprimés après usage |

Hôtes appelés : `raw.githubusercontent.com` (ligne d'installation et script de mise à jour), `github.com` (clone et `fetch` du fork, releases d'Electron, de ripgrep et des binaires précompilés de modules natifs), `registry.npmjs.org` (`npm ci`, `npm pack`), `nodejs.org` (le Node embarqué dans le runtime). La désinstallation avec `--purge` ne supprime que le clone et les fichiers d'état ; `~/.npm` et `~/Library/Caches` restent.

La ligne ne touche ni les données des workspaces (`~/.cate/`) ni les réglages de l'app : ils restent après un retour à l'app officielle.

## Revenir à l'app officielle

1. Désinstaller la mise à jour automatique (commande plus bas), sinon l'agent réinstalle le fork.
2. Fermer Cate, mettre `/Applications/Cate.app` à la corbeille.
3. Télécharger Cate depuis ses releases officielles et l'installer comme d'habitude.

`--sans-launchd` installe le script sans le planifier : `sh cate-fork-install.sh --sans-launchd`.

`--sans-gardes` laisse `~/.claude/settings.json` intact, pour qui a déjà ses propres gardes sur les mêmes outils (deux gardes sur un même outil se contredisent) : `curl -fsSL .../cate-fork-install.sh | sh -s -- --sans-gardes`. Le résumé nomme alors les gardes comme reste à faire.

## Ce que ça signifie

La mise à jour construit et installe automatiquement ce qui est sur la branche configurée du dépôt, toutes les 10 minutes, sans clic, avec les droits de l'utilisateur. Quiconque peut écrire sur cette branche peut donc faire exécuter du code sur le Mac : il faut faire confiance au propriétaire de la branche.

`--branche` (ou `CATE_FORK_BRANCH` dans le fichier de réglages) choisit la référence suivie. Seul un SHA complet de 40 caractères épingle : une branche avance, et un tag est relu à chaque passage (`git fetch origin <tag>`), donc un tag déplacé sur le dépôt est suivi.

Même avec un SHA, la ligne d'installation et la première copie de `cate-fork-update` viennent de `main` (`CATE_FORK_RAW_URL`, par défaut `.../cate/main/scripts`) ; au premier passage, le script est remplacé par celui du commit épinglé. Pour que rien ne vienne de `main`, prendre aussi les scripts au même commit :

```sh
curl -fsSL https://raw.githubusercontent.com/Heifarabuval/cate/<SHA>/scripts/cate-fork-install.sh | CATE_FORK_RAW_URL=https://raw.githubusercontent.com/Heifarabuval/cate/<SHA>/scripts sh -s -- --branche <SHA>
```

## Ce que l'installation ne fait pas

- `agence.nom` : `git config --global agence.nom <Prénom>` (sinon « L'humain ») ;
- les skills et les hooks Claude autres que les gardes d'envoi ;
- la connexion `gh` et l'installation de Claude Code : le résumé les nomme s'ils manquent ;
- le réglage `cliTerminalInputEnabled` du workspace, coupé par défaut : un clic dans Cate, nommé par `agence doctor --prerequis`.

Après une installation, le daemon du workspace garde l'ancien runtime jusqu'à sa mise à jour par l'app (cate#26 mergé : automatique quand le workspace est inactif).

## Garde-fous

Le dossier de build est normalisé (barre finale retirée) puis refusé, sans rien toucher, s'il n'est pas un chemin absolu nommé `cate-build` strictement sous `HOME`, s'il est un lien symbolique, ou si c'est un dépôt git dont l'`origin` n'est pas exactement `CATE_FORK_REPO`. Le dossier d'installation doit être inscriptible avant toute construction : sinon, `CATE_APPS_DIR=~/Applications`.

Un seul passage à la fois, `--purge` compris : un verrou (`cate-build.lock`, avec le pid) fait attendre le suivant. Le verrou est repris si son pid n'est plus un `cate-fork-update` (processus fini, ou pid repris par un autre programme après une coupure), ou s'il n'a pas de pid depuis 15 minutes. `--purge` pendant une construction refuse et ne supprime rien.

## Réglages

Variables d'environnement, ou lignes `CLE=valeur` dans `~/.config/cate-fork-update.conf` (l'environnement prime) :

| Variable           | Défaut                                    |
| ------------------ | ----------------------------------------- |
| `CATE_FORK_REPO`   | `https://github.com/Heifarabuval/cate.git` |
| `CATE_FORK_BRANCH` | `main`                                    |
| `CATE_BUILD_DIR`   | `~/.local/share/cate-build`               |
| `CATE_APPS_DIR`    | `/Applications`                           |

Journal : `~/Library/Logs/cate-fork-update.log`. Mise à jour immédiate : `~/.local/bin/cate-fork-update --force`. Prérequis seuls : `~/.local/bin/cate-fork-update --prereq`.

Le script construit avec `CATE_SELF_UPDATE=0` : l'app du fork ne se met jamais à jour depuis les releases d'upstream. Un build manuel sans cette variable peut l'être.

## Désinstaller

```sh
curl -fsSL https://raw.githubusercontent.com/Heifarabuval/cate/main/scripts/cate-fork-uninstall.sh | sh
```

Retire l'agent et le script. Ajouter `-s -- --purge` après `sh` supprime aussi le dossier de build. `--gardes` retire aussi les gardes d'envoi de `~/.claude/settings.json` (avec la CLI du clone, avant `--purge`) ; si elle ne peut pas, le dossier de build et le script de mise à jour restent (un second passage peut finir) et le code de sortie est 1. Sans `--gardes`, `~/.claude` n'est jamais touché. L'application installée, le journal et le fichier de réglages restent.

## Non vérifié

- Gatekeeper : le script retire la quarantaine et signe l'app en ad hoc, mais l'ouverture sur un autre Mac n'a pas été essayée. Si macOS refuse d'ouvrir l'app, clic droit puis Ouvrir (non vérifié).
- `agence hooks install` sur un vrai `~/.claude/settings.json` : couvert par les tests de la CLI et par ceux du script en faux HOME, pas exécuté sur un vrai Mac.
- `launchctl` réel (dont le premier passage de l'agent 10 minutes après son chargement, faute de `RunAtLoad`), durée du premier build et installation dans `/Applications` : couverts seulement par les tests en faux HOME, pas exécutés pour de vrai.
