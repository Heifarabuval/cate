# Implementation Plan: Coût en jetons de l'attente d'un orchestrateur

**Branch**: `docs/spec-cout-attente` | **Date**: 2026-11-20 | **Spec**: [spec.md](spec.md) | **Mesure**: [mesure.md](mesure.md)

## Résumé

L'issue #100 pose cinq pistes. La mesure (mesure.md) dit que l'attente passive pèse 8,1 % des jetons lus d'un orchestrateur, que les retours de Stop hook (`/goal`) en pèsent 13,9 %, et que la taille du contexte (médiane 220 000) multiplie tout le reste. Le plan retient **la piste 2, avec la piste 1 comme filet, plus une règle sur `/goal`**, écrites dans le skill `orchestrateur`. Aucun code produit. Un script de mesure en lecture seule, avant et après.

## Comparaison des pistes

Gain = borne haute sur l'échantillon de 442,7 M de jetons lus (mesure.md). Coût d'implémentation = ce qu'il faut écrire et maintenir.

| # | Piste | Gain mesuré (borne haute) | Coût d'implémentation | Cas chiffré | Verdict |
|---|---|---|---|---|---|
| 1 | `cate agent wait` en fond | 35,9 M (8,1 %), moins un passage par 10 min | 1 ligne de skill | 25 min d'attente : 25 passages à 60 s (cas de l'issue, ~3,5 M) contre au plus 3 passages à 600 s (~0,4 M à 140 000 par passage) | Retenue comme **filet** |
| 2 | Ne pas attendre : finir le tour, les rapports arrivent par `cate agent send` | 35,9 M (8,1 %), plus les retours de Stop hook s'il n'y a pas de `/goal` (jusqu'à 61,5 M, 13,9 %) | 2 lignes de skill, aucun code : le canal existe, c'est la ligne « Fin » du brief | 25 min d'attente : 0 passage ; 1 tour utile par rapport (3 agents = 3 tours) | **Retenue** |
| 3 | `/compact` avant l'attente, session neuve par vague | non mesuré ; borne théorique : contexte ÷ 2 = jetons lus ÷ 2 sur tous les tours suivants (65,7 % sont de la boucle d'outils) | déjà écrit : spec 004, T1 (`/compact`, seuil 150 000) et T4 (`/clear`, inactif) | contexte 220 000 → 110 000 : 110 000 jetons de moins par tour, sur 1 730 tours | **Hors de cette spec** : fait par la spec 004, à mesurer par son bilan |
| 4 | `agence wait` côté régisseur | égal à la piste 1 (même plafond 600 s, même blocage) | code dans `tools/agence/agence.py` : sous-commande, tests, doc, conflit avec les specs 004 et 005 | inchangé : un appel bloquant d'au plus 600 s reste un passage | **Rejetée** : depuis la PR #85 `cate agent wait` fait déjà ce plafond ; la reprendre si I1 reste haut au lot 4 |
| 5 | Modèle moins cher pour l'attente | non mesuré ; coût par jeton inconnu (`costUsd` null) | changer de modèle en cours de session : le choix est celui de l'humain (mémoire du projet : le modèle de l'orchestrateur n'est pas décidé par un agent) | n/a | **Rejetée** : on retire le passage plutôt que de le rendre moins cher |

## Piste retenue, et ce qui la rend la plus simple à maintenir

**Trois phrases dans `skills/orchestrateur/SKILL.md`, zéro ligne de code.** Le canal des rapports (`cate agent send`), l'attente plafonnée à 600 s et la mesure (`cate agent usage`) existent déjà ; il ne reste qu'à dire à l'orchestrateur de s'en servir. Rien à porter à chaque synchro avec upstream (constitution IX), rien à migrer, aucun réglage à ajouter. Si la règle ne tient pas, elle se retire en effaçant des lignes.

Texte à écrire (lot 3, version de travail) :

1. Suivi (remplace `SKILL.md:28`) : « Suis : après avoir lancé et rattaché la vague, termine ton tour. Les rapports arrivent par `cate agent send` et chacun relance un tour. Filet : un seul `cate agent wait <ids> --wait-timeout 600000` en tâche de fond pour la vague ; à son réveil `cate agent list`, puis `cate agent read <id>` pour un agent au repos sans rapport. Jamais d'attente en avant-plan en boucle. »
2. `/goal` : « Ne pose pas de `/goal` dont la condition dépend d'un clic humain, d'une merge ou d'un agent : chaque fin de tour redevient un tour complet. Le suivi et les cartes disent ce qui reste. »
3. Mesure : « `python3 tools/agence/attente_mesure.py` donne le coût d'une vague en nombres. »

## Mécanisme

- **Fin de tour** : une session Claude Code qui termine son tour sans Stop hook actif n'est relancée que par un prompt. `cate agent send` en envoie un à l'orchestrateur dès qu'il peut le prendre (`cate agent send --help`). Aucun tour n'a lieu entre-temps.
- **Filet** : une commande Bash `run_in_background` relance la session à sa sortie (comportement du harnais). `cate agent wait` sort quand tous les panneaux listés sont prêts pour un prompt, ou au plafond (d'après `cate agent wait --help`). Une commande qui sortirait aussitôt parce que les agents sont déjà « prêts » ferait un tour pour rien : la sonde T011 du lot 2 le vérifie sur une vague réelle avant d'écrire la règle.
- **Pas de poll** : aucune boucle, aucune planification récurrente.

## Modules touchés

Aucun module de `src/`. Fichiers : `tools/agence/attente_mesure.py`, `tools/agence/test_attente_mesure.py`, `tools/agence/fixtures/attente/` (lot 1), `specs/006-cout-attente-orchestrateur/rapport-sonde.md` (lot 2), `skills/orchestrateur/SKILL.md`, `tools/agence/test_regle_attente.py` (lot 3), `specs/006-cout-attente-orchestrateur/rapport-mesure.md` (lot 4).

## Conformité à la constitution

- **III coupes nettes** : la ligne `--wait-timeout 60000` est remplacée, pas doublée. Rien à supprimer d'autre ; la mesure n'ajoute aucune commande de plus à `agence`.
- **VI tests d'abord** : fixture et nombres attendus écrits avant `attente_mesure.py` ; la garde de texte du skill est vue rouge sur le skill actuel (il contient `--wait-timeout 60000`) avant la réécriture.
- **VII le plus simple** : une règle de skill avant un script de régisseur ; un script de lecture avant un tableau de bord.
- **IX écart minimal avec upstream** : 0 ligne dans `src/`. Tout vit dans `skills/` et `tools/`, déjà propres au fork.
- **X** : le script lit des fichiers, ne lance ni Playwright ni Electron ; la mesure du lot 4 s'appuie sur des vagues réelles, pas sur un lancement de l'app.

## Réglages (renvoi à la spec 005)

Aucun nouveau réglage. Deux valeurs pourraient en devenir, et elles relèvent de `specs/005-pratiques-reglables/` si elle les retient : le **plafond du filet** (aujourd'hui la constante de plateforme 600 s) et le **seuil de `/compact`** (déjà une ligne de `declencheurs.json`, spec 004). Cette spec n'ajoute ni clé, ni fichier de réglage, ni preset. Un dev qui travaille autrement (par exemple un orchestrateur qui reste à l'écoute en avant-plan) change son skill local, ce que le mécanisme de la spec 005 doit permettre, pas celle-ci.

## Conflits de fichiers avec les autres epics

Les quatre specs (005, 002, 006, 007) sont écrites en parallèle ; leurs implémenteurs partiront ensemble.

| Fichier | Cette epic | Autres epics possibles | Règle |
|---|---|---|---|
| `skills/orchestrateur/SKILL.md` | lot 3 : ligne 28 et deux lignes ajoutées | 002 (orchestrateur portable : le skill est son objet), 005 (pratiques réglables : le skill devient lisible par preset), 007 (panneaux perso partagés : peut citer le skill) | **Conflit probable.** Lot 3 en dernier sur ce fichier, ou rebase par l'implémenteur du lot ; le diff de 006 est de 3 hunks courts. L'orchestrateur sérialise les lots qui touchent ce fichier. |
| `tools/agence/attente_mesure.py`, `test_attente_mesure.py`, `fixtures/attente/*` (lot 1) | nouveaux | aucun | Aucun conflit. Parallélisable avec tout. |
| `tools/agence/test_regle_attente.py` (lot 3) | nouveau | aucun | Aucun conflit. |
| `tools/agence/agence.py`, `declencheurs.json` | non touchés | 004 (lots 3 à 5), 005 | Aucun conflit ici, volontairement (FR-007). |
| `specs/006-cout-attente-orchestrateur/**` | tous | aucun | Seul propriétaire. |

Lots 1 et 2 ne partagent aucun fichier : ils partent ensemble. Le lot 3 (règle) part quand le rapport de sonde du lot 2 est lu. Le lot 4 attend les lots 1 et 3 et une vague réelle.

**Ordre de merge et conflits entre les 4 specs** : voir `.cate/tmp/backlog/recoupement.md` (vague 1 : 005-L1, 007-L2, 002-5A, 006-L1).

## Estimation de coût

Jetons de l'implémentation : **non chiffré** (aucune mesure d'un lot de ce type). Gain : en jetons lus, borne haute 97,4 M sur 442,7 M (22 %) = 35,9 M de passages d'attente + 61,5 M de retours de Stop hook, **si** aucun `/goal` n'est posé ; en euros : non chiffré (`costUsd` null, SC-006).
