# Feature Specification: Cercle vertueux (le fork lance au bon moment les commandes qui l'améliorent)

**Feature Branch**: `docs/spec-cercle-vertueux`

**Created**: 2026-11-20

**Issue**: Heifarabuval/cate#103 (reste ouverte : elle porte l'implémentation). Besoin #n466. Recoupe #100 (coût de l'attente d'un orchestrateur) sans le refaire. Même limite de vie privée que la spec 003 (#76).

**Status**: Draft. Spec d'abord, PR de la spec seule, aucun code. Questions ouvertes en fin de document (section « Questions ouvertes ») ; q469, q471 et q488 sont tranchées (Q1, Q2) ; Q3 à Q9 gardent une hypothèse de travail.

**Input**: Heifara veut que l'orchestrateur et Cate lancent eux-mêmes, au bon moment, les commandes de Claude Code et les `/` de nos skills qui améliorent le processus : `/compact`, `/clear` (le « `/new` » de l'issue, voir Clarifications), `/learn`, `/audit-config`, et les `/` qui aident à trouver de nouveaux skills ou à améliorer le processus (`tooling-scout`, `skill-creator`, `fewer-permission-prompts`, `update-config`, `claude-md-improver`, `graphify`). Une règle : consommer peu de jetons, donc **un déclencheur se décide par un script local sur des données déjà là, jamais par un tour de modèle**. Le tout dans une boucle qui s'améliore avec des données d'usage. Rien n'est décidé au-delà du texte de l'issue ; ce qui manque est posé en question, pas tranché ici.

Liens :
- [`inventaire.md`](inventaire.md) : le relevé vérifié des commandes, des skills, des outils de mesure et des canaux (sources, version 2.1.329, coûts mesurés ou « inconnu »).
- Spec `003-apprentissage-observation` : même limite de vie privée (journal local, jamais envoyé, jamais lu par un modèle, borné dans le temps).
- Spec `002-orchestrateur-portable` et skill `orchestrateur` : le régisseur, les besoins, les cartes de validation.
- Issue #100 : l'attente passive et `/compact` sont deux moyens de la même économie. Cette spec n'en refait ni la mesure ni les pistes ; voir « Liens avec #100 ».

## Clarifications

### Session 2026-11-20

- Q: « `/new` » de l'issue ? → A: pour Claude Code, la commande qui ouvre une conversation vide est `/clear` (`/new` n'est pas dans la liste de la doc ; `src/services/agents/runtime/live/hookLifecycle.config.ts:6` donne `/clear` pour `claude-code`, `/new` pour `opencode` et `pi`). La spec écrit `/clear`. Cate voit la coupure (`conversationResets.ts`) et garde la liste des sessions pour `cate agent usage`.
- Q: Un hook peut-il lancer ces commandes ? → A: non. Aucun hook n'exécute un `/` (doc des hooks, `PreCompact` bloque ou cadre, `PostCompact` observe, `Stop` refuse l'arrêt). Le canal est l'envoi d'un prompt à la session : `cate agent send` (voir plan, « Mécanisme »).
- Q: Un agent peut-il appeler `/learn` ou `/audit-config` lui-même ? → A: non. Ces skills (et `/handoff`, `/n8n-deploy`) portent `disable-model-invocation: true`. Seul un prompt saisi les lance, ce qui est exactement ce que fait l'envoi à une session.
- Q: La part de contexte, par la barre de statut ? → A: non, `statusLine` est `null` dans `~/.claude/settings.json` ; en brancher une serait un changement du setup, et elle ne sert qu'à la session qui l'affiche. La taille du contexte se lit dans le journal de session (dernier message : entrée, création de cache, lecture de cache). Cate ne l'expose pas encore (lot 1 du plan).
- Q: Seuil en pourcentage ou en jetons ? → A: en jetons. La fenêtre est d'environ 1 M (registre de `measure.py`) ; 150 000 jetons lus par tour (#100) ne font que 15 % et coûtent déjà cher en attente.
- Q: Un déclencheur envoie-t-il la commande seul, ou seulement une carte à son clic ? → A: tranché par Heifara (q469) : seul pour `/compact` (classe A), carte pour le reste (classe B). Un `/` qui change un fichier du setup ou de la mémoire reste en classe B quoi qu'il arrive (FR-006).
- Q: Les trois déclencheurs minimaux ? → A: tranché par Heifara (q471) : `/compact` avant l'attente, `/learn` après une PR mergée, `/audit-config` hebdomadaire. Un 4e s'y ajoute (q488) : la mesure de consommation (`conso.py`, une carte hebdomadaire, classe B, 0 jeton).

## Vocabulaire

- **Déclencheur** : une ligne de la table des déclencheurs (plan.md) : commande, condition, donnée qui la décide, seuil, qui la lance, classe, garde-fous.
- **Décision** : le résultat d'un tour d'évaluation pour un déclencheur et une session : `envoyer`, `carte`, `attendre` (condition vraie mais garde-fou fermé), `blanc` (condition vraie, commande pas encore activée par Heifara : journalisé, rien ne part, FR-020), `rien`.
- **Évaluateur** : la fonction pure qui prend un instantané (agents, usage, besoins, journal, horloge) et rend des décisions. Un script, pas un modèle.
- **Classe A** : la commande part seule (sous réserve de Q1). **Classe B** : une carte attend le clic de Heifara dans le panneau agence ; la commande part au clic.
- **Carte** : une ligne du panneau agence « À faire par <nom> » : ce qui est proposé, pourquoi (la mesure), trois actions : « Lancer », « Pas utile », « Plus pour cette commande ».
- **Journal des déclenchements** : les fichiers `<racine>/.cate/tmp/agence/declencheurs/<AAAA-MM-JJ>.jsonl`, une ligne par décision qui n'est pas `rien`.
- **Mesure** : un petit objet de nombres lus sur la session avant et après (`contextTokens`, `inputTokens`, `outputTokens`, `costUsd`), jamais un texte.
- **Indicateur de réussite** : un test chiffré par commande (voir FR-009) qui dit si la commande a servi.
- **Bilan** : le résumé agrégé du journal par commande (nombre, taux de réussite, gain médian), sans identifiant de panneau.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - L'orchestrateur est compacté avant d'entrer en attente (Priority: P1)

L'orchestrateur a lancé ses agents et attend. Son contexte pèse plus que le seuil (hypothèse de départ : 150 000 jetons). Quand il est au repos (`waitingForInput`, aucun prompt en file, aucune permission en attente), le régisseur lui envoie `/compact` avec les consignes de ce qu'il faut garder (besoins ouverts, panneaux, décisions). Chaque tour d'attente relit ensuite moins.

**Why this priority**: c'est le seul `/` dont l'effet se mesure tout de suite (contexte avant et après), et c'est ce que #100 attend (piste 3). Il ouvre la liste.

**Independent Test**: instantanés fabriqués (`agents` et `usage` en JSON) : contexte à 149 999, 150 000 et 150 001 jetons ; agent en tour, en attente de permission, au repos avec un prompt en file, au repos ; vérifier la décision (`rien`, `rien`, `envoyer` seulement quand tout est ouvert). Rejouer deux fois le même instantané : une seule décision.

**Acceptance Scenarios**:

1. **Given** `/compact` activé pour le projet (sinon la décision est `blanc`), l'orchestrateur à 180 000 jetons de contexte, au repos, sans prompt en file, **When** le tour du régisseur tourne, **Then** une décision `envoyer /compact` est prise, un prompt part par `cate agent send`, et une ligne est écrite au journal avec la mesure avant.
2. **Given** l'orchestrateur à 180 000 jetons mais en plein tour, **When** le tour tourne, **Then** la décision est `attendre` : rien n'est envoyé, rien n'est mis en file (une file qui s'exécuterait au milieu d'un enchaînement de tours n'est pas voulue pour `/compact`, voir FR-004).
3. **Given** l'orchestrateur bloqué sur une confirmation de hook ou de permission, **When** le tour tourne, **Then** rien n'est envoyé ni tapé ; la section Bloquant du suivi reste la seule voie (règle de l'orchestrateur).
4. **Given** un `/compact` envoyé, **When** deux tours du régisseur plus tard le contexte est lu de nouveau, **Then** la ligne du journal reçoit la mesure après et le verdict (FR-009) ; sans mesure après (agent fermé, contexte illisible), le verdict est `sans-mesure` avec sa raison.
5. **Given** un `/compact` fait il y a moins de 10 minutes sur le même panneau, **When** le seuil est de nouveau franchi, **Then** la décision est `attendre` (délai de repos) et la ligne du journal dit `repos`.

---

### User Story 2 - Une carte propose `/learn` après une PR mergée (Priority: P1)

Un besoin passe à `done` parce que sa PR est mergée (`pr-merged:N`). Le régisseur le voit (il le fait déjà pour fermer les panneaux) et pose une carte : « `/learn` sur <session> ? ». Au clic, `/learn` part dans la session choisie (hypothèse : l'orchestrateur, voir Q3) ; le skill demande lui-même sa confirmation avant d'écrire.

**Why this priority**: c'est la seule voie de l'apprentissage vers la mémoire et les règles ; aujourd'hui elle dépend de la mémoire de l'humain (« proposer `/learn` en fin de session substantielle » est une consigne, pas un mécanisme).

**Independent Test**: état fabriqué avec un besoin `done` par `pr-merged:N` : une carte, une seule, même après plusieurs tours ; « Pas utile » : plus de carte pour ce besoin ; « Plus pour cette commande » : plus de carte `/learn`, visible et réversible dans le panneau.

**Acceptance Scenarios**:

1. **Given** un besoin clos par un merge, **When** le tour tourne, **Then** une carte `/learn` apparaît avec la raison (« PR #N mergée, besoin <titre> ») et rien n'est envoyé.
2. **Given** la carte, **When** Heifara clique « Lancer » et que la session est au repos, **Then** `/learn` part par `cate agent send` ; si la session n'est pas au repos, le prompt reste en file et la carte dit « en file ».
3. **Given** la carte ignorée, **When** 48 heures passent (hypothèse), **Then** elle disparaît et la ligne du journal dit `ignoree`.
4. **Given** `/learn` lancé, **When** il pose sa question de confirmation, **Then** elle s'affiche dans le panneau agence (règle `agence ask` en projet orchestré) ; la spec ne la remplace pas.
5. **Given** un besoin clos par un merge qui n'a rien appris (modification mécanique), **When** Heifara clique « Pas utile », **Then** le journal le compte contre `/learn` (FR-009).

---

### User Story 3 - Une carte hebdomadaire propose `/audit-config` (Priority: P1)

Une fois par semaine (hypothèse : 7 jours depuis la dernière exécution lue au journal), si aucun agent n'est en plein tour, une carte propose `/audit-config`. Au clic, la commande part. Elle mesure d'abord (`usage.py`, `measure.py` à environ 0,02 $, `check.py`), propose ensuite, et demande une confirmation par élément : la spec ne touche à rien de cela.

**Why this priority**: l'audit est « une fois par mois, ou quand le contexte de départ semble lourd » : rien ne le rappelle aujourd'hui. Un jour de retard coûte des jetons à chaque session.

**Independent Test**: journal fabriqué avec une exécution il y a 6 jours, puis 7 jours : 0 carte, puis 1 ; une carte ouverte ne se duplique pas ; un agent en plein tour : `attendre`.

**Acceptance Scenarios**:

1. **Given** aucune ligne `/audit-config` depuis 7 jours, **When** le tour tourne et qu'aucun agent n'est en plein tour, **Then** une carte apparaît avec la raison et la date de la dernière exécution.
2. **Given** la carte, **When** « Lancer », **Then** la commande part dans la session désignée ; la mesure avant est le dernier total exact connu (`~/.claude/state/setup/ledger.jsonl`, lecture seule) ; la mesure après est lue au prochain passage de `measure.py` (voir FR-009).
3. **Given** `measure.py` qui coûte un appel, **When** le déclencheur décide, **Then** il ne l'appelle jamais : il décide sur la date du journal (FR-001).
4. **Given** deux projets orchestrés, **When** les deux atteignent 7 jours, **Then** chacun pose sa carte (le journal est par projet) ; limite connue, voir Q7.

---

### User Story 4 - Un journal, un bilan, des seuils révisés (Priority: P1)

Chaque décision qui n'est pas `rien` laisse une ligne : date, commande, raison, mesure avant, mesure après, verdict. `agence declencheurs bilan` rend par commande le nombre de déclenchements, le taux de réussite et le gain médian. Quand une commande ne sert pas, le seuil se révise : à la main par Heifara au début, par une proposition chiffrée ensuite.

**Why this priority**: sans journal, aucun seuil n'est autre qu'une hypothèse et le cercle n'en est pas un.

**Independent Test**: journal fabriqué sur 30 jours ; le bilan sort les nombres attendus ; la révision proposée est calculée (pas de modèle) ; un fichier de plus de 90 jours disparaît à la purge (horloges J-89, J-90, J-91).

**Acceptance Scenarios**:

1. **Given** un `/compact` envoyé, **When** le verdict tombe, **Then** la ligne contient `{ts, commande, panneau, raison, classe, decision, avant, apres, verdict}` et aucun texte de conversation.
2. **Given** `/compact` en échec 3 fois de suite (contexte après ≥ 80 % de l'avant), **When** le bilan tourne, **Then** il propose de relever le seuil de 25 % et le dit en une ligne ; rien ne change sans l'accord de Heifara (règle « créer à la demande »).
3. **Given** `agence declencheurs bilan`, **When** Heifara la tape, **Then** les nombres par commande sortent sans identifiant de panneau ni raison libre.
4. **Given** l'état neuf, **When** aucun déclencheur ne s'est produit, **Then** aucun fichier n'existe.
5. **Given** un fichier de 91 jours, **When** la purge tourne (au démarrage du régisseur, puis une fois par jour), **Then** il est supprimé ; un nom invalide est ignoré et signalé, jamais supprimé.

---

### User Story 5 - Une friction qui revient deux fois propose un `/` pour la résoudre (Priority: P3, hors des trois minimaux)

La même friction (même commande Bash retapée, même erreur d'outil, même garde déclenché) revient deux fois sur 7 jours. Une carte propose la commande la plus petite qui la règle : `tooling-scout` pour chercher, `skill-creator` si c'est une séquence, `update-config` si c'est un « à chaque fois que », `fewer-permission-prompts` si ce sont des demandes de permission, `claude-md-improver` si c'est une consigne répétée, `graphify` après un gros ajout de modules.

**Why this priority**: c'est la boucle d'amélioration à proprement parler, mais elle demande de normaliser les données de friction (le registre de `usage.py` ne garde ni les erreurs ni les commandes répétées, seulement leur total).

**Independent Test**: sorties de `usage.py` fabriquées, deux passages avec la même friction : 1 carte ; une friction vue une seule fois : 0.

**Acceptance Scenarios**:

1. **Given** deux passages d'`usage.py` qui montrent la même commande Bash retapée, **When** le tour tourne, **Then** une carte propose `skill-creator` avec la preuve (la commande normalisée, le nombre d'occurrences) ; rien n'est créé.
2. **Given** la carte et un clic, **When** la commande part, **Then** elle suit les règles du skill (confirmation avant d'écrire, évals, `check.py` à 0 échec) : la spec n'y ajoute rien.
3. **Given** `tooling-scout`, **When** la carte propose de le lancer, **Then** il tourne comme un panneau (`cate agent start`), jamais par l'outil Agent (règle du projet), avec la sortie d'`usage.py` pour entrée.

### User Story 6 - Une carte hebdomadaire mesure la consommation, en nombres (Priority: P2, 4e déclencheur, décidé q488)

Une fois par semaine, une carte propose de lancer `conso.py` : la mesure de consommation de la fenêtre de 7 jours. Motif chiffré : 714 relances de tests sans édition en 1,68 jour, soit 29,4 dollars (`~/.claude/state/mesure-sessions-2026-11-20.md`, lecture seule). L'outil est `common/tools/conso.py` du dépôt Skills : **dépendance externe**, hors de ce dépôt, ni lue ni modifiée par cette spec. Il coûte 0 jeton et sort des nombres seulement. Au clic sur « Lancer » (classe B), la commande part ; la carte n'envoie rien seule.

**Why this priority**: c'est la seule mesure qui dit où partent les jetons ; sans elle, les seuils de `/compact` et les règles de relance restent des hypothèses.

**Independent Test**: horloge fabriquée : 6 jours depuis la dernière ligne `conso` au journal : 0 carte ; 7 jours : 1 carte ; `conso.py` absent : aucune carte et une ligne `sans-mesure`.

**Acceptance Scenarios**:

1. **Given** aucune ligne `conso` depuis 7 jours, **When** le tour tourne, **Then** une carte apparaît avec la raison (`7j`) et la date de la dernière exécution ; aucun jeton n'est dépensé pour la poser.
2. **Given** la carte, **When** « Lancer », **Then** la commande part vers la session désignée ; le régisseur ne l'exécute jamais de lui-même et n'affiche que des nombres (aucun texte de conversation).
3. **Given** `conso.py` absent de la machine, **When** le tour tourne, **Then** le déclencheur se tait (décision `rien`, `sans-mesure` une fois par jour au plus).

---

### Edge Cases

- **L'agent change d'état entre la décision et l'envoi** : `cate agent send` ne refuse jamais un agent occupé, il met en file. Pour `/compact` et `/clear` (qui détruisent ou résument le contexte), l'évaluateur relit `cate agent list` juste avant l'envoi et, si un prompt est déjà en file ou l'agent n'est plus au repos, il n'envoie pas ; un prompt déjà parti en file dont la condition tombe est repris par `cate agent withdraw`.
- **Compactage pendant que l'orchestrateur tient un état en tête** : tout ce qui doit survivre est dans `agence need` (journal des décisions, panneaux, besoins) ; `agence boot --from ORCH` le rend après coupure (skill `orchestrateur`, démarrage, point 4). La consigne passée à `/compact` le rappelle. Si ce n'est pas vrai pour un état (une décision non notée), le déclencheur ne le sait pas : voir M2.
- **Prompt en file derrière une confirmation** : si l'agent est bloqué sur une permission, `canReceivePrompt` est faux ; le prompt (classe B, `/learn`) reste en file derrière. La carte l'affiche « en file » et propose de le reprendre (`withdraw`).
- **Régisseur qui redémarre** : l'état « décision déjà prise » vient du journal du jour, pas de la mémoire du processus ; un redémarrage ne réenvoie pas.
- **Horloge qui recule** : les fichiers sont nommés par la date locale ; la purge se base sur le nom ; un délai de repos négatif compte comme non écoulé.
- **Plusieurs orchestrateurs sur la même racine** : un régisseur par racine, un seul écrivain du journal.
- **Session d'un autre agent que Claude Code** (Codex, Grok, Pi...) : `/compact` et `/clear` n'ont pas la même syntaxe ou n'existent pas ; la table ne vise que `claude-code` et le dit (`agentId`), sans branche de code par agent hors de la table (principe IV).
- **`contextTokens` illisible** (agent sans comptage de jetons, transcript tronqué) : décision `rien` pour les déclencheurs qui en dépendent, ligne `sans-mesure` au journal une fois par jour au plus.
- **Un `/` ouvre un dialogue** (sélecteur) : il bloque la saisie ; la liste blanche de la table ne contient que des commandes sondées sans dialogue (lot 0). Un prompt envoyé qui ne démarre pas de tour finit `failed` (« agent-prompt-not-taken ») ; une commande `/` en est exemptée par le runtime (`terminal.ts:622-625`), donc l'échec d'une commande à dialogue ne se verrait pas : d'où la sonde.

## Ce que le cercle ne fait JAMAIS

Liste ferme, vérifiée par des tests (FR-014). Une ligne ajoutée se teste avant d'être livrée ; une ligne retirée demande une décision de Heifara.

1. **Taper dans le terminal d'un agent.** Jamais `cate terminal type` ni `cate terminal press` sur le panneau d'un agent, bloqué ou non. L'envoi passe par `cate agent send`, dont le runtime tient la file.
2. **Envoyer à un agent en plein tour ou bloqué sur une confirmation** une commande de classe A ou une commande destructrice de contexte (`/compact`, `/clear`) : la décision est `attendre`.
3. **Changer le setup sans l'accord de Heifara** : `~/.claude/settings.json`, hooks, `autoMode`, permissions, skills, `CLAUDE.md`, `/autocompact`, `/update-config`, `/fewer-permission-prompts`, `/skill-creator`. Ces commandes sont de classe B, et le skill demande en plus sa propre confirmation. Cate n'écrit jamais un fichier utilisateur global (principe du fork).
4. **Installer une garde ou un hook de lui-même.** Un déclencheur proposé n'est jamais installé seul (règle « créer à la demande » : montrer le texte, attendre l'accord).
5. **Lancer l'app ou une fenêtre** : `/run`, `/verify`, `/ultrareview`, Playwright.
6. **Décider par un tour de modèle.** L'évaluateur n'importe aucun SDK de modèle ni ne lance `claude`.
7. **Lancer `measure.py` dans une boucle** (il coûte un appel, environ 0,02 $) ; il tourne seulement à l'intérieur d'une commande acceptée.
8. **Écrire un texte de conversation, un prompt d'agent ou une raison libre au journal.** Des nombres et des codes seulement.
9. **Écrire hors de la racine du projet** (`<racine>/.cate/tmp/agence/`), ou envoyer le journal hors du Mac.
10. **Boucler.** Au plus un envoi par commande et par panneau dans le délai de repos ; au plus 3 envois automatiques par panneau et par jour.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Un déclencheur MUST se décider par une fonction pure (`evaluer(instantane) -> decisions`) sur des données locales déjà lues : `cate agent list`, `cate agent usage`, l'état de `agence`, le journal, l'horloge. Aucun appel à un modèle, aucun appel réseau, aucune lecture de la conversation. Le surcoût en jetons d'un tour du régisseur est de 0.
- **FR-002**: La table des déclencheurs MUST être déclarée une fois, dans un seul fichier de données (commande, `agentId` visé, condition, donnée, seuil, classe, délai de repos, plafond par jour, indicateur). Aucune liste de commandes ailleurs. Les seuils sont des constantes nommées, marquées « hypothèse à mesurer » tant que le bilan n'en a pas confirmé la valeur.
- **FR-003**: Une commande MUST partir par `cate agent send --panel <id> "<commande>"` seulement. `cate terminal type` et `cate terminal press` sur un panneau d'agent sont interdits (liste ci-dessus, point 1).
- **FR-004**: Avant un envoi de `/compact` ou de `/clear`, l'évaluateur MUST relire l'état du panneau : `state` = `waitingForInput`, `canReceivePrompt` vrai, `prompts` vide. Sinon la décision est `attendre`. Un prompt de ces deux commandes déjà en file dont la condition tombe MUST être repris par `cate agent withdraw`.
- **FR-005**: Chaque déclencheur MUST avoir une classe. A : envoi sans clic, uniquement si Q1 l'autorise et seulement pour une commande qui ne change aucun fichier de l'utilisateur (hypothèse : `/compact`). B : une carte dans le panneau agence, la commande part au clic de Heifara. Le clic est la seule autorité (principe de l'orchestrateur : une phrase dite à un agent ne vaut pas).
- **FR-006**: Une commande qui peut changer un fichier du setup ou de la mémoire (`/learn`, `/audit-config`, `/update-config`, `/fewer-permission-prompts`, `skill-creator`, `claude-md-improver`, `/autocompact`) MUST être de classe B, quelle que soit la réponse à Q1.
- **FR-007**: Le runtime de l'agence MUST tenir un journal `<racine>/.cate/tmp/agence/declencheurs/<AAAA-MM-JJ>.jsonl`, en ajout seul, un seul écrivain (la CLI `agence`), dossier `0700`, fichiers `0600`. Une ligne : `{ts, commande, classe, decision, panneau, raison, avant, apres, verdict}` ; `raison` est un code d'une liste fermée plus ses nombres (`ctx>=150000`, `merge:N`, `7j`), jamais un texte libre ; `avant` et `apres` sont des objets de nombres ou `null`.
- **FR-008**: La rétention du journal MUST être de 90 jours (hypothèse : la révision d'un seuil demande des semaines, contre 14 jours pour #76 qui n'en demande pas) ; la purge tourne au démarrage du régisseur puis une fois par jour, sur le nom du fichier, jamais sur `mtime`.
- **FR-009**: Chaque commande MUST avoir un indicateur de réussite chiffré, évalué par le régisseur à un horizon fixe :
  - `/compact` : réussite si `contextTokens` après ≤ 50 % de l'avant au deuxième tour suivant ; échec si ≥ 80 % ou si un second `/compact` est décidé dans le délai de repos.
  - `/clear` : réussite si `contextTokens` après ≤ 30 000 et le besoin continue sans nouvelle question sur une décision déjà notée (non mesurable seul : le verdict reste `sans-mesure` sur ce second point, dit tel quel).
  - `/learn` : réussite si Heifara répond « enregistrer », « améliorer » ou « absorber » à une des questions du skill dans les 30 minutes (lu dans le journal du besoin, clic) ; échec si « abandonner » ou aucune réponse.
  - `/audit-config` : réussite si au moins un candidat est accepté dans les 7 jours (lu dans `~/.claude/state/setup/ledger.jsonl` : nouvelle ligne `measure.py` dont le total exact est inférieur) ; sinon échec ; la lecture est en lecture seule.
  - Carte non lancée : verdict `ignoree` ; « Pas utile » : verdict `refusee`, compté contre la commande.
- **FR-010**: Le bilan (`agence declencheurs bilan [--jours N] [--json]`) MUST rendre par commande le nombre de décisions, de réussites, d'échecs, d'ignorées, et le gain médian de la mesure principale ; aucune ligne brute, aucun identifiant de panneau. Une commande à ≥ 3 échecs sur ses 5 derniers déclenchements MUST faire proposer une révision de seuil, chiffrée (par exemple +25 %), qui ne s'applique pas sans l'accord de Heifara.
- **FR-011**: La proposition d'ajouter un déclencheur (une friction qui revient deux fois) MUST rester une carte avec le texte exact de la ligne à ajouter ; rien n'est ajouté à la table, au setup ou à un skill sans l'accord de Heifara.
- **FR-012**: `cate agent usage` MUST rendre en plus `contextTokens` (taille du contexte au dernier tour, ou `null` sans comptage), déclaré une fois dans le contrat d'usage de `services/agents` et lu par le même moteur que les autres champs ; aucune lecture de `~/.claude/projects/` hors de ce moteur.
- **FR-013**: Cate MUST n'écrire aucun fichier utilisateur global (`~/.claude`, `~/.cate` hors données du workspace). La lecture de `~/.claude/state/setup/ledger.jsonl` et de `~/.claude/state/usage-ledger.jsonl` est en lecture seule et optionnelle (absents : le déclencheur correspondant reste muet et le dit).
- **FR-014**: Des tests MUST exister pour chaque ligne de « Ce que le cercle ne fait JAMAIS », écrits avant le code (rouge d'abord) ; un test de non-régression grep le code de l'évaluateur pour s'assurer qu'il n'importe ni SDK de modèle, ni `claude`, ni `measure.py`, ni `cate terminal`.
- **FR-015**: Anti-bruit : un délai de repos par commande et par panneau (hypothèse : `/compact` 10 min), un plafond de 3 envois automatiques par panneau et par jour, un « Plus pour cette commande » par commande (visible et réversible dans le panneau), une carte ouverte ne se duplique pas.
- **FR-016**: Le journal MUST rester local (aucune écriture réseau, aucune synchronisation) ; le bilan agrégé est la seule vue qu'un orchestrateur peut lire pour réviser un seuil quand Heifara le demande ; il ne lit pas les lignes brutes (même esprit que `agence observe list`).
- **FR-017**: Respect des couches du fork : le champ `contextTokens` est une extension de `services/agents` (contrat et côté runtime) ; l'évaluateur, le journal, le bilan et les cartes sont des fonctions de la CLI `agence` (`tools/agence/`, hors `src/`) ; la vue des cartes est celle du panneau agence côté desktop ; aucune branche sur le contexte local ou distant ni sur un type de panneau dans le code partagé (voir plan, « Constitution Check »).
- **FR-018**: Aucune dépendance ajoutée ; aucun service. Coût mensuel de la boucle : 0 € en service ; le coût des commandes lancées est celui qu'elles consomment (`/compact` un appel de résumé, `/learn` et `/audit-config` des tours, `measure.py` environ 0,02 $).
- **FR-019**: Le skill `orchestrateur` MUST recevoir en lot 5 une section courte qui dit ce que le régisseur fait seul, ce qui attend un clic, et ce que l'orchestrateur ne fait pas (envoyer lui-même `/compact` à un autre agent, taper dans un terminal, lire le journal brut).
- **FR-021**: Le 4e déclencheur (conso, q488) MUST être une carte de classe B, une par semaine et par projet (fenêtre de 7 jours), qui lance `conso.py` au clic. Il décide sur la date du journal (FR-001), ne lance rien seul, ne lit pas `conso.py` et ne le modifie pas (dépendance externe du dépôt Skills). Sortie : des nombres seulement. Indicateur (FR-009) : le nombre de relances de tests sans édition de la semaine est inférieur à celui de la semaine précédente (lu dans la sortie nombre-seulement) ; sinon échec.
- **FR-020**: Une commande MUST démarrer **à blanc** : l'évaluateur décide et journalise (`decision: "blanc"`, mesure avant, ce qui aurait été envoyé) sans rien envoyer, jusqu'à ce que Heifara l'active par une carte « Activer <commande> pour ce projet ». L'activation se lit au journal et se retire d'un clic.

### Key Entities

- **Déclencheur** : `{commande, agentId, condition, donnee, seuil, classe, repos, plafondJour, indicateur, hypothese}` ; une ligne de la table.
- **Décision** : `{declencheur, panneau, decision, raison, mesure}` ; `decision` ∈ `envoyer`, `carte`, `attendre`, `rien`.
- **Ligne du journal** : `{ts, commande, classe, decision, panneau, raison, avant, apres, verdict}` ; `verdict` ∈ `reussi`, `echec`, `ignoree`, `refusee`, `sans-mesure`, `en-cours`.
- **Mesure** : `{contextTokens, inputTokens, outputTokens, costUsd}` (chaque champ peut être `null`).
- **Carte** : une question de l'état de l'agence avec une action `cmd:<commande>@<panneau>` (même forme que `merge:owner/repo#N`) ; au clic sur « Lancer », le régisseur envoie la commande. La commande, la raison et les trois actions s'affichent dans la carte de question existante.
- **Réglage de commande** : muette ou non, par commande, dans l'état de l'agence (modifiable dans le panneau).

## Modèle de menaces

| # | Menace | Effet | Parade |
|---|---|---|---|
| M1 | Boucle : `/compact` en rafale, ou un `/clear` qui relance un travail qui regonfle le contexte, qui relance `/clear` | Jetons brûlés, travail perdu | Délai de repos, plafond de 3 par jour et par panneau (FR-015), `attendre` si un prompt est en file, test de rafale (instantané identique 100 fois : 1 décision) |
| M2 | `/compact` ou `/clear` détruit un état que l'orchestrateur ne tenait qu'en tête | Décision perdue, agent relancé deux fois | État dans `agence need` et son journal ; `agence boot` le rend ; la consigne de `/compact` le dit ; le bilan compte les relances après coupure ; **limite connue** : une décision jamais notée est perdue, comme à tout `/clear` |
| M3 | Un envoi tombe sur une saisie inachevée, un dialogue ou une permission | Texte collé, geste de l'humain écrasé | Le runtime garde `canReceivePrompt` (jamais de collage), FR-004 relit l'état, jamais `cate terminal type` |
| M4 | Un agent forge une condition (écrit un faux « PR mergée » dans un rapport) pour déclencher | Carte ou envoi piégés | L'évaluateur lit l'état de la CLI et GitHub (`gh`), pas le texte d'un agent ; le journal d'un besoin marque `cli` ce qu'un agent écrit, `clic` ce que l'humain a cliqué ; seule une carte cliquée lance une classe B |
| M5 | Le journal fuit (raison libre, texte de prompt) | Données d'usage lisibles | Codes et nombres seulement (FR-007), `0600`, 90 jours, aucun envoi (FR-016) ; test de non-capture (FR-014) |
| M6 | Un déclencheur change le setup en silence | Setup modifié sans accord | Classe B obligatoire (FR-006), cartes, confirmation du skill en plus, `check.py` à 0 échec après |
| M7 | Le seuil est faux et la commande ne sert pas (compactage inutile, audit vide) | Coût sans gain, lassitude, désactivation | Indicateur par commande (FR-009), bilan, révision chiffrée (FR-010), « Plus pour cette commande » |
| M8 | Une commande lancée coûte plus qu'elle ne rapporte (`/learn` sur un contexte énorme : un tour lit tout le contexte) | Jetons | `/learn` proposé sur une session **à contexte bas** de préférence (Q3) ; le gain d'un `/compact` se mesure sur le même panneau ; coût du tour d'un déclencheur lu dans le bilan |
| M9 | Un panneau compte parmi les 4 agents maximum et le déclencheur en ouvre un (`tooling-scout`) | Plafond Mac de 24 Go dépassé | Plafond de 4 agents Claude à la fois ; le déclencheur propose, ne lance qu'un panneau si une place est libre |

## Liens avec #100 (coût de l'attente d'un orchestrateur)

Cette spec **n'en refait pas la mesure ni les pistes**. #100 compare cinq pistes (attente en fond, ne pas attendre, session neuve par vague et `/compact` avant l'attente, `agence wait`, modèle moins cher) et retient « la plus simple qui tient ». Ce que cette spec ajoute : la piste 3 devient un déclencheur (User Story 1) avec seuil, garde-fous, journal et verdict ; les pistes 1, 2, 4 et 5 restent à #100. Deux règles pour ne pas se marcher dessus :

- #100 mesure le coût **par tour d'attente** ; ce journal mesure l'effet **d'une commande** sur le contexte. Le contexte avant et après un `/compact` est lu au même champ que la mesure de #100 (`cate agent usage`).
- Si #100 retient « ne pas attendre » ou `agence wait`, le seuil de `/compact` baisse en importance (moins de tours à relire) mais le déclencheur reste valable pour les sessions longues ; le bilan le dira.

## Success Criteria *(mandatory)*

- **SC-001**: 0 envoi par `cate terminal type` ou `press` sur un panneau d'agent, et 0 envoi de `/compact` ou `/clear` à un agent en plein tour ou bloqué, sur tous les instantanés fabriqués (FR-003, FR-004).
- **SC-002**: 0 appel à un modèle pour décider : test statique sur le code de l'évaluateur, et un tour de régisseur à vide n'ajoute aucun jeton à `cate agent usage` (mesure à faire au lot 1).
- **SC-003**: 100 % des décisions `envoyer` et `carte` ont une ligne au journal avec une mesure avant, et 100 % des `envoyer` ont une mesure après ou un `sans-mesure` motivé.
- **SC-004**: aucun fichier du journal n'existe tant qu'aucune décision n'a été prise ; aucun fichier de plus de 90 jours ne subsiste (horloge simulée).
- **SC-005**: sur le journal fixture, le bilan donne exactement les nombres attendus et propose une révision de seuil à partir de 3 échecs sur 5.
- **SC-006**: `/compact` sur l'orchestrateur : contexte après ≤ 50 % de l'avant dans au moins 3 cas sur 4 sur les premières semaines d'usage (**hypothèse à mesurer**, pas un engagement).
- **SC-007**: le tour d'attente de l'orchestrateur après `/compact` relit moins que le tour d'avant, mesuré avec l'outil de #100 sur au moins 3 cas.
- **SC-008**: `npm run lint:deps`, `npm run typecheck`, `npm run lint`, `npm test` et `npm run test:agence` verts à chaque lot.
- **SC-009**: aucun changement de `~/.claude` ni du setup d'un projet sans un clic de Heifara, vérifié par la liste « jamais » et par `check.py` à 0 échec en fin de lot.

## Assumptions

- macOS Apple silicon seulement (constitution, principe VIII).
- Coût mensuel de service : 0 € (aucun service, aucune dépendance, aucun appel à un modèle pour décider). Le coût des commandes lancées est celui de leurs tours : inconnu avant le premier bilan.
- La table ne vise que Claude Code (`agentId` `claude-code`) au départ ; les autres CLI n'ont pas les mêmes commandes.
- Les hooks de `~/.claude/settings.json` ne sont pas touchés : le journal et les mesures se font sans eux. Un hook `PreCompact` pour cadrer le résumé est une option qui demande l'accord de Heifara et `agence hooks install` (hors de cette spec).
- L'envoi d'une commande `/` par `cate agent send` s'exécute comme une saisie dans la session : le code l'indique (`terminal.ts:622-625`), **mais aucune des cinq commandes visées n'a été essayée** ; c'est le lot 0.
- Les jours estimés au plan sont des estimations ; aucun lot ne démarre sans la décision de Heifara.

## Questions ouvertes

Chacune a une hypothèse de travail, écrite dans la spec, qui tombe si la réponse change.

- **Q1** (q469, **tranchée par Heifara**) : autonomie. Décision : `/compact` part seul (classe A, après activation et mode à blanc, FR-020) ; tout le reste par carte (classe B). La table du plan met la classe A sur `/compact` seulement.
- **Q2** (q471, **tranchée par Heifara**) : les trois déclencheurs minimaux : `/compact` avant l'attente de l'orchestrateur, `/learn` après une PR mergée (carte), `/audit-config` hebdomadaire (carte). `/clear` en fin de vague (T4) et la recherche de skills sur friction répétée (T5 à T10) restent hors des trois premiers lots.
- **Q2 bis** (q488, **tranchée par Heifara**) : la mesure de consommation est le **4e déclencheur** : une carte hebdomadaire, « Lancer » au clic (classe B), 0 jeton, sortie en nombres seulement, fenêtre de 7 jours (`common/tools/conso.py`, dépôt Skills, dépendance externe). Les trois minimaux de Q2 restent `/compact`, `/learn` après merge, `/audit-config` ; la conso s'y ajoute, elle ne les remplace pas.
- **Q3** : sur quelle session part `/learn` ? L'orchestrateur voit le merge et reste ouvert ; l'agent qui a fait le travail connaît la leçon mais le besoin ferme son panneau. Hypothèse : l'orchestrateur, avec un résumé de la PR en argument ; un agent d'apprentissage dédié est écarté (un panneau de plus, plafond de 4).
- **Q4** : valeurs de départ des seuils (150 000 jetons pour `/compact`, 7 jours pour `/audit-config`, 48 h d'ignorance pour une carte, repos de 10 minutes). Toutes **hypothèses à mesurer**, aucune n'est une mesure ; le bilan les révise.
- **Q5** : où lire la taille du contexte ? Hypothèse : un champ `contextTokens` dans `cate agent usage` (FR-012, code dans `services/agents/usage`), lu par la même routine que le reste. Alternative écartée : le régisseur lit `~/.claude/projects/` (contourne le moteur, dépend du nommage d'un dossier de Claude).
- **Q6** : qui lit le journal ? Hypothèse : Heifara par `agence declencheurs bilan` ; l'orchestrateur lit le bilan agrégé seulement s'il le demande ; personne ne lit les lignes brutes par un modèle. Même esprit que #76, avec des données bien moins sensibles (nombres et commandes, aucun geste, aucune adresse).
- **Q7** : `/audit-config` est global (il audite `~/.claude`) mais le journal est par projet. Hypothèse : deux projets orchestrés posent deux cartes ; Heifara clique l'une, ignore l'autre ; limite connue. Alternative : lire la date du dernier passage de `measure.py` dans le registre global (lecture seule, FR-013).
- **Q8** : le verdict de `/audit-config` (« au moins un candidat accepté ») se lit dans le registre de `measure.py` ; hypothèse : suffisant au départ.
- **Q9** : quelles données de friction pour la User Story 5 ? Le registre d'`usage.py` ne garde que des totaux ; il faudrait y ajouter les commandes retapées et les erreurs d'outil normalisées (un changement de `~/.claude/setup/usage.py`, donc de `~/.claude` : accord de Heifara, dans le dépôt qui le tient). Hypothèse : User Story 5 hors des trois minimaux, spec séparée une fois les trois premiers mesurés.
