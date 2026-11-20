---

description: "Tâches : ajouts de la veille du 20/11 à la vision v2 (spec 013)"
---

# Tasks: Ajouts de la veille du 20/11

**Input**: `specs/013-ajouts-veille/` (spec.md, plan.md) ; `specs/009-vision-v2/tasks.md` (gates G1 à G3).

**Prerequisites**: plan.md, spec.md. Tests exigés par la constitution (VI) : chaque tâche de test vient avant sa tâche de code et doit être vue **rouge** pour la bonne raison (sortie citée). Tout test qui écrit tourne en faux HOME et dossier temporaire ; `cate` et `gh` se simulent par un faux exécutable sur le PATH.

**Interdits à tout agent** (constitution X) : lancer Playwright, Electron, l'app Cate ou `npm run dev`, ouvrir une fenêtre, écrire dans le vrai `~/.cate`, `~/.claude` ou `~/.config`, lancer `agence hooks`, fermer une vraie PR, supprimer une branche, merger, pousser.

**État** : spec écrite, aucune tâche commencée. Q1 à Q7 ouvertes avec hypothèse ; Q1, Q3 et Q7 se tranchent en T004.

## Format: `- [ ] ID [P] [H] [US] Description avec chemin`

- **[P]** : parallélisable. **[H]** : action de Heifara, jamais d'un agent. **[US1] à [US9]** : récit de la spec.
- Un implémenteur par lot, un worktree par agent, un vérificateur différent. Une tâche se coche sur preuve (sortie de commande, `chemin:ligne`, commit).
- Portes de chaque PR : `npm run typecheck && npm run lint && npm run lint:deps && npm test && npm run test:agence`, plus `git diff --stat origin/main -- src` vide (SC-007).
- Tailles : estimations sans mesure.

## Lots, vue d'ensemble

| Lot | Récits | Couche | Taille | Dépend de | Preuve de fin |
|---|---|---|---|---|---|
| **0. Recherche et choix** | US7, US8 | toutes | 0,5 j agent + 20 min [H] | rien (lecture seule) | `research.md` commité, sources citées, Q1, Q3, Q7 tranchées |
| **1. Jauge de contexte** | US1 | 1 | 0,5 j | file de PR `agence.py` | SC-001 vert |
| **2. Garde de plafond** | US2 | 1 | 0,5 j | 1 (même fichier) | SC-002 vert |
| **3. Liens de fiches et de décisions** | US3 | 1 | 1 j | lots de 010 mergés | SC-003 vert (#177) |
| **4. Registre durable** | US4 | 1 | 0,5 j | 3, Q1 | SC-004 (clone neuf) |
| **5. Mesure de l'attente** | US5 | 1 | 0,5 j | lots de 006 mergés | rapport avant et après ; #176 gardée ou fermée |
| **6. Validation du plan** | US6 | 2 | 0,5 j | G1 (009), Q7 | clé de politique testée |
| **7. Proposition à jeter, droits dans le brief** | US7 | 3 | 1 j | G2 (009), 012 lot 2 | carte testée sur faux `gh` (#174) |
| **8. Clic navigateur** | US8 | 3 | selon lot 0 | G2 (009), Q5 | fixée par `research.md` |
| **9. Porte des recettes, résumé des fiches** | US9 | 4 | 1 j | G3 (009), mesure Q6 | rejeu rouge annule la recette (#175) |

Ordre sur `tools/agence/agence.py` : L1, L2, L3, L4, une PR ouverte à la fois.

---

## Lot 0 : recherche et choix (lecture seule)

- [ ] T001 [P] [US7] Lire `src/panels/review/` et écrire dans `specs/013-ajouts-veille/research.md` ce que Review fait déjà : commentaire de diff renvoyé à l'agent, rejet d'un changement. Citer `chemin:ligne`.
- [ ] T002 [P] [US8] Lire `src/services/browser/contract/` et dire si `cate browser` rend un sélecteur, le HTML et une capture d'un élément choisi. Conclure : skill seul, panneau perso ou issue upstream (Q5).
- [ ] T003 [P] [US5] Relire #100 et la spec 006 : quelles pistes sont livrées, quelle part d'attente reste. Citer la mesure.
- [ ] T004 [H] Trancher Q1 (forme du registre durable), Q3 (`deny` ou `ask`), Q7 (défaut de la validation du plan).

## Lot 1 : jauge de contexte (US1)

- [ ] T010 [US1] Test rouge dans `tools/agence/test_agence.py` : faux `cate agent usage` rendant 180 000 ; le suivi affiche la valeur ; sans mesure, « contexte inconnu ».
- [ ] T011 [US1] Afficher le contexte dans le suivi d'un besoin (`tools/agence/agence.py`), en réutilisant la lecture des déclencheurs de 004.
- [ ] T012 [US1] Une ligne dans `skills/orchestrateur/SKILL.md` : lire la jauge avant d'attendre.

## Lot 2 : garde de plafond (US2)

- [ ] T020 [US2] Tests rouges dans `tools/agence/test_guard.py` : plafond 4 et 4 vivants : `deny` avec le compte ; 3 vivants : aucune décision ; état illisible : aucune décision, message d'avertissement.
- [ ] T021 [US2] Reconnaître `cate agent start` dans `guard` et lire `plafond(st)` et le compte publié (`tools/agence/agence.py`).

## Lot 3 : liens de fiches et de décisions (US3, #177)

- [ ] T030 [US3] Tests rouges dans `tools/agence/test_backlog.py` : champs `remplace` et `doublonDe`, identifiant inconnu, cycle, doublon refusé à `prête`.
- [ ] T031 [US3] Étendre `CHAMPS_FICHE`, la validation et `transition` dans `tools/agence/backlog.py`.
- [ ] T032 [US3] `--remplace` et `--doublon-de` sur `agence fiche add` et `edit` ; `agence decision show` liste les fiches qui citent la décision (`tools/agence/agence.py`).
- [ ] T033 [US3] Message d'erreur d'un `backlog.json` ancien : nommer les deux champs à ajouter (coupe nette).
- [ ] T034 [US3] Une ligne dans `skills/interlocuteur/SKILL.md` : poser le lien quand il repère un doublon.

## Lot 4 : registre durable (US4)

- [ ] T040 [US4] Test rouge : `agence decision export` écrit les décisions actives, triées par date, et rien d'autre.
- [ ] T041 [US4] Écrire la commande (`tools/agence/agence.py`), cible selon Q1.
- [ ] T042 [H] Commiter le premier export par une PR de docs.

## Lot 5 : mesure de l'attente (US5, #176)

- [ ] T050 [US5] Mesurer la part d'attente sur 5 sessions récentes avec `tools/agence/attente_mesure.py` ; écrire le résultat dans `research.md`.
- [ ] T051 [US5] Si un reste de boucle existe : proposer le recul sur ce reste, mesuré avant et après. Sinon : proposer de fermer #176.

## Lot 6 : validation du plan (US6, couche 2, gelé jusqu'à G1)

- [ ] T060 [US6] Test rouge dans `tools/agence/test_pratiques.py` : clé absente = `jamais` ; valeur hors liste refusée.
- [ ] T061 [US6] Ajouter la clé à `tools/agence/pratiques.json` et la faire lire par le brief d'une fiche.

## Lot 7 : proposition à jeter, droits dans le brief (US7, couche 3, gelé jusqu'à G2, #174)

- [ ] T070 [US7] Tests rouges : sans clic, aucun appel à `gh` ni à `git worktree` ; après clic, PR fermée, worktree retiré, fiche en `discussion` ; PR mergée : refus.
- [ ] T071 [US7] Carte « jeter » d'un besoin (`tools/agence/agence.py`).
- [ ] T072 [US7] Le brief d'une fiche cite les connecteurs ouverts en écriture (dépend de 012 lot 2).

## Lot 8 : clic navigateur (US8, couche 3, gelé jusqu'à G2)

- [ ] T080 [US8] Tâches écrites après T002, selon la voie retenue.

## Lot 9 : porte des recettes, résumé des fiches (US9, couche 4, gelé jusqu'à G3)

- [ ] T090 [US9] Brancher le rejeu de 011 comme condition de proposition d'une recette (#175).
- [ ] T091 [US9] Mesurer le coût de lecture du backlog par l'interlocuteur ; ne coder le résumé que si Q6 est atteinte.

## Couverture de la spec

| Exigence | Lot |
|---|---|
| FR-001 | 1 |
| FR-002 | 2 |
| FR-003, FR-004 | 3 |
| FR-005 | 4 |
| FR-006 | 5 |
| FR-007 | 6 |
| FR-008, FR-009 | 7 |
| FR-010 | 0, 8 |
| FR-011 | 9 |
| FR-012 | tous |

## Chemin critique

T004 [H], puis L1, L2, L3, L4 dans la file de `agence.py`. L0 et L5 partent tout de suite, en lecture seule.
