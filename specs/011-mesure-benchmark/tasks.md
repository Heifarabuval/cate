---

description: "Tâches : mesure par benchmark, critère de passage de la couche 1 (spec 011)"
---

# Tasks: Mesure par benchmark

**Input**: `specs/011-mesure-benchmark/` (spec.md, plan.md) ; `specs/009-vision-v2/spec.md` (récit 2, FR-011, FR-012, FR-014, SC-002, SC-003, SC-006).

**Prerequisites**: plan.md, spec.md. Tests demandés : la constitution (principe VI) les exige avant le code. Chaque tâche de test vient avant sa tâche de code et doit être vue **rouge** pour la bonne raison (sortie citée). Tout test tourne en faux HOME et en dossier temporaire ; `gh`, `claude`, `open`, `osascript`, `electron`, `npx`, `playwright`, `npm` sont de faux exécutables sur le PATH ; `git` est le vrai, sur des dépôts créés dans le dossier temporaire.

**Interdits à tout agent** (constitution X) : lancer Playwright, Electron, l'app Cate ou `npm run dev`, ouvrir une fenêtre, lancer `npm ci` ou `npm install`, écrire dans le vrai `~/.cate`, `~/.claude` ou `~/.config`, jouer un rejeu à la place de l'humain, modifier `seuil.json` après son commit, relancer des tests sans édition depuis leur dernière exécution verte.

**État** : spec écrite, aucune tâche commencée. Q1 à Q5 ouvertes avec hypothèse (spec.md), aucune ne bloque les lots 1 et 2.

## Format: `- [ ] ID [P] [US] Description avec chemin`

- **[P]** : parallélisable (autre fichier, aucune dépendance non finie).
- **[US1] à [US3]** : récit de spec.md. **[H]** : action de Heifara, jamais d'un agent.
- **Modèle** conseillé : haiku (mécanique), sonnet (implémentation courante), opus (règle du temps actif, contamination, verdict : une erreur fausse la décision de couche).
- Un implémenteur par lot, un worktree par agent, un vérificateur différent de l'implémenteur. Un agent ne coche une tâche que sur preuve (sortie de commande, chemin:ligne).
- Portes de chaque PR : `npm run test:agence` ; `npm run typecheck && npm run lint && npm run lint:deps && npm test` seulement si un fichier hors `tools/agence/`, `skills/` et `specs/` change (aucun prévu). La PR dit ce qu'elle supprime, l'écart avec upstream (aucun dans `src/`) et s'il faut relancer Cate (non).

## Lots, vue d'ensemble

| Lot | Récits | Taille | Dépend de | Parallélisable avec |
|---|---|---|---|---|
| **1. Mesure étendue** (`attente_mesure.py`) | US1 | 1 j | rien | 2 |
| **2. Harnais : tirage, clone, arbitre, gardes** | US1, US3 | 1,5 j | rien | 1 |
| **3. Mesure de rejeu, revue, seuil, rapport** | US1 | 1 j | 1, 2 | aucun (même `benchmark.py` que 2 et 6) |
| **4. Pilote** | US1 | 0,5 j agent + [H] ~4 h (hypothèse) | 3 | 6 |
| **5. Campagne et verdict de couche 1** | US1 | 0,5 j agent + [H] 10 à 30 h (hypothèse) | 4 ; MVP de la spec 010 (hypothèse Q3) | 6 |
| **6. Comparaison et règle d'économie** | US2 | 1 j | 1, 2 ; après 3 sur `benchmark.py` ; `SKILL.md` après 006-L3, 005-L4 et 010-L4 | 4, 5 |

Ordre conseillé : {1, 2} ensemble, puis 3, puis {4 puis 5} et {6} ensemble. Les lots 2, 3 et 6 partagent `tools/agence/benchmark.py` et `test_benchmark.py` : une PR à la fois, rebase de la suivante.

---

## Lot 1 : mesure étendue, `attente_mesure.py` (US1)

**But** : la lecture de la spec 006 rend les quatre postes de jetons, lit plusieurs dossiers, et rend les instants des interventions humaines et machine ; aucune sortie existante ne change.

**Tests d'acceptation** : `python3 -m unittest tools.agence.test_attente_mesure` vert (nouveaux tests vus rouges d'abord) ; les 8 tests existants (`test_a` à `test_h`) passent sans retouche ; sur la fixture `fixtures/bench/nu/`, la sortie `--json` donne les nombres écrits dans T001 ; `grep -c` d'un mot de la conversation de la fixture dans la sortie : 0.

**Fichiers touchés** : `tools/agence/attente_mesure.py`, `tools/agence/test_attente_mesure.py`, `tools/agence/fixtures/bench/nu/*.jsonl`, `tools/agence/fixtures/bench/outil/*.jsonl` (nouveaux).

**Dépend de** : rien. **Parallélisable avec** : lot 2. **Critère de fin** : checkpoint ci-dessous et PR ouverte.

### Tests d'abord

- [ ] T001 [P] [US1] `tools/agence/fixtures/bench/` et `test_attente_mesure.py` : deux fixtures écrites à la main avec leurs nombres attendus **avant** le code : `nu/` (une session : 6 tours, 3 messages humains, des `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens` connus) ; `outil/` (trois sessions dans deux dossiers, préfixe commun : orchestrateur, agent dans un worktree, un message utilisateur de l'orchestrateur identique au texte d'un `cate agent send` de l'agent). Modèle : sonnet.
- [ ] T002 [P] [US1] `test_attente_mesure.py` : **jetons par poste** : `jetons_entree`, `jetons_cache_cree`, `jetons_lus`, `jetons_sortie`, `jetons_total` exacts sur les deux fixtures ; dédoublonnage par `message.id` conservé. Modèle : sonnet.
- [ ] T003 [P] [US1] `test_attente_mesure.py` : **plusieurs dossiers** : `mesurer([d1, d2])` égale la somme des deux mesures ; un préfixe de chemin encodé trouve le clone et ses worktrees (`~/.claude/projects/<préfixe>*`), et rien d'autre (un dossier voisin de même début mais hors préfixe exact `-` n'est pas pris). Modèle : sonnet.
- [ ] T004 [P] [US1] `test_attente_mesure.py` : **interventions** (règle de plan.md, décision 1) : `interventions(chemins)` rend, triés, des couples (instant, `humain`|`machine`|`systeme`) ; sur `outil/`, le message identique au `cate agent send` est `machine` ; les préfixes `<task-notification>`, `Stop hook feedback`, `Another Claude session sent` sont `machine` ; aucune chaîne de texte dans la valeur rendue. Modèle : opus.
- [ ] T005 [P] [US1] `test_attente_mesure.py` : **zéro modèle** (009 SC-006) : le script tourne avec un faux `claude` et un faux `curl` sur le PATH qui échouent s'ils sont appelés ; il n'importe ni `urllib.request`, ni `http.client`, ni `socket` (lecture du source). Modèle : haiku.

### Implémentation

- [ ] T006 [US1] `tools/agence/attente_mesure.py` : `lire` ajoute `input_tokens` et `cache_creation_input_tokens` à `acc` (`:81-82`) ; `resume` ajoute trois clés ; `mesurer` accepte une liste de dossiers et un préfixe ; `interventions` (comparaison de textes par empreinte en mémoire, jamais rendue). Moins de 80 lignes ajoutées. Rend T002 à T005 verts. Modèle : sonnet (T004 : opus).
- [ ] T007 Portes et PR du lot 1. Corps : `Réf. #<issue de l'epic>`, ce qui ne change pas (sorties existantes, 8 tests de 006 intacts). Modèle : haiku.

**Checkpoint lot 1** : sur `fixtures/bench/outil/`, la mesure rend les jetons des trois sessions et classe le rapport d'agent en `machine`.

---

## Lot 2 : harnais, tirage, clone, arbitre, gardes (US1, US3)

**But** : `benchmark.py select`, `prepare`, `debut`, `fini` (avec arbitre) et le contrôle de contamination marchent sur un faux dépôt, sans rien lancer d'interdit.

**Tests d'acceptation** : `python3 -m unittest tools.agence.test_benchmark` vert (rouge d'abord) ; sur un dépôt git créé en dossier temporaire (5 commits, une « PR » simulée par un faux `gh`), `prepare` donne un clone sans remote et sans le commit de la PR (`git log --all` : un commit) ; `fini` rend « vert » avec le correctif d'origine appliqué et « rouge » sans ; aucun faux exécutable interdit appelé.

**Fichiers touchés** : `tools/agence/benchmark.py` (nouveau), `tools/agence/test_benchmark.py` (nouveau), `tools/agence/fixtures/bench/gh/` (sorties JSON du faux `gh`), `tools/agence/fixtures/bench/bin/` (faux exécutables).

**Dépend de** : rien. **Parallélisable avec** : lot 1. **Critère de fin** : checkpoint et PR ouverte.

### Tests d'abord

- [ ] T010 [P] [US1] `test_benchmark.py` : **vivier et tirage** (spec FR-002) : sur la sortie du faux `gh` (25 PR dont 6 inéligibles : sans issue, sans test, tests seulement sous `e2e/`), le vivier compte 19 ; `select --graine 7` deux fois : `selection.json` identique à l'octet ; 2 pilotes, 10 de campagne, 5 de réserve, 1 de comparaison, disjoints ; chaque issue porte son bras de départ ; vivier de 17 : refus (code 2) qui dit qu'il en manque 1. Modèle : sonnet.
- [ ] T011 [P] [US1] `test_benchmark.py` : **clone** (FR-004) : `prepare` crée `<racine>/<issue>-<bras>/` au `baseRefOid` ; `git remote` vide ; `git log --all` ne contient aucun commit postérieur ; énoncé `<racine>/<issue>-<bras>.md` hors du clone, avec titre et corps, sans commentaires ; un second `prepare` pendant un rejeu ouvert : refus. Modèle : sonnet.
- [ ] T012 [P] [US1] `test_benchmark.py` : **dépendances** : lockfile identique : `node_modules` cloné par `cp -c` (vérifié par la présence du fichier témoin) ; lockfile différent : état « dépendances à installer », aucun appel du faux `npm`. Modèle : sonnet.
- [ ] T013 [P] [US1] `test_benchmark.py` : **arbitre** (FR-007) : les fichiers de test de la PR sont copiés depuis `headRefOid` ; seul `./node_modules/.bin/vitest run <fichiers>` (faux, dans le clone) ou `python3 -m unittest <modules>` est lancé ; « vert », « rouge », « non lançable » (binaire absent) ; aucun contenu de test affiché ; le 4e `fini` rouge donne « échec ». `debut` et `fini` horodatent en UTC. Modèle : sonnet.
- [ ] T014 [P] [US3] `test_benchmark.py` : **contamination** (FR-008) : un journal du rejeu dont un appel d'outil cite `Heifarabuval/cate`, `/pull/<N>`, le numéro de la PR avec `gh pr`, ou son `headRefOid` : rejeu `invalide` ; un journal propre : `valide` ; la sortie ne cite pas l'appel fautif, seulement son nombre. Modèle : opus.
- [ ] T015 [P] [US3] `test_benchmark.py` : **gardes de la constitution X** (009 FR-014) : toutes les sous-commandes du lot tournent avec les faux `open`, `osascript`, `electron`, `npx`, `playwright`, `npm`, `claude` qui écrivent un témoin s'ils sont appelés : aucun témoin ; le source ne contient ni `npm ci`, ni `npm run dev`, ni `playwright`, ni `open -a`. Modèle : haiku.

### Implémentation

- [ ] T016 [US1] `tools/agence/benchmark.py` : `select`, `prepare`, `debut`, `fini`, arbitre, contrôle de contamination, état du rejeu ouvert dans `<racine>/ouvert.json`. Stdlib seule, `argparse` comme `attente_mesure.py`. Rend T010 à T015 verts. Modèle : sonnet (contamination : opus).
- [ ] T017 Portes et PR du lot 2. Corps : « aucune fenêtre, aucun `npm ci` : gardes T015 ». Modèle : haiku.

**Checkpoint lot 2** : un clone préparé ne contient pas la solution ; l'arbitre la reconnaît quand on l'applique.

---

## Lot 3 : mesure de rejeu, revue à l'aveugle, seuil, rapport (US1)

**But** : un résultat JSON par rejeu, un seuil pré-rempli, un rapport qui rend le verdict ou refuse.

**Tests d'acceptation** : `test_benchmark.py` vert (nouveaux tests rouges d'abord) ; sur la fixture de campagne (4 issues × 2 bras, résultats écrits à la main), `rapport` rend exactement les médianes, les rapports et le verdict attendus ; deux lancements identiques à l'octet ; seuil modifié : refus.

**Fichiers touchés** : `tools/agence/benchmark.py`, `tools/agence/test_benchmark.py`, `tools/agence/fixtures/bench/campagne/` (résultats, seuil, état agence avec clics), `specs/011-mesure-benchmark/seuil.json` (nouveau, pré-rempli).

**Dépend de** : lots 1 et 2. **Parallélisable avec** : aucun (même fichier que 2 et 6). **Critère de fin** : checkpoint et PR ouverte.

### Tests d'abord

- [ ] T020 [P] [US1] `test_benchmark.py` : **temps actif** : sur `fixtures/bench/outil/` plus un `state.json` agence avec 2 notes `by: 'clic'` (format `tools/agence/agence.py:252-255`), le temps actif vaut la valeur calculée à la main dans le test (plafond 180 s lu dans le seuil) ; un clic d'un autre besoin que ceux du rejeu compte quand même (un seul rejeu ouvert) ; avec un plafond de 60 s, la valeur change comme attendu. Modèle : opus.
- [ ] T021 [P] [US1] `test_benchmark.py` : **résultat** (FR-005, FR-015) : `mesure` écrit `resultats/<issue>-<bras>.json` avec les clés de l'entité « Résultat de rejeu » (spec.md) et rien d'autre ; aucune chaîne de la conversation, aucun chemin, aucun identifiant de session (test de sortie, SC-007) ; panneau non `claude-code` : `non_mesurees` > 0 et jetons « partiel ». Modèle : sonnet.
- [ ] T022 [P] [US1] `test_benchmark.py` : **revue à l'aveugle** : `revue` présente les diffs dans un ordre tiré par la graine, sans le bras ni le nom du clone ; la saisie (nombre, marque « rouge par interface ») est écrite dans le bon résultat. Modèle : sonnet.
- [ ] T023 [P] [US1] `test_benchmark.py` : **verdict** (FR-009, FR-010) : 4 cas de fixture : passe ; ne passe pas sur le temps actif ; ne passe pas sur la qualité (arbitres verts outil < nu) ; non conclusif (rapport médian 0,72) ; chaque verdict nomme l'indicateur ; temps mural rapporté, jamais bloquant ; jetons « partiel » dit au rapport. Modèle : opus.
- [ ] T024 [P] [US1] `test_benchmark.py` : **seuil** (FR-003) : `seuil.json` absent : refus ; non commité (`git status --porcelain` non vide sur lui) : refus ; empreinte d'un résultat différente : refus ; chaque refus a le code 2 et son motif. Modèle : sonnet.
- [ ] T025 [P] [US1] `test_benchmark.py` : **part du régisseur** (009 SC-006) : le rapport porte une ligne « jetons du régisseur et des détections déterministes » ; sur la fixture, elle vaut 0 (aucun journal n'appartient au régisseur `agence`) ; une session `claude-code` lancée par le régisseur (fixture inventée) la rendrait non nulle et le rapport le signale. Modèle : sonnet.

### Implémentation

- [ ] T026 [US1] `tools/agence/benchmark.py` : `mesure`, `revue`, `rapport` ; lit `seuil.json` et `selection.json` ; écrit `rapport-benchmark.md` (tableau par bras, par issue, verdict, limites). Rend T020 à T025 verts. Modèle : opus.
- [ ] T027 [P] [US1] `specs/011-mesure-benchmark/seuil.json` : valeurs de plan.md (protocole, point 2), marquées `"source": "hypothèse 011, à confirmer par Heifara"` puis `"validé par l'humain le 2026-11-24"` (temps actif 0,75, jetons 1,5). Modèle : haiku.
- [ ] T028 Portes et PR du lot 3. Modèle : haiku.

**Checkpoint lot 3** : `benchmark.py rapport` sur la fixture rend « passe » ; après une retouche de `seuil.json`, il refuse.

---

## Lot 4 : pilote (US1)

**But** : 2 issues rejouées dans les deux bras pour calibrer le temps actif, mesurer la durée réelle d'un rejeu et son coût en jetons, avant la campagne.

**Tests d'acceptation** : `rapport-pilote.md` donne, pour les 4 rejeux, les quatre indicateurs, l'écart entre temps actif mesuré et chronomètre (SC-005 de spec.md : ≤ 25 %), la durée et les jetons par rejeu, et une recommandation : campagne telle quelle, ou règle revue (nouveau plafond, nouveau `seuil.json` à recommiter **avant** la campagne).

**Fichiers touchés** : `specs/011-mesure-benchmark/selection.json` (nouveau), `specs/011-mesure-benchmark/resultats/` (4 fichiers), `specs/011-mesure-benchmark/rapport-pilote.md` (nouveau).

**Dépend de** : lot 3. **Parallélisable avec** : lot 6. **Critère de fin** : rapport de pilote commité, décision de Heifara notée.

- [ ] T040 [H] [US1] Heifara relit `seuil.json`, fixe le surcoût de jetons accepté (Q1, hypothèse +50 %) et les autres valeurs s'il veut, et le commite. Ensuite, l'agent contrôle en lecture seule : fichier commité, empreinte lue par `shasum -a 256 specs/011-mesure-benchmark/seuil.json`. Aucun rejeu avant.
- [ ] T041 [US1] L'agent lance `benchmark.py select --graine <N>` (graine donnée par Heifara, ou date du jour en AAAAMMJJ) et commite `selection.json`. Preuve : sortie citée, vivier ≥ 18. Modèle : haiku.
- [ ] T042 [US1] L'agent lance `prepare` pour les 4 rejeux du pilote et donne à Heifara les 4 énoncés et la commande de début de chacun. Il ne joue rien. Modèle : haiku.
- [ ] T043 [H] [US1] Heifara joue les 4 rejeux (premiers bras des deux issues, puis seconds), avec `debut` et `fini`, et note à la main un chronomètre de son temps actif par rejeu.
- [ ] T044 [US1] L'agent lance `mesure` sur les 4 rejeux, puis écrit `rapport-pilote.md` (tableau, écart au chronomètre, durée, jetons, recommandation). Modèle : sonnet.
- [ ] T045 [H] Heifara tranche : campagne telle quelle, ou règle revue (alors retour au lot 3 pour la règle, nouveau T040).

**Checkpoint lot 4** : le temps actif mesuré tient à 25 % du chronomètre, et la durée réelle d'un rejeu est connue.

---

## Lot 5 : campagne et verdict de couche 1 (US1)

**But** : 10 issues (15 si non conclusif) rejouées dans les deux bras ; le verdict de couche 1 écrit.

**Tests d'acceptation** : `rapport-benchmark.md` rend « passe », « ne passe pas » ou « non conclusif » contre le `seuil.json` commité avant le premier rejeu de campagne ; toutes les empreintes concordent ; rejeux invalidés refaits ; le rapport dit les limites (biais de l'humain qui connaît les solutions, bugs après merge non mesurés, version de l'outil).

**Fichiers touchés** : `specs/011-mesure-benchmark/resultats/` (20 à 30 fichiers), `specs/011-mesure-benchmark/rapport-benchmark.md` (nouveau).

**Dépend de** : lot 4 (T045) ; MVP de la spec 010 livré (hypothèse Q3 ; sinon le rapport dit « outil sans interlocuteur »). **Parallélisable avec** : lot 6. **Critère de fin** : rapport commité, verdict transmis.

- [ ] T050 [US1] L'agent prépare les rejeux dans l'ordre de `selection.json` (tous les premiers bras, puis tous les seconds), un à la fois, et tient la liste de ce qui reste dans le suivi. Modèle : haiku.
- [ ] T051 [H] [US1] Heifara joue les 20 rejeux, `debut` et `fini` à chaque fois.
- [ ] T052 [US1] L'agent lance `mesure` après chaque rejeu ; un rejeu `invalide` (contamination) est re-préparé dans un clone neuf et redonné à Heifara. Modèle : haiku.
- [ ] T053 [H] [US1] Heifara fait la revue à l'aveugle (`benchmark.py revue`).
- [ ] T054 [US1] L'agent lance `rapport`. « Non conclusif » : il prépare les 5 issues de réserve (retour à T050 pour elles), puis relance `rapport` sur 15. Modèle : sonnet.
- [ ] T055 [US1] L'agent commite `rapport-benchmark.md` et envoie le verdict au propriétaire de la spec 009 (message, pas d'édition de `specs/009-vision-v2/spec.md`) ; « ne passe pas » ou « non conclusif » : aucune spec de couche 2 n'est lancée (009 FR-012, récit 2 scénario 2). Modèle : sonnet.

**Checkpoint lot 5** : la couche 1 a son verdict chiffré, contre un seuil fixé avant.

---

## Lot 6 : comparaison et règle d'économie (US2)

**But** : une économie de jetons se juge par `comparer` avant d'être livrée, et le skill l'exige.

**Tests d'acceptation** : `test_benchmark.py` et `test_regle_economie.py` verts (rouges d'abord) ; sur faux `claude` : économie qui rend un arbitre rouge : « annuler », code 1 ; économie neutre : jetons avant, après, rapport, code 0.

**Fichiers touchés** : `tools/agence/benchmark.py` (sous-commande `comparer`), `tools/agence/test_benchmark.py`, `tools/agence/fixtures/bench/claude/` (faux `claude`), `tools/agence/test_regle_economie.py` (nouveau), `skills/orchestrateur/SKILL.md` (une ligne), `specs/011-mesure-benchmark/comparaisons/` (rapports de comparaison, à l'usage).

**Dépend de** : lots 1 et 2 ; après le lot 3 sur `benchmark.py` ; `SKILL.md` après 006-L3, 005-L4 et 010-L4 (ordre de 009 T011, ou rebase). **Parallélisable avec** : lots 4 et 5. **Critère de fin** : checkpoint et PR ouverte.

### Tests d'abord

- [ ] T060 [P] [US2] `test_benchmark.py` : **comparer** (FR-011) : le faux `claude -p` écrit un diff et un journal connus selon la ref ; avant vert, après rouge : « annuler », code 1, l'issue nommée ; tous verts : jetons avant, après, rapport, code 0 ; sous-ensemble lu dans `selection.json` (pilotes et issue de comparaison), jamais une issue de campagne. Modèle : opus.
- [ ] T061 [P] [US2] `test_benchmark.py` : `comparer` lance `claude` avec `-p` et `--output-format json`, sans aucune option qui ouvre une interface ; les gardes de T015 restent vertes. Modèle : haiku.
- [ ] T062 [P] [US2] `tools/agence/test_regle_economie.py` : lit `skills/orchestrateur/SKILL.md` : il cite `benchmark.py comparer` et exige son rapport dans une PR qui annonce une économie de jetons ; le skill ne grossit pas de plus de 2 % par rapport au HEAD d'avant ce lot (règle propre à 011, plus stricte que les 5 % de 006 FR-009 ; chaque octet se relit à chaque tour) ; la constante du test de taille de 006 est relevée de ce seul ajout (009 T011). Modèle : sonnet.

### Implémentation

- [ ] T063 [US2] `tools/agence/benchmark.py` : `comparer --avant <ref> --apres <ref>`, rapport dans `specs/011-mesure-benchmark/comparaisons/<date>-<ref>.md`. Rend T060 et T061 verts. Modèle : sonnet.
- [ ] T064 [US2] `skills/orchestrateur/SKILL.md` : une ligne : « Une économie de jetons se livre avec le rapport de `python3 tools/agence/benchmark.py comparer` ; « annuler » : elle ne part pas. » Rend T062 vert. Modèle : haiku.
- [ ] T065 Portes et PR du lot 6. Modèle : haiku.

**Checkpoint lot 6** : une économie qui casse un arbitre est refusée par la commande, et le skill renvoie à elle.

---

## Couverture de la spec 009

| 009 | Couvert par | Renvoi |
|---|---|---|
| Récit 2, scénario 1 (économie annulée si rouge) | lot 6 (T060, T063) | |
| Récit 2, scénario 2 (seuil non atteint : couche 2 non étendue) | lot 3 (T023), lot 5 (T055) | mise à jour du tableau de 009 : son propriétaire |
| FR-005 (indicateurs de mesure en code) | lots 1 à 3 | |
| FR-011 (avant, après, même outil, annulée si rouge) | lot 6 | |
| FR-012 (critère de passage) | lot 3 (T023, T024), lot 5 (T054, T055) | critères des couches 2 à 4 : specs 005, 008, 007, 003 |
| FR-014 (aucune fenêtre, y compris pour le benchmark) | lot 2 (T015), lot 6 (T061), interdits des lots 4 et 5 | |
| SC-002 (quatre indicateurs par bras, verdict contre seuil fixé avant) | lot 3, lot 5 | |
| SC-003 (aucune économie livrée avec un test rouge) | lot 6 (T060, T062, T064) | |
| SC-006 (calculs déterministes à 0 jeton) | lot 1 (T005), lot 3 (T025), lot 5 (rapport) | les détections elles-mêmes (chevauchement, péremption, budget) : spec 010 |

## Dépendances et parallélisme

- Lots 1 et 2 en même temps : aucun fichier commun.
- Lot 3 après les deux ; lot 6 après le lot 3 sur `benchmark.py`, et après 005-L4 et 006-L3 sur `SKILL.md`.
- Lots 4 et 5 ne touchent que `specs/011-mesure-benchmark/` : ils courent en même temps que le lot 6.
- **Avec les autres epics** : aucun fichier de `src/`, aucun de `agence.py`. `SKILL.md` est le seul point de contact (005-L4, 006-L3, 010) : l'orchestrateur sérialise.

## Stratégie

MVP : lots 1 à 4 (la mesure existe et elle est calibrée sur un pilote). Le lot 5 donne le verdict de couche 1 et attend le MVP de 010. Le lot 6 protège la qualité des économies de jetons ; il peut partir avant la campagne. Chaque lot est livrable seul : sans le lot 6, le benchmark rend son verdict ; sans les lots 4 et 5, le harnais est prêt mais rien n'est décidé.
