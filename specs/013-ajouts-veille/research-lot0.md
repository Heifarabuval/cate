# Recherche lot 0 : Review, `cate browser`, et les questions Q1, Q3, Q7 (spec 013)

**Lu le** : 2026-11-21. **Base du code lu** : `docs/spec-012-connecteurs-metiers` (`38b53317`), avant les lots de 010 et 013 ; les chemins ci-dessous valent pour cette base. **Nom du fichier** : `research-lot0.md`, pas `research.md` : le lot 5 de la spec (mesure de l'attente) écrit `research.md`, les deux ne se mélangent pas. **Lecture seule sur le code** ; rien lancé, aucune fenêtre ouverte.

Portée : T001 (Review), T002 (`cate browser`), et les réponses argumentées à Q1, Q3, Q7 pour T004. **T003** (relire #100 et la spec 006) n'est pas dans cette demande : laissée. **T004 est [H]** : ce document recommande, l'humain tranche.

## T001 : ce que fait déjà le panneau Review

**Il lit, il ne répond pas.** Le panneau n'a aucune opération qui écrit un commentaire de diff, qui le renvoie à un agent ou qui rejette un changement. Preuve : `grep -i "comment|revert|discard|restore|undo|reject"` sur `src/panels/review/` et `src/shells/desktop/ui/panels/review/` ne rend que des codes de rejet d'opération (`reject('pr-subject')`, `session.ts:80`) et aucune action sur un diff.

| Besoin de la spec | Ce qui existe | Preuve |
|---|---|---|
| Voir les modifications d'un agent | Oui : les éditions enregistrées par agent, source, commit ou non commité, par fichier ; diff à la demande, page par page | `src/panels/review/session.ts:291-379` (`loadRecorded`, `publishRecorded`, `recordedDiff`) |
| Revoir une pull request | Oui : lecture seule d'une PR (détails, checks, diff d'un fichier) | `src/panels/review/contract/types.ts:113-127`, ops `prTick` et `prFileDiff` (`session.ts:428-429`) |
| Faire relire par un agent | Oui : « Review in terminal » lance un **nouvel** agent relecteur sur les éditions choisies, dans un terminal choisi ; le prompt dit « Report findings without editing files » | `session.ts:405-415` (`reviewWithAgent`), `src/panels/review/parts/runtime/prompts.ts:11`, `src/shells/desktop/ui/panels/review/AgentChangesView.tsx:35` |
| Commentaire de diff renvoyé à l'agent | **Non.** Le retour est un texte libre de l'agent relecteur dans son terminal, pas un commentaire accroché à une ligne. L'instruction de la relation « verify » est : « Review the recorded agent edits. Report findings in your response; do not edit files unless asked » | `src/panels/review/definition.ts:99` |
| Rejeter un changement | **Non dans Review.** Les ops du panneau : `refresh`, `updateFilter`, `recordedDiff`, `switchCheckout`, `switchWorktree`, `retarget`, `reviewAgents`, `reviewWithAgent`, `prTick`, `prFileDiff` | `session.ts:419-430`, `types.ts:146-165` |

**Ce qui existe ailleurs et sert à « jeter » (#174) :**

- Rejeter un fichier : `vcs.discardFile` (confirmation dans la vue, fichier non suivi mis à la corbeille), mais depuis la **vue de comparaison Git**, pas depuis Review. `src/shells/desktop/ui/workspace/repository/GitComparisonView.tsx:52-66`, capacité `src/workspace/repository/contract/capability.ts:68`.
- Retirer un worktree, avec ou sans sa branche : `worktreeRemove` (`capability.ts:98`).
- Créer une PR et lire son état : `createPr` et `prStatus` (`capability.ts:111-112`). **Aucune méthode pour fermer une PR** dans cette capacité : « PR fermée » (US7) passe donc par `gh pr close`, côté `agence`, pas par `src/`.
- Envoyer un prompt à un agent déjà en route : `cate agent send` (`src/services/agents/contract/api.ts:135-144`), accès `control`. C'est le seul canal existant pour renvoyer un retour humain à l'agent qui a écrit le code.

**Conséquence pour US7.** La carte « jeter » ne demande aucun code de Review : elle compose `gh pr close` (hors `src/`), `worktreeRemove` et le retour de la fiche en `discussion`. Un retour commenté vers l'agent se ferait par `cate agent send` depuis `agence`, sans toucher au panneau.

## T002 : ce que fait déjà `cate browser`

**Il observe et il agit par un identifiant d'élément issu d'un instantané, il ne se laisse pas montrer un élément.** Aucun sélecteur CSS, aucun HTML d'élément, aucune capture d'élément.

| Capacité demandée par US8 | Ce qui existe | Preuve |
|---|---|---|
| Sélecteur d'un élément | **Non.** Un élément s'adresse par id de l'instantané, `[x,y]` ou `--role` / `--name`. `find` rend `id`, `role`, `name`, `value`, `states`, `offscreen` | `src/services/browser/contract/api.ts:184`, `src/services/browser/contract/automation.ts:30-37` |
| HTML d'un élément | **Non.** `attr` lit **un** attribut nommé (`getAttribute`), pas `outerHTML` | `api.ts:185-188`, `src/services/browser/desktop/pageDriver.ts:1496-1503` |
| Capture d'un élément | **Non.** `screenshot` capture la fenêtre visible (`capturePage(undefined, ...)`) puis la redimensionne au viewport ; pas de zone | `api.ts:183`, `pageDriver.ts:1195-1198` |
| L'humain montre un élément | **Non.** Dans la page invitée, les écouteurs `pointerdown` et `keydown` ne servent qu'à signaler que l'humain reprend la main et annule l'automatisation en cours | `src/services/browser/desktop/preload/guest.ts:74-81` |
| Sens agent vers humain | Oui : un curseur d'agent affiche où l'agent agit | `src/services/browser/contract/agentCursor.ts` |

Autorisations : lecture (`cliBrowserReadEnabled`) et contrôle (`cliBrowserControlEnabled`) par zone, `api.ts:104-117`.

**Réponse à Q5 (skill, panneau perso ou issue upstream).** Un skill seul ne suffit pas : rien dans le code lu ne fait remonter un clic de l'humain jusqu'à l'agent, et les commandes ne rendent ni sélecteur, ni HTML, ni capture d'élément. Un panneau perso : **non vérifié** (le code des panneaux perso n'a pas été lu), mais il ne verrait pas non plus les éléments de la page invitée sans un pont que le navigateur n'expose pas dans le code lu. Le plus probable est donc du code dans `src/services/browser/` et `src/panels/browser/`, ce que FR-010 interdit sans décision écrite. Recommandation : **décision écrite d'accepter ce code, puis une issue upstream** pour le même geste (écart minimal, 009 FR-013). Option écartée : un skill qui demande à l'humain de coller un sélecteur à la main, sans valeur pour l'intégrateur non-dev. L'humain tranche (pas dans T004, Q5 reste ouverte).

**Fait à connaître.** Un autre lot, commité en local sur `feat/v2-reste-013l8` (`21daf307`, sans push), ajoute un bouton « montrer un élément » : sélecteur, rôle, texte et boîte de l'élément envoyés aux agents reliés, **sans HTML ni capture** (le message de commit le dit). Cela couvre le sélecteur et pas les deux autres éléments d'US8. Le code de cette recherche ne le contient pas. À réconcilier avec US8 et FR-010 au moment de la PR.

## Q1 : forme du registre durable

**Recommandation : `docs/decisions.md`, écrit par `agence decision export`, décisions actives seulement, triées par date, commité par une PR de docs.** C'est l'hypothèse de la spec. Pourquoi :

- **Lisible en revue** : Markdown, un bloc par décision (objet, date, pourquoi, alternatives écartées), diff compréhensible ; le fichier est généré, jamais édité à la main.
- **Ne change aucune règle de l'architecture** : le dossier `.cate/` du projet ne contient que `skills.json`, `tmp/`, `worktrees/` et son `.gitignore` (CLAUDE.md, « State »). Un fichier de décisions hors de `.cate/tmp/` a sa place dans `docs/`.
- **Déterministe** : sans date d'export, deux exports du même registre sont identiques, donc aucun diff parasite. La fonction est déjà écrite sur la lignée de branches de 013 (`tools/agence/backlog.py`, `registre_md`, sur `feat/v2-reste-013c1`), qui suit cette hypothèse : un autre choix ne coûte que cette fonction et son test.
- **Coût** : 0 € par mois, une PR de docs par export.

**Limite à connaître.** Un clone neuf reçoit la **copie lisible**, pas le registre : `decisions.json` reste dans `.cate/tmp/` (ignoré par git). Les décisions actives se lisent, mais l'interlocuteur ne retrouve pas son garde-fou contre les contradictions tant qu'une commande d'import n'existe pas (aucune n'est prévue). SC-004 (« un clone neuf contient les décisions actives ») est tenu à la lettre.

**Option écartée : versionner `decisions.json` lui-même** (sans perte, restaurable, mais illisible en revue, tentation de l'éditer à la main, et il demande soit de sortir de `.cate/tmp/`, soit un fichier JSON dans `docs/` à côté d'une copie lisible). À reprendre si le besoin de restaurer le registre sur un nouveau poste devient réel.

## Q3 : garde de plafond, `deny` ou `ask`

**Recommandation : `deny`**, avec comme sortie de secours le réglage de la clé `agents.max` par l'humain. Pourquoi :

- **Cohérence avec la garde actuelle.** Tout ce qui est une règle de projet est un `deny` : pages du régisseur, `state.json`, politique (`tools/agence/agence.py:2505-2523`). `ask` ne sert qu'à l'envoi au nom de l'humain, où son clic est justement ce qu'on veut (`agence.py:2471-2473`). Un plafond est une règle déjà posée par l'humain, pas une décision à reprendre à chaque lancement.
- **`ask` se contourne à l'usure.** L'orchestrateur lance depuis son terminal ; une question là bloque ou se valide par réflexe. Le plafond existe parce que 13 agents ont forcé un redémarrage sur un Mac de 24 Go : le risque est le « oui » machinal.
- **La sortie de secours est solide.** Un agent ne peut pas relever le plafond : `agence pratiques set` et `start --max-agents` sont refusés aux agents (`agence.py:2446-2447`). L'humain règle `agents.max` et le lancement passe. Aucune variable d'environnement de contournement à prévoir.
- **Compte** : `agentsActive + agentsWaiting`, publiés par le régisseur (`agence.py:1659`), l'orchestrateur et le régisseur ne comptent pas (`agence.py:181-182`, aide de `--max-agents`).
- **Risque résiduel** : un compte périmé trop haut refuse à tort jusqu'au tour suivant du régisseur. Réponse prévue par la spec : le message dit l'âge du compte, état illisible = aucune décision (Edge Cases). Coût : 0 €, aucun appel de modèle.

**Option écartée : `ask`.** Elle laisserait l'humain dépasser le plafond d'un clic, ce qui est la porte que la règle devait fermer.

## Q7 : défaut de la validation du plan

**Recommandation : défaut `jamais`**, confirmé ; `structurante` posé seulement dans le préréglage strict (`pr-tdd`), jamais dans `neutre`. Pourquoi :

- **Le critère du benchmark est le temps actif humain** (009 FR-011, spec 011) ; une validation de plan ajoute un arrêt par fiche. Un défaut qui ajoute ce temps avant qu'on l'ait mesuré contredit la règle « mesurer avant et après ».
- **Les défauts de la politique sont déjà permissifs** : le préréglage `neutre` met `tests`, `verification` et `issue` à `libre` et les réserve au préréglage `pr-tdd` (`tools/agence/pratiques.json`, `presets`). `jamais` suit le même motif.
- **`structurante` est déjà calculable sans modèle** : une décision porte le booléen `structurante` (`backlog.py`, `decision_ajouter`, branche `feat/v2-reste-013c1`) et une fiche lie ses décisions. La clé fera donc partie du préréglage strict sans nouveau code de détection (009 FR-005).
- **La clé s'écrit comme les autres** : trois valeurs et une phrase `exige` ajoutée au brief pour `structurante` et `toujours`, sur le modèle de `speckit` (`pratiques.json`, entrée `speckit`). Couche 2 : gelée jusqu'à G1 (009).

**Option écartée : défaut `structurante`.** Un seul arrêt sur les décisions structurantes serait raisonnable, mais son gain n'est pas mesuré ; à revoir après le premier benchmark, en changeant seulement le défaut de `neutre`. `toujours` est écarté comme défaut : un arrêt par fiche est le pire cas pour le temps actif.

## Non vérifié

- Aucun comportement n'a été lancé : tout vient de la lecture du code de la base citée.
- L'interface de Review à l'écran : non vue (aucune fenêtre ouverte). Seul le code des vues a été lu.
- `PullRequestView.tsx` : seule sa présence et les ops de session ont été lues, pas son rendu ; le grep ne trouve aucun commentaire.
- Le compte publié du régisseur et son âge réel : lus dans le code, pas mesurés.
- L'avantage mesuré de `jamais` contre `structurante` : aucune mesure (les gains de 013 ne sont pas mesurés).
