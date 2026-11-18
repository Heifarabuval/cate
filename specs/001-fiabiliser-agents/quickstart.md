# Validation : démarrage rapide

Aucune commande ci-dessous ne lance Playwright, Electron, l'app Cate ni `npm run dev` (principe X). Prérequis : `node_modules` présent à la racine du worktree de l'implémenteur (le sien, jamais d'`npm ci` lancé par un agent).

## Lot A : agence (récits 1 à 3)

```bash
npm run test:agence
```

Attendu : 0 échec. Tests nouveaux : plafond à 4 et agents en attente comptés, `doctor --relance` (oui, agent en plein tour, worktree non poussé, PR ouverte, build différent, source illisible, lecture seule), balayage (orphelin sur 2 tours, protégés exclus, Fermer sans `--discard`, Garder).

Vérification de l'aide : `python3 tools/agence/agence.py start --help` affiche « défaut 4 ».

## Lot B : clone de `node_modules` (récit 4)

```bash
npx vitest run src/workspace/repository/runtime/nodeModules.test.ts src/workspace/repository/runtime/git.worktreePr.test.ts
npm run typecheck
npm run lint:deps
```

Attendu : 0 échec, 0 erreur. Les tests de clone passent sur macOS et sont sautés ailleurs. Preuve manuelle des modules natifs, avec le Node du runtime (`~/.cate/runtime/<build>/runtime/bin/node`, `<build>` est le contenu du fichier `~/.cate/runtime/current`), dans un dossier qui contient une copie de `node_modules` :

```bash
cd <dossier de la copie> && ~/.cate/runtime/$(cat ~/.cate/runtime/current)/runtime/bin/node -e "require('@parcel/watcher'); require('node-pty'); console.log('ok')"
```

## Lot C : hors fork (récits 5 et 6)

```bash
python3 ~/.claude/setup/check.py
```

Attendu : 0 échec, cas `window-guard` compris. Contrôle manuel du gabarit : `rg -n "ouvrir une fenêtre|poussé : oui" ~/.claude/skills/orchestrateur/SKILL.md` rend deux lignes.

## Scénario de bout en bout (par l'humain, hors agent)

1. Un orchestrateur lance 4 agents : le 5e reste en file jusqu'au message « Une place est libre ».
2. `agence doctor --relance` : `non` tant qu'un agent tourne ou qu'un commit n'est pas poussé.
3. Après un plantage de Cate : les terminaux `#n… <rôle>` sans agent apparaissent au suivi, Fermer les ferme.
4. Un worktree créé par Cate contient `node_modules` sans `npm ci`.
5. Un agent qui tape `npx playwright test` dans un worktree reçoit le refus du hook.
