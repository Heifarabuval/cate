# Rapport de sonde : mécanisme d'attente (spec 006, lot 2)

Sondes du 2026-11-20, 22:14 à 22:20, dans l'app déjà ouverte, avec deux agents jetables en `claude-haiku-5-5` (O, l'orchestrateur de sonde, et B), 4 agents Claude vivants au plus. Les tours de O sont comptés dans son journal de session (un tour = un `message.id` d'assistant, horodaté), pas par `cate agent usage`, qui ne donne que des jetons cumulés. Journal lu en lecture seule.

**Écart de montage, commun aux trois sondes** : B n'a pas été lancé par O. Dans ce projet, un `cate agent start` doit porter `--relation` et `agence need` dans la même commande (garde `panel-link-guard`) ; je l'ai lancé moi-même, avec O et B reliés à moi (`--relation trigger`), et B envoie à O par son id. Le mécanisme sondé (O au repos, réveillé par un `cate agent send`) est le même ; ce qui n'est pas sondé : O qui lance B lui-même.

| Sonde | Montage | Mesuré | Attendu | Écart |
|---|---|---|---|---|
| A (T010) | O a fini son tour. B attend 90 s puis envoie `ok` à O. | 0 tour de O sur 105 s (21:14:02 à 21:15:46), 1 tour à l'arrivée de `ok` (21:15:48) | 0, puis 1 | aucun |
| B (T011) | Idem, plus `cate agent wait <B> --wait-timeout 600000` lancé par O en `run_in_background`, puis O finit son tour | La commande sort au bout de **5 s** (code 0, notification à 21:15:59) alors que B vient de recevoir sa tâche de 90 s. 3 tours de O avant la fin de B (lancement, résultat de l'outil, notification), puis 1 tour à `ok2` (21:17:32) : **4 tours au lieu de 1** | 1 réveil, sortie après la fin de B, 0 passage entre-temps | **hypothèse tombée** |
| C (T012) | Idem A, après `/goal le fichier /private/tmp/claude-502/jamais.txt existe` (condition fausse) | 0 tour forcé de O entre 21:18:00 et 21:19:47 (107 s), 1 tour à `ok3`. Le `/goal` lui-même a coûté 2 tours à sa pose (21:17:57 et 21:18:00) | au moins 1 tour forcé par fin de tour | **hypothèse tombée** |

## Hypothèses qui tombent

- **T011, sortie différée du `cate agent wait`.** Lancé juste après le `cate agent send` à B, `wait` rend la main tout de suite : B est encore « prêt pour un prompt » quand la commande le lit, et le prompt envoyé n'a pas été pris en compte comme en attente. Le filet du plan (« un seul `cate agent wait` en fond pour la vague ») fait donc un tour pour rien, d environ 66 000 jetons lus dans la sonde (contexte de O au premier tour), sans durée d'attente derrière. Le plan écrit la condition (« Une commande qui sortirait aussitôt ... ») et la sonde la confirme. À corriger avant le lot 3 : le filet ne vaut qu'une fois les agents entrés dans leur tour (par exemple le lancer après le premier rapport, ou après avoir vu un agent `running` dans `cate agent list`), sinon il coûte un tour. Cause inférée, non prouvée : l'ordre des deux commandes (envoi à B, puis wait) ; non testé : `wait` sur un B déjà `running` depuis plusieurs secondes.
- **T012, tours forcés par `/goal`.** Aucun tour forcé en 107 s pour un orchestrateur de sonde au repos, alors que `mesure.md` en compte 131 (13,85 %) dans les vrais journaux. Le Stop hook de `/goal` n'a pas relancé O. Causes possibles, non vérifiées : l'évaluateur de la condition a jugé « non atteignable sans action » et s'est arrêté ; les 131 tours viennent d'un `/goal` dont la condition porte sur un fichier du dépôt, ou d'un évaluateur qui relance sur une condition que l'agent peut avancer. La règle `/goal` du plan reste défendable (131 tours mesurés dans les journaux), mais son mécanisme n'est pas reproduit : le lot 3 ne doit pas écrire « chaque fin de tour redevient un tour complet » comme un fait. Dire plutôt ce que la mesure établit : des tours Stop hook existent dans les journaux, 13,85 % des jetons lus.

## Ce que la sonde confirme

- **A** : une session qui finit son tour ne consomme aucun tour pendant l'attente (105 s, 0 tour) et est réveillée par `cate agent send` en 2 s (1 tour). La piste 2 tient.
- Coût des sondes : O 688 546 jetons lus, 805 de sortie ; B 1 006 373 lus, 1 443 de sortie (jetons cumulés de `cate agent usage`, amorçage compris). Coût en euros non chiffré (`costUsd` des jetables non relevé).

## Plan à corriger avant le lot 3

1. Mécanisme du filet (`plan.md`, section Mécanisme) : remplacer l'hypothèse « le filet attend » par le résultat de T011 ; la phrase du skill ne doit pas lancer `cate agent wait` juste après l'envoi.
2. Règle `/goal` (`plan.md`, texte 2) : garder l'interdit, retirer la cause non reproduite.
3. `tasks.md` T020 (b) vérifie `--wait-timeout 600000` et `run_in_background` : à garder seulement si la phrase du filet indique quand le lancer.

## Fin des sondes

Panneaux jetables fermés (`cate panel close --discard`, refus d'abord sur les deux : `claude is running`). `cate agent list` ensuite : 2 agents (l'orchestrateur du projet et ce sondeur), 0 jetable. Code mort : aucun (aucun code touché).

## Non vérifié

- O lançant B lui-même ; une vague de plus de 2 agents ; `wait` sur des agents déjà `running` ; modèle autre que haiku pour O ; `/goal` avec un orchestrateur réel qui a du travail restant ; le coût en euros.
