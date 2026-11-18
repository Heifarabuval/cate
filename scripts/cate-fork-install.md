# Fork Cate : installation et mise à jour automatique (macOS)

Installe le fork et le garde à jour sans rien taper après la première fois.

## Installer

Coller une fois dans Terminal :

```sh
curl -fsSL https://raw.githubusercontent.com/Heifarabuval/cate/main/scripts/cate-fork-install.sh | sh
```

## Ce que la ligne fait

1. Vérifie et nomme d'un coup ce qui manque : outils développeur (`xcode-select -p`, sans ouvrir la fenêtre d'installation), git, Node 22 (version lue dans `engines` de `package.json`), npm, connexion. Si quelque chose manque, elle s'arrête sans rien écrire : installer, puis recoller la même ligne.
2. Copie `cate-fork-update` dans `~/.local/bin`.
3. Écrit l'agent launchd `com.cate.fork-update` (toutes les 10 minutes, priorité basse) dans `~/Library/LaunchAgents`.
4. Construit le fork une première fois et l'installe dans `/Applications` (10 à 20 min, durée non mesurée).
5. Charge l'agent.

Ensuite, à chaque nouveau commit de `main`, l'agent construit le fork. Le remplacement de `/Applications/Cate.app` attend que Cate soit fermé. Aucun daemon n'est arrêté, Cate n'est jamais lancé. Un build en échec laisse l'app installée intacte et ne notifie qu'une fois.

Relancer la ligne est sans risque : même résultat, pas de doublon. Si un agent d'un autre nom lance déjà `cate-fork-update`, rien n'est installé.

`--sans-launchd` installe le script sans le planifier : `sh cate-fork-install.sh --sans-launchd`.

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

Retire l'agent et le script. Ajouter `-s -- --purge` après `sh` supprime aussi le dossier de build. L'application installée, le journal et le fichier de réglages restent.

## Non vérifié

- Gatekeeper : le script retire la quarantaine et signe l'app en ad hoc, mais l'ouverture sur un autre Mac n'a pas été essayée. Si macOS refuse d'ouvrir l'app, clic droit puis Ouvrir (non vérifié).
- `launchctl` réel, durée du premier build et installation dans `/Applications` : couverts seulement par les tests en faux HOME, pas exécutés pour de vrai.
