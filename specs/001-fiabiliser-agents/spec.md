# Feature Specification: Fiabiliser l'orchestration d'agents

**Feature Branch**: `feat/speckit-fiabiliser-agents`

**Created**: 2026-11-18

**Status**: Draft

**Input**: User description: "Fiabiliser l'orchestration d'agents du fork Cate : une seule spec, 6 récits indépendants (plafond de 4 agents, contrôle de relance, balayage des panneaux orphelins, clone de node_modules, gabarit de brief, hook anti-fenêtre)."

## Contexte

Le 2026-11-18, une journée d'orchestration a révélé quatre pannes sur un Mac de 24 Go :

- 13 agents vivants ont forcé un force quit de Cate. Le plafond valait 8 et ignorait les agents en attente de saisie, qui gardent environ 400 Mo chacun.
- Après ce plantage, 14 terminaux « sans agent » sont restés ouverts. Personne ne les balaie.
- 16 worktrees d'agents sur 43 ont lancé `npm ci` ou `npm install` en parallèle, parce qu'un worktree neuf n'a pas de `node_modules`.
- Des agents ont lancé 18 fois `npx playwright test` par-dessus le travail de l'humain, malgré la consigne « aucune fenêtre » qui ne figure pas dans le gabarit de brief.

Six récits indépendants y répondent. Chacun se livre et se vérifie seul. Les récits 1 à 3 modifient la CLI `agence` (`tools/agence/`), le récit 4 le code de création de worktree du fork (`src/`), les récits 5 et 6 le setup personnel de l'humain (`~/.claude`, hors du fork).

## Clarifications

### Session 2026-11-18

- Q: Après un plantage, quel terminal est « orphelin » ? → A: seulement un terminal sans agent dont le titre suit `#n<chiffres> <rôle>` (réponse de l'humain, besoin n271). Un terminal sans ce titre n'est jamais proposé.
- Q: Où cliquer Fermer ou Garder ? → A: sur la page du régisseur seulement (réponse de l'humain, besoin n273). Le panneau agence n'est pas modifié ; l'offre y apparaît sans bouton, comme l'offre « Supprimer le worktree ».

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Le plafond protège la mémoire (Priority: P1)

L'orchestrateur ne dépasse jamais 4 agents vivants par projet. Un agent en attente de saisie compte comme vivant, parce qu'il garde sa mémoire. Quand une place se libère, l'orchestrateur est prévenu.

**Why this priority**: c'est la cause directe du force quit. Un changement de quelques lignes supprime le risque principal.

**Independent Test**: simuler des listes d'agents (running et waitingForInput) et vérifier le compte, le message « place libre » et le plafond par défaut, sans lancer Cate.

**Acceptance Scenarios**:

1. **Given** un projet sans réglage, **When** on lit le plafond, **Then** il vaut 4.
2. **Given** 2 agents en plein tour et 2 en attente de saisie, **When** le régisseur fait un tour, **Then** le projet est à 4 sur 4 et aucun message « place libre » n'est émis.
3. **Given** 4 agents vivants, **When** un agent disparaît, **Then** l'orchestrateur reçoit un seul message « place libre ».
4. **Given** `agence start --max-agents 6`, **When** on lit le plafond, **Then** il vaut 6 et reste à 6 aux démarrages suivants sans option.
5. **Given** un état écrit avant ce changement, sans réglage de plafond, **When** on lit le plafond, **Then** il vaut 4.
6. **Given** la page de suivi, **When** elle s'affiche, **Then** elle dit combien d'agents sont vivants, dont combien en attente, sur le plafond.

---

### User Story 2 - Savoir si on peut relancer Cate (Priority: P2)

L'humain, ou l'orchestrateur pour lui, lance `agence doctor --relance` et lit « oui » ou « non » avec la raison, sans ouvrir plusieurs outils. La commande ne ferme, ne pousse et ne relance rien.

**Why this priority**: la question a été posée 7 fois en deux jours et chaque réponse coûtait un tour d'orchestrateur. Aucune perte de données n'en dépend, d'où P2.

**Independent Test**: avec de faux `cate`, `git` et `gh`, vérifier la réponse dans trois cas (rien en cours, agent en plein tour, commit non poussé) et dans le cas du daemon à build différent.

**Acceptance Scenarios**:

1. **Given** aucun agent en plein tour, aucun worktree sale ou non poussé, aucune PR ouverte et un daemon au même build que l'app, **When** `agence doctor --relance`, **Then** la réponse est « oui ».
2. **Given** 2 agents en plein tour, **When** `agence doctor --relance`, **Then** la réponse est « non » et nomme les 2 agents. Un agent en attente de saisie est cité sans bloquer.
3. **Given** un worktree avec des modifications non commitées ou des commits non poussés, **When** la commande tourne, **Then** la réponse est « non » et nomme le worktree.
4. **Given** une PR ouverte du projet, **When** la commande tourne, **Then** la réponse est « non » et cite la PR.
5. **Given** un daemon dont le build diffère de celui que l'app installerait, **When** la commande tourne, **Then** la réponse dit que les terminaux et les agents s'arrêteront au redémarrage.
6. **Given** l'une des sources illisibles (`cate`, `git` ou `gh` en échec), **When** la commande tourne, **Then** la réponse n'est jamais « oui » : elle dit laquelle n'a pas pu être lue.
7. **Given** n'importe quel cas, **When** la commande se termine, **Then** aucun panneau, branche, fichier d'état ni processus n'a changé.

---

### User Story 3 - Balayer les panneaux orphelins (Priority: P2)

Après un plantage, Cate restaure des terminaux dont l'agent est mort. Le suivi les liste et propose à l'humain **Fermer** ou **Garder** pour chacun. Un clic sur Fermer ferme le panneau sans `--discard`.

**Why this priority**: 14 terminaux vides ont encombré le canvas. C'est de l'encombrement, pas une perte, donc P2.

**Independent Test**: avec de faux panneaux et agents, vérifier la liste des orphelins, les panneaux exclus, et l'effet d'un clic Fermer (commande de fermeture sans `--discard`).

**Acceptance Scenarios**:

1. **Given** un terminal titré `#n<chiffres> <rôle>` dont l'agent n'existe plus, détecté sur deux tours du régisseur, **When** le suivi se met à jour, **Then** il apparaît avec Fermer et Garder.
   - **Given** un terminal sans agent dont le titre ne suit pas cette forme, **Then** il n'est jamais proposé.
2. **Given** un panneau lancé par l'orchestrateur et jamais rattaché à un besoin, **When** le suivi se met à jour, **Then** il apparaît avec Fermer et Garder.
3. **Given** l'orchestrateur, le régisseur, le suivi, un panneau rattaché à un besoin ouvert ou un éditeur non enregistré, **When** le balayage tourne, **Then** aucun n'est proposé.
4. **Given** un orphelin proposé, **When** l'humain clique Fermer, **Then** le panneau est fermé sans `--discard` ; si la fermeture est refusée, la ligne le dit et le panneau reste.
5. **Given** un orphelin proposé, **When** l'humain clique Garder, **Then** le panneau reste et n'est plus proposé.
6. **Given** un agent qui vient d'être lancé et n'est pas encore dans la liste des agents, **When** le balayage tourne une seule fois, **Then** son terminal n'est pas proposé.
7. **Given** le balayage, **When** il tourne, **Then** il ne ferme jamais un panneau sans le clic de l'humain.

---

### User Story 4 - Un worktree neuf a déjà ses dépendances (Priority: P1)

Quand Cate crée un worktree, il y copie le `node_modules` de la racine par clone de fichiers APFS. Un agent démarre sans `npm ci`, sans trafic réseau et presque sans disque ni mémoire supplémentaires.

**Why this priority**: 16 installations en parallèle sont une cause de pression mémoire du même incident, et elles se répètent à chaque vague d'agents.

**Independent Test**: test unitaire sur dossiers temporaires et dépôt git temporaire, avec et sans `node_modules`, lockfile identique ou différent, copie en échec. Vérification manuelle des modules natifs dans une copie, hors suite automatique.

**Acceptance Scenarios**:

1. **Given** une racine avec `node_modules` et un lockfile identique à celui du worktree à créer, **When** le worktree est créé, **Then** il contient `node_modules`.
2. **Given** une racine sans `node_modules`, **When** le worktree est créé, **Then** il est créé sans erreur et sans `node_modules`.
3. **Given** un lockfile différent entre la racine et le worktree, **When** le worktree est créé, **Then** rien n'est copié et aucune erreur n'est levée.
4. **Given** une copie qui échoue, **When** le worktree est créé, **Then** la création réussit, sans `node_modules` partiel laissé en place.
5. **Given** un worktree qui a déjà un `node_modules`, **When** il est créé, **Then** il n'est pas écrasé.
6. **Given** la copie, **When** `node-pty` et `@parcel/watcher` sont chargés depuis elle, **Then** ils fonctionnent (vérification avant livraison).

---

### User Story 5 - Le gabarit de brief interdit les fenêtres (Priority: P3)

Le gabarit de brief du skill `orchestrateur` interdit explicitement de lancer Playwright, Electron ou l'app Cate et d'ouvrir une fenêtre. Il demande en fin de rapport « HEAD `<sha>`, poussé : oui ou non ».

**Why this priority**: une ligne de texte, effet immédiat sur tout brief futur, mais sans garantie dure (voir le récit 6).

**Independent Test**: lire le gabarit : l'interdit figure dans la ligne `Interdit`, la ligne HEAD figure dans le rapport de fin, et le reste du gabarit est inchangé.

**Acceptance Scenarios**:

1. **Given** le gabarit, **When** on lit sa ligne `Interdit`, **Then** elle contient « lancer Playwright, Electron ou l'app Cate, ouvrir une fenêtre ».
2. **Given** le gabarit, **When** on lit la ligne `Fin`, **Then** le rapport demande « HEAD `<sha>`, poussé : oui ou non ».
3. **Given** le skill, **When** on lit sa règle du plafond d'agents, **Then** elle dit 4 et compte les agents en attente de saisie, comme le récit 1.

---

### User Story 6 - Un hook bloque les fenêtres dans les worktrees d'agents (Priority: P3)

Un hook `PreToolUse` sur `Bash` refuse `playwright test`, `npm run test:e2e`, `electron` et `npm run dev` quand le dossier courant est sous `.cate/worktrees/`. La sortie de secours `ALLOW_E2E=1` les autorise. Une consigne oubliée devient une garantie.

**Why this priority**: les 18 lancements ont tous eu lieu dans des worktrees d'agents. P3 parce que le récit 5 couvre déjà la plupart des cas et qu'aucune récidive n'a été vue depuis.

**Independent Test**: les cas de test du hook (bloqué, autorisé, sortie de secours, hors worktree) passent par `python3 ~/.claude/setup/check.py`.

**Acceptance Scenarios**:

1. **Given** un dossier courant sous `.cate/worktrees/`, **When** l'agent lance `npx playwright test x`, `npm run test:e2e`, `electron .` ou `npm run dev`, **Then** le hook refuse avec un message qui nomme la sortie de secours.
2. **Given** le même dossier, **When** l'agent lance `npx vitest run`, `npm run typecheck`, `npm run lint` ou `grep playwright fichier`, **Then** le hook laisse passer.
3. **Given** un dossier hors `.cate/worktrees/`, **When** la commande bloquée ailleurs est lancée, **Then** le hook laisse passer.
4. **Given** `ALLOW_E2E=1` devant la commande, **When** elle est lancée dans un worktree, **Then** le hook laisse passer.
5. **Given** une commande qui cite seulement le mot (message de commit, `grep`, texte), **When** elle est lancée, **Then** le hook laisse passer.

### Edge Cases

- Récit 1 : `waitingForInput` sans `canReceivePrompt` (agent bloqué sur une permission) compte comme vivant. L'orchestrateur, le régisseur et un panneau `agence` ne comptent pas.
- Récit 2 : un worktree sans upstream compte comme « non poussé ». Une PR ouverte d'un autre auteur du dépôt est citée mais décrite comme telle. `gh` absent rend « non », jamais « oui ».
- Récit 3 : un terminal de l'humain sans titre de besoin ne doit jamais être proposé si le critère retenu est le titre. Un orphelin gardé ne revient pas au tour suivant. Un panneau déjà fermé entre le tour et le clic ne provoque pas d'erreur.
- Récit 4 : lockfile absent des deux côtés, liens symboliques dans `node_modules`, racine elle-même en worktree, disque sans APFS (la copie échoue : aucun effet).
- Récit 6 : le hook lit toute la commande, y compris un heredoc ou un message de commit : seule une commande qui lance réellement l'outil est bloquée. Les appels MCP Playwright ne sont pas couverts.

## Requirements *(mandatory)*

### Functional Requirements

**Récit 1 : plafond**

- **FR-001**: Le plafond d'agents vivants par projet vaut 4 par défaut.
- **FR-002**: Le compte du plafond MUST inclure les agents `running` et `waitingForInput`, et MUST exclure l'orchestrateur et le régisseur.
- **FR-003**: `agence start --max-agents <n>` MUST continuer à régler le plafond du projet, et un état sans réglage MUST prendre le défaut.
- **FR-004**: Le plafond MUST rester consultatif : il prévient l'orchestrateur quand une place se libère et ne bloque pas `cate agent start`.
- **FR-005**: Le suivi MUST afficher le nombre d'agents vivants, dont en attente, sur le plafond. L'aide de `agence start` MUST dire que les agents en attente comptent.

**Récit 2 : relance**

- **FR-006**: `agence doctor --relance` MUST répondre « oui » ou « non » en une première ligne, suivie des raisons.
- **FR-007**: La réponse MUST être « non » dès qu'un agent est en plein tour (`running`), qu'un worktree du projet a des modifications non commitées ou des commits non poussés, ou qu'une PR du projet est ouverte. L'orchestrateur, le régisseur et le terminal qui appelle ne comptent pas. Les agents en attente de saisie sont cités comme information (ils s'arrêtent au redémarrage) et ne bloquent pas.
- **FR-008**: La réponse MUST dire si le daemon redémarrerait (build du daemon du workspace différent du build installé le plus récent) et que ses terminaux et agents s'arrêteraient alors.
- **FR-009**: Une source illisible MUST donner « non » avec le nom de la source, jamais « oui ».
- **FR-010**: La commande MUST être en lecture seule.
- **FR-011**: Le code de retour MUST valoir 0 pour « oui » et 1 pour « non ».

**Récit 3 : balayage**

- **FR-012**: Le régisseur MUST détecter les panneaux orphelins : terminal titré `#n<chiffres> <rôle>` dont l'agent n'existe plus et panneau lancé par l'orchestrateur et jamais rattaché à un besoin.
- **FR-013**: Un panneau MUST être vu orphelin sur deux tours consécutifs avant d'être proposé.
- **FR-014**: Chaque orphelin proposé MUST apparaître au suivi avec **Fermer** et **Garder** sur la page du régisseur. Rien ne se ferme sans clic.
- **FR-015**: Fermer MUST fermer sans `--discard`. Un refus MUST laisser le panneau et le dire sur la ligne.
- **FR-016**: Le balayage MUST exclure l'orchestrateur, le régisseur, le suivi, tout panneau rattaché à un besoin ouvert et tout éditeur non enregistré.
- **FR-017**: Garder MUST retirer l'orphelin de la liste et ne plus le proposer tant que le panneau vit.

**Récit 4 : node_modules**

- **FR-018**: Après `git worktree add`, `addWorktree` MUST copier `node_modules` de la racine dans le worktree par clone de fichiers APFS si, et seulement si, la racine a un `node_modules`, le worktree n'en a pas et les lockfiles de la racine et du worktree sont identiques.
- **FR-019**: Toute condition non remplie ou tout échec de copie MUST laisser la création du worktree réussir, sans erreur remontée et sans `node_modules` partiel.
- **FR-020**: La copie MUST ne pas bloquer la boucle d'événements du daemon.
- **FR-021**: `node-pty` et `@parcel/watcher` MUST se charger depuis une copie ; ce fait MUST être vérifié avant la livraison et le résultat consigné dans la PR.

**Récit 5 : gabarit**

- **FR-022**: Le gabarit de brief du skill `orchestrateur` MUST contenir, dans sa ligne `Interdit`, « lancer Playwright, Electron ou l'app Cate, ouvrir une fenêtre ».
- **FR-023**: Le rapport de fin du gabarit MUST demander « HEAD `<sha>`, poussé : oui ou non ».
- **FR-024**: La règle de plafond du skill MUST dire 4 et compter les agents en attente de saisie, pour rester cohérente avec FR-001 et FR-002.

**Récit 6 : hook**

- **FR-025**: Un hook `PreToolUse` sur `Bash` MUST refuser une commande qui lance `playwright test`, `npm run test:e2e`, `electron` ou `npm run dev`, quand le dossier courant est sous `.cate/worktrees/`.
- **FR-026**: Le hook MUST laisser passer Vitest, typecheck, lint, build, la CI, toute commande qui cite seulement ces mots, et toute commande hors `.cate/worktrees/`.
- **FR-027**: `ALLOW_E2E=1` devant la commande MUST autoriser.
- **FR-028**: Le message de refus MUST nommer la règle et la sortie de secours.
- **FR-029**: Le hook MUST être enregistré dans la configuration des hooks de l'humain et livrer ses cas dans `~/.claude/hooks/tests/cases.json` ; `python3 ~/.claude/setup/check.py` MUST rendre 0 échec.

### Key Entities

- **Agent vivant** : agent d'un projet en état `running` ou `waitingForInput`, hors orchestrateur et régisseur.
- **Plafond** : nombre maximal d'agents vivants d'un projet, réglable par projet.
- **Panneau orphelin** : panneau de l'espace de travail qui n'a plus ni agent ni besoin ouvert qui le justifie.
- **Besoin** : ligne de suivi d'`agence` à laquelle des panneaux sont rattachés.
- **Verdict de relance** : oui ou non, avec la liste des raisons et des sources illisibles.
- **Brief** : texte donné à un sous-agent, dont le gabarit vit dans le skill `orchestrateur`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un projet ne compte jamais plus de 4 agents vivants sans réglage explicite de l'humain.
- **SC-002**: La réponse à « puis-je relancer Cate ? » s'obtient en une commande et moins de 10 secondes, sans ouvrir d'autre outil.
- **SC-003**: Après un plantage, 100 % des terminaux d'agents sans agent sont proposés à la fermeture dans les 2 minutes, et 0 panneau protégé est proposé.
- **SC-004**: Un worktree d'agent neuf démarre ses tests sans installation, dans un cas nominal, en moins de 30 secondes de préparation.
- **SC-005**: Un worktree neuf ne lance plus d'`npm ci` dans les cas où la racine et lui ont le même lockfile.
- **SC-006**: 0 lancement de Playwright, d'Electron ou de `npm run dev` par un agent dans un worktree, sans la sortie de secours.
- **SC-007**: Toutes les suites de tests des périmètres touchés passent : `npm run test:agence`, les tests de `git.ts` et `python3 ~/.claude/setup/check.py`.

## Assumptions

- Le Mac cible est un Apple silicon sous macOS (constitution, principe VIII).
- Les comptes se font à partir de ce que rendent `cate agent list` et `cate panel list`.
- `agence doctor` n'existe pas encore dans le fork : cette fonctionnalité en crée la commande avec le seul contrôle `--relance`. Les autres contrôles prévus par l'issue 29 (lot 3) s'y ajouteront plus tard.
- Le « build de l'app » se lit dans l'install la plus récente (`~/.cate/runtime/current`), celui du daemon dans `runtime.json` du workspace.
- Le plafond est un compte et non une mesure de mémoire : 13 agents à 400 Mo suffisent à expliquer l'incident, et un seuil de mémoire serait bruité.
- Hors périmètre : bloquer `cate agent start` au-delà du plafond, couvrir les appels MCP Playwright par un hook, une commande `agence resume`, changer le CI Windows, modifier `ci.yml`, fermer automatiquement un panneau sans clic.
- Les récits 5 et 6 vivent hors du fork et se livrent par l'humain dans son `~/.claude` ; seule leur spécification est dans ce dépôt.
- Les récits 1 à 3 se font dans `tools/agence/agence.py` et ses tests, par un seul implémenteur. Le récit 4 touche `src/workspace/repository/runtime/git.ts`. Les récits 5 et 6 touchent `~/.claude`. Ces trois lots n'ont aucun fichier commun.
- Les issues du fork correspondantes sont numérotées après la création de cette spec ; la PR les cite par `Réf.`.
