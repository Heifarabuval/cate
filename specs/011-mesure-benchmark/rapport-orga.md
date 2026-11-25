# Rapport orga (spec 011, issue #248) : non conclusif

Mesure partielle. Heifara a choisi (2026-11-25) la mesure à la main sur 2 issues (#199, #26) avec `cate agent usage`, sans la campagne. Elle ne remplace pas la campagne (#155, ouverte) ni le pilote (#154, ouvert).

**Le test d'acceptation de #248 n'est pas atteint** : seul le bras nu (une session, sans orchestrateur) est mesuré. Les orgas duo et agence ne le sont pas : la constitution de la spec 011 interdit à un agent de jouer un rejeu à la place de l'humain, et les rejeux restent à jouer par Heifara.

## Chiffres

Source : `resultats/199-nu.json`, `resultats/26-nu.json` (`benchmark.py mesure`, outil `ab9013e12514`, seuil `2732c761...`, contamination 0). Rejeux du 2026-11-24.

| | #199 solo (nu) | #26 solo (nu) | duo | agence |
|---|---|---|---|---|
| Temps actif (humain) | 285 s | 805 s | non mesuré | non mesuré |
| Temps mural | 373 s | 3035 s | non mesuré | non mesuré |
| Qualité (arbitre) | vert au 1er `fini` | rouge x4, 3 reprises, jamais vert | non mesuré | non mesuré |
| Jetons total | 1 094 570 | 3 338 834 | non mesuré | non mesuré |
| dont lus en cache | 1 027 203 | 3 237 880 | non mesuré | non mesuré |
| dont sortie | 5 598 | 16 535 | non mesuré | non mesuré |
| Tours de l'orchestrateur | 0 | 0 | non mesuré | non mesuré |
| Interventions humaines | 3 | 9 | non mesuré | non mesuré |

Le bras nu est une session unique : le plus proche de « solo », sans en être la définition par fichier d'orga (`src/workspace/org`). Les jetons du régisseur ne sont pas attribués (`jetons_regisseur` nul, pas d'export `cate agent usage --json`).

## Hypothèse de coût (non testée)

Coût de l'orchestrateur = tours x contexte relu par tour. Références (mémoire de l'orchestrateur, mesure du 2026-11-18, autre époque) : 188 000 jetons lus par tour en moyenne, 477 000 pour la session orchestrateur du 17/11.

Ordre de grandeur, pas une mesure : #199 solo lit 1,03 M. Une orga qui ajoute 10 tours d'orchestrateur à 477 000 lus ajoute 4,8 M de lecture en cache, soit 4,6 fois le solo entier. Sur #26 (3,2 M lus), le même ajout pèse 1,5 fois. L'hypothèse pèse donc surtout sur les petites tâches. Tant que les tours de l'orchestrateur ne sont pas mesurés, elle reste ouverte.

## Ce que les deux rejeux disent déjà

- #199 (petit, 6 min, vert au 1er essai) : le solo suffit. Une orga ne peut rentabiliser que du temps humain, il en reste 285 s.
- #26 (4 fichiers de test, 51 min muraux, jamais vert en 4 essais, 9 interventions) : la tâche où une orga pourrait se rentabiliser (vérificateur séparé, parallélisme). Aucune mesure pour le dire.

## Recommandation

1. Ne pas conclure sur duo et agence. Heifara joue #199 et #26 en duo et en agence (4 rejeux : `benchmark.py debut/fini/controle/mesure`, `cate agent usage --json` exporté avant chaque `mesure`, `benchmark.py machine` avant chaque geste de l'orchestrateur). Max 4 agents Claude vivants.
2. Faire rendre à `benchmark.py` le nombre de tours de l'orchestrateur (colonne vide ci-dessus) : il ne le rend pas aujourd'hui.
3. Hypothèse de travail en attendant : solo par défaut pour une tâche de moins d'une heure et d'un seul fichier de test ; agence seulement pour une tâche longue ou à plusieurs fichiers, avec les tours d'orchestrateur comptés.

## Non vérifié

- Tout ce qui concerne duo et agence.
- Le nombre de tours de l'orchestrateur, pour les trois orgas.
- L'écart au chronomètre de Heifara (SC-005) : aucun chronomètre noté pour #199 et #26 dans le dépôt.
- Les références 188 000 et 477 000 : mémoire de l'orchestrateur, non rejouées ici.
- Les exemples d'orga de `src/workspace/org/contract/examples.ts` : non comparés au bras nu.
