# Mesure : où part le coût d'un orchestrateur (spec 006)

Mesure du 2026-11-20, faite sans lancer l'app, en lecture seule, par un script jetable (`python3 -I`, hors dépôt). Le lot 1 le remplace par `tools/agence/attente_mesure.py`, testé. Les nombres ci-dessous sont ceux à retrouver (SC-005).

## Échantillon

- Panneau « Orchestrateur » du projet cate. `cate agent usage --json` liste 22 sessions Claude Code ; 10 ont leur journal dans `~/.claude/projects/-Users-ADFINITAS-Documents-cate/` (les 12 autres : journal absent ou purgé, non mesurées).
- Période des journaux : 2026-11-18 11:25 à 2026-11-20 15:50 UTC.
- Contrôle de cohérence : `cate agent usage` donne 446 509 564 jetons d'entrée et 1 028 668 de sortie pour le panneau (22 sessions) ; le script retrouve 442 732 472 jetons lus du cache et exactement 1 028 668 jetons de sortie sur les 10 sessions lues. La sortie est identique à l'unité près : les 12 sessions sans journal n'ont rien produit.
- `contextTokens` rend `null` pour ce panneau au moment de la mesure (cause non cherchée) : il n'a servi à rien ici, la taille du contexte vient du journal.
- Coût en euros ou en dollars : **non chiffré**. `costUsd` est `null` (modèle `claude-sonnet-5-5` absent de la table de tarifs). La mesure du 2026-11-20 (`~/.claude/state/mesure-sessions-2026-11-20.md`, dollars équivalents API aux tarifs ajustés) situe l'orchestration à 64,9 $ sur 386 $ en 1,68 jour (16,8 %), tous projets confondus ; ce n'est pas le même échantillon et on ne le mélange pas avec les jetons ci-dessous.

## Méthode

1. Un tour = un message `assistant` du journal avec `usage`, dédoublonné par `message.id` (un même message est écrit en plusieurs lignes).
2. Jetons lus d'un tour = `usage.cache_read_input_tokens`.
3. Cause d'un tour = le message utilisateur qui le précède : résultat d'outil (`tool_result`), retour de Stop hook (`Stop hook feedback`), message d'agent ou notification, autre (saisie humaine, message du bus).
4. Passage d'attente = le tour qui suit un appel Bash dont la commande contient `agent wait`.

## Résultats

| Cause du tour | Tours | Jetons lus | Part |
|---|---|---|---|
| Résultat d'outil (boucle d'outils) | 1 214 | 291,0 M | 65,7 % |
| Saisie humaine ou autre | 356 | 84,4 M | 19,1 % |
| Stop hook (`/goal`) | 131 | 61,3 M | 13,9 % |
| Message d'agent ou notification | 28 | 5,9 M | 1,3 % |
| **Total** | **1 730** | **442,7 M** | 100 % |

| Indicateur | Valeur mesurée |
|---|---|
| I1 jetons lus par passage d'attente | moyenne 344 252, médiane 362 028 |
| Passages d'attente | 97 tours pour 96 appels `cate agent wait` (95 avec `--wait-timeout 60000`, 1 avec 420000, 1 sans) |
| I2 part des passages d'attente | 50,3 M sur 442,7 M = 11,35 % |
| I3 tours forcés par un Stop hook | 131 tours, 61,3 M, 13,9 % |
| I4 contexte médian par tour | 220 140 (moyenne 255 914) |
| Tours hors attente | 1 633 tours, médiane 208 475, moyenne 249 130 |

Les 132 retours de Stop hook portent tous une condition de `/goal` entre crochets (par exemple « toutes les issues closes ou avec une PR prête à merger ») et un constat « condition non remplie ». La condition dépend de merges et de clics humains : elle ne peut pas être vraie pendant une attente.

## Ce que la mesure change à l'issue

- L'attente passive n'est pas le gros poste : 11,35 % des jetons lus. Les pistes 1, 2 et 4 se partagent au mieux ces 11,35 %.
- Le `/goal` pèse davantage (13,9 %) et annule la fin de tour de la piste 2. C'est la cause 2 de l'issue, et elle compte plus que la cause 1.
- Le gros poste est la **taille du contexte** : 220 000 jetons en médiane, relus à chaque appel d'outil (65,7 % des jetons lus). Tout ce qui garde le contexte bas (spec 004, T1 et T4) vaut plus que tout ce qui réduit les tours d'attente. Borne théorique, non mesurée : un contexte ramené de 220 000 à 110 000 jetons divise par deux les jetons lus de tous les tours qui suivent. L'effet réel de `/compact` est à mesurer par la spec 004 (SC-006 : après ≤ 50 % de l'avant).

## Limites

- Un seul projet, un seul orchestrateur, 3 jours. Pas un dev qui orchestre une fois par semaine.
- Un tour d'outil n'est pas « de l'attente » : la classification par cause sépare ce qu'on peut sûrement retirer (passages d'attente, Stop hook) de ce qu'on ne retire pas (travail réel).
- Les 97 passages d'attente couvrent les attentes avant la PR #85 (plafond de 60 s) : après la PR et avec `--wait-timeout 600000`, un passage de foreground couvre 10 min, mais coûte autant de jetons par passage.
- Les tours d'outils lancés en parallèle dans un même message sont comptés une fois (dédoublonnage par id).

## Protocole du lot 1 (ce que le script doit reproduire)

1. Entrée : un dossier de journaux (`~/.claude/projects/<projet>/`) et une liste d'identifiants de session (`cate agent usage --json`, champ `sessionIds`), ou une fenêtre de jours.
2. Sortie : les nombres du tableau ci-dessus, par projet et en total, plus la durée totale des appels d'attente et le nombre de passages par 10 min. Aucun texte de conversation, aucun identifiant de panneau.
3. Un journal absent est compté (« non lu ») et nommé par son nombre, pas par son chemin.
4. Reproductibilité : relancé deux fois sur les mêmes fichiers, la sortie est identique.
5. Vérifications : fixture de 7 tours (2 passages d'attente, 1 tour Stop hook, 4 tours d'outil) avec nombres attendus écrits avant le code ; refus d'un chemin hors du dossier de sessions.
