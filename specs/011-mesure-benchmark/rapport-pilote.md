# Rapport de pilote (spec 011, lot 4, fiche F19, besoin n944)

État (2026-11-25, n972) : **3 rejeux exploitables sur 4** (nu #199, nu #26 rouge x4, outil #199) ; **#26 outil invalide deux fois** (défaut d'isolation du harnais, issue #258), pas de 3e rejeu. Pas de SC-005 (aucun chronomètre). Recommandation en fin de rapport : règle à revoir avant la campagne. Les rejeux sont joués par Heifara (T043 ; aucun agent ne joue un rejeu). La recommandation est une proposition, la décision (T045) est à Heifara.

## Résultats (`benchmark.py mesure`, outil `ab9013e12514`, seuil `2732c761...`, contamination 0)

| Rejeu | Temps actif | Temps mural | Arbitre | Interventions | Jetons total (lus, sortie) |
|---|---|---|---|---|---|
| #199 nu | 285 s | 373 s | vert au 1er `fini` | 3 | 1 094 570 (1 027 203, 5 598) |
| #26 nu | 805 s | 3035 s | rouge x4, 3 reprises | 9 | 3 338 834 (3 237 880, 16 535) |
| #199 outil | 12 s | 125 s | vert au 1er `fini` | 3 | 1 974 118 (1 891 092, 10 255) |
| #26 outil | invalide x2 (contamination) | non calculé | rouge x3 au 2nd essai | non calculé | non exploitable (6 912 721 au 2nd essai, sessions entières) |

Source : `resultats/199-nu.json`, `resultats/26-nu.json`, `resultats/199-outil.json`. #26 outil invalide : note ci-dessous, pas de fichier de résultat. Durée d'un rejeu : 6 min (#199 nu), 51 min (#26 nu), 2 min (#199 outil). Jetons du régisseur : 0 sur les deux bras outil (`--usage-json`).

## Vérifications du bras outil (2026-11-25)

**#199 outil, 12 s actifs contre 125 s muraux : cohérent avec la règle, mais pas comparable au nu.**
- Événements humains dans la fenêtre : `debut` (0 s), l'énoncé collé (+2 s), `fini` (125 s). `temps_actif` compte, pour chacun, le délai depuis l'événement précédent. Énoncé : 2 s. `fini` : 9 s après la dernière sortie du système (116 s). Total 11 à 12 s. Les ~113 s intermédiaires sont du temps d'agent (attente), exclu par construction (`benchmark.py:385`).
- Le 12 s ne compte donc que la saisie et la lecture finale. Ce que l'humain a fait avant `debut` (un collage 13 s avant) est hors fenêtre.
- Rapport outil / nu = 12 / 285 = 0,04, très sous le seuil 0,75. Ne pas le lire comme un gain : le nu à 285 s contient des gestes d'orchestrateur non marqués par `machine` (chronomètre à 0 s selon la section ci-dessous), donc le nu est surestimé. Sans chronomètre, l'écart SC-005 n'est pas calculable.

**Jetons de #199 outil (1 974 118) : ce sont les jetons de la session du panneau « Agence : 199-outil », pas ceux de la seule fenêtre du rejeu.**
- Preuve : le total égale 48 + 10 255 + 1 891 092 + 72 723 de ce seul journal (une session lue, `sessions.lues = 1`), qui court de 11:58:31 à 12:03:42. Le rejeu va de 11:58:45 à 12:00:50.
- Sur la fenêtre `debut` à `fini` seule (calcul du journal, message par message) : 1 763 376, soit 89 % du total. L'écart (+12 %) est la session avant `debut` (14 s) et après `fini` (172 s). Le bras nu a la même construction (session entière), donc la comparaison reste de même nature, mais `mesure` ne borne pas les jetons à la fenêtre.
- Même calcul sur #26 outil : 1 209 903 dans la fenêtre sur 2 025 617 au total (60 %), session en cours.
- Un seul panneau est lu : le bras outil de ces rejeux est un orchestrateur seul, sans agent de travail séparé. `jetons_regisseur` à 0 le confirme. Ce que l'outil ajoute (agents reliés, tours de l'orchestrateur) n'est donc pas encore mis à l'épreuve.

**#26 outil : deux rejeux, tous deux invalides (contamination). Ils ne sont pas un résultat, seulement une note.**

Règle (`benchmark.py`) :
- `controle` rend « invalide » dès qu'un appel d'outil du journal du clone cite le nom GitHub du dépôt d'origine, son checkout local, `/pull/<PR>` ou les 7 premiers caractères du sha de tête de la PR (`motifs`, lignes 294 à 312 ; FR-008). `mesure` met alors `etat: invalide` avant tout autre état (ligne 432).
- Un rejeu ne se ferme qu'au vert ou à la 4e rouge (`rouges > REPRISES`, `REPRISES = 3`, ligne 273) : `temps_actif_s` et `temps_mural_s` restent `None` tant qu'il est ouvert, quelle que soit l'invalidité (ligne 417).
- Un rejeu invalide est refait dans un clone neuf (T052) et le rapport compte les invalidés (FR-009).

**Premier essai** (début 12:04:36Z, 3 rouges : 12:06:10, 12:11:51, 12:17:32 ; 9 appels).
- Les 9 appels vont de 12:12:01 à 12:13:21, après le 2e `fini`. 5 ne matchent que le chemin du harnais (lecture de `benchmark.py`, recherche de `selection.json`). 4 citent le sha `0f76b2e` ou `/pull/27` : deux commandes avec le sha dans le clone, une commande qui mêle un `git checkout --` d'un fichier de test et un `git ls-remote origin refs/pull/27/head`, un `git cat-file` dans le checkout du dépôt d'origine. Contamination réelle : la session a lu la sélection (sha et PR en clair) et s'en est servie.
- Les 2 premiers `fini` (rouges) précèdent le premier appel qui matche. Ce que la session a fait du fichier de test ensuite : non vérifié.
- Ancien clone archivé dans `~/.cache/agence-bench/invalide-26-outil-1`. 832 153 jetons : la session de la reprise seule, pas un coût de rejeu.

**Second essai** (clone neuf, début 12:20:03Z, 3 rouges : 12:25:08, 12:26:03, 12:33:27 ; `controle` : 16 appels, `mesure` : invalide ; `resultats/26-outil.json` retiré du dépôt, le fichier d'état est en cache).
- Les 16 ne sont pas tous du second essai : 9 viennent du premier. Le clone neuf a le même chemin que l'ancien, donc le même dossier de journaux Claude Code (`~/.claude/projects/-Users-ADFINITAS--cache-agence-bench-26-outil`) : `controle` relit les 5 sessions, dont les 3 de l'essai précédent. Après le `debut` du second essai : **7 appels**.
- Ces 7 ne citent ni le sha ni `/pull/27`. 4 matchent le nom du dépôt : le brief du dev (12:21:16) et 3 commandes de l'orchestration (`agence draft new --cible pr:Heifarabuval/cate:...`, `cate agent send`, 12:24:03 à 12:24:13). C'est le flux normal du bras outil, qui prépare une PR vers le dépôt où l'agence tourne : le motif « nom du dépôt » invalide donc le bras outil par construction quand l'issue rejouée vient de ce même dépôt. 3 matchent le chemin du harnais (lecture de `benchmark.py`, 12:25:27 à 12:25:43, après le 1er `fini`) : le harnais est de nouveau accessible depuis la session.
- Rien ne prouve, dans ces 7 appels, un accès à la solution ; rien ne prouve non plus le contraire : le harnais a été lu et `selection.json` n'a pas été relu par moi. Non vérifié.
- Jetons 6 912 721 : deux sessions (orchestrateur 08f7aa8c, dev d94fcdb9), toutes deux du second essai : ce n'est pas le cumul de l'essai précédent. C'est la session entière de chaque panneau, non bornée à la fenêtre du rejeu.
- Rouge : `npm ci` s'est fait sous node v24.21.0 alors que `package.json` exige `>=22.16 <23` (`engines`, ligne 21 ; node de cette machine : v24.21.0 ; l'avertissement EBADENGINE est rapporté par l'orchestrateur, le log d'`npm ci` n'est plus sur disque). Les 3 rouges, comme les 4 du bras nu, peuvent venir de cet environnement : non vérifié, aucun test rejoué ici.

**Ce qui est rapportable pour #26 outil** : rien en indicateurs (temps actif, mural, interventions, durée, qualité) ; la seule chose établie est que le harnais invalide le rejeu deux fois, pour des raisons de dispositif (isolation, motif « nom du dépôt », journaux partagés entre clones de même chemin), tracées dans l'issue #258 (isolation du harnais, ouverte à part par Heifara). Le pilote n'a donc que 3 rejeux exploitables : #199 nu, #26 nu (rouge x4, jamais vert), #199 outil (vert).

**Chronomètres (q1062, 2026-11-25)** : aucun noté. Réponse de Heifara : « je n'ai rien eu a faire sur les deux » (lue comme : sur les deux rejeux outil). Aucune valeur pour #199 nu ni #26 nu. L'écart SC-005 (25 % max) n'est pas calculable : un chronomètre à 0 s contre 12 s mesurés sur #199 outil n'a pas de rapport défini. SC-005 : **non vérifié**, la mesure du temps actif reste non calibrée.

## Contrôlé en lecture seule (2026-11-24, base origin/main 452607b8)

| Contrôle | Résultat |
|---|---|
| `seuil.json` valide | `python3 -c "import json;json.load(open('specs/011-mesure-benchmark/seuil.json'))"` : ok |
| `seuil.json` commité tel quel | commit f0aa3ef9, `git ls-files --error-unmatch` ok |
| Empreinte du seuil | `2732c7611685aa56680a8233a90774b71cf8d4b79cb3434f6af78d25013cea6e` (`shasum -a 256`) |
| Source du seuil | « validé par l'humain le 2026-11-24 » : le mot « hypothèse » a disparu, donc `debut`, `mesure` et `rapport` ne refusent plus |
| `selection.json` | écrit par `benchmark.py select --graine 20261124` (graine = date du jour, T041), commit 3e9bcb52 ; vivier de 29 issues (≥ 18 exigé) |
| Pilotes | #199 (PR #221, test `src/shells/desktop/main/pipes.test.ts`) et #26 (PR #27, 4 fichiers de test dont `RuntimeMismatch.test.tsx`) ; les deux issues sont fermées, chaque PR est mergée et touche un test hors e2e (FR-007, filtre de `select`) |
| Tests du harnais | `python3 -m unittest tools/agence/test_benchmark.py` : 66 tests, **1 échec** (voir ci-dessous) |

### Test rouge : `test_debut_refuse_tant_que_le_seuil_est_une_hypothese`

Il copie le `seuil.json` livré et attend le refus « hypothèse ». Le seuil livré n'est plus une hypothèse, donc `debut` réussit : le garde-fou marche, c'est le test qui supposait un seuil non validé. Correctif à faire hors de cette fiche (fichier `tools/agence/test_benchmark.py`, exclu de la consigne) : écrire dans le test un `seuil.json` à source « hypothèse 011 » au lieu de copier celui du dépôt.

## Seuil recalé : ce que change `non_conclusif = [0,65 ; 0,75]` avec `temps_actif_max = 0,75`

`benchmark.py rapport` (lignes 504 à 520) : la zone est inclusive des deux bornes et ne compte que sur les 10 issues de campagne, tant que la réserve n'est pas entamée.

- Avant (max 0,70) : la zone chevauchait le seuil. Un rapport médian de 0,70 à 0,75 était « non conclusif », sous 0,65 « passe », au-dessus de 0,75 « ne passe pas ».
- Maintenant (max 0,75) : la zone finit pile sur le seuil. Tout rapport médian de 0,65 à 0,75 reste « non conclusif » (même plage qu'avant), y compris un 0,75 qui passerait ; au-dessus de 0,75, « ne passe pas » direct ; sous 0,65, « passe » (si qualité et jetons suivent). Ce qui change : de 0,70 à 0,75, le « non conclusif » ne rattrape plus un échec, il retient un passage ; la zone ne protège plus que d'un faux « passe » au ras du seuil.
- Sur 15 issues (réserve entamée), la zone ne joue plus : à 0,75 exactement, « passe ».
- Condition de code : `zone and manque in ([], ['temps actif'])` ; avec le nouveau seuil le second cas est vide pour un rapport dans la zone. Rien à modifier dans `benchmark.py`.
- Pas d'effet sur le pilote : `rapport` ne lit que `campagne` et `reserve`. Les 2 issues de pilote calibrent seulement la mesure.

À dire à Heifara : la zone « à 5 points du seuil » (spec.md, Clarifications) devient « 10 points sous le seuil ». Si l'intention est une zone symétrique autour de 0,75, il faut [0,70 ; 0,80] : à lui de trancher, après le pilote.

Textes de specs encore à l'ancienne valeur (hors de ma liste de fichiers, non modifiés) : `spec.md:23` (« baisse d'au moins 30 % »), `plan.md:50` (« ≤ 0,70 »), `tasks.md:116` (source « hypothèse »), fixture du test T023 (médiane 0,72, qui reste « non conclusif » avec la nouvelle zone).

## Ordre de rejeu

Un seul rejeu ouvert à la fois (`ouvert.json`). Ordre de `selection.json` : premiers bras des deux issues, puis seconds.

1. #199, bras nu
2. #26, bras nu
3. #199, bras outil
4. #26, bras outil

Les issues de pilote ne comptent pas dans la campagne. Heifara note à la main un chronomètre de son temps actif par rejeu (SC-005 : écart ≤ 25 %). Si un orchestrateur pilote le rejeu (messages par `cate terminal type`, `fini`), il pose `benchmark.py machine ISSUE BRAS` juste avant chaque geste : sans marque, ces gestes comptent comme du temps humain (#199 : 285 s mesurés pour un chronomètre à 0 s).

Le harnais lit le seuil et la sélection dans le dépôt où vit `benchmark.py`, et exige `seuil.json` commité. Les commandes ci-dessous visent le worktree `n944-preparateur`, où les deux fichiers sont commités. Si ce worktree disparaît avant le rejeu, merger d'abord la branche puis remplacer le chemin par celui du checkout de `main`.

## Commandes à coller

Préparation des 4 clones (sans remote, au commit parent) et des énoncés dans `~/.cache/agence-bench/` :

```
python3 /Users/ADFINITAS/Documents/cate/.cate/worktrees/n944-preparateur/tools/agence/benchmark.py prepare 199 nu
```

```
python3 /Users/ADFINITAS/Documents/cate/.cate/worktrees/n944-preparateur/tools/agence/benchmark.py prepare 26 nu
```

```
python3 /Users/ADFINITAS/Documents/cate/.cate/worktrees/n944-preparateur/tools/agence/benchmark.py prepare 199 outil
```

```
python3 /Users/ADFINITAS/Documents/cate/.cate/worktrees/n944-preparateur/tools/agence/benchmark.py prepare 26 outil
```

Rejeu 1 (#199, nu). Début, puis tu travailles dans `~/.cache/agence-bench/199-nu` avec l'énoncé `~/.cache/agence-bench/199-nu.md`, puis fini :

```
python3 /Users/ADFINITAS/Documents/cate/.cate/worktrees/n944-preparateur/tools/agence/benchmark.py debut 199 nu
```

```
python3 /Users/ADFINITAS/Documents/cate/.cate/worktrees/n944-preparateur/tools/agence/benchmark.py fini 199 nu
```

Un `fini` rouge laisse le rejeu ouvert (reprise possible, 3 maximum) ; vert ou 4e rouge le ferme. Une fois fermé :

```
python3 /Users/ADFINITAS/Documents/cate/.cate/worktrees/n944-preparateur/tools/agence/benchmark.py controle 199 nu
```

```
python3 /Users/ADFINITAS/Documents/cate/.cate/worktrees/n944-preparateur/tools/agence/benchmark.py mesure 199 nu
```

Rejeux 2 à 4 : mêmes trois étapes, dans l'ordre (`debut`, `fini`, `controle`, `mesure`) :

```
python3 /Users/ADFINITAS/Documents/cate/.cate/worktrees/n944-preparateur/tools/agence/benchmark.py debut 26 nu
```

```
python3 /Users/ADFINITAS/Documents/cate/.cate/worktrees/n944-preparateur/tools/agence/benchmark.py fini 26 nu
```

```
python3 /Users/ADFINITAS/Documents/cate/.cate/worktrees/n944-preparateur/tools/agence/benchmark.py controle 26 nu
```

```
python3 /Users/ADFINITAS/Documents/cate/.cate/worktrees/n944-preparateur/tools/agence/benchmark.py mesure 26 nu
```

```
python3 /Users/ADFINITAS/Documents/cate/.cate/worktrees/n944-preparateur/tools/agence/benchmark.py debut 199 outil
```

```
python3 /Users/ADFINITAS/Documents/cate/.cate/worktrees/n944-preparateur/tools/agence/benchmark.py fini 199 outil
```

```
python3 /Users/ADFINITAS/Documents/cate/.cate/worktrees/n944-preparateur/tools/agence/benchmark.py controle 199 outil
```

```
python3 /Users/ADFINITAS/Documents/cate/.cate/worktrees/n944-preparateur/tools/agence/benchmark.py mesure 199 outil
```

```
python3 /Users/ADFINITAS/Documents/cate/.cate/worktrees/n944-preparateur/tools/agence/benchmark.py debut 26 outil
```

```
python3 /Users/ADFINITAS/Documents/cate/.cate/worktrees/n944-preparateur/tools/agence/benchmark.py fini 26 outil
```

```
python3 /Users/ADFINITAS/Documents/cate/.cate/worktrees/n944-preparateur/tools/agence/benchmark.py controle 26 outil
```

```
python3 /Users/ADFINITAS/Documents/cate/.cate/worktrees/n944-preparateur/tools/agence/benchmark.py mesure 26 outil
```

Jetons par panneau (optionnel, sinon les jetons du régisseur restent « non attribués » et le total « partiel ») : exporter l'usage depuis un terminal Cate avant chaque `mesure`, puis ajouter `--usage-json` :

```
cate agent usage --json > ~/.cache/agence-bench/usage-199-nu.json
```

```
python3 /Users/ADFINITAS/Documents/cate/.cate/worktrees/n944-preparateur/tools/agence/benchmark.py mesure 199 nu --usage-json ~/.cache/agence-bench/usage-199-nu.json
```

(Même schéma pour 26 nu, 199 outil et 26 outil, avec leur nom dans le fichier.)

## Recommandation (proposition, pas une décision : T045 reste à Heifara)

Ne pas lancer la campagne telle quelle. La règle est à revoir avant, dans cet ordre :
1. **Isoler le rejeu** (issue #258) : harnais et `selection.json` hors de portée de la session ; un clone refait à un chemin neuf (ou ses journaux archivés avec lui) pour que `controle` ne relise pas l'essai précédent.
2. **Revoir le motif « nom du dépôt »** : il invalide le bras outil quand l'issue vient du dépôt où l'agence tourne (4 des 7 appels du second essai). Ne garder que le sha, `/pull/<PR>` et le checkout, ou accepter que le flux de PR cite le dépôt.
3. **Imposer node 22** au clone avant `npm ci` (`engines` `>=22.16 <23`), puis vérifier si le rouge de #26 disparaît. Tant que ce n'est pas fait, #26 (nu comme outil) ne départage rien.
4. **Calibrer le temps actif** : un chronomètre réel sur au moins un rejeu (SC-005 non vérifié ; #199 outil 12 s contre 285 s au nu non marqué).
5. **Borner les jetons à la fenêtre du rejeu** : `mesure` lit la session entière du panneau (89 % du total sur #199 outil).

Seuil : aucune donnée valide ne justifie un nouveau `seuil.json`. À noter pour T045 : sur la seule paire valide (#199), les jetons de l'outil valent 1,80 fois ceux du nu (1 974 118 contre 1 094 570), et 1,61 sur la fenêtre seule, au-dessus du plafond de 1,5 de `seuil.json`. Une paire ne conclut pas, mais le plafond de +50 % est déjà sous tension.

## Reste à faire

- Décision de Heifara (q1070, 2026-11-25) : clore le pilote à 3 rejeux, pas de 3e essai de #26 outil.
- Heifara : trancher T045 (campagne après correctifs, ou arrêt) ; issue #258 (isolation).
- Preuve de la fiche F19 : issue #154, à fermer par la PR de ce rapport seulement si Heifara juge le pilote réglé, sinon `Réf. #154`.
- Correction du test `test_debut_refuse_tant_que_le_seuil_est_une_hypothese` et alignement de `spec.md`, `plan.md`, `tasks.md` sur 0,75 (fiche à ouvrir).

## Non vérifié

- SC-005 (aucun chronomètre).
- La cause du rouge de #26 (node 24 contre 22 : hypothèse), dans les deux bras.
- Ce que la session du premier essai a fait du fichier de test, et si celle du second a relu `selection.json`.
- Le log `npm ci` du second essai (EBADENGINE) : rapporté, non vu.
- Le nombre de tours de l'orchestrateur : non rendu par `benchmark.py`.
