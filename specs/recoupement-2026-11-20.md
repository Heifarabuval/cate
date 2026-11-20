# Recoupement des 4 specs du backlog (brief E, lecture seule)

Base : `origin/main` `455a23b2` (fetch fait le 2026-11-20). Branches lues par `git show origin/<branche>:<chemin>` : `docs/spec-pratiques-reglables` (005), `docs/spec-002-lots-macro` (002), `docs/spec-cout-attente` (006), `docs/spec-panneaux-perso-partage` (007). Aucun fichier du dépôt modifié.

Notation des lots : `005-L1` = spec 005 lot 1. Pour 002, seuls les lots ouverts comptent : `002-5A` à `002-5D` (les lots 0 à 4b sont livrés, PR #27 #30 #40 #41 #63 #65 #68 #70 #96). Pour 006 je suis `tasks.md` (4 lots : mesure, sonde, règle, mesure après), pas `plan.md` (voir contradiction C1).

## 1. Matrice de conflits (fichiers cités par au moins deux specs, ou deux lots d'une même spec)

| Fichier | Lots | Risque | Ordre de merge imposé |
|---|---|---|---|
| `tools/agence/agence.py` (2 870 lignes, vérifié) | 005-L1, L2, L3, L4. Hors des 4 specs : 004 (lot 2 en cours, branche `n481-impl`, commit local `a9bf97fe`, bus c287e6 ; lots 3 à 5) | Élevé | 005-L1, puis L2, puis L3, puis L4, une seule PR ouverte à la fois sur ce fichier. Les deux fonctions les plus disputées : `un_tour` (005-L1 y écrit `st['pratiques']`, 004 T027 y lit `contextTokens`) et `prerequis()`. 004 lot 2 merge avant 005-L1, sinon rebase de 005-L1 |
| `skills/orchestrateur/SKILL.md` (82 lignes, 13 936 octets, vérifiés) | 006-L3 (ligne 28, deux lignes `/goal`, une ligne de mesure) ; 005-L4 (lignes 19, 20, 25, 30, 36, 39-41, 43, 65, 74). Hors 4 specs : 004 lot 5, et une ligne de brief demandée par l'orchestrateur Skills (bus e04752, 16:34) | Élevé | 006-L3 puis 005-L4 (les deux specs le disent). Condition : régler C4 et C5 d'abord. Les deux lignes `/goal` de 006 tombent dans la liste « Jamais... » (lignes 39-44) que 005-L4 réécrit : conflit de hunks quasi certain, donc rebase obligatoire |
| `docs/architecture.md` (3 066 lignes) | 005-L1 et L5 (§ « The agence panel », l.2192) ; 007-L1 (§12.3, l.2397) ; 007-L3 (« The app panel » l.2175 + arbre `<data>`). Hors 4 specs : 004 T014 | Moyen | Pas d'ordre imposé, hunks disjoints. Un titre par PR, rebase avant la PR. Seul vrai fichier commun entre 005 et 007 |
| `tools/agence/declencheurs.json`, `test_declencheurs.py` | 005-L4 ; hors 4 specs : 004 lots 2 à 5 (n481-impl en cours) | Élevé | 004 d'abord ; 005-L4 rebasé dessus (005 Q5 le prévoit) |
| `src/shells/desktop/ui/panels/agence/QuestionCard.tsx` et `.test.tsx` | 005-L5 (libellé « Merger quand même (rebase) », l.68) ; hors 4 specs : 004 T044 et T047 (carte `cmd:`) | Moyen | Absent du plan 005 (qui ne cite que 002 pour ces fichiers). 004 lot 3 avant 005-L5, ou rebase |
| `src/panels/agence/contract/types.ts`, `session.ts`, `session.test.ts`, `contract/fixtures/etat.json`, `AgenceView.tsx(.test)` | 005-L5 seul parmi les 4 | Faible | `humain` et `garde` déjà sur `origin/main` (types.ts:84,106 ; session.ts:63,248,256) : la précondition « après les lots 2 et 3 de 002 » est déjà remplie |
| `tools/agence/test_portable.py` | 005-L2 (ajout des mots `hermes`, `.hermes`) ; il scanne `skills/orchestrateur/` que 005-L4 nettoie | Moyen | Voir C4 : l'ajout de mots interdits doit passer dans 005-L4 |
| `tools/agence/test_agence.py` (3 856 lignes) | 005-L2 (l.71-84, 2112-2144, plus `--rebase` l.852 non cité) ; 005-L1 si T006 choisit ce fichier | Moyen | Après 005-L1. T006 hésite entre `test_agence.py` et `test_pratiques.py` : trancher `test_pratiques.py` |
| `scripts/agence-files.mjs`, `scripts/build-runtime-tarball.test.mjs` | 005-L1 seul. 006 : rien à faire | Faible | `agenceFiles` livre tout `tools/agence` sauf `test_*`, `fixtures`, fichiers cachés : `attente_mesure.py` et `pratiques.*` partent seuls ; seule `AGENCE_REQUIRED` et la fixture `checkout()` du test (l.15-30) changent |
| `skills/cate-cli/references/`, `skills/cate-cli/SKILL.md` | 007-L4 (page de l'`app`) ; 006 Q1 (laisse `agents.md:15`) ; 004 T014 (`agents.md`) | Faible | 007-L4 ajoute un fichier ; `skills/cate-cli/SKILL.md:22,25` liste les `references/` : à ajouter à sa liste de fichiers (voir inexactitudes) |
| `src/panels/app/` : `contract/grant.ts`, `session.ts` (+ tests), `definition.ts`, `runtime/import.ts`, `contract.ts` | Interne à 007 : L1 et L3 (grant, session), L1 et L4 (definition), L2 et L3 (import.ts) | Moyen | 007-L1 et L2 avant L3 ; L3 avant L4 et L5 |
| `src/panels/api.ts`, `src/panels/app/contract/api.ts` | 007-L4 ; Skills 008 jalon 2 (`app.open`, `app.check`, hors dépôt) | Faible | Le premier arrivé crée `contract/api.ts` (absent de `origin/main`) |
| `tools/agence/test_quickstart.py` (nouveau), `specs/002.../{rapport-final,quickstart}.md` | 002-5A, 5B, 5C seuls | Nul | 5A, puis 5B (ses lignes FR-013, SC-003), puis 5C. 005 ne touche pas `cate-fork-install.sh` : pas de rouge croisé, sauf si 005-L2 change le texte de `doctor --prerequis` lu par l'amorçage |
| `tools/agence/{attente_mesure.py,test_attente_mesure.py,test_regle_attente.py,fixtures/attente/*}`, `specs/006.../*` | 006 seul | Nul | Aucun |

Fichiers sans recoupement entre specs : tout `src/panels/app/` (007) et `src/shells/desktop/main/webSecurity.ts` n'ont aucun autre epic.

### Fichiers et lignes inexacts, vérifiés sur `origin/main`

- 005 `QuestionCard.tsx:41` : la ligne est le texte de `mergeAnyway`, sans méthode ; seul `:68` porte « (rebase) ». `types.ts:36,116` sont des commentaires, aucun libellé.
- 005 `agence.py:167` : `plafond` est à 167-168, ligne de retour `:168` (négligeable). Tous les autres numéros de 005 (53, 456-457, 667-677, 699-700, 738-739, 842-846, 1025, 1375, 1536, 1860, 1919, 1980, 2752, 2770) sont exacts. SKILL.md : lignes 19, 20, 25, 28, 30, 36, 39-41, 43, 65, 74 exactes.
- 006 : `SKILL.md:28`, 13 936 octets, `agents.md:15` exacts.
- 007 : `runtime/service.ts` n'existe pas (à créer, non dit nouveau) ; §12.3 s'appelle « Loopback routing », pas « verrou d'origine » (le paragraphe s'y ajoute, c'est le plus proche) ; `skills/cate-cli/SKILL.md` manque de la liste des fichiers du lot 4. `src/panels/app/contract/api.ts` n'existe pas (créé par 007-L4, cohérent avec « nouveau ou étendu »).
- 002 (historique, lots livrés) : `test_agence.py:3226` n'est pas la classe `Version` (elle est à `:3797`) ; `docs/architecture.md:1553-1560` ne parle plus de l'agence (le lanceur est à `:1618-1622`) ; `CLAUDE.md:266-268` : seule `:268` parle de la CLI. Les numéros `agence.py:63, 90, 164, 1326, 1857, 1860, 1996, 2018, 2428` sont exacts.
- Non vérifiés : les numéros de PR et de runs CI de 002 partie A (hors dépôt local), les 4 specs hors partie citée (`rapport-lot0.md` etc., existent mais lignes non relues), la PR #85 citée par 006.

## 2. Graphe de dépendances entre lots

```
002-5A ──> 002-5B (2 lignes) ──> 002-5C [H Max, T014 [H] avant]     002-5D (repo Skills, libre)

005-L1 ──> 005-L2 ──> 005-L3 ──> 005-L4   (agence.py en série)
   └─────> 005-L5 (panneau, libre après L1)
005-L4 aussi après : 006-L3 (SKILL.md) et 004 (declencheurs.json)
005-T064 [H] (preset pr-tdd chez Heifara) AVANT le merge de 005-L2 (voir C2)

006-L1 (mesure) ──────────────────────────> 006-L4 [H une vague réelle]
006-L2 (sonde)  ──> 006-L3 (SKILL.md) ────> 006-L4

007-L1 ─┐
007-L2 ─┴─> 007-L3 ─┬─> 007-L4 (CLI, skill)
                    └─> 007-L5 (carte d'import) ──> 007-L6 [H] (aussi après 007-L1)
```

Contraintes de machine : plafond de 4 agents Claude vivants (24 Go, mémoire du projet) ; le vérificateur d'un lot ne tourne qu'après la fermeture de son implémenteur. `006-L2` consomme 2 panneaux jetables par sonde en plus de son implémenteur (3 de 4 places) : à lancer avec au plus un autre lot. `002-5D` est un travail du projet Skills, mais compte dans les 4.

### Vague 1 (4 lots, deux à deux sans fichier commun)

1. `005-L1` (1,5 j) : ouvre toute la 005.
2. `007-L2` (1 j) : `bundle.ts`, `export.ts`, `import.ts` neufs.
3. `002-5A` (0,5 j) : `test_quickstart.py` neuf ; libère sa place en demi-journée.
4. `006-L1` (1 j) : `attente_mesure.py` et fixtures neufs.

Prêts mais exclus : `007-L1` (même taille, ne partage que `docs/architecture.md` avec 005-L1, hunks disjoints ; il prend la place de `002-5A` à sa fin, rebase du doc seulement) ; `002-5B` (0,25 j, aucun fichier commun, attend 5A pour 2 lignes) ; `006-L2` (voir plafond) ; `002-5D` (Skills).
Ensemble maximal sans fichier commun parmi les lots prêts : 7 (tous sauf l'un de 005-L1 ou 007-L1) ; le plafond de 4 en retient 4.

### Vague 2 (après merge de 005-L1, 007-L1 et 007-L2)

`005-L2` (agence.py), `005-L5` (panneau ; partage seulement un titre de `docs/architecture.md` avec 007-L3), `007-L3`, plus `002-5B` ou `006-L2` en 4e place.

### Vague 3

`005-L3` (après L2 sur agence.py), `007-L4`, `007-L5`, `006-L3` (après le rapport de sonde ; avant 005-L4). Aucun fichier commun entre eux.

### Vague 4 et gates humaines

`005-L4` (après 005-L3, 006-L3, 004 sur `declencheurs.json`). `007-L6`, `006-L4`, `002-5C` sont des actions de Heifara ou de Max, pas d'agent. `005-T064` [H] doit précéder le merge de `005-L2`.

Durée critique estimée (somme des tailles des specs, non mesurée en jetons) : 005 : 1,5 + 1 + 1,25 + 1 = 4,75 j en série sur agence.py (le lot 5 de 1 j est en parallèle). 007 : 1 + 1 + 0,5 à 1 + 1 = environ 3,5 j avant la recette. Estimation en jetons : non chiffrée.

## 3. Contradictions

- **C1 (numérotation de 006).** `plan.md` a 3 lots (1 mesure, 2 écriture de la règle, 3 mesure après) ; `tasks.md:26-31` en a 4 (1 mesure, 2 sonde, 3 règle, 4 mesure après). `spec.md` (SC-001 « mesuré au lot 3 », SC-004 « diff du lot 2 ») suit le plan. 005 dit « lot 2 de 006 » pour `SKILL.md` (`tasks.md:31,141,190`, `plan.md:118`) : c'est le lot 3 de `tasks.md`. Un implémenteur qui lit « lot 2 » lance la sonde au lieu de la règle. Sources : `006/plan.md:39`, `006/tasks.md:28-31`, `006/spec.md:128,131`.
- **C2 (la bascule de Heifara est déjà faite).** 005 suppose la bascule de Skills (002 lot 5) à venir : « doit attendre le preset `pr-tdd` » (`005/plan.md:107`), T064 « avant le lot 5 de la spec 002 » (`005/tasks.md:152,190`). 002 la dit livrée le 2026-11-20 : L5-07 coché, `agence hooks status` = `actif`, `~/.claude/skills/orchestrateur` supprimé, Skills#37 mergée (`002/tasks.md:121-122`). Heifara tourne donc déjà sur le fork : dès que 005-L2 est mergé et installé, son merge passe de rebase à squash. T064 doit précéder le merge de 005-L2, pas « le lot 5 de 002 ».
- **C3 (préconditions périmées dans 005).** 005 attend « les lots 2 et 3 de 002 » (`005/tasks.md:97,167`, `plan.md:106,108`) et cite 002 lots 2, 3, 4 « si encore ouverts » comme écrivains d'`agence.py` (`plan.md:116`). Ils sont mergés (PR #63, #65, #68, #70) et `humain`, `garde`, `prerequis(hors_cate)` sont sur `origin/main`. Aucun lot ouvert de 002 ne touche `agence.py` (`002/tasks.md:149`). 005 cite aussi une « piste `agence wait`, lot 4 » de 006 (`plan.md:116`) : rejetée par 006 (`006/plan.md:18`, `spec.md:97`).
- **C4 (test de mots interdits rouge entre 005-L2 et 005-L4).** 005-L2 ajoute `hermes` et `.hermes` à `test_portable.py` (`005/tasks.md:97`) ; ce test scanne `skills/orchestrateur/` (`test_portable.py:17-31`) et `SKILL.md:36` contient « Hermes », corrigé seulement par 005-L4 (T062, audit B). Rouge de L2 à L4. Corriger : déplacer l'ajout des mots dans L4, ou faire éditer `SKILL.md:36` par L2.
- **C5 (ordre 006 puis 005 sur SKILL.md, et test (e) de 006).** 006 T020(e) exige du skill « aucune valeur propre à un dev (nom, chemin personnel, modèle imposé) » (`006/tasks.md:78`) sur le fichier entier ; le skill actuel contient « Hermes » (l.36) et « Sonnet » (l.74), que seul 005-L4 retire. 006-L3 serait rouge si 006 passe d'abord, comme les deux specs le veulent. Corriger : limiter (e) aux lignes ajoutées par 006, ou inverser l'ordre. Aussi : (f) fixe un plafond absolu de 105 % de 13 936 octets ; 005-L4 change la taille, donc le test se calcule à la fin de chaque PR sur le HEAD réel.
- **C6 (zone « Fin du brief », SKILL.md:62-70).** 006 s'appuie sur la ligne « Fin : `cate agent send` » (l.69) et la teste (T020(c)) ; 005 génère le gabarit de brief depuis `agence pratiques brief` (ligne 65) et la ligne demandée par le bus (e04752) s'ajoute au même bloc. Si 005-L4 déplace tout le gabarit vers la commande, 006 (c) casse. Règle à écrire : la ligne « Fin » reste dans le skill.
- **C7 (taille et lieu du « plafond 4 agents »).** 005 le rend réglable (`agents.max`, supprime `MAX_AGENTS`, `maxAgents` ; `005/spec.md` FR-008) ; 006 le répète en dur dans ses critères (« pas plus de 4 agents Claude vivants », `006/tasks.md:64`) et dit à la fois « un seul à la fois » (`:59`) et « 3 agents jetables à la fois au plus » (`:70`) pour les sondes. À réconcilier : une sonde = 2 panneaux, un seul lot de sonde à la fois.
- **C8 (activation d'un déclencheur définie trois fois).** 004 : champ `actif` de `declencheurs.json` (14, 28, 42, 56...) puis activation par carte « Activer <commande> pour ce projet », lue au journal (`004/spec.md` FR-020, l.202). 005 : supprime `actif`, le remplace par `declencheurs.actifs` dans le fichier de pratiques (`005/spec.md` FR-014, `plan.md:69`). Deux mécanismes pour la même décision (qui active quoi) : un déclencheur « blanc » (004) peut être « actif » (005). Hors des 4 specs mais 005-L1 pose déjà la clé et sa cohérence avec les identifiants de la table (`005/plan.md:73`).
- **C9 (lieu des réglages d'un dev : trois endroits).** 005 : `<racine>/.cate/tmp/agence/pratiques.json` et `~/.config/agence/pratiques.json`, `defineSettings` écarté pour ne pas écrire le schéma deux fois (`005/spec.md` Q1) ; 002 : le nom de l'humain en `git config --global agence.nom` ou `AGENCE_NOM` (`002/tasks.md:190`) ; 007 : zone `cliApp` en réglage de workspace (`defineCliArea`, `007/tasks.md:112`). Pas de bug, mais une troisième réponse à « où est le réglage d'un dev » : `agence.nom` devrait-il migrer dans `pratiques.json` ? 005 dit que non (`plan.md:104`, propriété de 002).
- **C10 (format du paquet, contre une spec hors des 4).** 007 : un JSON `.cate-panneau`, pas de zip (`007/spec.md` FR-011, Q1, `plan.md:13,157`). Skills 008 D11 parle d'un « zip du dossier » et nomme les commandes `install` et `update` (`007/spec.md` Q1, Q9, Q11). À aligner avant `007-L4` (CLI et skill) ; `007-L2` fixe déjà le format, donc le coût d'un changement de décision est dans L2.
- **C11 (outil de mesure en double).** 006 écrit `tools/agence/attente_mesure.py` dans le fork (`006/spec.md` Q4, hypothèse « non, il vit dans ce dépôt ») ; le bus (e04752, 16:35, décision q162 de Heifara) fait de `common/tools/conso.py` un outil du dépôt Skills, 0 jeton, nombres seulement, qui entre dans la spec 004 comme 4e déclencheur. Deux lecteurs de journaux de session. Et `python3 tools/agence/attente_mesure.py` (`006/plan.md:29`) ne marche que dans un checkout du fork : une fois livré, le fichier est à `<install>/agence/attente_mesure.py`, sans sous-commande `agence` (006 FR-007 interdit d'en ajouter une).
- **C12 (réglages non réglables par choix, cohérents).** 006 FR-008 et 005 Q9 s'accordent : ni le plafond du filet de 600 s ni le seuil de `/compact` ne deviennent un réglage en v1. Aucune contradiction ; noté pour ne pas le rouvrir.

## 4. Questions ouvertes à fusionner (celles qui bloquent un lot de la vague 1)

| # | Question | Bloque | Hypothèse de travail de la spec |
|---|---|---|---|
| F1 | 005 Q1 : lieu des fichiers de politique (deux fichiers hors dépôt, ou `defineSettings`, ou fichier commité dans `.cate/`, ce qui amende D5). À fusionner avec C9 (et `agence.nom`) | `005-L1` (`tasks.md:14` exige sa confirmation avant lancement) | Deux fichiers hors dépôt, `.cate/tmp/agence/pratiques.json` et `~/.config/agence/pratiques.json`, projet avant dev avant `neutre` |
| F2 | 005 Q2 : nom du preset de Heifara | `005-L1` (idem) | `pr-tdd` (décrit des pratiques, pas une personne) |
| F3 | 007 Q1 + Q9 + Q11 : JSON ou zip, `import` ou `install`, qui met à jour la spec Skills 008 | `007-L2` (format du paquet), `007-L4` (noms de commande) | JSON `.cate-panneau`, `cate app import` qui met en attente seulement, mise à jour = import du même `id` ; Skills à prévenir par son orchestrateur |
| F4 | 006 Q4 + bus q162 : réutiliser `conso.py` ou garder `attente_mesure.py` | `006-L1` | `attente_mesure.py` dans `tools/agence/` ; à rouvrir puisque `conso.py` entre au dépôt Skills et dans 004 |
| F5 | 005 Q7 : valeurs par défaut de `neutre` (`squash`, `verification: libre`, `agents.max: 4`), figées dans T005 | `005-L1` (le test fige les 12 valeurs) | Valeurs de la spec, aucune mesurée |
| F6 | 007 Q10 : plafonds du paquet (200 fichiers, 2 Mio par fichier, 10 Mio, 10 en attente, 24 h) | `007-L2` (constantes de `bundle.ts`) | Valeurs de départ sans mesure, ajustables sans changer le format |
| F7 | 007 Q5 : `--out` est un chemin de la machine du runtime | `007-L2` (`export.ts`) | Oui, aucune boîte de dialogue |
| F8 | 007 Q6 (U+200C, U+200D autorisés) et Q12 (filtre `webRequest` limité à WebRTC et préchargements) | `007-L1` si elle entre en vague 1 | Autorisés ; filtre limité, preuve à l'écran par Heifara (007-L6) |
| F9 | 005 Q3 : mode `main` (l'agent commit, le push reste à l'humain, preuve `report`) | schéma de `005-L1` (cohérences `main` avec `pr-mergee`) | Push par l'humain, pas de bouton « Pousser » en v1 |
| F10 | 002-5A : aucune question ouverte (décisions q303, q305, q307 prises) | rien | sans objet |

Questions des lots suivants, non bloquantes pour la vague 1 : 005 Q5 (`declencheurs.actifs` avant ou après 004, voir C8), Q6 (`tests-local`), Q8, Q9 ; 006 Q1, Q2, Q3, Q5, Q6 ; 007 Q2, Q3, Q4, Q7, Q8.

## 5. Recommandations pour l'orchestrateur

1. Trancher C2 avant tout merge de 005-L2 : demander à Heifara `agence pratiques preset pr-tdd --dev` (005-T064) ; sinon son merge passe en squash sans qu'il l'ait voulu.
2. Corriger les trois textes avant la vague 1 : numérotation de 006 (C1), déplacement des mots interdits de 005-L2 vers 005-L4 (C4), périmètre du test (e) de 006 (C5). Chacun tient en une ligne de spec.
3. Poser sur le bus `repo:cate` que 004 lot 2 (n481-impl) précède 005-L1 sur `agence.py`, ou l'inverse, mais pas les deux ouverts ensemble.
4. Confier à l'orchestrateur Skills C10 et C11 : il tient la spec 008 et `conso.py`.
