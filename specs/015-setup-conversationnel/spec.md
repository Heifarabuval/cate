# Feature Specification: Setup conversationnel

**Feature Branch**: `docs/spec-setup-conversationnel`

**Created**: 2026-11-25 (besoin n1, base `origin/main` `776adebb`)

**Status**: Draft. Spec d'abord, aucune ligne de code produit. Questions ouvertes en fin de document, chacune avec son hypothèse de travail.

**Input**: à la première ouverture d'un workspace orchestré, l'humain répond à 4 « premières questions » figées (spec 008, US3). Elles supposent qu'on sait déjà ce qu'est le projet. Besoin : les remplacer par une conversation avec un agent Claude relié à Cate, qui demande à quoi va servir l'espace, lit le dépôt, ne pose que les questions que la lecture n'a pas réglées, puis propose le setup complet (pratiques, métier et connecteurs, orga) que l'humain valide par clic. Ajout du 2026-11-25 : le setup reste modifiable à tout moment du travail, par la même conversation (relance, ajustement d'un point, contexte ajouté en route), avec une mémoire entre deux conversations et un diff avant chaque écriture.

Liens :
- Spec `005-pratiques-reglables` : le schéma, les deux fichiers de politique, la garde `pages` (FR-005).
- Spec `008-reglages-workspace` : le formulaire de réglages, les premières questions (US3, FR-013), `/pratiques/set|preset`.
- Spec `010-interlocuteur` : le modèle d'un agent relié au panneau qui n'écrit que des propositions.
- Spec `012-connecteurs-metiers` : le catalogue des métiers et des connecteurs, l'écriture par carte.
- Spec `014-noyau-agence` : une seule boîte de validation, trois types de cartes.
- Constitution du fork : II (déclarer une fois), III (coupes nettes), V (le runtime est l'application), VI (tests d'abord), VII (le plus simple).

## Constat (lu sur `origin/main` `776adebb`, le 2026-11-25)

Ce que fait le questionnaire aujourd'hui :

- **Quatre questions, toutes sur le flux de travail.** `tools/agence/pratiques.json` porte `question` sur `metier` (`:5`), `livraison.mode` (`:13`), `verification` (`:36`) et `agents.max` (`:44`). Aucune ne demande à quoi sert le projet. La spec 008 (US3, Q7) en annonce d'autres : `tests` y figure, le schéma ne lui donne pas de `question` (`:24-27`).
- **Le plafond est la question 4, la limite est 4.** `premieresQuestions` garde les champs `essentiel` qui portent `question`, au plus `MAX_QUESTIONS = 4` (`src/panels/agence/contract/types.ts:153-159`). Une cinquième question serait coupée en silence.
- **Le métier est une question à un seul choix.** `metier` se choisit `parmi` `metiers.json`, qui ne contient qu'un métier, `dev` (`tools/agence/metiers.json:2`). Un projet non technique répond « Développement » ou passe.
- **Réponses présélectionnées, une par écran.** `PremieresQuestions.tsx:22-24` préremplit la valeur courante ; « Passer » (`:84`) écrit le preset `neutre`, « Terminer » (`:86`) écrit les réponses en une fois.
- **L'écran tient l'orchestrateur.** `AgenceView.tsx:126-138` affiche les questions seules quand `pratiques.projet === false` ; `session.ts:222-228` (`held`) retient le lancement ; `session.ts:237-257` (`questions`) écrit par `/pratiques/preset` (passer) ou `/pratiques/set` (terminer), puis lance l'orchestrateur. Le régisseur route ces écritures (`agence.py:1495`, `click_pratiques` `:1708`).
- **L'orga n'est jamais demandée.** Sans `.cate/org.json`, l'orga est « solo » (`docs/architecture.md:1605-1650`, section 9.9). Seule la skill `orga` l'écrit, sur la demande de l'humain : `agence org propose` pose une carte (`agence.py:4063`), `agence org save` écrit après le clic (`:4087`). L'interlocuteur ne s'ouvre que si l'orga porte ce poste (`agence.py:674-680`) : un setup sans orga n'a donc jamais d'interlocuteur.
- **Les connecteurs ne sont jamais demandés.** `connecteurs.lecture` et `connecteurs.ecriture` sont `avance` (`pratiques.json:6-9`) et sans `question`. La skill `metier` décrit comment les choisir, à la main.
- **Rien ne lit le dépôt.** Les réponses viennent de l'humain seul ; les défauts sont ceux du preset, pas ceux du projet (un dépôt avec `CLAUDE.md`, Vitest et une CI reçoit les mêmes questions qu'un dépôt vide).

Cause commune : le questionnaire demande des réglages, alors que la personne sait dire à quoi sert son projet et ne sait pas dire quelle clé en découle.

## Principe

L'agent déduit, l'humain valide. Une conversation courte, une proposition par type d'écriture, un clic par écriture. Rien ne s'écrit sans ce clic, et l'agent ne touche jamais à la politique lui-même.

Le setup n'est pas figé à l'ouverture. L'humain le précise ou le change à tout moment du travail, par la même conversation : tout ce que l'agent propose part d'un état lu (la politique effective, l'orga, la mémoire du setup), montre un diff avant chaque écriture, et n'écrit qu'au clic. Le formulaire de réglages (spec 008) reste une voie équivalente : les deux écrivent au même endroit, le clic reste l'autorité.

## Vocabulaire

- **Agent de setup** : un agent Claude dans un panneau terminal relié au panneau agence (même mécanisme que l'interlocuteur, `agence.py:651-662`), lancé seulement pour un setup. Il lit, pose des questions, propose. Il n'écrit rien.
- **Proposition** : un fichier JSON écrit par l'agent dans `.cate/tmp/`, validé par la CLI, présenté sur une carte de la boîte de validation avec son aperçu.
- **Carte de setup** : une carte (spec 014) à deux boutons, « Appliquer » et « Refuser », qui porte le texte exact de la proposition.
- **Setup** : l'ensemble des trois propositions possibles : pratiques (réglages, métier, connecteurs), orga.
- **Mémoire du setup** : `<racine>/.cate/tmp/agence/setup.json`, à côté de `pratiques.json` : à quoi sert l'espace, les précisions données en route, et pourquoi chaque réglage a la valeur qu'il a. Lisible et éditable à la main.
- **Diff** : pour chaque ligne qu'une écriture change, la valeur actuelle, la valeur proposée et la source de la déduction. Montré sur la carte avant le clic.
- **Ajustement** : une conversation de setup lancée quand `projet` vaut déjà `true` (relance complète, un seul point, ou un contexte à noter).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Un projet non technique, sans code (Priority: P1)

Camille, cheffe de projet, ouvre un dépôt de 12 fichiers Markdown (briefs de campagne, calendrier éditorial) dans un workspace orchestré. Le panneau agence ne montre plus 4 questions : il montre un terminal avec l'agent de setup, qui demande « À quoi va servir cet espace ? ». Camille répond : « préparer les posts et les newsletters du mois, deux personnes relisent ».

1. L'agent lit `README.md`, `docs/` et le calendrier (12 fichiers, environ 15 000 jetons lus). Il ne trouve ni code, ni test, ni CI : il le dit en une phrase, sans poser de question sur les tests.
2. Il pose 2 questions de plus : « Qui valide un texte avant l'envoi ? » (réponse : Camille), « Vous travaillez avec quels outils : Slack, Drive, un CMS ? » (réponse : Slack et Drive).
3. Il écrit deux propositions. **Pratiques** : `preset: neutre`, `livraison.mode: pr`, `verification: differente`, `agents.max: 2`, `preuve: ["rapport"]`. Le métier : aucun métier du catalogue ne convient (seul `dev` existe) ; il ne propose pas `dev`, il le dit sur la carte et propose les connecteurs `lecture` Slack et Drive seulement s'ils sont déjà au catalogue (`connecteurs.json`), sinon il laisse une ligne « à ajouter au catalogue par une PR » (skill `metier`). **Orga** : 2 postes (rédacteur, relecteur), 1 lien avec `verifiedBy`, `maxAgents: 2`.
4. Deux cartes apparaissent dans la boîte de validation. Camille clique Appliquer sur la première, Refuser sur la seconde (« je prends le mode solo pour l'instant »). Le fichier de réglages du projet est écrit, l'orga reste solo, l'orchestrateur démarre.

Bilan chiffré : 3 questions, 2 cartes, 1 écriture (le fichier du projet), environ 4 minutes. Aucune clé technique n'a été montrée.

**Independent Test**: test de la CLI : une proposition de pratiques valide pose une carte et n'écrit rien ; le clic Appliquer écrit le fichier du projet par le régisseur ; Refuser n'écrit rien. Test de la skill : voir SC-005.

### User Story 2 - Un dépôt de dev lisible (Priority: P1)

Nadia ouvre un dépôt SvelteKit : 340 fichiers, un `CLAUDE.md` qui impose les tests d'abord, Vitest et Playwright dans `package.json`, une CI GitHub Actions, un modèle de PR. Elle répond à « À quoi va servir cet espace ? » : « refondre l'espace donateur, deux devs, livraison toutes les deux semaines ».

1. L'agent lit `CLAUDE.md`, `package.json`, `.github/workflows/`, `.github/pull_request_template.md`, l'arbre de `src/` (environ 25 fichiers, 40 000 jetons lus). Il déduit : livraison par PR (modèle de PR), tests d'abord (`CLAUDE.md`), preuve de fin par CI verte puis PR mergée (workflows).
2. Il ne pose que 2 questions, celles que le dépôt ne règle pas : « Combien d'agents en même temps ? » (réponse : 3, le Mac est à 24 Go, plafond de l'utilisateur), « Un second agent relit-il chaque travail ? » (réponse : oui).
3. **Pratiques** : `preset: pr-tdd`, `agents.max: 3`, `verification: differente`. L'aperçu montre uniquement les écarts avec ce que Nadia a aujourd'hui (4 lignes : valeur actuelle, valeur proposée, origine de la déduction : « `CLAUDE.md:12` »). **Orga** : un duo implémenteur et vérificateur, `maxAgents: 3`.
4. Deux clics Appliquer. Le fichier du projet est écrit, `.cate/org.json` est enregistré par `agence org save`, l'orchestrateur démarre.

Bilan chiffré : 2 questions (contre 4 aujourd'hui), 2 cartes, 2 écritures, environ 3 minutes. Chaque réglage proposé cite sa source dans le dépôt.

**Independent Test**: test de la skill sur un dépôt de fixture : le nombre de questions posées est inférieur au nombre de clés que la lecture a pu déduire ; chaque valeur proposée porte sa source.

### User Story 3 - Un dépôt vide (Priority: P2)

Max crée un workspace sur un dossier vide et répond « un petit outil interne pour suivre des devis ». L'agent n'a rien à lire : il le dit, et pose les questions utiles dans l'ordre de leur poids : livraison (PR ou direct), relecture par un second agent, plafond d'agents. 3 questions, une proposition de pratiques à partir de `neutre`, pas d'orga proposée (solo). Une carte, un clic, démarrage.

**Independent Test**: sur un dossier vide, l'agent ne lit que la racine, ne propose aucune orga, et pose au plus 4 questions.

### User Story 4 - Refaire le setup plus tard (Priority: P2)

Six semaines plus tard, l'équipe passe de 2 à 5 personnes. Camille clique « Refaire le setup » dans les réglages. L'agent part de l'état courant (`agence pratiques show`, `agence org --json`), relit le dépôt, demande ce qui a changé et ne propose que les écarts, chaque ligne avec « avant » et « après ». Rien n'est écrit sans clic ; un refus laisse l'existant intact.

**Independent Test**: avec `projet: true`, la proposition ne contient que les clés qui diffèrent de la valeur effective.

---

### User Story 5 - Le projet évolue en cours de route (Priority: P1)

Trois semaines après l'US2, le dépôt de Nadia change de nature : l'équipe ajoute à la refonte SvelteKit un flux de newsletters (12 fichiers Markdown dans `contenu/`), et le Mac rame. Nadia clique « Ajuster le setup » et écrit : « on ajoute les newsletters, un rédacteur arrive, et je passe à 2 agents, le Mac rame ».

1. L'agent ne repart pas de zéro. Il lit la mémoire du setup (objet : « refonte espace donateur » ; 6 décisions datées, chacune avec sa source), `agence pratiques show`, `agence org --json`, puis seulement ce qui a changé dans le dépôt depuis la date de la dernière écriture (`git log --since`, `contenu/` : environ 10 000 jetons lus, contre 40 000 au premier setup).
2. Il traite les trois points en une conversation :
   - **plafond** : `agents.max` 3 vers 2. Pas de question, c'est dit.
   - **métier qui s'ajoute** : le contenu éditorial n'est pas au catalogue (`metiers.json` ne porte que `dev`, et la clé `metier` n'accepte qu'un choix, Q10). Il le dit, ne propose rien pour cette clé, et note le besoin dans la mémoire (« métier contenu à ajouter au catalogue, PR »). Si le catalogue porte un métier qui convient, il le propose.
   - **orga** : un poste « rédacteur » s'ajoute au duo, `maxAgents` reste 2.
3. Il ne pose qu'une question : « Le rédacteur est-il relu par un second agent ou par toi ? » (réponse : par moi, `click: after`).
4. Deux cartes. La carte de pratiques montre 2 lignes de diff (plafond 3 vers 2 ; mémoire : +1 précision, +1 besoin de catalogue). La carte d'orga montre le diff des postes (+1 poste, +1 lien) et l'aperçu habituel, dont l'alerte « plus de rôles à la fois que `maxAgents` » (3 postes, 2 agents). Nadia clique Appliquer sur la première, Enregistrer sur la seconde.

Bilan chiffré : 1 question, 2 cartes, 3 fichiers écrits (réglages, mémoire, orga) par 2 clics, environ 2 minutes. Rien d'autre n'a bougé : les 4 réglages non cités sont absents du diff.

**Independent Test**: sur un état `projet: true` avec mémoire, la proposition ne contient que les lignes qui diffèrent ; refusée, elle laisse les trois fichiers identiques.

---

### User Story 6 - Ajuster un seul point, ou noter un contexte (Priority: P2)

Camille voit « Agents en même temps : 4 » dans le formulaire et veut le baisser en le justifiant. Elle clique « En parler à l'agent » sur cette ligne : l'agent s'ouvre sur ce seul réglage, demande pourquoi (« le Mac a 16 Go »), propose 4 vers 2 avec cette raison. Autre cas : elle écrit « les relectures se font toujours le jeudi » : aucune clé n'en découle, l'agent propose seulement une ligne de contexte à noter dans la mémoire (carte « Noter ce contexte », un clic). Le contexte est relu à chaque setup suivant et par l'agent de relance.

**Independent Test**: un contexte sans clé produit une carte qui n'écrit que `setup.json` ; un ajustement d'un point ne produit qu'une ligne de diff.

### Edge Cases

- **Pas de code lisible** (dossier de documents, fichiers binaires, droits refusés, dépôt de moins de 3 fichiers) : l'agent le dit, saute les questions de code (tests, CI, preuve) et se fonde sur les réponses ; il ne devine pas une pile.
- **Dépôt vide** : voir US3. Pas d'orga proposée, preset `neutre`.
- **Réponse vague** (« je ne sais pas », « comme d'habitude ») : une seule relance avec un exemple chiffré (« 2 agents à la fois coûtent environ la moitié de 4 »). Toujours vague : la valeur du preset `neutre` est prise et la carte la marque « par défaut, non confirmée ». Jamais une valeur inventée.
- **Abandon en cours** (panneau fermé, terminal tué, deux jours sans réponse) : rien n'est écrit, `projet` reste `false`, l'orchestrateur reste retenu comme aujourd'hui (`held`). Le bouton « Passer » du panneau reste disponible à tout moment et écrit `neutre` (comportement actuel de `session.ts:239`). À la réouverture, le setup recommence ; la conversation précédente n'est pas reprise en v1, seule la mémoire écrite par un clic l'est (section « Mémoire du setup »).
- **Réglage changé hors de la conversation** (formulaire, édition à la main, `agence pratiques set` par l'humain) : la valeur effective fait foi. La mémoire peut dire autre chose ; l'agent le signale (« la mémoire note 3 agents, le réglage vaut 2 depuis le formulaire ») et ne l'écrase pas sans carte.
- **Proposition périmée** : entre la proposition et le clic, une clé qu'elle change a été modifiée (formulaire, autre client). Le régisseur refuse l'écriture avec « les réglages ont changé depuis la proposition » ; rien n'est écrit, l'agent reproposé sur l'état courant.
- **Mémoire illisible ou éditée à tort** (JSON cassé, clé inconnue, secret apparent) : l'agent le dit, ne la répare pas, travaille sans elle et propose de la réécrire par une carte. Elle est mise de côté, jamais supprimée.
- **Rien à changer** : une proposition dont le diff est vide est refusée par la CLI (« aucun écart avec les réglages effectifs ») ; aucune carte, aucun clic inutile.
- **Ajustement pendant qu'un agent travaille** : une écriture qui baisse `agents.max` sous le nombre d'agents vivants ne ferme rien (records sont état, pas commande, constitution) ; la carte le dit (« 3 agents tournent, le plafond de 2 s'applique aux prochains lancements »).
- **Deux ajustements en même temps** (deux clients, deux agents de setup) : un seul agent de setup par projet (`panels.setup`) ; une seconde demande rouvre l'agent existant au lieu d'en lancer un autre.
- **Carte laissée sans réponse** : l'orchestrateur reste retenu tant que la carte de pratiques n'a pas de réponse ; la carte d'orga n'a aucun effet sur le démarrage (solo suffit).
- **Relance du setup** : voir US4. Le bouton n'est actif que si le régisseur tourne et qu'aucun setup n'est en cours.
- **Deux clients, deux clics** : la carte se règle une seule fois (mécanisme de `agence ask`) ; le second clic est refusé avec « déjà répondu ».
- **Proposition invalide** (clé inconnue, valeur hors bornes, incohérence de la spec 005) : la CLI la refuse, liste les erreurs, rien n'est posé. L'agent corrige ou dit qu'il ne peut pas.
- **Garde non installée** : comme pour 005, le panneau signale déjà la bannière ; la protection est celle du jeton du régisseur, pas plus.
- **Claude absent ou non connecté** : l'agent ne démarre pas ; le panneau retombe sur « Passer » et le formulaire de réglages (spec 008). Le questionnaire figé n'est pas conservé en secours (voir Q4).
- **Plafond d'agents** : l'agent de setup est le seul agent actif avant le premier démarrage de l'orchestrateur ; il se ferme à la fin du setup (plafond de 4 agents du Mac respecté).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Quand l'état publie `pratiques.projet: false`, la session MUST lancer l'agent de setup (`cate agent start`, relié au panneau agence) à la place des premières questions, avec la skill `setup`. L'orchestrateur reste retenu (`held`) jusqu'à la réponse à la carte de pratiques, ou jusqu'à « Passer ».
- **FR-002**: L'agent MUST ouvrir par « À quoi va servir cet espace, et quel est le projet ? » et MUST NOT demander la profession (« dev ? ») ni la taille de l'équipe avant d'avoir lu le dépôt.
- **FR-003**: L'agent MUST lire avant de questionner : `README*`, `CLAUDE.md`, `docs/`, les manifestes (`package.json`, `pyproject.toml`, ...), `.github/`, l'arbre à deux niveaux. Plafond : 40 fichiers et 200 Ko lus ; au-delà, il s'arrête et le dit. Il MUST ignorer `.env*`, `*.pem`, `*.key`, `secrets*`, `node_modules/`, `dist/` et ne jamais afficher la valeur d'un secret.
- **FR-004**: L'agent MUST poser une question seulement quand la lecture n'a pas déterminé la clé, une question à la fois, au plus 6 au total. Chaque valeur déduite MUST citer sa source (`chemin:ligne` ou « réponse de la personne »).
- **FR-005**: La CLI MUST gagner `agence pratiques propose <fichier|-> --from <id>` : valide la proposition avec la même validation que `pratiques set` (clés du schéma, bornes, cohérences de 005, aucun secret : seuls des noms de variables sont admis), puis pose une carte « Appliquer ces réglages ? » (options Appliquer, Refuser) qui porte le **diff** (clé en mots simples, valeur actuelle, valeur proposée, source de la déduction) et le texte exact de la proposition. Invalide ou sans écart : rien n'est posé, la commande liste les erreurs ou dit « aucun écart ».
- **FR-006**: Au clic Appliquer sur une carte de pratiques, le **régisseur** MUST écrire le fichier du projet (`regler_plusieurs`, même verrou et même écriture que `/pratiques/set`, `pratiques.py:306`) avec le texte de la carte, après l'avoir revalidé. L'agent n'exécute aucune commande d'écriture : il n'y a pas d'équivalent de `agence org save` pour les pratiques, et la garde `PRATIQUES_RE` (`agence.py:3553`) n'est pas assouplie.
- **FR-007**: Le métier et les connecteurs MUST se proposer dans la même carte que les pratiques (clés `metier`, `connecteurs.lecture`, `connecteurs.ecriture`). L'agent MUST choisir parmi `metiers.json` et `connecteurs.json` seulement. Aucun ne convient : il le dit sur la carte et ne propose rien pour cette clé ; un nouveau métier ou outil entre au catalogue par une PR (skill `metier`).
- **FR-008**: L'orga MUST se proposer par la skill `orga` existante, sans changement : `agence org propose`, carte « Enregistrer cette orga ? », `agence org save` après le clic. L'agent de setup ne propose une orga que si la lecture et la conversation décrivent plus d'un rôle ; sinon elle reste solo.
- **FR-009**: L'agent MUST NOT lancer `agence pratiques set|unset|preset`, ni `agence start`, ni écrire `pratiques.json`, `.cate/org.json` ou `state.json`. La CLI MUST refuser `agence need|fiche|draft|ask` hors celles du setup à l'appelant enregistré comme agent de setup (même seconde barrière que `refuse_interlocuteur`, `agence.py:481`).
- **FR-010**: Au clic sur une carte de pratiques lors du premier setup (`projet` passe à `true`), la session lance l'orchestrateur, comme `questions()` aujourd'hui (`session.ts:253`). L'agent de setup se ferme à la fin de chaque conversation (plafond de 4 agents) ; « la même conversation » veut dire le même point d'entrée et la même mémoire, pas le même processus.
- **FR-011**: « Passer » MUST rester présent et écrire `{"preset": "neutre"}` (comportement de `session.ts:239`) ; l'agent est fermé.
- **FR-012**: Un bouton « Ajuster le setup » (panneau agence, disponible à tout moment, `projet: true`) MUST ouvrir l'agent de setup, ou rouvrir celui qui tourne (un par projet). Un bouton « En parler à l'agent » sur chaque ligne du formulaire de réglages MUST l'ouvrir centré sur cette clé. L'agent MUST partir de l'état lu (mémoire, `agence pratiques show`, `agence org --json`) et de ce qui a changé dans le dépôt depuis la date de la dernière écriture ; sa proposition MUST ne contenir que les écarts avec la valeur effective.
- **FR-013**: Les premières questions figées MUST disparaître (coupe nette, constitution III) : `PremieresQuestions.tsx` et son test, `premieresQuestions` et `MAX_QUESTIONS` (`contract/types.ts:153-159`), le champ `question` du schéma (`pratiques.json:5,13,36,44`), l'op `pratique.questions` (remplacée par une op `setup.passer`), les références de la spec 008 (US3, FR-013, Q7, Q9) marquées remplacées. Le formulaire de réglages (008) reste.
- **FR-014**: Le modèle et l'effort de l'agent de setup MUST se régler comme ceux de l'interlocuteur : clé `modele.interlocuteur` réutilisée (`agence.py:658`), null voulant dire le défaut de la CLI. Aucune clé nouvelle en v1.
- **FR-015**: Chaque lot MUST commencer par ses tests rouges (constitution VI). Aucun test e2e, aucun Electron (constitution X).
- **FR-016**: Chaque écriture du setup MUST montrer son diff sur la carte avant le clic : pratiques (clé, avant, après, source), orga (postes et liens ajoutés, retirés, modifiés, plus l'aperçu et les défauts de `previewOrg`), mémoire (lignes ajoutées ou retirées). Le premier setup montre le même diff, l'« avant » étant la valeur effective du preset. Le texte écrit au clic est celui de la carte, octet pour octet.
- **FR-017**: La mémoire du setup MUST vivre dans `<racine>/.cate/tmp/agence/setup.json` (hors dépôt versionné, comme `pratiques.json`, partagée par les worktrees), JSON écrit atomiquement par le même code que les fichiers de politique (`pratiques.py`), un seul écrivain : le régisseur, au clic, dans la même écriture que la carte de pratiques ou par une carte « Noter ce contexte ». L'agent ne l'écrit jamais ; il la lit.
- **FR-018**: Le régisseur MUST refuser l'écriture d'une carte de pratiques quand une clé qu'elle change a une valeur effective différente de l'« avant » de la carte (proposition périmée). Il écrit sinon par `regler_plusieurs`, le même chemin que le formulaire (FR-004 de 008).
- **FR-019**: Le formulaire de réglages MUST rester la voie directe et continuer d'écrire sans agent. Aucune des deux voies n'a priorité : le dernier clic gagne (008, cas limites), la valeur effective est la seule vérité, la mémoire n'en est que l'historique et la raison.
- **FR-020**: Quand une remarque faite en cours de travail à l'orchestrateur ou à l'interlocuteur touche une clé du setup, l'agent qui la reçoit MUST répondre en une ligne qui renvoie à « Ajuster le setup » ; il ne propose et n'écrit rien lui-même.

### Key Entities

- **Proposition de pratiques** : `{ preset?, valeurs: { "<clé>": <valeur> }, sources: { "<clé>": "<chemin:ligne ou réponse>" } }`, fichier sous `.cate/tmp/`, jamais dans le dépôt versionné. Les `sources` servent l'aperçu et ne s'écrivent pas dans la politique.
- **Carte de setup** : une question de la boîte de validation (spec 014) qui porte `setup: "pratiques"` et le texte de la proposition, comme la carte d'orga porte `org` (`agence.py:4081`).
- **Agent de setup** : un panneau terminal enregistré dans `state.json` (`panels.setup`), un par projet, fermé à la fin de chaque conversation.
- **Mémoire du setup** : `setup.json` (voir la section du même nom), jamais dans `state.json`.
- **Base d'une carte** : les valeurs « avant » que la proposition a lues ; le régisseur les compare à l'état courant au clic (FR-018).

## Les écritures et leur clic

| Écriture | L'agent produit | Qui écrit | Au clic |
|---|---|---|---|
| Réglages, métier, connecteurs | `agence pratiques propose` (fichier validé, carte) | le régisseur, par la route des formulaires | Appliquer sur la carte |
| Orga | `agence org propose` (skill `orga`, carte) | `agence org save`, lancée après la réponse | Enregistrer sur la carte |
| Mémoire du setup (objet, contexte, raisons) | le texte dans la même proposition de pratiques, ou une carte « Noter ce contexte » | le régisseur | Appliquer (même clic que les réglages) ou Noter |
| Connecteur manquant ou métier absent | une ligne sur la carte, pas d'écriture | personne ; l'humain ouvre une PR au catalogue | aucun |

Ce que l'agent lit : le dépôt (FR-003), la mémoire du setup, `agence pratiques show`, `agence org --json`, `agence connecteur check` (présence d'un secret, jamais sa valeur). Ce qu'il propose : au plus deux cartes par conversation (pratiques avec mémoire, orga). Ce qu'il n'écrit jamais : tout fichier de politique, d'orga, de mémoire ou d'état.

## Mémoire du setup

Entre deux conversations, l'agent n'a rien en tête : tout ce qui doit survivre est dans `<racine>/.cate/tmp/agence/setup.json`.

```json
{
  "version": 1,
  "objet": "Refonte de l'espace donateur, 2 devs, livraison toutes les deux semaines",
  "contexte": [
    { "date": "2026-11-25", "texte": "Les relectures se font le jeudi" }
  ],
  "decisions": {
    "agents.max": { "valeur": 2, "raison": "Le Mac a 16 Go", "source": "réponse", "date": "2026-12-16" },
    "tests": { "valeur": "tdd", "raison": "CLAUDE.md impose les tests d'abord", "source": "CLAUDE.md:12", "date": "2026-11-25" }
  },
  "dernierSetup": "2026-12-16"
}
```

- **Ce qui persiste** : `objet` (la réponse à « à quoi sert cet espace »), `contexte` (précisions datées en texte libre, sans clé), `decisions` (pour chaque clé posée par le setup : valeur, raison, source de la déduction, date), `dernierSetup`. Les valeurs effectives ne sont pas la mémoire : elles restent dans `pratiques.json` (005) ; la mémoire dit pourquoi et depuis quand.
- **Où** : à côté de `pratiques.json`, hors du dépôt versionné (`.cate/tmp/`), partagée par les worktrees comme lui. Le contenu ne quitte jamais la machine du runtime. Une équipe qui veut la versionner la copie elle-même (Q9).
- **Qui écrit** : le régisseur, au clic de la carte (FR-017). Même écriture atomique que les fichiers de politique, même verrou. Jamais l'agent, jamais la vue.
- **Lisible et éditable à la main** : JSON indenté, clés en clair, aucune donnée binaire. L'humain peut corriger une raison ou supprimer une ligne de contexte. L'agent relit le fichier à chaque conversation et ne suppose rien de ce qu'il ne contient pas. Un fichier illisible : voir cas limites.
- **Pas de secret** : la proposition est refusée si une valeur de `contexte` ou de `raison` ressemble à un secret (jeton, clé privée, `://user:mot@`), comme pour les réglages.
- **Taille** : 200 lignes de contexte au plus ; au-delà, l'agent propose un résumé en un clic. Conséquence sur le coût : la mémoire lue ne dépasse pas environ 3 000 jetons.
- **Pas de journal de conversation** : le texte échangé n'est pas conservé (Q5). Ce que la personne veut garder, l'agent le propose en `contexte`, et elle clique.

## Cohérence avec le formulaire de réglages (spec 008)

- Un seul fichier de politique : le formulaire (`/pratiques/set`, `/preset`) et la carte de setup écrivent le même `pratiques.json` par `regler_plusieurs` (`pratiques.py:306`), même validation, même verrou, mêmes refus en mots simples. Il n'y a pas de seconde source.
- Le clic est l'autorité : dans le formulaire, le clic sur un choix ; sur la carte, le clic Appliquer. Un agent n'a aucune route d'écriture (FR-009), ni vers `pratiques.json`, ni vers la mémoire.
- Les deux voies se voient : le formulaire lit la valeur effective et son origine ; la carte compare à cette même valeur (FR-018). Une écriture du formulaire entre une proposition et son clic rend la carte périmée, jamais écrasante.
- La mémoire ne bloque rien : un réglage changé au formulaire n'invalide pas la mémoire ; l'agent la compare à la valeur effective à la conversation suivante et propose de mettre la raison à jour (une ligne de diff, un clic).
- L'origine affichée au formulaire reste celle de 008 (« par défaut », « vos réglages », « ce workspace », « ponctuel ») ; une valeur posée par le setup est « ce workspace », la raison se lit en survol ou en bas de ligne depuis `decisions` (lecture seule, depuis `setup.json`).
- Le setup et le formulaire partagent les mêmes bornes, les mêmes phrases de refus et le même schéma ; la skill `setup` ne recopie aucune liste de clés ou de valeurs (SC-004 de 008).

## Success Criteria *(mandatory)*

- **SC-001**: Sur un dépôt lisible, le nombre de questions posées est au plus 3 pour 90 % des setups, au plus 6 dans tous les cas (aujourd'hui : 4 à chaque fois).
- **SC-002**: 100 % des valeurs proposées portent une source ; 0 valeur sans source n'apparaît sur une carte.
- **SC-003**: 0 écriture sans clic : test de la CLI et du régisseur, la politique, l'orga et l'état sont identiques avant et après une proposition refusée ou ignorée.
- **SC-004**: 0 secret : test sur un dépôt qui contient un `.env` factice, sa valeur n'apparaît ni dans la conversation lue, ni dans une proposition, ni sur une carte.
- **SC-005**: Écart avec upstream : 0 fichier hors `tools/agence/`, `skills/setup/`, `skills/orga/`, `src/panels/agence/`, `src/shells/desktop/ui/panels/agence/`, `docs/architecture.md`.
- **SC-006**: Un setup refusé en entier (deux Refuser) laisse le workspace au preset `neutre` seulement si la personne a cliqué « Passer » ; sinon `projet` reste `false`.
- **SC-008**: 100 % des cartes de setup affichent un diff ; le texte écrit est celui de la carte (test : octets du fichier écrit égaux au texte de la carte).
- **SC-009**: Un ajustement (US5) lit moins que le premier setup (au plus la moitié des jetons de dépôt) et ne propose que les lignes qui diffèrent.
- **SC-010**: Cohérence : une écriture du formulaire entre proposition et clic rend la carte refusée (test du régisseur) ; formulaire et carte écrivent le même fichier et rendent la même valeur effective.
- **SC-011**: Une mémoire éditée à la main (ligne retirée, raison changée) est relue telle quelle à la conversation suivante ; une mémoire cassée n'empêche pas le setup.
- **SC-007**: Coût borné et dit avant le lancement : lecture limitée à 40 fichiers et 200 Ko, 6 questions au plus ; le panneau affiche « Setup : jusqu'à environ N jetons » (voir ci-dessous).

## Coût en jetons et modèle

- Entrée lue : 15 000 à 40 000 jetons de dépôt (US1 et US2), plus la conversation (3 à 6 tours). Ordre de grandeur d'une session de setup : 100 000 à 250 000 jetons lus, cache compris. **Estimation, non mesurée.** Référence mesurée : 477 000 jetons lus par tour pour l'orchestrateur du 17/11 (mémoire projet) : le setup coûte de l'ordre d'un demi-tour d'orchestrateur sur la durée, une fois par projet.
- Coût en euros : non chiffré, aucune mesure (le questionnaire actuel coûte 0 jeton).
- Modèle : `modele.interlocuteur` (FR-014), défaut de la CLI. Hypothèse de travail : Sonnet, effort moyen, car la tâche est de lecture et de dialogue ; le choix du modèle reste à Heifara (Q3). Pas de Fable 5.2.
- Un ajustement lit la mémoire (au plus environ 3 000 jetons), les écarts du dépôt depuis `dernierSetup` et l'état courant : de l'ordre de 20 000 à 60 000 jetons lus, 1 à 3 tours. **Estimation, non mesurée.** Un ajustement d'un seul point (US6) tient dans le bas de cette fourchette.
- Mesure à faire au lot 1 : relever les jetons d'un setup sur les trois dépôts de fixture, et reporter le chiffre dans cette section.

## Assumptions

- Le mécanisme d'un agent relié au panneau (`cate agent start`, enregistrement dans `state.json`) est celui de l'interlocuteur (spec 010) ; le lot 1 le réutilise sans nouveau mécanisme.
- Le panneau agence est desktop seul : un client iOS ne voit ni l'agent ni les cartes de setup en v1.
- Les libellés des cartes sont en français, comme le reste de l'agence.
- Le catalogue ne contient qu'un métier (`dev`) : les projets non techniques sont servis par les pratiques et l'orga tant que le catalogue n'a pas grandi (spec 012).

## Questions ouvertes

Chacune a une hypothèse de travail, écrite dans la spec, qui tombe si la réponse change.

- **Q1** : une carte ou deux ? Hypothèse : **deux**, pratiques (avec métier et connecteurs) et orga, parce que l'orga a déjà sa carte et sa commande (`agence org propose`) et que l'humain peut refuser l'une sans l'autre. Une carte unique demanderait de refondre `org save`.
- **Q2** : l'agent de setup est-il une skill nouvelle (`skills/setup/`) ou un mode de la skill `interlocuteur` ? Hypothèse : **skill nouvelle**, courte, qui renvoie à `orga` et `metier` pour leurs étapes ; l'interlocuteur écrit des fiches et ne doit pas apprendre à proposer de la politique.
- **Q3** : modèle et effort de l'agent. Hypothèse : réutiliser `modele.interlocuteur` (null, défaut de la CLI). La clé n'existe pas encore pour un projet neuf (`projet: false`) : le défaut de la CLI s'applique, donc le modèle choisi par Heifara pour le défaut. Alternative : une clé `modele.setup`, rejetée en v1 (une clé de plus pour un usage unique).
- **Q4** : garder le questionnaire figé en secours quand Claude est absent ? Hypothèse : **non** (coupe nette) ; « Passer » et le formulaire de réglages suffisent, et un poste sans Claude n'orchestre rien de toute façon.
- **Q5** : reprendre le texte d'une conversation interrompue ? Hypothèse : **non en v1** ; seule la mémoire écrite par un clic survit. Une conversation de 3 à 6 tours coûte moins cher à refaire qu'un journal à maintenir, et un journal brut risquerait de garder un secret collé en réponse.
- **Q6** : l'agent peut-il créer la PR d'ajout d'un métier au catalogue ? Hypothèse : **non**, il écrit seulement la ligne « à ajouter au catalogue » sur la carte ; la PR relève du flux normal (skill `metier`).
- **Q7** : la proposition de pratiques peut-elle poser `agents.max` au-dessus du plafond mémoire du Mac (4 agents sur 24 Go, mémoire projet) ? Hypothèse : **oui, mais la carte affiche l'avertissement de mémoire** que `previewOrg` calcule déjà ; la décision reste celle de l'humain.
- **Q8** : où vit l'entrée vers le setup ? Hypothèse : « Ajuster le setup » dans l'en-tête du panneau agence et « En parler à l'agent » sur chaque ligne du formulaire (FR-012). Pas de commande de palette en v1.
- **Q9** : la mémoire est-elle versionnée avec le dépôt ? Hypothèse : **non**, elle reste dans `.cate/tmp/agence/` (hors dépôt, comme `pratiques.json`) parce qu'elle peut citer des noms d'outils et des raisons internes. Une équipe qui veut la partager la copie à la main.
- **Q10** : la clé `metier` n'accepte qu'un choix (`"un": true`, `pratiques.json:3`). Un projet qui ajoute un métier (US5) en veut deux. Hypothèse : **le setup ne change pas ce schéma** ; il propose le seul métier qui convient le mieux et note l'autre dans la mémoire. Passer `metier` en liste est une décision de la spec 012, pas de celle-ci.
- **Q11** : quand l'agent est-il relancé tout seul ? Hypothèse : **jamais** ; seul l'humain clique « Ajuster le setup ». Un déclencheur automatique (dépôt qui change de nature, plafond dépassé) serait une proposition de la spec 004 (déclencheurs), pas de ce setup.
- **Q12** : la raison d'une décision est-elle affichée dans le formulaire ? Hypothèse : **oui, en lecture seule**, sous la ligne (FR-019), lue depuis `setup.json` ; pas d'édition depuis le formulaire en v1.
- **Q13** : une proposition périmée est-elle refusée ou fusionnée ? Hypothèse : **refusée** (FR-018). Fusionner demanderait de recalculer le diff sans que l'humain l'ait vu, ce qui contredit « le diff est montré avant chaque écriture ».
- **Q14** : les remarques en cours de travail à l'orchestrateur ou à l'interlocuteur (FR-020) sont-elles détectées par une règle ou par le jugement de l'agent ? Hypothèse : **le jugement de l'agent**, avec une phrase dans leurs skills ; une règle par mots-clés produirait des renvois à tort. À mesurer au lot 1 sur 10 remarques réelles.
- **Q15** : la mémoire garde-t-elle l'historique des valeurs précédentes d'un réglage ? Hypothèse : **non** ; `decisions` ne garde que l'état courant et sa raison, l'historique est dans git si l'équipe versionne le fichier (Q9).
