# Quickstart : Max installe l'orchestrateur

Prérequis (macOS Apple silicon) : les outils développeur d'Apple, Node 22.16 à 22.x (nvm, volta, fnm ou Homebrew), Claude Code ; `gh` pour l'orchestration. Le script vérifie, nomme ce qui manque avec sa commande, et s'arrête sans rien casser.

## Max, première minute

Coller cette ligne dans Terminal, une seule fois (texte de référence : `scripts/cate-fork-install.md:10`) :

```shell
curl -fsSL https://raw.githubusercontent.com/Heifarabuval/cate/main/scripts/cate-fork-install.sh | sh
```

Ensuite, plus aucune commande. Le script :

1. vérifie les prérequis sans ouvrir la fenêtre d'installation d'Apple (livré) ;
2. installe la mise à jour automatique : un agent launchd, toutes les 10 min (livré) ;
3. construit Cate depuis le fork et l'installe dans `/Applications` (livré ; première fois : 10 à 20 min, durée non mesurée) ;
4. branche les gardes d'envoi (sauvegarde de `~/.claude/settings.json` d'abord) et lance `agence doctor --prerequis --hors-cate` (lot 4) ;
5. dit en 3 lignes au plus ce qui reste à la main (lot 4).

Ouvrir Cate sur le dépôt à orchestrer, lancer Claude Code dans un terminal Cate et taper `/orchestrateur` (un message à Claude, pas une commande).

Si un prérequis manque, le script le dit avec sa commande ; Max la lance et recolle **la même ligne** (seul cas de deuxième collage). Relancer la ligne ne casse rien.

## Mises à jour

Rien à faire. Toutes les 10 minutes, l'agent regarde si le fork a avancé, construit en arrière-plan et installe dès que Cate est fermé. À l'ouverture suivante, un workspace inactif passe tout seul sur le nouveau build ; un workspace occupé demande avant d'arrêter quoi que ce soit (PR #27).

Journal : `~/Library/Logs/cate-fork-update.log`.

## Désinstaller

Défaire l'agent et le script (ni l'app ni `~/.cate`) :

```shell
curl -fsSL https://raw.githubusercontent.com/Heifarabuval/cate/main/scripts/cate-fork-uninstall.sh | sh
```

`--purge` supprime aussi le dossier de build (livré) ; `--gardes` retire aussi les gardes (lot 4).

## Essai réel (recette : le premier passage de Max, X003)

1. Max colle la ligne ; noter toute commande tapée ensuite (0 attendu) et la durée (moins de 30 min hors prérequis).
2. `agence draft new --cible issue:<compte>/<dépôt-test> --from <orch> "test"` ; Envoyer depuis le panneau ; l'issue existe.
3. Dans un sous-agent : `curl 127.0.0.1:<port>/` refusé par le garde, `state.json` non modifiable.
4. Fermer et rouvrir Cate : `agence need list` répond dans le terminal restauré.
5. Deuxième passage : un commit sur `origin/main`, attendre l'installation (Cate fermé), rouvrir Cate : le workspace est sur le nouveau build sans `pkill`.

## Chez Heifara

Avant le lot 5 :

```shell
git config --global agence.nom Heifara
```

Puis, après le lot 5 de Skills : `agence hooks install`, puis `./skills.sh install` de Skills, puis `agence hooks status`. S'il relance l'amorçage chez lui avant le lot 5 : `sh -s -- --sans-gardes`.
