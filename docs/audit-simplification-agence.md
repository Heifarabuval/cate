# Audit de simplification de l'agence (#n961)

Rapport seul, aucun code modifié. Base : `origin/main` à `538ae18b` (2026-11-24). État lu dans `<root>/.cate/tmp/agence/` du workspace cate (`state.json` 1,2 Mo, `backlog.json`, `decisions.json`) le 2026-11-24 vers 15 h, par `agence need list`, `agence fiche list`, `agence decision list`, `agence pratiques show` et un script Python en lecture seule sur ces fichiers. Cadre : la vision du fork n'est pas remise en cause (validation centrale, orchestrateur, agents visibles, agence type ESN, autres métiers). On simplifie la mécanique.

## 1. Recommandation globale

Retirer d'abord ce qui ne sert pas ou bloque à tort, puis unifier fiche et besoin comme le décrit `specs/014-noyau-agence/spec.md`. Les 3 suppressions au meilleur gain, dans l'ordre :

| # | Suppression | Gain mesuré | Coût du retrait |
|---|---|---|---|
| 1 | **Budgets bloquants** (jetons, minutes, « Bloquant » dépassé). On garde l'affichage du coût. | 6 fiches sur 6 mesurées dépassent leur budget en jetons, de 12,8 fois en cumul (17,9 M consommés pour 1,4 M budgétés). 28 besoins dépassent leur budget en minutes sur 169 lancés avec budget (17 %), 14 en jetons. 5 champs de besoin, 1 champ de fiche, 51 mentions en tests Python, 15 en TS. Défauts : #204, #225 (ouvert), F44. | Faible : un lot, aucune donnée à migrer. |
| 2 | **Lentilles, déclencheurs, registre de décisions au clic et revue de cap** (gelés hors noyau, comme la spec 014 le propose). | Environ 705 lignes d'`agence.py` (3116-3471 déclencheurs, 1559-1821 registre et revue, 40 lignes de fonctions « lentille ») + `backlog.py:473-520` + 174 lignes de JSON, soit 12 % des 6 501 lignes Python hors tests, et 1 341 lignes de tests (114 tests). Usage : 1 besoin lentille sur 607, 47 lignes de journal de déclencheurs dont le bilan ne rend que `/compact` : 19 décisions, 19 « blanc », 0 réussite. | Moyen : un lot, les 20 fiches qui citent une décision gardent le texte dans `docs/decisions.md` (`agence decision export`, `agence.py:4145`). |
| 3 | **États, genres, champs et conditions jamais utilisés** : état de fiche « abandonnée » (0 sur 66), champ fiche `modele` (0 sur 66), genres de besoin `cmd`, `pr`, `issue`, `file`, `lentille` (20 sur 607, 3 %), condition `ci-green` (0). | Un état, 5 genres sur 8, 1 champ, 1 condition de moins. Lignes non chiffrées : à compter au lot, ce sont des branches dispersées. | Faible à moyen : `need pr` et `jeter` touchent les genres `pr` et `file`, à traiter ensemble. |

Ensuite, hors top 3 car le coût est grand : fusionner fiche et besoin en une tâche (section 4, ligne « Fiches »). C'est le plus gros gain structurel (deux surfaces qui se contredisent : F57, F58, #197, #213) mais c'est un lot de plusieurs jours.

## 2. Chiffres globaux

| Mesure | Valeur | Source |
|---|---|---|
| Python hors tests | 6 501 lignes : `agence.py` 4 254, `benchmark.py` 665, `backlog.py` 545, `pratiques.py` 496, `attente_mesure.py` 306, `metiers.py` 235 | `wc -l tools/agence/*.py` |
| Tests Python | 13 360 lignes, 1 154 tests, 27 fichiers | `grep -c "def test_" tools/agence/test_*.py` |
| Fonctions de `agence.py` | 231 (def et méthodes), 4 254 lignes | `ast` sur `agence.py` |
| Commandes CLI (feuilles) | 46 (`need` 9, `fiche` 8, `pratiques` 6, `draft` 5, `decision` 4, 19 autres à 1) | argparse, `agence.py:4046` |
| TS hors tests | 3 670 lignes : `src/panels/agence` 1 493, `src/client/boite` 562, UI agence 1 270, UI boîte 345 | `find` + `wc -l` |
| Tests TS | 392 tests, environ 5 194 lignes, plus 2 011 lignes de fixtures JSON | `grep -c "it("` |
| Total hors tests / tests | 10 171 / 18 554 lignes, soit 1,8 ligne de test par ligne de code | somme |
| Specs | 14 dossiers, 9 137 lignes | `cat specs/*/*.md \| wc -l` |
| Commits agence | 107 des 348 commits d'`origin/main` depuis le 2026-11-17 (31 %), dont 34 `fix` ou bug | `git log --since=2026-11-17 -- tools/agence src/panels/agence src/client/boite ...` |
| `state.json` | 1,2 Mo : besoins 700 Ko (58 %), brouillons 235 Ko, questions 189 Ko, aucune purge des 536 besoins clos | script sur `state.json` |
| Besoins | 607 en 8 jours (81, 99, 29, 237, 70, 32, 59 par jour) : 229 humain, 170 task, 125 draft clos; 68 abandonnés | `agence need list` |
| Fiches | 66 : 49 discussion, 13 faite, 3 prête, 1 lancée, 0 abandonnée | `agence fiche list` |

Découpage d'`agence.py` par bannière de section (lignes) : état et coûts 138-436 (298), cate et gh 436-588 (152), démarrage 588-747 (159), besoins 747-838 (91), fiches et décisions 838-1006 (168), brouillons 1006-1215 (209), questions 1215-1359 (144), clics 1359-1559 (200), registre et revue 1559-1821 (262), clic Lancer et fiches au tour 1821-2033 (212), pages 2033-2329 (296), régisseur, permissions, tick, doctor 2329-3116 (787), déclencheurs 3116-3471 (355), garde 3471-3780 (309), hooks 3780-4034 (254), CLI 4034-4254 (220). Il reste 138 lignes d'en-tête.

## 3. Défauts récents par pièce

Issues #195 à #214 : 19 trouvées (`gh issue list -R Heifarabuval/cate --state all`), #205, #206 et #208 absentes de la liste (non vérifié : PR ou autre dépôt). 15 sont des bugs, 3 des évolutions, 1 hors agence (#199). Attribution de ma part, une pièce par issue :

| Pièce | Issues | Nb |
|---|---|---|
| Cartes et Boîte de validation | #198, #201, #207 | 3 |
| Plan, file, Lancer, chevauchement | #197, #210 | 2 |
| Budgets | #204, #225 (ouvert) | 2 |
| Gardes | #212, #214 | 2 |
| Lentilles et carte Éclairer | #202, #211 | 2 |
| Brouillons | #200 | 1 |
| Doctor | #196 | 1 |
| Fiches, états | #213 | 1 |
| Panneau backlog (UI) | #195 | 1 |
| Conditions de fin | #203 | 1 |
| Besoins (clôture forcée) | #209 (ouvert) | 1 |
| Taille d'`agence.py` | #215 | 1 |
| Hors agence | #199 | 1 |

F48 classe 15 défauts en 5 causes : cartes figées, attente sans action, faux signaux, CLI incomplète, cache périmé (`agence fiche show F48`). Quatre des cinq causes touchent la surface de validation ou une vue qui ne se recalcule pas. F58 (faite) : le plan de lancement était calculé deux fois, par la CLI et par le panneau (F57). Constat encore vrai à la lecture : `state.json` donne `maxAgents` à 10 alors que `agence pratiques show` donne `agents.max` à 8 (cause non vérifiée, F30 et F58 visaient ce point).

## 4. Pièce par pièce

Colonnes de code : lignes hors tests, puis tests. « Usage » vient de l'état du workspace. Les lignes par pièce dans `agence.py` sont des sections de la bannière ou des fonctions repérées par nom : approximatives, dites « au moins » quand je n'ai pas compté les branches dans `click` et `tick`.

| Pièce | Code, tests, CLI, champs | Usage mesuré | Défauts | Verdict | Ce qui casse si retiré | Coût du retrait |
|---|---|---|---|---|---|---|
| **Fiches et états** (`agence.py:838-1006`, `backlog.py`, `backlog.json` 89 Ko) | 168 + 545 lignes; `test_backlog.py` 86 tests; 8 commandes `fiche`; 18 champs; 5 états | 66 fiches : 49 discussion (74 %), 13 faite, 3 prête, 1 lancée, 0 abandonnée. 14 fiches ont un besoin, 17 des dépendances, 5 `remplace`, 2 `doublonDe`, 0 `modele`. | #213, #195, F26, F47, F57, F58 | **Fusionner** avec le besoin en une tâche (spec 014 FR-001). Court terme : retirer l'état « abandonnée » et `modele`. | Le backlog parking de 49 idées en discussion disparaît du modèle : il devient une liste simple de tâches à faire. | Élevé pour la fusion (plusieurs jours, coupe nette sans migration selon la spec 014). Faible pour les deux retraits. |
| **Décisions D** (`agence.py:936` `cmd_decision`, `backlog.py:273-290`, `click_registre` 1745) | environ 155 lignes de fonctions « decision », 4 commandes; 327 mentions en tests | 11 décisions : 10 actives, 1 révoquée (D8), D10 est un doublon exact de D9, D11 un doublon exact de D8. 20 fiches sur 66 en citent. | #202 (carte Éclairer liée) | **Fusionner** : les décisions deviennent `docs/decisions.md` à la main, sans registre ni carte au clic ni revue de cap. | Le lien fiche vers décision (`decisions`) et la carte Valider, Rejeter. | Moyen : top 3, n° 2. |
| **Lentilles** (`agence.py:977` `cmd_lentille`, `1586-1620`, `backlog.py:473-520`, `lentilles.json` 32 lignes) | au moins 88 lignes; `test_lentilles.py` 268 lignes, 18 tests; 1 commande | 1 besoin kind `lentille` sur 607; 3 mentions dans les journaux de fiche. | #202, #211, F42, F51, F59 | **Supprimer** (gelé par D6, hors noyau dans la spec 014). | Les cartes « Éclairer ». Rien d'autre : une lentille est un brief d'angle qu'on peut écrire à la main. | Faible : top 3, n° 2. |
| **Besoins** (kinds `task`, `cmd`, `pr`, `issue`, `file`, `draft`, `human`, `lentille`, `agence.py:62`; `add_need` 252, `cmd_need` 749) | 91 + 87 lignes; 9 commandes `need`; 40 champs observés dans l'état; 8 genres | 607 besoins : `human` 232 (38 %), `task` 223, `draft` 130; les 5 autres genres 20 (3 %). `status` : 399 done, 68 dropped (11 %), 2 open. Champs rares : `unblocks` 22, `contexte` 18, `worktree` 8, `closing` 2. `acceptance` 205 et `doneWhen` 361 coexistent. | #209, #207, F46, F49 | **Garder, réduire** : retirer 5 genres, fusionner `acceptance` dans `doneWhen`. | `need pr` (rattache une PR), `jeter` sur les genres retirés. | Faible à moyen. |
| **Cartes** (`carte_preuve` 379, `carte_eclairer` 1591, `click_jeter` 1634, `click_perm` 1974; UI `Ligne.tsx`) | environ 76 lignes de fonctions « carte » + les clics (1359-1559, 200 lignes) | Un besoin `human` = une carte : 232 en 8 jours. 130 brouillons ont aussi leur besoin `draft`. | #201, #202, #207, F40, F42, F45, F46 | **Garder, réduire à 3 types** (question, envoi, fin de tâche, spec 014) : c'est la validation centrale. | Rien de la vision. Disparaissent Éclairer et Jeter en carte séparée. | Moyen, avec la fusion fiche et besoin. |
| **Brouillons** (`agence.py:1006-1215`, `draftHash.ts`, `DraftReader.tsx`) | 209 lignes; 5 commandes `draft` | 130 brouillons : 126 envoyés, 4 abandonnés; ils pèsent 235 Ko de `state.json`. Cibles : issue 74, PR 28, commentaire 9, Slack 3. | #200, F39 | **Garder** : seul chemin pour qu'un texte parte au nom de l'humain. | L'envoi par clic. | Sans objet. |
| **Questions** (`agence.py:1215-1359`, `QuestionCard.tsx`) | 144 lignes; 1 commande `ask` | 224 questions en 8 jours (28 par jour), 222 répondues, 78 avec une action (35 %), 2,3 options en moyenne. | #198 (absente de la Boîte), F33 | **Garder.** Usage le plus sain mesuré. | La validation centrale. | Sans objet. |
| **Régisseur et suivi** (`tick` 2478, `un_tour` 3050, `cmd_watch` 3086; `regisseur.ts` 350 lignes, `suivi.ts` 116, `SuiviList.tsx`) | 787 lignes de 2329 à 3116 (avec doctor et permissions); `regisseur.test.ts` 354 lignes | 1 régisseur, boucle permanente; `state.json` réécrit à chaque tour (1,2 Mo). | #196, #197, F37, F57, F65 | **Garder, alléger** : un seul calcul d'état lu par CLI et panneau (spec 014 FR-003). | Le suivi en direct. | Moyen. |
| **Pages web du régisseur** (`agence.py:2033-2329` pages, `1359-1559` clics) | 296 + 200 lignes | **Non mesuré** : aucun journal d'ouverture des pages. | #195 côté panneau | **À décider après mesure** : la spec 014 les met hors noyau, le panneau les double. | Les clics hors panneau. | Moyen. |
| **Boîte** (`src/client/boite` 562 lignes, UI `panels/boite` 345; tests 881 + 573 lignes) | 907 lignes; aucune commande CLI | Lit tous les panneaux agence du client. | #198, F33, F38, F41, F45 | **Garder** : c'est l'objectif (validation centrale), F38 a déjà fusionné les deux surfaces. | La vision. | Sans objet. |
| **Backlog (vue panneau)** (`Backlog.tsx`, `plan_lancement` 1840, `backlog.py:357` `plan`) | environ 136 lignes de plan/file/fiche + `Backlog.tsx`; `test_lancer.py` 32 tests | 4 fiches en vagues à lire (vagues `[F27,F48]`, `[F20]`). | #195, #197, #210, F57, F58, F60, F65 | **Fusionner** avec la liste des tâches (une seule vue). | Rien. | Moyen. |
| **Politique et pratiques** (`pratiques.py` 496, `pratiques.json` 111, `Reglages.tsx`) | 496 + 111 lignes; 6 commandes `pratiques`; 23 clés; `test_pratiques.py` 67 tests, `test_reglages.py` 58 | 2 clés sur 23 réglées par le projet (`agents.max`, `declencheurs.actifs`), les 21 autres au défaut. Les deux fichiers de pratiques (projet, dev) se lisent avec le preset. | F30 | **Fusionner** : garder les clés lues par le code (`agents.max`, `livraison.*`, `preuve`, `envoi.slack.*`), retirer le reste. | Réglages affichés dans le panneau. | Moyen. |
| **Budgets** (minutes, jetons, dollars) (`agence.py:279-304` coûts, `budgetMin`, `overBudget`, `budgetJetons`) | 36 lignes de fonctions « budget/cout » + champs; 51 mentions en tests Python, 15 en TS | Minutes : 203 besoins ont un budget, 28 dépassés. Jetons : 22 besoins, 14 dépassés, 6 fiches sur 6 dépassées (12,8 fois). Dollars : **non mesurable**, `costUsd` vaut `null` dans le journal des déclencheurs. | #204, #225, F44 | **Supprimer le blocage**, garder l'affichage (top 3, n° 1). | Le drapeau « Bloquant » sur un dépassement; un agent qui boucle n'est plus signalé par le budget. Garde-fous qui restent : plafond d'agents, seuil d'usage hebdomadaire D1 à 95 %. | Faible. |
| **Conditions de fin** (`done_preuves` 341, `fin` 422, `nums_fin` 416) | environ 110 lignes; 46 mentions en tests | 361 besoins sur 607 (59 %) : `report` 178, `draft-sent` 130, `issue-closed` 27, `pr-merged` 19, `tests-local` 7, `ci-green` 0. | #203, F43, F26 | **Garder, réduire** : retirer `ci-green`, fusionner `acceptance`. | `ci-green` (jamais utilisée). | Faible. |
| **File d'attente et plafond** (`plafond` 196, `plan` 357) | quelques lignes + le plan | `maxAgents` 10 dans `state.json`, `agents.max` 8 dans la politique : deux sources non alignées à la lecture. Plafond mémoire de la machine : 4 agents. | F7, F30, F58, #197 | **Garder** : une source, la politique. | Rien. | Faible. |
| **Clones et rejeux de benchmark** (`benchmark.py` 665 lignes, `attente_mesure.py` 306, spec 011) | 971 lignes; tests 886 + 248 lignes (87 tests); hors de la CLI `agence` (script à part) | 2 issues rejouées en 2 bras (nu, outil) : `~/.cache/agence-bench` pèse 5,4 Go. 4 fichiers de résultat de 94 à 182 octets. F19 a consommé 4 692 433 jetons; F20 (verdict couche 1) attend. Aucun verdict. | F19, F20 | **Garder isolé** : hors du noyau, il arbitre la vision (D9). **Supprimer les clones** (5,4 Go) une fois le verdict écrit. | Le verdict de couche 1. | Faible : `rm -r` des clones après verdict. |
| **Gardes et hooks** (`guard` 3670, `garde_envoi` 3612, hooks 3780-4034) | 309 + 254 lignes; `test_guard.py` 60 tests, `test_hooks.py` 28 | Gardes : envoi, pages, interlocuteur. | #212, #214, F52, F53, F59 | **Garder deux gardes** (spec 014 FR-008). | Rien de la vision. | Moyen. |
| **Déclencheurs** (`agence.py:3116-3471`, `declencheurs.json` 142 lignes) | 355 + 142 lignes; `test_declencheurs.py` 806 lignes, 75 tests; 1 commande | 47 lignes de journal en 4 jours; `agence declencheurs bilan` : 19 décisions `/compact`, 19 « blanc », 0 réussite, gain inconnu. | aucun (n'aboutit à aucun effet) | **Supprimer** (top 3, n° 2). | Rien : « à blanc, rien ne part ». | Faible. |
| **Métiers et connecteurs** (`metiers.py` 235, `metiers.json` 4 lignes, `connecteurs.json` 3 octets) | 235 lignes; `test_metiers.py` 21 tests, `test_connecteurs.py` 16; 1 commande | Catalogues livrés vides; 0 connecteur configuré. | aucun récent | **Garder** : c'est l'ouverture à d'autres métiers (vision). | Rien aujourd'hui. | Sans objet. |

## 5. Ce qui n'a pas pu être mesuré

- Le temps passé dans la mécanique (la « moitié de la journée ») : aucun journal de temps humain; je ne l'invente pas.
- La fréquence d'ouverture des pages web du régisseur, la durée de vie des cartes, la latence de lecture et d'écriture de `state.json` (1,2 Mo).
- Les dollars : `costUsd` est `null` partout où je l'ai lu.
- Les lignes exactes par pièce : `click` (187 lignes), `tick` (143) et `parser` (196) mélangent plusieurs pièces. Mes totaux par pièce sont donc des planchers.
- Les issues #205, #206, #208 (introuvables par `gh issue list`), et l'attribution d'un défaut à une pièce, qui est mon classement.
- Je n'ai lancé ni les tests, ni l'app, ni Playwright : les nombres de tests sont des décomptes de `def test_` et de `it(`.
- La cause de l'écart `maxAgents` 10 contre `agents.max` 8.
