# Contrats d'interface

Quatre interfaces changent. Aucune n'ajoute de capability, de méthode `cate` API ni de réglage : la constitution (principe II) n'a rien à déclarer.

## 1. `agence start --max-agents` (récit 1)

- Défaut : 4. Aide : « plafond d'agents vivants pour ce projet (défaut 4 ; les agents en attente de saisie comptent, l'orchestrateur et le régisseur non) ».
- Un message `notify` à l'orchestrateur : `Une place est libre : <vivants> en cours sur <plafond>.` (texte actuel, sens du compte changé).

## 2. `agence doctor --relance` (récit 2)

```text
agence doctor --relance
```

Sortie : première ligne `oui` ou `non`, puis une raison par ligne.

```text
non : 2 agents en plein tour (#n12 implémenteur, #n12 vérificateur)
non : worktree n12-implementeur : 1 commit non poussé
non : PR ouverte #31 test(ci)
info : daemon à redémarrer (build 2.1.0-beta.15+337c78bd35a7, app 2.1.0-beta.15+91553d604add) : terminaux et agents arrêtés
info : 1 agent en attente de saisie (#n13 vérificateur)
```

Code de retour : 0 pour `oui`, 1 pour `non`, 2 hors terminal Cate (comme les autres sous-commandes). Source illisible : `non : <source> illisible (<erreur>)`. Lecture seule : aucune écriture de `state.json`, aucun appel `cate ... close`, `git push`, `git worktree remove`.

## 3. Pages du régisseur (récit 3)

| Route | Méthode | Effet |
|-------|---------|-------|
| `/orphan/<besoin>/close` | POST | `cate panel close <id>` sans `--discard`, puis besoin `done`. Refus de Cate : 409 avec le motif, le besoin reste ouvert. |
| `/orphan/<besoin>/keep` | POST | Besoin `dropped`, panneau ajouté à `orphanGardes`. |

Les deux exigent le jeton des formulaires (`token_ok`), comme `/wt/...`. Besoin plus ouvert ou sans champ `orphan` : 409 « Cette proposition n'est plus attendue. ».

## 4. `addWorktree` (récit 4)

Signature inchangée : `addWorktree({ cwd, branch, targetPath, createBranch, baseRef })` rend `{ path, branch }`. Nouveau comportement observable : `<targetPath>/node_modules` existe après l'appel quand les conditions de la spec (FR-018) sont réunies. Aucune erreur nouvelle ne remonte.

## 5. Hook `window-guard` (récit 6)

Entrée : JSON `PreToolUse` sur stdin (`tool_name`, `tool_input.command`, `cwd`). Sortie : code 0 (laisser passer) ou code 2 avec sur stderr :

```text
Fenêtre interdite dans un worktree d'agent : <commande>. Un e2e s'écrit, il ne s'exécute pas : rapport « non exécuté ». Sortie de secours : ALLOW_E2E=1 devant la commande.
```

## 6. Gabarit de brief (récit 5)

Deux lignes du bloc « Brief d'un sous-agent » de `~/.claude/skills/orchestrateur/SKILL.md` :

- `Interdit : merge, push sur main, force-push, envoi en son nom hors agence draft, lancer Playwright, Electron ou l'app Cate, ouvrir une fenêtre.`
- `Fin : cate agent send --panel <ORCH> "<rapport de 15 lignes max : STATUT, PREUVES (commande + résultat, URL, SHA), HEAD <sha>, poussé : oui ou non, NON VÉRIFIÉ, FICHIERS>"`
