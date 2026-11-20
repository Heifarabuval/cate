# Feature Specification: Coût en jetons de l'attente d'un orchestrateur

**Feature Branch**: `docs/spec-cout-attente`

**Created**: 2026-11-20

**Issue**: Heifarabuval/cate#100 (reste ouverte : elle porte l'implémentation). Recoupe la spec 004 (T1, `/compact`) sans la refaire.

**Status**: Draft. Spec d'abord, PR de la spec seule, aucun code. Questions ouvertes en fin de document ; chacune a une hypothèse de travail.

**Input**: un orchestrateur qui attend ses agents relit tout son contexte à chaque tour. L'issue mesure environ 140 000 jetons lus par passage, un passage par minute, plus de 3 M de jetons pour 25 min d'attente, et pose cinq pistes. Il faut retenir la plus simple qui tient, la chiffrer, la découper. Le résultat doit servir **tout dev** qui orchestre, pas seulement Heifara.

Liens :
- [`mesure.md`](mesure.md) : la mesure sur les journaux de session, la méthode, ses limites, le protocole du lot 1.
- Spec `004-cercle-vertueux` : le déclencheur T1 (`/compact` avant l'attente, seuil 150 000) et T4 (`/clear` en fin de vague) sont à elle. Cette spec n'y revient pas.
- Spec `005-pratiques-reglables` (écrite en parallèle) : tout réglage par dev passe par elle (voir FR-008).

## Clarifications

### Session 2026-11-20

- Q: Qu'est-ce qui est déjà livré ? → A: sur `origin/main` : PR #85, `cate agent wait` accepte `--wait-timeout` de 5 000 à 600 000 ms (`src/services/agents/contract/api.ts:21`, défaut 30 000), vérifié dans le runtime courant par `cate agent wait --help` ; `contextTokens` dans `cate agent usage` (`b0a6eb15`, `e706b825`) ; l'évaluateur `/compact` de la spec 004 lot 2, en essai à blanc (`4b696ac3`, `tools/agence/declencheurs.json` T1 : seuil 150 000, repos 600 s, plafond 3). Le skill, lui, dit encore `--wait-timeout 60000` (`skills/orchestrateur/SKILL.md:28`).
- Q: L'attente est-elle le gros poste ? → A: non, et c'est la correction principale de l'issue. Sur 10 sessions d'orchestrateur (1 730 tours, 442,7 M de jetons lus du cache) les tours qui suivent un `cate agent wait` pèsent 50,3 M, soit 11,35 %. Les tours forcés par un Stop hook (`/goal`) en pèsent 61,3 M (13,9 %). Le reste, 66 %, est la boucle d'outils d'un contexte de 220 000 jetons en médiane. Voir `mesure.md`.
- Q: Le chiffre de l'issue (140 000 par passage) est-il faux ? → A: non, c'est une autre session. L'échantillon donne 370 127 par passage d'attente en moyenne (médiane 364 645) : les sessions mesurées sont plus longues. L'ordre de grandeur et la cause sont les mêmes.
- Q: Une notification de tâche de fond réveille-t-elle une session au repos sans tour intermédiaire ? → A: oui pour Claude Code (une commande lancée en fond relance la session à sa fin ; c'est ce que dit le harnais). Non vérifié dans un panneau Cate : sondes T010 et T011 du lot 2.
- Q: Un message `cate agent send` réveille-t-il un orchestrateur au repos ? → A: oui : « il part dès que l'agent peut en prendre un » (`cate agent send --help`) ; au repos il part tout de suite, en plein tour il attend en file. C'est le canal des rapports de sous-agents (brief du skill, ligne « Fin »).

## Vocabulaire

- **Passage d'attente** : un tour de l'orchestrateur qui commence par le résultat d'un `cate agent wait` et n'apporte rien de neuf (aucun rapport, aucune décision).
- **Jetons lus** : `cache_read_input_tokens` d'un tour, lu dans le journal de session. C'est la partie du coût que l'attente répète.
- **Filet** : un unique `cate agent wait` en tâche de fond, plafonné à 600 s, qui ne sert qu'à rattraper un agent silencieux.
- **Vague** : un lot d'agents lancés ensemble par l'orchestrateur, jusqu'à leurs rapports.
- **Indicateurs** : I1 jetons lus par passage d'attente, I2 part des passages d'attente dans les jetons lus, I3 tours forcés par un Stop hook, I4 contexte médian par tour. Définis dans `mesure.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - L'orchestrateur n'est pas relancé pendant que ses agents travaillent (Priority: P1)

L'orchestrateur lance une vague, puis **termine son tour**. Les agents lui rapportent par `cate agent send` ; chaque rapport arrive tout seul et déclenche un tour utile. Un seul filet en fond (600 s au plus) rattrape l'agent qui finit sans rapport. Il n'y a plus un tour par minute.

**Why this priority**: c'est le seul poste que le skill peut retirer sans code. Borne haute mesurée : 11,35 % des jetons lus de l'échantillon.

**Independent Test**: garde de texte sur `skills/orchestrateur/SKILL.md` (aucun `--wait-timeout 60000`, la règle de fin de tour et le filet présents) ; puis mesure du lot 4 sur une vague réelle : passages d'attente par 10 min d'attente.

**Acceptance Scenarios**:

1. **Given** une vague de 3 agents lancée, **When** l'orchestrateur a fini de les lancer et de les rattacher, **Then** il termine son tour sans appeler `cate agent wait` en avant-plan, et le filet est lancé en fond une seule fois pour les trois.
2. **Given** le filet lancé, **When** un rapport arrive, **Then** l'orchestrateur traite ce rapport, et le filet reste en cours ; s'il expire ensuite, il coûte au plus un tour.
3. **Given** un agent qui a fini sans envoyer de rapport, **When** le filet expire (au plus 600 s), **Then** l'orchestrateur lit `cate agent list`, voit l'agent au repos, lit son résultat avec `cate agent read` et relance ou clôt.
4. **Given** un agent en attente de permission ou de réponse, **When** le filet expire, **Then** rien n'est tapé dans son terminal ; la section Bloquant du suivi reste la seule voie (règle du skill).

---

### User Story 2 - Pas de `/goal` sur une session qui attend d'autres (Priority: P1)

Un `/goal` actif renvoie la session au travail à chaque fin de tour tant que sa condition est fausse. Pour un orchestrateur dont la condition dépend d'un clic humain, d'une merge ou d'un agent, chaque fin de tour devient un tour complet. Le skill interdit de poser une condition d'arrêt de ce genre sur l'orchestrateur et dit quoi faire à la place : une carte ou une ligne du suivi qui rappelle ce qui reste.

**Why this priority**: 132 tours, 61,5 M de jetons (13,9 %) dans l'échantillon, plus que l'attente elle-même. Sans cette règle, la User Story 1 ne tient pas : le Stop hook annule la fin de tour.

**Independent Test**: garde de texte sur le skill ; lot 4 : 0 tour forcé par un Stop hook (I3) sur une session orchestrateur sans `/goal`.

**Acceptance Scenarios**:

1. **Given** l'humain demande « continue jusqu'à ce que toutes les issues soient closes », **When** l'orchestrateur lit le skill, **Then** il le dit en une ligne (une condition qui dépend de clics humains forcerait un tour par fin de tour) et propose le suivi à la place, sans poser le `/goal`.
2. **Given** un `/goal` posé par l'humain lui-même, **When** il l'a voulu, **Then** l'orchestrateur ne le retire pas : le skill n'interdit que d'en poser un de sa propre initiative.

---

### User Story 3 - Un dev mesure le coût de l'attente avant et après (Priority: P2)

Un script en lecture seule lit les journaux de session d'un orchestrateur et rend des nombres : tours, jetons lus, part des passages d'attente, tours forcés par Stop hook, contexte médian. Il tourne avant la règle (lot 1) et après (lot 4), sur le même format, sur n'importe quel projet.

**Why this priority**: sans mesure après, « la piste tient » n'est qu'une phrase. Et la mesure est ce qui a corrigé l'hypothèse de l'issue.

**Independent Test**: un journal fixture de quelques tours donne exactement les nombres attendus ; aucun texte de conversation n'apparaît en sortie.

**Acceptance Scenarios**:

1. **Given** le journal fixture (7 tours : 2 passages d'attente, 1 tour forcé par un Stop hook, 4 tours d'outil), **When** le script tourne, **Then** il rend 7 tours, 2 passages d'attente, 1 tour Stop hook et les sommes de jetons lus attendues.
2. **Given** un agent qui n'est pas `claude-code`, **When** on demande la mesure, **Then** le script répond « non mesuré : journal de cet agent non lu » et rend un code de sortie 0.
3. **Given** un journal absent ou illisible, **When** le script tourne, **Then** il le dit et ne lève pas d'exception ; il n'écrit jamais dans le journal lu.

---

### Edge Cases

- Un agent finit sans rapport : rattrapé par le filet (US1, scénario 3). Coût : au plus 10 min de latence, jamais un tour par minute.
- Le filet expire alors que tous les agents ont déjà rapporté : un tour de trop, au plus un par vague. Accepté plutôt que d'ajouter un arrêt de tâche de fond.
- Deux vagues en même temps : un filet par vague, pas un par agent.
- Un rapport arrive pendant un tour de l'orchestrateur : il attend en file (`canReceivePrompt` faux), puis part. Aucun tour perdu.
- L'orchestrateur n'est pas dans Claude Code (autre `agentId`) : la règle de fin de tour vaut telle quelle (c'est `cate agent send`), le filet dépend de la tâche de fond de cet agent (non vérifié, voir Q3) ; la mesure dit « non mesuré ».
- Contexte déjà énorme au moment d'entrer en attente : c'est la spec 004 (T1, `/compact`). Cette spec ne compacte rien.

## Ce que cette spec ne fait PAS

- Pas de nouvelle commande `agence wait` ni de changement du régisseur (piste 4, voir plan.md pour la raison et la condition de reprise).
- Pas de changement de modèle pour l'attente (piste 5) : le modèle de l'orchestrateur est un choix de l'humain.
- Pas de compactage, pas de `/clear` : spec 004.
- Pas de code dans `src/`. Les seules lignes qui changent sont dans `skills/orchestrateur/SKILL.md`.
- Pas de réglage nouveau (voir FR-008).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: le skill `orchestrateur` dit qu'après avoir lancé et rattaché une vague, l'orchestrateur **termine son tour** ; les rapports arrivent par `cate agent send` et chacun relance un tour utile.
- **FR-002**: le skill dit que le suivi d'une vague passe par **un seul filet** : `cate agent wait <ids de la vague> --wait-timeout 600000` lancé en tâche de fond (`run_in_background`), jamais en avant-plan en boucle, jamais plus d'un par vague. Il remplace la ligne `--wait-timeout 60000` (`SKILL.md:28`).
- **FR-003**: au réveil par le filet, le skill dit de lire `cate agent list` puis `cate agent read <id>` pour les agents au repos sans rapport, et de ne jamais taper dans le terminal d'un agent (règle existante).
- **FR-004**: le skill interdit à l'orchestrateur de poser de sa propre initiative un `/goal` (ou toute condition d'arrêt qui renvoie au travail) dont la condition dépend d'un clic humain, d'une merge ou d'un agent. Il dit pourquoi en une ligne (un tour complet par fin de tour) et la voie de remplacement (le suivi, les cartes).
- **FR-005**: un script en lecture seule, `tools/agence/attente_mesure.py`, lit les journaux de session d'agents `claude-code` et rend les indicateurs I1 à I4 **en nombres seulement**, sans identifiant de panneau ni texte de conversation (même limite que les specs 003 et 004). Il ne lance aucun modèle et n'écrit rien.
- **FR-006**: la mesure avant (lot 1) et la mesure après (lot 4) utilisent le même script, la même définition d'un passage d'attente, et se comparent par indicateur. Une vague mesurée porte au moins 3 agents et 10 min d'attente.
- **FR-007**: aucun changement dans `src/`, `tools/agence/agence.py` ni `declencheurs.json` n'est fait par cette spec. Si le lot 4 montre plus d'un passage d'attente par 10 min malgré la règle, la piste 4 est rouverte comme une nouvelle spec, pas comme un correctif dans celle-ci.
- **FR-008**: la règle vit dans le skill, sans valeur propre à un dev. Le plafond du filet (600 s) est la constante de la plateforme (`AGENT_WAIT_MAX_SECONDS`), pas une pratique. Si un dev doit pouvoir régler un plafond d'attente ou un seuil de compactage, c'est une entrée de `specs/005-pratiques-reglables/` (la table de la spec 004 pour le seuil), pas un second mécanisme ici.
- **FR-009**: le skill reste de la même taille à 5 % près (13 936 octets avant) : la règle remplace des lignes, elle n'en ajoute pas plus de quelques-unes. Chaque octet du skill se relit à chaque tour.

### Key Entities

- **Journal de session** : le fichier JSONL de l'agent (pour `claude-code`, sous `~/.claude/projects/`). Lu en lecture seule par le script ; jamais copié, jamais envoyé.
- **Mesure d'une vague** : un objet de nombres (tours, jetons lus, passages d'attente, tours Stop hook, contexte médian, durée d'attente), sans texte.

## Modèle de menaces

Surface ajoutée : un script qui lit des journaux contenant des conversations. Garde-fous : sortie en nombres seulement (FR-005), aucun écriture, aucune sortie réseau, aucun modèle, refus d'un chemin hors du dossier de sessions du dev. Le contenu des journaux n'est jamais affiché ni stocké ; le rapport de mesure du lot 4 ne cite que des nombres. Le skill ne donne à l'orchestrateur aucun pouvoir de plus : le filet est une commande de lecture déjà permise (`cate agent wait`, accès `read`).

## Success Criteria *(mandatory)*

- **SC-001**: sur une vague réelle après la règle, au plus 1 passage d'attente par 10 min d'attente (avant : 1 par minute, `--wait-timeout 60000` utilisé 95 fois sur 96). Mesuré au lot 4.
- **SC-002**: I2 (part des passages d'attente dans les jetons lus) ≤ 2 % après, contre 11,35 % avant. **Hypothèse à mesurer** : elle suppose que le filet ne se déclenche pas plus d'une fois par vague.
- **SC-003**: I3 = 0 tour forcé par un Stop hook sur une session orchestrateur sans `/goal` posé par l'orchestrateur (avant : 132 tours, 61,5 M).
- **SC-004**: diff du lot 3 = `skills/orchestrateur/SKILL.md` et son test de texte seulement ; 0 ligne dans `src/` ; le skill ne grossit pas de plus de 5 % (FR-009).
- **SC-005**: sur le journal fixture, le script rend exactement les nombres attendus et aucun mot de la conversation ; sur les 10 journaux de l'échantillon il retrouve 1 730 tours et 442 732 472 jetons lus (reproductibilité de `mesure.md`).
- **SC-006**: le coût en euros n'est pas chiffré : `cate agent usage` rend `costUsd: null` pour le modèle de l'orchestrateur (tarif inconnu de la table). Les gains se disent en jetons lus.

## Assumptions

- Les agents rapportent bien par `cate agent send` en fin de tâche : c'est la ligne « Fin » du brief du skill, déjà en place. Cette spec ne la change pas.
- La tâche de fond de Claude Code réveille une session au repos à sa fin (dit par le harnais, non vérifié en panneau Cate : sondes T010 et T011).
- L'échantillon (10 sessions de l'orchestrateur « Agence : cate », du 2026-11-18 au 2026-11-20) est représentatif d'un orchestrateur en vague ; il ne l'est pas d'un dev qui orchestre une fois par semaine. Le lot 4 le dit s'il le faut.
- Le coût d'un jeton lu du cache est le même avant et après ; le gain se mesure en jetons, pas en euros (SC-006).

## Questions ouvertes

Chacune a une hypothèse de travail, écrite dans la spec, qui tombe si la réponse change.

- **Q1** : poser la règle d'attente dans le skill seul, ou aussi dans `skills/cate-cli/references/agents.md:15` (qui conseille déjà « repeat while it exits 1 ») ? *Hypothèse* : le skill orchestrateur seul ; `cate-cli` décrit la commande, pas la politique d'un orchestrateur. À confirmer par Heifara.
- **Q2** : la garde de texte du lot 3 (une assertion sur le contenu de `SKILL.md`) est-elle voulue, ou le skill se relit à la main ? *Hypothèse* : oui, un petit test de texte : le skill dit encore `--wait-timeout 60000` alors que la PR #85 est mergée, preuve qu'une valeur du skill et celle de la plateforme dérivent sans garde.
- **Q3** : le filet en tâche de fond marche-t-il pour un orchestrateur qui n'est pas Claude Code ? *Hypothèse* : non vérifié, hors cible (le skill vise Claude Code). La sonde T011 le dit pour Claude Code seulement.
- **Q4** : le script du lot 1 réutilise-t-il `~/.claude/tools/conso.py` (outil de mesure du dépôt Skills, lecture des journaux, nombres seulement) ? *Hypothèse* : non pour le lot 1, il vit dans ce dépôt (`tools/agence/`) et tourne chez tout dev ; si `conso.py` entre dans le dépôt via la spec 004 (4e déclencheur), on le réduit à un appel à sa lecture de journal. À trancher à la fusion des deux.
- **Q5** : `/goal` : l'interdiction est-elle posée dans le skill, ou y a-t-il un contrôle (le régisseur avertit quand le panneau orchestrateur a un `/goal` actif) ? *Hypothèse* : le skill seul ; un contrôle suppose de lire l'état `/goal` du panneau, donc du code et une donnée que Cate n'expose pas. Rouvrir si I3 reste haut au lot 4.
- **Q6** : mesurer aussi la piste 3 (effet de T1, `/compact`) dans ce lot 4 ? *Hypothèse* : oui pour I4 (contexte médian), puisque l'outil le donne gratuitement, mais l'attribution à T1 est du bilan de la spec 004, pas d'ici.
