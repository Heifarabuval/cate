---

description: "Tâches : cercle vertueux (issue #103)"
---

# Tasks: Cercle vertueux

**Input**: `specs/004-cercle-vertueux/` (spec.md, plan.md, inventaire.md)

**Prerequisites**: plan.md, spec.md. Tests demandés : la constitution (principe VI) les exige avant le code. Chaque tâche de test vient avant sa tâche de code et doit être vue **rouge** pour la bonne raison (sortie citée). Tout test qui écrit des fichiers tourne dans un dossier temporaire et échoue s'il voit le vrai `~/.cate` ou `~/.claude`.

**Interdits à tout agent** (constitution X) : lancer Playwright, Electron, l'app Cate ou `npm run dev`, ouvrir une fenêtre, lancer `npm ci` ou `npm install`, écrire dans le vrai `~/.cate` ou `~/.claude`, éditer `~/.claude/settings.json`, lancer `agence hooks`. Pas de merge, de push sur `main`, de force-push, de suppression de branche. Aucune dépendance ajoutée. Jamais `cate terminal type` ni `press` sur un panneau d'agent (hors du panneau jetable que le lot 0 a créé lui-même).

**État** : spec écrite, aucune tâche commencée. Q1 (q469) est tranchée : `/compact` seul, le reste par carte. Q2 (q471) est tranchée : `/compact`, `/learn` après merge, `/audit-config` hebdomadaire (lots 3 et 4). Q2 bis (q488) ajoute la conso comme 4e déclencheur (lot 4, T068). Q3 à Q9 ont une hypothèse de travail.

## Format: `- [ ] ID [P] [US] Description avec chemin`

- **[P]** : parallélisable (autre fichier, aucune dépendance non finie).
- **[US1] à [US5]** : récit de la spec. **[H]** : action de Heifara, jamais d'un agent.
- **Modèle** conseillé : haiku (mécanique), sonnet (implémentation courante), opus (garde-fous d'envoi et règle « jamais » : une erreur envoie une commande à un agent en plein tour).
- Un implémenteur par lot, un worktree par agent, un vérificateur différent de l'implémenteur.
- Un agent ne coche une tâche que sur preuve (sortie de commande, chemin:ligne).

## Lot 0 : sondes (0,5 j, avant tout code)

**But** : savoir, par l'essai, ce que le code laisse supposer.

- [x] T001 [H] Heifara répond à Q1 (q469 : `/compact` seul, le reste par carte) et Q2 (q471 : `/compact`, `/learn` après merge, `/audit-config` hebdomadaire). Preuve : `spec.md`, Clarifications.
- [ ] T002 [P] Sonde d'envoi : démarrer **un agent jetable** (`cate agent start`, panneau, modèle le moins cher, titre `#n466 sonde`), lui envoyer successivement `/context`, `/compact`, `/clear` par `cate agent send`, lire l'état (`cate agent list --json`, `cate agent read`). Noter pour chaque commande : le prompt est-il pris, la commande s'exécute-t-elle, un dialogue reste-t-il ouvert (`cate terminal read`, lecture seule), l'agent revient-il à `waitingForInput`. Fermer le panneau. Livrable : `specs/004-cercle-vertueux/rapport-lot-0.md`, verdict « sans dialogue / dialogue / non pris » par commande. Interdit : l'orchestrateur ou un panneau de travail comme cible.
- [ ] T003 [P] Sonde des skills : sur le même agent jetable, `/learn` puis `/audit-config` par `cate agent send`. Noter ce qui part (pas d'écriture : répondre « abandonner » ou fermer avant), où s'affiche la question de confirmation en projet orchestré, et si le skill exige l'outil de question (bloqué par `cate-guard` en projet orchestré). Même livrable.
- [ ] T004 [P] Sonde de la donnée : sur 3 sessions vivantes, lire `contextTokens` calculé à la main depuis le journal de session (dernier message `assistant` : entrée, création de cache, lecture de cache) ; **[H]** Heifara compare au chiffre de `/context` dans le panneau. Noter l'écart. Mesurer aussi la durée d'un passage de `usage.py --days 7` (lecture seule) et la forme de sa sortie texte (pour Q9). Même livrable.
- [ ] T005 [H] Relire le rapport avec Heifara : quelles commandes entrent dans la table (seulement celles sondées sans dialogue), `contextTokens` fiable ou non. Aucun lot ne démarre sans cette relecture.

## Lot 1 : `contextTokens` dans `cate agent usage` (1,5 j, FR-012)

**But** : la seule donnée qui manque. Un champ, aucune dépendance.

### Tests d'abord (à voir rouges)

- [ ] T010 [P] [US1] `src/services/agents/runtime/usage/usage.test.ts` (ajouts) : un transcript fixture à trois réponses rend `contextTokens` égal à la somme entrée + création de cache + lecture de cache du **dernier** message ; sans comptage de jetons : `null` ; transcript tronqué ou sans message `assistant` : `null` ; plusieurs sessions (un `/clear` entre deux) : la dernière session seulement. Vu rouge : champ absent.
- [ ] T011 [P] [US1] `src/cli/engine.test.ts` ou le test de format de `cate agent usage` : l'aide et la sortie texte et JSON montrent `contextTokens` ; un agent sans comptage garde le tiret.

### Implémentation

- [ ] T012 [US1] `src/services/agents/contract/usage/types.ts` : `contextTokens: number | null` dans le résumé par panneau (contrat pur). Rend T011 vert.
- [ ] T013 [US1] `src/services/agents/runtime/usage/` (records, summary) : calcul au dernier enregistrement de la session ; magasins sans comptage : `null`. Rend T010 vert. Aucun import de `~/.claude` hors du moteur.
- [ ] T014 [US1] `docs/architecture.md` (usage : `contextTokens`) et `skills/cate-cli/references/agents.md`. `npm run lint:deps`, `typecheck`, `lint`, `test` verts (SC-008).
- [ ] T015 Vérificateur : relit le diff, relance les quatre commandes, lit `cate agent usage --json` sur deux sessions réelles et confirme que `contextTokens` est présent et du bon ordre de grandeur (la comparaison à `/context` reste T004).

## Lot 2 : évaluateur, journal, bilan, mode à blanc (2 j, US4)

**But** : décider et journaliser sans rien envoyer. Le cercle tourne à blanc.

### Tests d'abord

- [ ] T020 [P] [US4] `tools/agence/test_declencheurs.py` : **schéma de la table** (`declencheurs.json`) : chaque ligne a commande, `agentId`, condition, donnée, seuil, classe, repos, plafond par jour, indicateur, drapeau hypothèse ; une commande de setup (`/learn`, `/audit-config`, `/update-config`, `/fewer-permission-prompts`, `/autocompact`, `skill-creator`, `claude-md-improver`) en classe A est refusée au chargement (FR-006).
- [ ] T021 [P] [US1] `tools/agence/test_declencheurs.py` : **T1 sur instantanés** : contexte à 149 999, 150 000 et 150 001 ; agent en tour, bloqué sur une permission, au repos avec un prompt en file, au repos : décision attendue (`rien`, `rien`, `blanc`, seulement quand tout est ouvert). Même instantané 100 fois : une décision (rafale, M1). Repos de 10 minutes : le même seuil franchi à 9 min : `attendre` ; horloge qui recule : `attendre`.
- [ ] T022 [P] [US4] `tools/agence/test_declencheurs.py` : **journal** : état neuf, 0 fichier ; une ligne `{ts, commande, classe, decision, panneau, raison, avant, apres, verdict}` ; `raison` hors de la liste fermée rejetée ; texte libre dans un champ rejeté ; modes `0700` et `0600` ; ajout seul ; ligne illisible ignorée par le bilan.
- [ ] T023 [P] [US4] `tools/agence/test_declencheurs.py` : **purge** : J-89 reste, J-90 reste, J-91 supprimé ; nom invalide ignoré et signalé, jamais supprimé ; sur le nom, pas sur `mtime`.
- [ ] T024 [P] [US4] `tools/agence/test_declencheurs.py` : **verdicts et bilan** : `/compact` avant 180 000, après 80 000 : `reussi` ; après 160 000 : `echec` ; mesure absente : `sans-mesure` avec raison, une fois par jour ; bilan par commande (nombre, taux, gain médian) sur un journal fixture de 30 jours ; **aucun identifiant de panneau** dans la sortie ; 3 échecs sur 5 : une proposition de seuil chiffrée, aucune écriture.
- [ ] T025 [P] [US4] `tools/agence/test_declencheurs.py` : **non-capture et « jamais »** (FR-014) : l'évaluateur n'importe ni SDK de modèle, ni `claude`, ni `measure.py`, ni `cate terminal` (grep du code) ; une raison ne contient jamais le texte d'un prompt ou d'un rapport d'agent ; registres `~/.claude/state/...` absents : le déclencheur concerné se tait sans erreur.

### Implémentation

- [ ] T026 [US4] `tools/agence/declencheurs.json` : T1, T2, T3 (et T4 à T10 présentes, `actif: false`, marquées hypothèse). Rend T020 vert.
- [ ] T027 [US1] `tools/agence/agence.py` : `evaluer(instantane, table, journal, maintenant)` pure ; `un_tour` lit `contextTokens` (en plus de `costUsd`) et passe l'instantané ; décision `blanc` journalisée. Rend T021 vert.
- [ ] T028 [US4] `tools/agence/agence.py` : journal, purge au démarrage et une fois par jour, verdicts deux tours plus tard. Rend T022, T023, T024 verts.
- [ ] T029 [US4] `tools/agence/agence.py` : `agence declencheurs bilan [--jours N] [--json]` et son aide. Rend T024 vert.
- [ ] T030 [US4] Rend T025 vert : compléter les cas, jamais en affaiblissant le test.
- [ ] T031 Vérificateur : relit le diff, relance `npm run test:agence`, lance `evaluer` sur un instantané réel copié de `cate agent list --json` et `cate agent usage --json` (sorties collées dans un fichier de test, rien envoyé), vérifie que le journal reste vide en l'absence de décision et que `tick` n'ajoute aucun appel à un modèle.
- [ ] T032 [H] Une à deux semaines à blanc sur un vrai orchestrateur : Heifara lit le bilan (`agence declencheurs bilan`) et valide ou corrige les seuils de T1 à T3 avant le lot 3.

## Lot 3 : envoi de T1 et cartes (2 j, US1)

**But** : `/compact` part au bon moment ; les commandes de classe B passent par une carte. Dépend de la décision de T005 sur la sonde de `/compact`.

### Tests d'abord

- [ ] T040 [P] [US1] `tools/agence/test_declencheurs.py` : **envoi** (FR-003, FR-004) : agent en plein tour, bloqué sur une permission, avec un prompt en file, avec une saisie inachevée : 0 envoi ; au repos : exactement un `cate agent send --panel <id> "/compact ..."`, jamais `cate terminal type` ni `press` (un faux `cate` enregistre les appels) ; relecture de l'état juste avant l'envoi : l'état change entre la décision et l'envoi : pas d'envoi ; un prompt déjà en file dont la condition tombe : `cate agent withdraw`.
- [ ] T041 [P] [US1] `tools/agence/test_declencheurs.py` : **activation** (FR-020) : tant que la commande n'est pas activée, décision `blanc` (rien ne part) ; la carte « Activer `/compact` pour ce projet » passe la commande en `envoyer` ; « Plus pour cette commande » la rend muette, visible et réversible.
- [ ] T042 [P] [US1] `tools/agence/test_declencheurs.py` : **carte** : une question avec action `cmd:/compact@<panneau>` ; un clic sur l'option 0 envoie ; double clic : un seul envoi ; panneau fermé entre la carte et le clic : refus lisible ; carte ignorée 48 h : disparaît, verdict `ignoree`.
- [ ] T043 [P] [US1] `tools/agence/test_declencheurs.py` : **plafonds** : 3 envois automatiques par panneau et par jour, le 4e : `attendre` ; deux commandes différentes ne se bloquent pas.
- [ ] T044 [P] `src/shells/desktop/ui/panels/agence/QuestionCard.test.tsx` (ajouts, jsdom) : une question à action `cmd:` affiche la commande, la raison et les trois actions ; double clic : une seule requête. Aucune fenêtre.

### Implémentation

- [ ] T045 [US1] `tools/agence/agence.py` : effet `('send', panneau, commande, id)` appliqué par `apply`, relecture avant envoi, `withdraw`. Rend T040 vert.
- [ ] T046 [US1] `tools/agence/agence.py` : activation, mute, carte `cmd:`, clic dans `click`. Rend T041, T042, T043 verts.
- [ ] T047 [US1] `src/shells/desktop/ui/panels/agence/QuestionCard.tsx` : libellés de la carte `cmd:`. Rend T044 vert.
- [ ] T048 [US1] Verdict de T1 (contexte après ≤ 50 % de l'avant) branché sur les lignes `envoyer`. 
- [ ] T049 Vérificateur : même contrôle que T031, plus une relecture ligne à ligne de la liste « jamais » de spec.md contre les tests ; vérifie qu'aucun appel `cate terminal` n'existe dans `tools/agence/agence.py` hors des lectures déjà présentes (`lire_ecran`).
- [ ] T050 [H] X001 : Heifara active `/compact` sur un orchestrateur réel, regarde un déclenchement et son verdict ; aucun agent ne lance l'app.

## Lot 4 : `/learn` après merge et `/audit-config` hebdomadaire (1,5 j, US2 et US3)

**But** : les deux autres déclencheurs minimaux, en classe B.

### Tests d'abord

- [ ] T060 [P] [US2] `tools/agence/test_declencheurs.py` : besoin `done` par `pr-merged:N` : une carte `/learn`, une seule après plusieurs tours ; « Pas utile » : plus de carte pour ce besoin et un `refusee` compté ; « Plus pour cette commande » : plus de carte `/learn` ; expiration à 48 h ; besoin clos sans merge : aucune carte.
- [ ] T061 [P] [US2] `tools/agence/test_declencheurs.py` : **verdict de `/learn`** : une réponse « enregistrer », « améliorer » ou « absorber » dans les 30 min : `reussi` ; « abandonner » ou rien : `echec` ; lu dans le journal du besoin (`clic`), jamais dans le texte d'un agent (`cli`).
- [ ] T062 [P] [US3] `tools/agence/test_declencheurs.py` : **T3** : dernière ligne `/audit-config` il y a 6 jours : 0 carte ; 7 jours : 1 ; carte ouverte : pas de doublon ; agent en plein tour : `attendre` ; registre global absent : la date du journal seule décide ; `measure.py` jamais appelé (le test échoue si l'appel est vu).
- [ ] T063 [P] [US3] `tools/agence/test_declencheurs.py` : **verdict de `/audit-config`** : une nouvelle ligne de `ledger.jsonl` dont le total exact baisse dans les 7 jours : `reussi` ; sinon `echec` ; fichier absent ou illisible : `sans-mesure` ; lecture seule (le test vérifie la date de modification du fichier).

### Implémentation

- [ ] T064 [US2] `tools/agence/agence.py` : détection du besoin clos par merge (le régisseur la fait déjà pour fermer les panneaux), carte `/learn` vers la session désignée (Q3), verdict. Rend T060 et T061 verts.
- [ ] T065 [US3] `tools/agence/agence.py` : T3 sur la date du journal, lecture seule du registre, verdict. Rend T062 et T063 verts.
- [ ] T068 [US6] `tools/agence/test_declencheurs.py` puis `tools/agence/agence.py` + `declencheurs.json` : 4e déclencheur conso (q488), carte hebdomadaire de classe B qui lance `common/tools/conso.py` (dépôt Skills, dépendance externe, jamais lu ni modifié ici) au clic : 6 jours : 0 carte, 7 jours : 1, outil absent : `sans-mesure`. Test rouge d'abord. Pas de code dans cette spec.
- [ ] T066 Vérificateur : même contrôle que T031 ; relecture : aucun fichier de `~/.claude` écrit (comparer les dates de modification avant et après les tests).
- [ ] T067 [H] X002 : Heifara clique une carte `/learn` et une carte `/audit-config` sur un projet réel, lit leurs questions de confirmation dans le panneau agence.

## Lot 5 : règle de l'orchestrateur et documentation (1 j)

- [ ] T070 `skills/orchestrateur/SKILL.md` : section « Déclencheurs » : ce que le régisseur envoie seul (selon Q1), ce qui attend un clic, ce que l'orchestrateur ne fait pas (envoyer `/compact` à un autre agent, taper dans un terminal, lire le journal brut, lancer `measure.py`), et comment lire `agence declencheurs bilan`. Test : l'aide de `agence` et la section citent les mêmes noms de commandes.
- [ ] T071 `docs/architecture.md` (agence : évaluateur, journal, cartes `cmd:` ; usage : `contextTokens`), `CLAUDE.md` du fork (une ligne : journal des déclencheurs, `<racine>/.cate/tmp/agence/declencheurs/`), `skills/cate-cli/references/agents.md`.
- [ ] T072 Liste du code mort supprimé dans la PR (aucun attendu : module neuf) et grep des occurrences voisines (autre mention de « `/new` » à corriger en `/clear` pour Claude Code).
- [ ] T073 Vérificateur : même contrôle que T031 ; relit les trois documents contre le code.

## Lot X : fin (0,5 j, puis une semaine de mesure)

- [ ] T090 [H] X003 : un orchestrateur réel, `/compact` activé, une semaine ; lire le bilan ; comparer le coût du tour d'attente avant et après avec la mesure de #100 ; rapport dans #103.
- [ ] T091 [H] Réviser un seuil sur les données (si le bilan en propose un) ou déclarer le cercle fermé pour T1 à T3. Les déclencheurs T4 à T10 sont chacun une décision de Heifara (spec suivante : normaliser les données de friction, Q9).
- [ ] T092 Fermer l'issue #103 seulement quand les lots 1 à 5 sont mergés ; chaque PR de lot écrit `Réf. #103`, la dernière écrit `Closes #103` (règle « issue réglée = issue fermée »).

## Dépendances et ordre

- Lot 0 d'abord (0,5 j). Lots 1 et 2 ensuite, en parallèle possible (TypeScript et Python, fichiers différents) ; un vérificateur par lot.
- Lot 2 : au moins une semaine à blanc (T032) avant le lot 3 si Heifara veut régler les seuils sur des données.
- Lot 3 après 1, 2 et Q1. Lot 4 après 3. Lot 5 après 4.
- Lien avec #100 : T1 est la piste 3 de #100 ; si #100 retient d'abord une autre piste, le lot 3 se mesure contre elle (SC-007).
- Plafond d'agents du Mac : 4 agents Claude à la fois au maximum, un panneau fermé dès qu'il a fini.

## Couverture

| Récit | Tâches |
|---|---|
| US1 `/compact` avant l'attente | T010 à T015 (donnée), T021, T027, T040 à T050 |
| US2 `/learn` après merge | T060, T061, T064, T067 |
| US3 `/audit-config` hebdomadaire | T062, T063, T065, T067 |
| US4 journal, bilan, seuils | T020 à T032 |
| US5 friction vers `/` de recherche de skills | hors lots (Q9) ; T026 porte les lignes `actif: false` |
| Menaces M1 à M9 | M1 : T021, T043 ; M2 : T070 (consigne), T090 ; M3 : T040 ; M4 : T061 ; M5 : T022, T025 ; M6 : T020, T066 ; M7 : T024 ; M8 : T060 ; M9 : T040 (plafond d'agents) |
