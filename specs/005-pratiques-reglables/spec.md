# Feature Specification: Pratiques réglables par dev (le fork suit le flux du dev, pas celui de Heifara)

**Feature Branch**: `docs/spec-pratiques-reglables`

**Created**: 2026-11-20 (besoin n495, base `origin/main` `455a23b2`)

**Status**: Draft. Spec d'abord, aucune ligne de code produit. Questions ouvertes en fin de document, chacune avec son hypothèse de travail.

**Input**: cap produit décidé par Heifara : le fork doit servir **n'importe quel dev**, dont les pratiques diffèrent des siennes. Max, un collègue, est le premier dev qui n'est pas Heifara. Aujourd'hui l'orchestrateur impose en dur le flux de Heifara : merge par rebase, jamais de push sur `main`, un vérificateur différent par implémenteur, `--done-when` limité à deux formes, jeton Slack lu dans un fichier de Hermes, deux skills personnels activés par défaut dans le cercle. `audit.md` (même dossier) le relève ligne par ligne, avec sa source.

Liens :
- [`audit.md`](audit.md) : l'entrée de cette spec. Chaque occurrence a son chemin:ligne et son lot.
- Spec `002-orchestrateur-portable` : le nom de l'humain (`nom()`), les gardes, `doctor --prerequis`. Points de contact dans `plan.md`.
- Spec `004-cercle-vertueux` : la table `declencheurs.json`, dont les commandes sont des skills de Heifara.
- Constitution du fork : II (déclarer une fois), III (coupes nettes), VI (tests d'abord), VII (le plus simple), IX (écart minimal avec upstream).

## Clarifications

### Session 2026-11-20

- Q: Quel périmètre ? → A: les **pratiques de flux** d'un dev qui code avec des agents : branche et PR ou `main`, merge, issue, TDD, spec-kit, vérification croisée, preuve de fin, plafond d'agents. Hors périmètre (cap produit) : métiers non dev, carrousel de décisions, zoetrope, autres forges que GitHub, autre agent que Claude Code, langue des textes.
- Q: Qu'est-ce qui n'est pas réglable ? → A: les **invariants de sécurité** : seul le clic de l'humain envoie en son nom ; aucun agent ne merge, ne pousse ni ne force-push (sauf le `--force-with-lease` d'un rebase demandé) ; aucun secret dans la politique ; une preuve est exigée pour passer un besoin en fait. Ils ne figurent pas dans le schéma : aucun réglage ne peut les lever.
- Q: Le flux de Heifara reste-t-il disponible ? → A: oui, comme **preset** livré par le fork, nommé par ses pratiques (`pr-tdd`) et non par une personne : rien de personnel dans le code (critère SC-002 de la spec 002). Ses chemins personnels (fichier du jeton Slack) vivent dans son fichier de dev, jamais dans le fork.

## Vocabulaire

- **Politique** : l'ensemble des valeurs effectives des réglages, calculé à chaque lecture.
- **Réglage** : une clé du schéma (`livraison.mode`, `issue`, ...) avec ses valeurs permises.
- **Preset** : un jeu de valeurs nommé, livré dans `tools/agence/pratiques.json`. `neutre` est le défaut.
- **Fichier du projet** : `<racine>/.cate/tmp/agence/pratiques.json`. **Fichier du dev** : `~/.config/agence/pratiques.json`. Les deux sont du JSON éditable à la main, écrit par la seule CLI `agence pratiques`.
- **Invariant** : une règle de sécurité qui n'est pas un réglage.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Un dev règle son flux et l'orchestrateur le suit (Priority: P1)

Max ouvre un dépôt orchestré. Il tape `agence pratiques preset neutre`, puis `agence pratiques set tests tdd` pour ce projet. L'orchestrateur lit la politique au démarrage, rédige ses briefs d'après elle (TDD demandé, spec-kit non proposé), et ne pose plus de question de merge en rebase si Max a réglé `squash`.

**Why this priority**: c'est le cap produit. Sans lui, le fork reste l'outil d'une seule personne.

**Independent Test**: faux HOME, dépôt jetable, `agence pratiques set livraison.methode squash`, un besoin `pr` et une question `--merge` ; la commande passée à `gh` contient `--squash` et jamais `--rebase`.

**Acceptance Scenarios**:

1. **Given** aucun fichier, **When** `agence pratiques show`, **Then** les valeurs du preset `neutre` s'affichent, chacune avec sa source (`défaut`, `dev`, `projet`).
2. **Given** `agence pratiques set tests tdd` dans un projet, **When** `agence pratiques brief`, **Then** le bloc rendu contient l'exigence « test rouge d'abord, vu en échec avant le code » et la source du réglage.
3. **Given** `livraison.methode` à `squash`, **When** l'humain clique Merger, **Then** `gh pr merge` reçoit `--squash`.
4. **Given** `livraison.merge` à `dehors`, **When** l'orchestrateur lance `agence ask --merge o/r#7`, **Then** la CLI refuse (code 2) en citant `livraison.merge` ; la question sans `--merge` reste possible.
5. **Given** un fichier qui contient `"livraisn.mode": "pr"` ou `"tests": "tdd-strict"`, **When** n'importe quelle commande lit la politique, **Then** elle refuse en nommant la clé ou la valeur inconnue, la liste des valeurs permises, et le fichier en cause ; rien n'est écrit.

---

### User Story 2 - La preuve de fin se déduit de la politique (Priority: P1)

Aujourd'hui `--done-when` est un texte libre que seules deux formes rendent utile, et rien ne vérifie la saisie. Avec la politique, `agence need add --kind task` sans `--done-when` reçoit la condition de fin du projet : `ci-green` puis `pr-merged` pour un flux à PR, `report` pour un flux `main` direct. Le besoin ne se ferme pas seul tant que ces conditions ne sont pas vraies, et une saisie hors grammaire est refusée.

**Why this priority**: « fini » veut dire des choses différentes selon le dev ; la preuve est ce qui rend l'orchestration fiable.

**Independent Test**: faux `gh` sur le PATH qui renvoie une PR `MERGED` avec checks verts, puis rouges, puis `OPEN` ; l'état du besoin à chaque tour du régisseur.

**Acceptance Scenarios**:

1. **Given** `preuve = ["ci-verte", "pr-mergee"]` et un besoin lié à la PR 12, **When** les checks sont verts mais la PR ouverte, **Then** le besoin reste ouvert et le suivi dit ce qui manque (« PR non mergée »).
2. **Given** la même politique, **When** la PR est mergée et ses checks verts, **Then** le besoin se ferme avec le lien de la PR comme preuve.
3. **Given** `--done-when "n'importe quoi"`, **When** `need add`, **Then** refus (code 2) qui liste les formes valides.
4. **Given** `preuve = ["rapport"]` (flux `main`), **When** l'orchestrateur lance `need done --evidence "<sortie>"`, **Then** le besoin se ferme ; sans `--evidence`, refus comme aujourd'hui.
5. **Given** `livraison.mode = main` et `preuve = ["pr-mergee"]`, **When** n'importe quelle commande lit la politique, **Then** refus : une preuve de PR n'a pas de sens sans PR.

---

### User Story 3 - Heifara garde son flux, sans rien coder en dur (Priority: P1)

Heifara lance une fois `agence pratiques preset pr-tdd`. Son flux (branche et PR, rebase, issue obligatoire, TDD, spec-kit au-delà d'une journée, vérificateur différent, CI verte puis PR mergée, merge à son clic) devient un preset du fork. Ses chemins personnels (fichier du jeton Slack) vont dans `~/.config/agence/pratiques.json`. Aucune occurrence de Hermes ni de ses skills personnels ne reste dans le code livré.

**Why this priority**: il orchestre tous les jours ; sans preset, le retrait du codé en dur change son flux.

**Independent Test**: `agence pratiques show --json` avec le preset `pr-tdd` et un faux fichier de dev ; les valeurs sont celles du tableau du plan, et le jeton Slack est lu depuis le fichier nommé.

**Acceptance Scenarios**:

1. **Given** le preset `pr-tdd`, **When** `show`, **Then** `livraison.methode` vaut `rebase`, `issue` vaut `obligatoire`, `tests` vaut `tdd`, `verification` vaut `differente`.
2. **Given** `envoi.slack.fichier` pointant un fichier `.env` jetable, **When** un brouillon `slack:` est cliqué, **Then** le jeton est lu dans ce fichier ; sans fichier ni variable, le brouillon reste à valider avec le refus existant.
3. **Given** le fork installé, **When** `grep -rniE "hermes|\.hermes" tools/agence skills src/panels/agence src/shells/desktop/ui/panels/agence` (hors tests), **Then** 0 occurrence.
4. **Given** un `state.json` réel de Heifara (copie) avec un besoin ouvert `doneWhen: "pr-merged:12"` et une clé `maxAgents`, **When** la CLI du fork l'ouvre, **Then** aucune erreur, le besoin reste évalué et `maxAgents` est ignorée, sans réécriture du fichier.

---

### User Story 4 - Le dev voit et change sa politique depuis le panneau (Priority: P2)

Le panneau agence affiche une ligne « Pratiques : pr-tdd (projet) » et, en dépliant, les valeurs et leur source. Un bouton ouvre le fichier du projet dans un panneau éditeur. Une politique invalide s'affiche en bannière, avec la clé en cause.

**Why this priority**: la commande suffit pour que tout marche ; le panneau rend le réglage découvrable.

**Independent Test**: test Vitest du panneau sur un état qui porte `pratiques` ; test de session de l'op « ouvrir le fichier ».

**Acceptance Scenarios**:

1. **Given** un état qui porte `pratiques`, **When** le panneau s'ouvre, **Then** la ligne et les valeurs s'affichent, chacune avec sa source.
2. **Given** un état sans `pratiques` (CLI ancienne), **When** le panneau s'ouvre, **Then** aucune ligne, aucune erreur.
3. **Given** `pratiques.erreur` non vide, **When** le panneau s'ouvre, **Then** une bannière nomme la clé, sans bloquer le reste.
4. **Given** le clic sur « Ouvrir le fichier », **When** la session reçoit l'op, **Then** un panneau éditeur s'ouvre sur `pratiques.json` du projet (créé avec `{}` s'il n'existe pas) ; la vue ne lit ni n'écrit aucun fichier.

### Edge Cases

- Fichier du dev absent, fichier du projet absent : preset `neutre`, sans erreur (cas normal d'un dev qui n'a rien réglé).
- JSON invalide ou non objet : refus en nommant le fichier et la position ; le régisseur continue avec `neutre` et publie l'erreur, il ne s'arrête pas.
- Valeur permise mais combinaison incohérente (`main` avec `pr-mergee`, `merge: clic` avec `main`) : refus à la lecture, jamais à l'usage.
- Un dépôt cloné ne peut rien imposer : le fichier du projet est sous `.cate/tmp/`, ignoré par git (`.cate/.gitignore` : `*`). Une politique ne voyage pas avec le dépôt.
- Deux worktrees du même dépôt : même fichier (la racine est celle du dépôt principal, comme `state.json`).
- `$HOME` absent ou non lisible : le fichier du dev est traité comme absent.
- Un besoin ouvert au moment du changement de politique garde sa `doneWhen` déjà écrite ; seuls les besoins créés ensuite prennent la nouvelle valeur par défaut.
- `agence pratiques set` concurrent depuis deux terminaux : verrou `fcntl` et écriture atomique, comme `tx()` pour l'état.
- Un agent tente `agence pratiques set` ou d'éditer `pratiques.json` : refusé par la garde `pages` (FR-005) ; sans gardes installés, le panneau le signale déjà (bannière de la spec 002) et la protection est celle de `state.json`, pas plus.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: La politique MUST se calculer à chaque lecture, dans l'ordre : preset `neutre`, preset du fichier du dev, valeurs du fichier du dev, preset du fichier du projet, valeurs du fichier du projet. La dernière source gagne, clé par clé.
- **FR-002**: Le schéma, les valeurs permises, les défauts et les presets MUST être déclarés **une seule fois**, dans `tools/agence/pratiques.json` (constitution II). Le validateur, `show`, `brief`, `doctor` et le panneau en dérivent ; aucune liste de clés ni de valeurs n'est recopiée dans le code.
- **FR-003**: Une clé inconnue, une valeur hors liste, un type faux ou une combinaison incohérente MUST faire refuser la lecture (code 2) avec le fichier, la clé et la liste des valeurs permises. Rien n'est ignoré en silence.
- **FR-004**: `agence pratiques show [--json]` MUST rendre chaque valeur effective avec sa source ; `set <clé> <valeur>` et `unset <clé>` écrivent le fichier du projet (`--dev` : celui du dev) après validation du résultat ; `preset <nom>` pose le preset ; `check` valide les deux fichiers sans rien écrire ; `brief` imprime le bloc de pratiques à coller dans un brief. Écriture atomique, verrou, sauvegarde non nécessaire (fichier à l'humain, éditable à la main).
- **FR-005**: Les **invariants** MUST rester hors schéma : aucune clé ne peut autoriser un envoi sans clic, un merge ou un push par un agent, un secret dans la politique, ni un besoin fait sans preuve. La garde `agence guard --mode pages` MUST refuser à un agent d'écrire `pratiques.json` (outils d'écriture) et de lancer `agence pratiques set|unset|preset` : même protection que `state.json`, active quand les gardes sont installés (spec 002).
- **FR-006**: `livraison.methode` MUST fixer la méthode passée à `gh pr merge` et le libellé du bouton Merger. `livraison.merge` à `dehors` MUST faire refuser `agence ask --merge` ; le besoin lié à la PR se ferme déjà quand GitHub la dit mergée.
- **FR-007**: `envoi.slack.variable` et `envoi.slack.fichier` MUST remplacer `HERMES_ENV` et `~/.hermes/.env` ; la politique ne porte jamais le jeton, seulement le nom de la variable et le chemin du fichier.
- **FR-008**: `agents.max` MUST remplacer `MAX_AGENTS` ; `agence start --max-agents N` écrit `agents.max` dans le fichier du projet ; la clé `maxAgents` de l'état n'est plus lue.
- **FR-009**: `--done-when` MUST suivre une grammaire fermée : conditions séparées par une virgule parmi `pr-merged:N`, `issue-closed:N`, `ci-green:N`, `tests-local`, `report`, `draft-sent:ID` (interne). `need add` refuse toute autre forme. Sans `--done-when`, un besoin `task` reçoit la condition dérivée de `preuve` et du mode de livraison, la PR étant rattachée plus tard par `agence need pr <besoin> <N>`.
- **FR-010**: Les conditions machine (`pr-merged`, `issue-closed`, `ci-green`) MUST fermer le besoin seules quand elles sont toutes vraies ; les conditions humaines (`tests-local`, `report`) MUST exiger `need done --evidence`, refusé tant qu'une condition machine reste fausse. `ci-green` lit `statusCheckRollup` déjà lu pour griser Merger, sans appel `gh` de plus.
- **FR-011**: `issue` à `obligatoire` MUST faire refuser `need add --kind task` sans `--issue N` ; `tests`, `speckit` et `verification` MUST apparaître dans `agence pratiques brief` sous forme d'exigences nommées, et le skill `orchestrateur` MUST coller ce bloc dans chaque brief au lieu de les écrire en dur.
- **FR-012**: `agence doctor --prerequis` MUST ajouter un point `pratiques` (valide ou erreur, `info` si aucun fichier) et rendre `gh` bloquant seulement si la politique a besoin de GitHub.
- **FR-013**: `watch` MUST écrire `st['pratiques']` à chaque tour (valeurs, sources, erreur éventuelle) ; un état sans la clé reste valide. Le panneau MUST l'afficher (User Story 4) ; la vue ne lit pas les fichiers.
- **FR-014**: La table `declencheurs.json` MUST perdre le champ `actif` ; `declencheurs.actifs` (liste d'identifiants) MUST le remplacer, défaut `["T1"]`, T2 et T3 dans le preset `pr-tdd`. (Contact avec la spec 004 : Q5.)
- **FR-015**: Coupes nettes (constitution III) : aucune migration, aucun alias de l'ancien nom de variable ou de clé. Une première lecture sans fichier donne `neutre` ; le flux de Heifara demande une commande, une fois (`agence pratiques preset pr-tdd`).
- **FR-016**: Chaque lot MUST commencer par ses tests rouges ; les chemins qui lancent `gh` se testent avec un faux exécutable sur le PATH (constitution VI).

### Key Entities

- **Politique** : valeurs effectives + source de chacune ; jamais stockée, recalculée.
- **Preset** : nom, description d'une ligne, valeurs ; données de `pratiques.json`.
- **Condition de fin** : une forme de la grammaire FR-009 ; stockée dans `doneWhen` du besoin.
- **Fichier de politique** : objet JSON imbriqué, `{ "preset": "<nom>", "livraison": { "methode": "squash" }, "tests": "tdd" }`. Une seule forme acceptée ; la CLI désigne une clé par son chemin pointé (`livraison.methode`).

## Success Criteria *(mandatory)*

- **SC-001**: Un dev qui n'est pas Heifara passe de « fork installé » à « flux réglé » en une commande (`agence pratiques preset <nom>`) et 0 fichier édité à la main.
- **SC-002**: 0 occurrence de `hermes`, `.hermes` ou `HERMES_ENV` dans le code livré (`tools/agence`, `skills/orchestrateur`, `src/panels/agence`, `src/shells/desktop/ui/panels/agence`) hors tests ; 0 occurrence de `--rebase` en dur dans `agence.py`.
- **SC-003**: 100 % des clés du schéma ont un test de refus (valeur hors liste) et un test de source (`défaut`, `dev`, `projet`).
- **SC-004**: `--done-when` : 100 % des saisies hors grammaire sont refusées ; les 6 formes de la grammaire ont chacune un test d'évaluation sur faux `gh`.
- **SC-005**: Le preset `pr-tdd` reproduit le flux de Heifara : la liste de ses 12 valeurs est figée dans un test, et le flux actuel (merge en rebase, TDD, issue obligatoire) se retrouve par `show`.
- **SC-006**: `npm run test:agence`, `typecheck`, `lint`, `lint:deps` et `npm test` verts après chaque lot ; aucun de ces lots ne grossit `agence.py` de plus de 150 lignes (la logique va dans `pratiques.py`).
- **SC-007**: Coût : 0 € par mois, 0 jeton (aucun appel à un modèle ; la politique se lit dans des fichiers). Gain en jetons : non chiffré.

## Assumptions

- Les agents lisent la politique par `agence pratiques brief`, collé dans leur brief par l'orchestrateur ; ils ne la lisent pas eux-mêmes (un seul point de rédaction, un seul texte).
- `neutre` vise un dev qui a déjà GitHub et `gh` : branche et PR, merge au clic en `squash`, issue libre, TDD libre, spec-kit non, vérification libre, preuve dérivée (`pr-mergee`), 4 agents.
- Le fork reste macOS arm64, Python 3.9 stdlib (constitution VIII, tests sous `/usr/bin/python3`).
- La langue des textes reste le français (Q4).
- Écart avec upstream : aucun dans `src/` sauf le panneau agence (déjà un écart du fork) ; tout le reste vit sous `tools/agence/`, `skills/` et `docs/` (constitution IX).

## Questions ouvertes

Chacune a une hypothèse de travail, écrite dans la spec, qui tombe si la réponse change.

- **Q1** : où vit la politique ? Hypothèse : **deux fichiers hors dépôt** (projet sous `.cate/tmp/agence/`, dev sous `~/.config/agence/`), priorité projet puis dev puis `neutre`. Écartés : une tranche `defineSettings` (le schéma serait écrit deux fois, en TypeScript et en Python, contre FR-002 ; la CLI n'a pas d'API pour écrire les réglages du workspace sans devenir second écrivain de `settings.json`) ; un fichier commité dans `.cate/` (décision D5 de `docs/architecture.md` : le dépôt ne porte que `skills.json`, `tmp/`, `worktrees/` ; et un dépôt cloné imposerait son flux). Si Heifara veut une politique partagée par l'équipe dans le dépôt, c'est un amendement de D5 et de `.cate/.gitignore`, à décider avant le lot 1.
- **Q2** : nom du preset de Heifara. Hypothèse : `pr-tdd` (décrit des pratiques, pas une personne, donc rien de personnel dans le fork). Alternative : `heifara` comme nom de preset, pas comme clé de code. Choix à lui.
- **Q3** : mode `main` direct (POC, projets perso). Hypothèse : l'agent commit sur la branche de base du checkout, sans worktree ni PR ; **le push reste l'acte de l'humain** (invariant), preuve `report` avec le SHA. Un bouton « Pousser » dans le panneau serait une nouvelle action : hors v1. À confirmer.
- **Q4** : langue des textes. Hypothèse : le français reste imposé (Max est francophone), hors périmètre ; la spec ne crée pas de mécanisme de langue. À rouvrir à l'arrivée d'un dev non francophone.
- **Q5** : `declencheurs.actifs` touche la spec 004 (`declencheurs.json`, `test_declencheurs.py`, l'évaluateur de `agence.py`). Hypothèse : la tâche vit dans le lot 4 de cette spec, après le merge des lots 3 et 4 de la spec 004 ; si 004 est en cours au même moment, elle passe à 004 et le lot 4 de 005 la retire.
- **Q6** : `tests-local` n'est pas vérifiable par la CLI (elle ne relance pas les tests). Hypothèse : preuve **déclarée** (`need done --tests "<commande>=<code>"`), affichée « déclaré, non revérifié » dans le suivi. Alternative : retirer `tests-local` de la v1, la preuve `report` suffisant.
- **Q7** : valeurs par défaut de `neutre` : `squash` (le seul mode que tout dépôt GitHub autorise par défaut), `verification: libre` (la vérification croisée double le coût en agents), `agents.max: 4`. Aucune n'est mesurée ; coût en jetons : non chiffré.
- **Q8** : un dev qui change de preset en cours de projet : les besoins ouverts gardent leur `doneWhen`. Hypothèse suffisante ; une commande de re-dérivation serait un ajout hors demande.
- **Q9** : la spec 006 (coût de l'attente) signale deux valeurs qui pourraient devenir des réglages : le plafond du filet de 600 s et le seuil de `/compact`. Hypothèse : **non retenus en v1**. Le filet est une constante de plateforme, pas une pratique de dev ; le seuil de `/compact` est une ligne de `declencheurs.json` (spec 004). Ajouter une clé plus tard coûte une entrée de `pratiques.json` et un test.
