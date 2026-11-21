# Recherche : ajouts de la veille du 20/11 (spec 013)

**Base lue** : `origin/main` à `ca3e0662` (contient #186, le gros lot de la vision v2). **Lecture seule** : rien lancé, aucune fenêtre ouverte. Chaque constat porte un `chemin:ligne` ou la mention « non vérifié ». Ce fichier couvre le lot 0 (T001 à T003, puis les options de T004) et le lot 5 (T050, T051).

`research-lot0.md` est une première lecture faite sur une base plus ancienne (`38b53317`). Ce fichier la remplace sur ce point : plusieurs conclusions ont changé depuis (voir T002, Q1, Q3, Q7).

**Ce qui a bougé depuis la spec** : les hypothèses de Q1, Q3 et Q7 et le bouton « montrer un élément » sont déjà du code sur `origin/main` (#186). Trancher revient donc à confirmer ce code ou à le changer (coût de chaque option indiqué plus bas), pas à partir d'une page blanche. C'est Heifara qui tranche ; ce document recommande.

## T001 : ce que fait déjà le panneau Review

**Il lit et il fait relire ; il ne répond pas à l'agent et ne rejette rien.** Aucune op du panneau n'écrit un commentaire de diff, ne le renvoie à l'agent auteur ou ne rejette un changement.

| Besoin | État | Preuve |
|---|---|---|
| Voir les éditions d'un agent (par agent, source, commit ou non), diff à la demande | Oui | `src/panels/review/session.ts:291` (`loadRecorded`), `:322` (`publishRecorded`), `:374` (`recordedDiff`) |
| Lire une pull request (détails, checks, diff d'un fichier), lecture seule | Oui | `src/panels/review/contract/types.ts:162-165` (`prTick`, `prFileDiff`), `src/shells/desktop/ui/panels/review/PullRequestView.tsx:1` (« read only (no comment, approval or merge) ») |
| Faire relire par un agent | Oui, par un **nouvel** agent relecteur, « sans éditer » | `src/panels/review/session.ts:406` (`reviewWithAgent`), `src/panels/review/parts/runtime/prompts.ts:11`, `src/shells/desktop/ui/panels/review/AgentChangesView.tsx:35,40` |
| Commentaire de diff renvoyé à l'agent auteur | **Non.** Le retour est du texte libre dans le terminal du relecteur, pas accroché à une ligne | `src/panels/review/definition.ts:99` (« Report findings in your response; do not edit files unless asked ») |
| Rejeter un changement | **Non dans Review.** Ops : `refresh`, `updateFilter`, `recordedDiff`, `switchCheckout`, `switchWorktree`, `retarget`, `reviewAgents`, `reviewWithAgent`, `prTick`, `prFileDiff` | `src/panels/review/session.ts:419-430`, `src/panels/review/contract/types.ts:146-165` |

Preuve de l'absence : `grep -niE "comment|revert|discard|restore|undo|reject"` sur `src/panels/review/` et `src/shells/desktop/ui/panels/review/` ne rend que des codes de refus d'opération (`session.ts:80`, `:155`, `:159`, `:276`, `:376`, `pullRequest.ts:186`) et le commentaire de `PullRequestView.tsx:1`. Aucune action sur un diff.

**Ce qui existe ailleurs, pour « jeter » (#174) :**

- Rejeter un fichier : `vcs.discardFile`, depuis la vue de comparaison Git, pas depuis Review. `src/shells/desktop/ui/workspace/repository/GitComparisonView.tsx:60`, capacité `src/workspace/repository/contract/capability.ts:68`.
- Retirer un worktree, avec ou sans sa branche : `src/workspace/repository/contract/capability.ts:98` (`worktreeRemove`).
- Créer une PR, lire son état : `capability.ts:111-112`. **Aucune méthode pour fermer une PR** dans cette capacité : « PR fermée » passe par `gh pr close`, côté `agence`.
- Renvoyer un retour à l'agent qui a écrit le code : `cate agent send`, accès `control`, `src/services/agents/contract/api.ts:135-144`.
- La carte « jeter » (lot 7) existe déjà dans `agence`, sans toucher `src/` : `tools/agence/agence.py:798` (`need jeter`), `:1555` (`carte_jeter`), `:1497` (clic), tests `tools/agence/test_jeter.py`.

**Conclusion T001.** Le geste « commenter et renvoyer à l'agent » n'existe pas dans Review. Il est atteignable sans code dans `src/` : l'humain ou `agence` écrit le retour, `cate agent send` le livre. Ajouter des commentaires de diff au panneau serait du code `src/` (009 FR-013) : hors périmètre, à ne proposer qu'en issue upstream si le besoin se confirme.

## T002 : ce que fait déjà `cate browser`

**Les commandes `cate browser` ne rendent ni sélecteur, ni HTML, ni capture d'un élément. Mais le panneau Browser a déjà un bouton « montrer un élément » qui envoie le sélecteur, le rôle, le texte et la boîte aux agents reliés.**

| Capacité demandée par US8 | État | Preuve |
|---|---|---|
| Un élément s'adresse par | id d'instantané, `[x,y]` ou `--role`/`--name` ; `find` rend id, rôle, nom | `src/services/browser/contract/api.ts:101,184`, `src/services/browser/contract/automation.ts:30-37` |
| Sélecteur CSS d'un élément (par commande) | **Non** | `api.ts:184` (`find`), `:185-188` (`attr`) |
| HTML d'un élément (par commande) | **Non.** `attr` lit un attribut nommé | `api.ts:185-188`, `src/services/browser/desktop/pageDriver.ts:1580-1584` (`getAttribute`) |
| Capture d'un élément | **Non.** `screenshot` capture la fenêtre visible puis la redimensionne au viewport | `api.ts:183`, `pageDriver.ts:1279-1282` |
| L'humain montre un élément (bouton du panneau) | **Oui, sans HTML ni capture** : sélecteur, rôle, texte (200 car. max), boîte | `src/services/browser/contract/pickedElement.ts:9-18,35-52`, `src/services/browser/client/showElement.ts:14-22`, `pageDriver.ts:334` (`pickElement`, surcouche d'inspection `Overlay.setInspectMode`), `src/shells/desktop/ui/panels/browser/BrowserView.tsx:452-470` |
| Destinataire | les panneaux reliés au navigateur, via `agents.send` | `showElement.ts:15-22`, `panelsLinkedTo` (`pickedElement.ts:56-63`), `BrowserView.tsx:460-463` |
| Garde-fou de contenu | HTML, capture et valeur d'un champ exclus **par conception** | `pickedElement.ts:1-3`, `pageDriver.ts` (commentaire « never textContent » dans `pickElement`) |
| Écouteurs `pointerdown` / `keydown` de la page invitée | Servent seulement à annuler une automatisation en cours, pas à montrer un élément | `src/services/browser/desktop/preload/guest.ts:78-81` |

**Écart de la spec.** US8 demande « sélecteur, HTML et capture ». Le code fait le sélecteur (plus rôle, texte, boîte). HTML et capture manquent, et le contrat les exclut exprès (`pickedElement.ts:3`). SC-007 (« `git diff --stat origin/main -- src` reste vide ») et FR-010 (« ne pas ajouter de code dans `src/` sans décision écrite ») sont déjà dépassés par #186 : le code `src/` du bouton est sur `main`. Non vérifié : si une décision écrite l'autorisait (aucune trouvée dans `specs/013-ajouts-veille/`).

**Voie retenue pour le clic navigateur : une issue chez upstream**, pour le geste complet (HTML borné et capture de l'élément). Raisonnement :

- **Skill seul : non.** Aucune commande ne renvoie le choix de l'humain à l'agent ; un skill qui demande de coller un sélecteur à la main n'aide pas un intégrateur non dev.
- **Panneau perso : non, non vérifié.** Je n'ai pas lu le code des panneaux perso (`panneau-perso` n'a pas été ouvert). Il ne verrait pas non plus les éléments de la page invitée sans le pont du navigateur de Cate, que seul le code `src/` expose.
- **Issue upstream : oui**, pour la part qui reste (HTML, capture). Le sélecteur est déjà dans le fork (#186) ; l'écart avec upstream (009 FR-013) est déjà pris pour lui. Une issue upstream ne coûte rien au fork et lui fournit la suite, si elle est acceptée. Coût : 0 € par mois.

Q5 reste à Heifara ; la voie ci-dessus est ma recommandation pour T080.

## T003 : l'attente, ce qui est livré dans #100

Source : issue #100 (ouverte), `skills/orchestrateur/SKILL.md:30-32`, mesure du lot 5 plus bas.

| Piste de #100 | État | Preuve |
|---|---|---|
| 1. `cate agent wait` en tâche de fond | **Livrée** (filet, à 600 s, jamais en boucle d'avant-plan) | `skills/orchestrateur/SKILL.md:30` ; plafond d'attente 600 s : `src/services/agents/contract/api.ts:20-21` |
| 2. Ne pas attendre : les rapports arrivent par `cate agent send` | **Livrée** (consigne du skill : « termine ton tour ») | `skills/orchestrateur/SKILL.md:30` |
| 3. Session neuve par vague, `/compact` avant l'attente | **Partielle** : le skill demande de lire la jauge et de compacter vers 150 000 jetons | `skills/orchestrateur/SKILL.md:32` |
| 4. `agence wait` côté régisseur | **Non vu** dans la CLI ; remplacé par la piste 1 | non vérifié (aucun `agence wait` trouvé dans `tools/agence/agence.py` par grep) |
| 5. Modèle moins cher pour l'attente | **Non livrée**, sans objet : l'attente par événement ne fait plus de tour | non vérifié |

Il reste : les 24 passages d'attente (5,48 % des jetons lus) et les tours forcés par un Stop hook (7,7 %). Voir la mesure du lot 5.

## T004 : options pour Heifara (Q1, Q3, Q7)

Les trois hypothèses de la spec sont **déjà codées** sur `origin/main`. Chaque option dit ce qu'elle coûte à partir de là.

### Q1 : forme du registre durable

| Option | Ce que c'est | Coût de changement |
|---|---|---|
| **A. `docs/decisions.md` généré (Recommandé)** | `agence decision export`, décisions actives triées par date, déterministe, commité par une PR de docs | **Déjà fait** : `tools/agence/agence.py:935-942`, `tools/agence/backlog.py:285` (`registre_md`). 0 €/mois. |
| B. Versionner `decisions.json` lui-même | Restaurable sans perte, illisible en revue ; il faut sortir le fichier de `.cate/tmp/` ou en dupliquer un dans `docs/` | Une migration de chemin et la fin du « fichier généré, jamais édité ». 0 €/mois. |
| C. Les deux (copie lisible + JSON) | Lisible et restaurable | Deux fichiers à garder cohérents. 0 €/mois. |

**Recommandation : A.** Lisible en revue, rien à toucher à l'architecture (le dossier `.cate/` du projet ne contient que `skills.json`, `tmp/`, `worktrees/`, `CLAUDE.md` section State), deux exports du même registre sont identiques. **Limite** : un clone neuf reçoit la copie lisible, pas le registre : `decisions.json` reste dans `.cate/tmp/`, aucune commande d'import n'existe (non vérifié par grep d'une commande `import`). SC-004 est tenu à la lettre ; passer à B ou C si restaurer le registre sur un nouveau poste devient un besoin réel.

### Q3 : garde de plafond, `deny` ou `ask`

| Option | Effet | Coût de changement |
|---|---|---|
| **A. `deny` (Recommandé)** | Le lancement est refusé, message avec vivants et plafond | **Déjà fait** : `tools/agence/agence.py:3388-3404` (`garde_plafond`), branchée à `:3541`. 0 €/mois. |
| B. `ask` | L'humain peut dépasser le plafond d'un clic | Changer `decision('deny', ...)` en `decision('ask', ...)` (`:3403`) et le test de garde. 0 €/mois. |

**Recommandation : A.** Les règles de projet sont des `deny` (`agence.py:3523-3549`), `ask` ne sert qu'à l'envoi au nom de l'humain où son clic est le but (`:3433`). Le plafond existe parce que 13 agents ont forcé un force quit sur un Mac de 24 Go (mémoire du projet) : un `ask` laisse la porte du « oui » machinal. La sortie de secours est le réglage `agents.max` par l'humain, que les agents ne peuvent pas relever (non vérifié sur cette base : le refus de `agence pratiques set` aux agents est cité par `research-lot0.md` à `agence.py:2446-2447` sur l'ancienne base). **Risque résiduel** : un compte périmé trop haut refuse à tort jusqu'au tour suivant du régisseur ; le message cite « dernier compte publié par le régisseur » (`:3403`). Compte illisible : aucune décision, avertissement (`:3394-3399`).

### Q7 : défaut de la validation du plan

| Option | Effet | Coût de changement |
|---|---|---|
| **A. `jamais` partout (Recommandé)** | Aucun arrêt ajouté | **Déjà fait** : `tools/agence/pratiques.json:59` (clé), `:97` (neutre), `:107` (pr-tdd) ; brief : `tools/agence/backlog.py:444-456`. |
| B. `structurante` dans `pr-tdd` seulement | Un arrêt sur les fiches liées à une décision structurante, dans le préréglage strict | Une valeur à changer à `pratiques.json:107` ; le calcul est déjà sans modèle (`backlog.py:456`). |
| C. `structurante` partout | Un arrêt sur ces fiches, par défaut | Une valeur à changer aux deux préréglages. Ajoute du temps actif humain avant mesure. |

**Recommandation : A**, puis B après le premier benchmark. Le critère du benchmark est le temps actif humain (009 FR-011) : un arrêt ajouté sans mesure contredit « mesurer avant et après ». `toujours` est le pire cas (un arrêt par fiche). Correction de l'ancienne recherche : elle proposait `structurante` dans `pr-tdd` ; sur `main`, `pr-tdd` vaut aussi `jamais` (`pratiques.json:107`). Le gain de B n'est pas mesuré.

## Lot 5 : part de l'attente après #100 (T050, T051, #176)

### Mesure (T050)

Outil : `python3 -I tools/agence/attente_mesure.py <dossier>`, en lecture seule, sur une copie des 5 journaux de session les plus récents du projet cate (dossier des journaux Claude Code du projet, sans `--usage-json`), modifiés du 2026-11-20 16:43 au 2026-11-21 01:37 (heure de Paris). Même méthode que `specs/006-cout-attente-orchestrateur/mesure.md` (avant), même outil que son lot 1.

| Indicateur | Avant (006, 10 sessions, 18 au 20/11) | Après (5 sessions, 20 et 21/11) |
|---|---|---|
| Tours, jetons lus | 1 730 tours, 442,7 M | 514 tours, 111,1 M |
| Passages d'attente (part des jetons lus) | 97 passages, 11,35 % | 24 passages, 5,48 % |
| Jetons lus par passage (médiane) | 362 028 | 193 551 |
| Tours forcés par un Stop hook | 131 tours, 13,9 % | 35 tours, 7,7 % |
| Contexte médian par tour | 220 140 | 186 934 |
| Appels `agent wait` | 96, dont 95 à 60 s | 24 : 17 entre 300 et 570 s, 6 entre 45 et 120 s, 1 sans délai |
| Durée totale des appels d'attente | non relevée | 4 967 s, soit 207 s par appel en moyenne |

Sortie brute de l'outil (après) : `passages_attente.part: 0.0548`, `stop_hook.part: 0.077`, `appels_attente.duree_s: 4967`, `appels_attente.passages_par_10min: 2.8991`, `contexte.mediane: 186933.5`.

### Lecture

- L'attente par événement de #100 a divisé par deux la part des passages d'attente (11,35 % vers 5,48 %) et le coût d'un passage (contexte plus petit).
- Il reste une boucle : 24 passages, 5,48 % des jetons lus. Mais un appel dure 207 s en moyenne pour un délai demandé de 300 à 570 s dans la plupart des cas : la majorité des attentes se terminent sur un événement (un agent rapporte ou finit), pas sur leur délai.
- Un recul exponentiel ne réduit que les réveils dus au délai. Ici les délais sont déjà proches du plafond de 10 min de l'outil Bash, et la plupart des réveils viennent d'un événement : le gain est borné bien au-dessous de 5,48 %, sans doute proche de zéro.
- Le reste le plus lourd n'est pas l'attente mais les tours forcés par un Stop hook (7,7 %) : le skill orchestrateur interdit déjà un `/goal` qui dépend d'un clic, d'un merge ou d'un agent (`skills/orchestrateur/SKILL.md:31`), et la consigne n'est pas toujours suivie.

### Proposition (T051)

- Ne pas coder de recul exponentiel : la mesure ne montre aucun reste qu'il réduirait (FR-006). Proposer de fermer #176 comme sous-tâche de #100, cette mesure citée (hypothèse Q2 de la spec).
- Piste séparée, hors de ce lot et non codée : une garde qui refuse un `/goal` dans le panneau orchestrateur viserait les 7,7 % restants. À trancher par l'humain.

### Non vérifié

- Que les 5 journaux soient tous des sessions d'orchestrateur : le dossier du projet mêle orchestrateur et interlocuteur ; sans `--usage-json`, l'outil ne trie pas par panneau.
- La qualité (FR-006) : aucune comparaison de résultat entre les deux périodes, seul le coût est mesuré.

## Non vérifié (lot 0)

- Aucun comportement lancé : tout vient de la lecture du code de `ca3e0662`. L'interface de Review et le bouton « montrer un élément » n'ont pas été vus à l'écran.
- Le code des panneaux perso (`panneau-perso`) : non lu ; la voie « panneau perso » est écartée sur raisonnement, pas sur preuve.
- Une décision écrite qui autorise le code `src/` du bouton (FR-010) : aucune trouvée dans `specs/013-ajouts-veille/`, hors des autres specs non relues.
- `agence wait` (piste 4 de #100) : seulement un grep sans résultat.
- Le refus aux agents de `agence pratiques set` (sortie de secours de Q3) : cité d'après l'ancienne recherche, pas relu sur cette base.
- L'acceptation d'une contribution upstream : aucun contact pris.
