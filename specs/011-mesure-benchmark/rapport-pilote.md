# Rapport de pilote (spec 011, lot 4, fiche F19, besoin n944)

État (2026-11-25, n972) : **3 rejeux sur 4 mesurés** (nu #199, nu #26, outil #199) ; **#26 outil ouvert** (rouge au 1er `fini`, reprise attendue). Le rejeu est joué par Heifara (T043 ; aucun agent ne joue un rejeu). Pas de recommandation tant que les 4 ne sont pas fermés (T044, T045).

## Résultats (`benchmark.py mesure`, outil `ab9013e12514`, seuil `2732c761...`, contamination 0)

| Rejeu | Temps actif | Temps mural | Arbitre | Interventions | Jetons total (lus, sortie) |
|---|---|---|---|---|---|
| #199 nu | 285 s | 373 s | vert au 1er `fini` | 3 | 1 094 570 (1 027 203, 5 598) |
| #26 nu | 805 s | 3035 s | rouge x4, 3 reprises | 9 | 3 338 834 (3 237 880, 16 535) |
| #199 outil | 12 s | 125 s | vert au 1er `fini` | 3 | 1 974 118 (1 891 092, 10 255) |
| #26 outil | **inachevé** | non calculé | rouge au 1er `fini`, rejeu ouvert (1 reprise sur 3) | non calculé | 2 025 617 (1 944 825, 8 437), session en cours |

Source : `resultats/199-nu.json`, `resultats/26-nu.json`, `resultats/199-outil.json` (`26-outil.json` : état inachevé, non commité). Durée d'un rejeu : 6 min (#199 nu), 51 min (#26 nu), 2 min (#199 outil). Jetons du régisseur : 0 sur les deux bras outil (`--usage-json`).

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

**#26 outil, inachevé : une reprise est attendue, ce n'est pas un résultat à rapporter.**
- `mesure` calcule temps actif, mural et interventions seulement si `etat['debut'] and finis and ouvert(a) != nom(a)` (`benchmark.py:417`). `ouvert.json` vaut `26-outil` : le rejeu est encore ouvert, `inachevé` est l'état d'un rejeu non fermé.
- Il se ferme au premier vert ou à la 4e rouge. Il en est à 1 rouge sur 3 reprises. Il faut reprendre, ou le clore à la main : question posée à Heifara (`agence ask`).
- Point à lever en reprise : les dépendances du clone sont « à installer » (`npm ci` sorti 0, mais scripts `postinstall` de `node-pty` et `esbuild` non exécutés). Le bras nu de #26 avait le même état et est resté rouge 4 fois. Si le rouge vient de l'environnement et non du travail, #26 mesure le même défaut des deux côtés. Non vérifié : aucun test rejoué ici.

Effet sur la recommandation : #26 outil étant ouvert, il n'y a pas de recommandation de seuil possible aujourd'hui. Sur #199 seul, la règle du temps actif donne un rapport de 0,04 qui ne départage rien (nu non calibré).

Le test d'acceptation n'est pas atteint : manquent #26 outil fermé, les 4 chronomètres de Heifara (SC-005, questions posées) et la recommandation.

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

## Reste à jouer

- Les 4 rejeux et les 4 chronomètres de Heifara (T043).
- `mesure` sur les 4 rejeux, puis ce rapport complété : tableau des quatre indicateurs, écart au chronomètre (≤ 25 %), durée et jetons par rejeu, recommandation (T044).
- Décision de Heifara : campagne telle quelle ou règle revue, avec nouveau `seuil.json` recommité avant la campagne (T045).
- Preuve de la fiche F19 : issue #154 fermée, après le rejeu. Elle est ouverte aujourd'hui.
- Correction du test `test_debut_refuse_tant_que_le_seuil_est_une_hypothese` et alignement de `spec.md`, `plan.md`, `tasks.md` sur 0,75 (fiche à ouvrir).

## Non vérifié

- Aucun rejeu, aucun `prepare`, `debut`, `fini` ni `mesure` n'a été lancé : le fonctionnement de bout en bout sur ces 2 issues est inconnu (clone, dépendances, arbitre).
- Que les fichiers de test de #199 et #26 passent à leur `headRefOid` dans un clone sans `node_modules` ne se sait qu'à `prepare` (dépendances « à installer » possible).
