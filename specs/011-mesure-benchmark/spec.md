# Feature Specification: Mesure par benchmark (preuve du gain de la couche 1)

**Feature Branch**: `docs/spec-011-mesure-benchmark` (depuis `docs/spec-vision-v2`, non poussée)

**Created**: 2026-11-20

**Status**: Draft. Spec, plan et tâches ; aucune ligne de code. Enfant de la spec 009 (vision v2) : elle porte son récit 2, FR-011, FR-012, FR-014, SC-002, SC-003 et SC-006, et fournit le **critère de passage de la couche 1** (`specs/009-vision-v2/spec.md:50`).

**Input**: `specs/009-vision-v2/spec.md:75-86` (récit 2) : rejouer 10 à 15 issues déjà fermées depuis leur commit parent, une fois en Claude Code nu, une fois avec l'outil, dans un ordre tiré au hasard ; le test de la PR d'origine arbitre ; on mesure temps actif de l'humain, temps mural, qualité et jetons ; le seuil est fixé avant le premier rejeu (Q3, `:198`).

Liens :
- Spec `009-vision-v2` : vocabulaire, couches, FR et SC repris ici. Cette spec ne la modifie pas.
- Spec `006-cout-attente-orchestrateur` : `tools/agence/attente_mesure.py` (lecture des journaux, nombres seulement) est la base de la mesure des jetons ; ses valeurs « avant » sont dans `specs/006-cout-attente-orchestrateur/rapport-mesure.md`.
- Spec `010-interlocuteur` (commitée en local, branche `docs/spec-010-interlocuteur`, `76d7b3bc`) : l'interlocuteur et le backlog font partie du bras « outil » quand ils existent. Pour SC-006, 010 teste que `backlog.py` ne fait aucun appel externe (son SC-006) ; 011 mesure, sur les rejeux, que le régisseur et ces détections ne consomment aucun jeton. 010 fait dépendre de 011 toute économie de jetons rendue par défaut (son SC-003).
- Spec `005-pratiques-reglables` : aucun réglage nouveau ici ; un réglage futur du benchmark serait une clé de 005.

## Clarifications

### Session 2026-11-20

Chaque question est tranchée par l'hypothèse de travail de 009 quand elle existe (renvoi `009:ligne`), sinon par l'hypothèse écrite ici. Aucune ne change le périmètre fixé par 009 : aucune n'a été posée à Heifara par `agence ask`.

- Q: Quel seuil fait passer la couche 1 ? → A: hypothèse de 009 (`009:198`) : on garde si le **temps actif de l'humain baisse d'au moins 30 %** à qualité égale ou meilleure. Le surcoût de jetons accepté d'avance n'a pas de valeur dans 009 : **hypothèse ici, +50 % de jetons au plus** (médiane du rapport outil / nu). Les deux valeurs sont écrites dans `seuil.json` et **Heifara les confirme ou les change avant le premier rejeu** (tâche [H] T040) ; sans ce fichier commité, le rapport refuse de rendre un verdict.
- Q: Quels indicateurs bloquent le verdict ? → A: le temps actif (gain attendu, `009:30`), la qualité (non-infériorité) et les jetons (plafond de surcoût). Le **temps mural est rapporté, pas bloquant** : 009 dit que le gain attendu n'est pas là (`009:30`). Hypothèse.
- Q: Combien d'issues ? → A: 009 dit 10 à 15 (`009:77`). Règle fixée d'avance : **2 issues de pilote** (non comptées, elles calibrent la mesure), puis **10 issues** ; si le rapport médian du temps actif tombe entre 0,65 et 0,75 (à 5 points du seuil), on rejoue **5 issues de plus** déjà tirées, et le verdict se prend sur 15. Hypothèse.
- Q: Quelles issues sont éligibles ? → A: une issue du fork fermée par une PR mergée (`closingIssuesReferences` non vide) dont la PR touche au moins un fichier de test unitaire (`*.test.ts`, `*.test.tsx`, `test_*.py`), hors e2e (`e2e/`). Le 2026-11-20 à 20:24 UTC, `gh pr list -R Heifarabuval/cate --state merged --limit 200` rend 84 PR mergées, 22 qui ferment une issue, **20 qui ferment une issue et touchent un test** : le vivier suffit pour 2 + 10 + 5 + 1 = 18, avec 2 de marge (avant le filtre lockfile et e2e, non appliqué ce jour). Hypothèse : le fork seul, pas upstream.
- Q: Quel est le « commit parent » ? → A: le `baseRefOid` de la PR (le commit d'où le travail est parti), pas le parent du commit de merge : les PR du fork sont mergées par squash ou rebase, le parent du merge contient parfois d'autres PR. Hypothèse.
- Q: Qu'est-ce que « Claude Code nu » ? → A: un seul terminal, `claude` lancé à la racine du clone, **même `~/.claude`** (même CLAUDE.md global, mêmes skills, mêmes hooks), **même modèle**, **même mode de permission** que le bras outil. La seule différence est la couche d'orchestration : ni agence, ni orchestrateur, ni interlocuteur, ni panneaux reliés. Hypothèse : on mesure l'outil, pas la configuration personnelle.
- Q: Qu'est-ce que le bras « outil » ? → A: ce que la couche 1 livre au moment du rejeu, version notée (sha du fork, version de l'agence). Le **pilote** tourne sur l'outil d'aujourd'hui (orchestrateur et agence, sans interlocuteur) ; la **campagne qui donne le verdict** tourne après le MVP de la spec 010, car la couche 1 inclut l'interlocuteur (`009:50`). Hypothèse ; si 010 tarde, le verdict se prend sur l'outil sans interlocuteur et le rapport le dit.
- Q: Comment mesurer le temps actif de l'humain sans chronomètre ni capture d'écran ? → A: par les traces horodatées déjà écrites : messages humains dans les journaux Claude Code, clics du panneau agence (`note(..., 'clic')`, `tools/agence/agence.py:252-255`), commandes `debut` et `fini` du harnais. Chaque intervention compte le temps écoulé depuis la dernière sortie du système, **plafonné à 180 s** (au-delà, l'humain faisait autre chose). Le pilote compare cette mesure à un chronomètre tenu à la main ; écart de plus de 25 % : la règle est revue avant la campagne. Hypothèse.
- Q: Les rapports d'agents envoyés par `cate agent send` arrivent comme des messages utilisateur : comment ne pas les compter comme de l'humain ? → A: un message utilisateur dont le texte (normalisé) a été envoyé par un appel `cate agent send` ou `agence` d'un autre journal du même rejeu est une intervention de machine. Le reste est humain. Hypothèse, vérifiée par fixture.
- Q: Comment éviter que le bras voie la solution ? → A: le clone est neuf, **sans historique au-delà du commit parent et sans remote** (pas de `origin`, pas de commit futur dans les objets) ; il vit **hors du dépôt** (un `CLAUDE.md` parent du fork d'aujourd'hui serait chargé, `~/.cache/agence-bench/` par défaut) ; l'énoncé est le titre et le corps de l'issue, **sans commentaires**. Un appel d'outil du rejeu qui cite le dépôt d'origine, le numéro de la PR ou son sha invalide le rejeu (contrôle déterministe), qui est refait. Hypothèse.
- Q: Ordre et effet d'apprentissage ? → A: un tirage par graine fixée dans `selection.json` avant le premier rejeu : quelles issues, leur ordre, et pour chacune quel bras passe en premier. On joue **tous les premiers bras, puis tous les seconds** : deux bras d'une même issue ne se suivent jamais. L'humain connaît une partie des solutions d'origine : biais commun aux deux bras, accepté et dit au rapport.
- Q: Quelle qualité, concrètement ? → A: 009 (`009:77`) liste tests verts du premier coup, remarques de review, bugs après merge, travail refait. Ici : (a) tests de la PR d'origine verts au premier `fini` ; (b) tours de reprise jusqu'au vert (plafond 3, puis échec) ; (c) remarques d'une revue à l'aveugle par l'humain (diffs présentés sans le nom du bras). **Bugs après merge : non mesurables sur un rejeu** (rien n'est mergé) ; renvoyés à l'usage réel (spec 003, observation), le rapport le dit.
- Q: Les dépendances du clone ? → A: `node_modules` cloné en copie sur écriture (`cp -c`) depuis la racine quand le lockfile est identique, comme `cloneNodeModules` (`src/workspace/repository/runtime/nodeModules.ts:12-17`). Sinon, l'issue est marquée « dépendances à installer » et c'est l'humain qui lance `npm ci` (constitution X : jamais un agent).

## Vocabulaire

- **Bras** : une façon de faire la même issue : `nu` (Claude Code dans un terminal) ou `outil` (la couche 1 de Cate).
- **Rejeu** : une issue jouée dans un bras, depuis un clone neuf au commit parent.
- **Arbitre** : les fichiers de test de la PR d'origine, copiés sur le résultat du rejeu et lancés seuls.
- **Temps actif** : la somme des temps d'intervention de l'humain, chacun plafonné (180 s, hypothèse).
- **Temps mural** : du `debut` au dernier `fini` du rejeu.
- **Tour de reprise** : un `fini` suivi d'un arbitre rouge puis d'un nouveau travail.
- **Seuil** : `seuil.json`, fixé et commité avant le premier rejeu ; son empreinte est écrite dans chaque résultat.
- **Comparaison** : la même mesure avant et après une économie de jetons, en rejeu automatique (FR-011).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Je sais si l'outil me fait gagner du temps, chiffres à l'appui (Priority: P1)

Heifara lance la sélection : 12 issues tirées d'un vivier figé, l'ordre et le bras de départ tirés par une graine. Pour chaque rejeu, le harnais prépare un clone neuf au commit parent et un énoncé ; Heifara ouvre lui-même son terminal (bras nu) ou son workspace (bras outil), tape `debut`, travaille, tape `fini`. Le harnais lance l'arbitre, lit les journaux, écrit un résultat en nombres. À la fin, un rapport donne les quatre indicateurs par bras et le verdict contre le seuil.

**Why this priority**: c'est le critère de passage de la couche 1 (`009:50`, FR-012). Sans lui, la vision n'est qu'une hypothèse (`009:79`).

**Independent Test**: sur des fixtures (deux journaux de bras, un état agence avec des clics, un faux `gh`, un faux dépôt), `benchmark.py rapport` rend exactement les nombres attendus et le verdict attendu ; avec un `seuil.json` modifié après le premier résultat, il refuse.

**Acceptance Scenarios**:

1. **Given** 10 issues rejouées dans les deux bras, **When** le rapport tourne, **Then** il rend, par bras et par issue, temps actif, temps mural, qualité (a, b, c) et jetons, puis les rapports médians outil / nu et le verdict « passe » ou « ne passe pas » contre `seuil.json`.
2. **Given** le seuil non atteint, **When** le rapport est écrit, **Then** il dit « couche 1 : ne passe pas » et nomme l'indicateur qui manque ; la couche 2 n'est pas étendue (`009:86`).
3. **Given** un rapport médian du temps actif entre 0,65 et 0,75 sur 10 issues, **When** le rapport tourne, **Then** il dit « non conclusif, rejouer les 5 issues de réserve » et ne rend pas de verdict.
4. **Given** `seuil.json` absent, non commité, ou d'empreinte différente de celle des résultats, **When** le rapport tourne, **Then** il refuse avec ce motif (code 2).

---

### User Story 2 - Une économie de jetons est annulée si la qualité baisse (Priority: P1)

Un agent propose une économie (skill raccourci, brief plus court, compactage plus tôt). Avant d'être livrée, elle passe par une comparaison : 3 issues du vivier rejouées en automatique (`claude -p`, sans humain, sans fenêtre), avant et après, avec le même outil de mesure. Si un arbitre vert avant devient rouge après, l'économie est annulée.

**Why this priority**: FR-011 et SC-003 de 009 ; une économie qui casse un test n'est pas une économie (`009:85`).

**Independent Test**: un faux `claude` sur le PATH qui produit un diff connu et un journal connu ; avant : arbitre vert ; après : rouge ; `benchmark.py comparer` rend le code 1 et « annuler ».

**Acceptance Scenarios**:

1. **Given** une économie dont un rejeu devient rouge, **When** la comparaison tourne, **Then** elle rend « annuler », code 1, et nomme l'issue.
2. **Given** les trois arbitres verts avant et après, **When** la comparaison tourne, **Then** elle rend les jetons avant, après et le rapport, code 0.
3. **Given** un agent qui livre une économie de jetons, **When** l'orchestrateur prépare la PR, **Then** le skill exige le rapport de comparaison dans la PR (garde de texte).

---

### User Story 3 - Le benchmark ne touche ni à ma machine ni à mon écran (Priority: P1)

Le harnais ne lance ni l'app Cate, ni Electron, ni Playwright, ni `npm run dev`, n'ouvre aucune fenêtre et n'appelle aucun modèle (sauf `comparer`, en `claude -p` sans interface). Les clones vivent hors du dépôt, sans remote ; rien n'est poussé.

**Why this priority**: 009 FR-014 et constitution X (`.specify/memory/constitution.md:58-62`) : le rejeu se fait sur la machine où l'humain travaille.

**Independent Test**: faux exécutables `open`, `osascript`, `electron`, `npx`, `playwright`, `npm` sur le PATH qui échouent s'ils sont appelés ; toutes les commandes du harnais passent sans les appeler ; une issue dont les tests de PR sont seulement e2e est exclue du vivier.

**Acceptance Scenarios**:

1. **Given** toutes les commandes du harnais, **When** elles tournent en faux HOME avec les faux exécutables, **Then** aucun n'est appelé.
2. **Given** un clone préparé, **When** on y lance `git remote` et `git log --all`, **Then** aucun remote et aucun commit postérieur au commit parent.

### Edge Cases

- Rejeu interrompu (l'humain s'arrête au milieu) : `debut` sans `fini` ; le rapport le compte « inachevé », jamais comme un temps.
- Arbitre rouge après 3 tours de reprise : qualité « échec » ; le temps compte jusqu'au dernier `fini`.
- Tests de la PR qui dépendent d'une interface renommée par le rejeu : rouge pour les deux bras de la même façon ; la revue à l'aveugle note « rouge par interface » ; le rapport donne le nombre de ces cas.
- Agent non `claude-code` dans le bras outil : jetons « non mesurés » pour ce panneau (comme `attente_mesure.py`) ; le verdict sur les jetons devient « partiel » et le dit.
- Contamination détectée (le rejeu a lu la PR d'origine) : résultat invalidé, issue rejouée dans un clone neuf.
- Lockfile du commit parent différent de celui de la racine : « dépendances à installer », action de l'humain.
- Vivier insuffisant le jour du tirage (moins de 18 issues éligibles : 2 de pilote, 10 de campagne, 5 de réserve, 1 de comparaison) : le tirage refuse et dit combien il en manque.
- Deux rejeux en même temps : refusé ; un rejeu ouvert à la fois (le temps actif suppose un seul travail en cours).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Le harnais MUST être un script en Python stdlib dans `tools/agence/` (`benchmark.py`), hors de `src/`, sans dépendance ni appel de modèle (sauf `comparer`, FR-011 de 009). (009 FR-005, FR-013)
- **FR-002**: La sélection MUST figer dans `specs/011-mesure-benchmark/selection.json` le vivier éligible (critères des Clarifications), la graine, les issues tirées, leur ordre et le bras de départ de chacune, **avant** le premier rejeu. Deux tirages avec la même graine et le même vivier MUST rendre le même fichier.
- **FR-003**: Le seuil MUST vivre dans `specs/011-mesure-benchmark/seuil.json` (temps actif, jetons, règle de qualité, zone non conclusive), commité avant le premier rejeu ; chaque résultat MUST porter son empreinte ; le rapport MUST refuser un verdict si l'empreinte diffère ou si le fichier n'est pas commité. (009 SC-002, Q3)
- **FR-004**: Un rejeu MUST partir d'un clone neuf au `baseRefOid` de la PR, sans remote ni commit postérieur, hors du dépôt, avec un énoncé fait du titre et du corps de l'issue sans commentaires. Les deux bras d'une issue MUST avoir deux clones distincts.
- **FR-005**: Le harnais MUST mesurer par rejeu : temps actif (interventions humaines plafonnées), temps mural, qualité (arbitre au premier `fini`, tours de reprise, remarques de revue à l'aveugle), jetons (entrée, cache créé, cache lu, sortie, et leur total) de toutes les sessions `claude-code` du clone et de ses worktrees.
- **FR-006**: La mesure des jetons MUST reprendre `tools/agence/attente_mesure.py` (même lecture, même dédoublonnage par `message.id`) ; elle MUST rester en nombres seulement : aucun texte de conversation, aucun chemin, aucun identifiant de session dans les sorties ni dans les résultats commités. (006 FR-005)
- **FR-007**: L'arbitre MUST copier les fichiers de test de la PR d'origine (à son `headRefOid`) dans le clone et lancer **ces fichiers seuls** (Vitest ou `unittest`), jamais un e2e ; le résultat est vert, rouge ou « non lançable ».
- **FR-008**: Le contrôle de contamination MUST être déterministe (lecture des appels d'outil du journal) et invalider tout rejeu qui cite le dépôt d'origine, la PR ou son sha.
- **FR-009**: Le rapport MUST donner, par bras, les quatre indicateurs et leur médiane, le rapport outil / nu par issue, le verdict contre le seuil, et le nombre de rejeux invalidés, inachevés ou partiels. (009 SC-002)
- **FR-010**: Le verdict de couche 1 MUST s'écrire dans `specs/011-mesure-benchmark/rapport-benchmark.md` avec « passe », « ne passe pas » ou « non conclusif » ; aucune spec de couche 2 ne démarre sur « ne passe pas » ou « non conclusif ». (009 FR-012, récit 2 scénario 2)
- **FR-011**: `benchmark.py comparer` MUST rejouer en automatique (`claude -p`, sans humain, sans interface) un sous-ensemble fixe du vivier avant et après une économie de jetons, avec la même mesure, et rendre « annuler » (code 1) dès qu'un arbitre vert avant devient rouge après. (009 FR-011, SC-003)
- **FR-012**: Le skill `orchestrateur` MUST exiger le rapport de `comparer` dans toute PR qui annonce une économie de jetons. (009 SC-003)
- **FR-013**: Le harnais MUST NOT lancer l'app Cate, Electron, Playwright, `npm run dev`, `npm ci`, ni ouvrir une fenêtre ; c'est l'humain qui ouvre son terminal et son workspace. (009 FR-014, constitution X)
- **FR-014**: La mesure MUST montrer que le régisseur `agence` et les détections déterministes (chevauchement, péremption, budget : spec 010) ne consomment aucun jeton : leur part dans le rapport est un nombre, et il vaut 0. (009 SC-006)
- **FR-015**: Les résultats MUST être des fichiers JSON éditables à la main, un par rejeu, sous `specs/011-mesure-benchmark/resultats/`, écrits par `benchmark.py` seul ; aucun journal n'est copié dans le dépôt.

### Key Entities

- **Vivier** : issues éligibles à une date (numéro, PR, `baseRefOid`, `headRefOid`, fichiers de test de la PR).
- **Sélection** : graine, issues de pilote, issues de campagne, issues de réserve, ordre, bras de départ.
- **Seuil** : temps actif (rapport médian maximal), jetons (surcoût médian maximal), règle de qualité, zone non conclusive, empreinte.
- **Résultat de rejeu** : issue, bras, sha de l'outil, empreinte du seuil, début, fins, temps actif, interventions, arbitre par `fini`, tours de reprise, remarques de revue, jetons par poste, sessions lues et non mesurées, état (`valide`, `invalide`, `inachevé`).
- **Rapport** : agrégats par bras, rapports par issue, verdict, limites.

## Success Criteria *(mandatory)*

- **SC-001**: le rapport de campagne donne, pour chaque bras, temps actif, temps mural, qualité et jetons, et un verdict contre `seuil.json` commité avant le premier rejeu. (009 SC-002)
- **SC-002**: sur les fixtures, `benchmark.py rapport` rend exactement les nombres attendus, écrits avant le code ; deux lancements rendent la même sortie à l'octet.
- **SC-003**: `comparer` rend « annuler » sur la fixture où un arbitre devient rouge ; aucune PR d'économie de jetons ne se merge sans son rapport de comparaison. (009 SC-003)
- **SC-004**: 0 appel des faux `open`, `osascript`, `electron`, `npx`, `playwright`, `npm` sur toute la suite de tests du harnais ; 0 ligne dans `src/`. (009 FR-014)
- **SC-005**: au pilote, l'écart entre le temps actif mesuré et le chronomètre de l'humain est de 25 % au plus, ou la règle est revue avant la campagne.
- **SC-006**: dans le rapport de campagne, les jetons attribués au régisseur et aux détections déterministes valent 0. (009 SC-006)
- **SC-007**: aucun texte de conversation, chemin ou identifiant de session dans `resultats/`, `selection.json` ni le rapport (test de sortie, comme 006).

## Assumptions

- Heifara joue l'humain des deux bras ; il n'y a pas d'autre testeur aujourd'hui.
- Le coût en temps humain est réel : 2 rejeux de pilote, puis 20 à 30 rejeux de campagne. Durée d'un rejeu : **non mesurée**, hypothèse 30 à 60 min de temps mural, soit 10 à 30 h au total ; le pilote donne la vraie valeur avant la campagne.
- Le coût en jetons d'un rejeu n'est pas chiffré (`costUsd` null pour le modèle de l'orchestrateur, `specs/006-cout-attente-orchestrateur/mesure.md:11`) ; le pilote le mesure.
- Les journaux Claude Code d'un clone vivent sous `~/.claude/projects/<chemin encodé du clone>/`, ceux de ses worktrees sous le même préfixe ; vérifié pour `attente_mesure.py` (lecture d'un dossier), non vérifié pour le préfixe des worktrees (T003).
- Cible macOS Apple silicon seule (constitution VIII) ; `cp -c` est permis.

## Questions ouvertes

Chacune a son hypothèse, appliquée ci-dessus ; aucune ne bloque le lot 1.

1. **Surcoût de jetons accepté** : +50 % (hypothèse). Heifara fixe la valeur dans `seuil.json` (T040) avant le premier rejeu.
2. **Plafond d'une intervention** : 180 s (hypothèse), calibré au pilote (SC-005).
3. **Campagne avant ou après le MVP de 010** : après (hypothèse) ; le pilote tourne avant.
4. **Revue à l'aveugle** : par Heifara, environ 5 min par diff (hypothèse) ; si elle coûte trop, le rapport s'en passe et le dit (qualité sur a et b seulement).
5. **Sous-ensemble de `comparer`** : les 2 issues du pilote et 1 issue du vivier hors sélection, la plus courte en diff de la PR d'origine (hypothèse) ; jamais une issue de campagne, pour ne pas l'user ; coût en jetons mesuré à la première comparaison.
