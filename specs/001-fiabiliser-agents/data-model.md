# Modèle de données

Les seuls états persistés sont ceux de `<racine>/.cate/tmp/agence/state.json`, écrit par la seule CLI `agence` (récits 1 à 3). Les récits 4 à 6 ne persistent rien.

## État `agence` : champs ajoutés ou changés

| Champ | Récit | Type | Règle |
|-------|-------|------|-------|
| `maxAgents` | 1 | entier ≥ 1, optionnel | Absent : défaut `MAX_AGENTS = 4`. Réglé par `agence start --max-agents`. |
| `agentsActive` | 1 | entier | Agents `running` au dernier tour (inchangé). |
| `agentsWaiting` | 1 | entier | Agents `waitingForInput` au dernier tour (inchangé). Le total vivant est `agentsActive + agentsWaiting`. |
| `orphanVus` | 3 | objet `{panelId: nombre de tours}` | Un panneau passe à 2 avant d'être proposé. Un panneau absent du tour est retiré. |
| `orphanGardes` | 3 | liste de panelId | Panneaux gardés par l'humain : jamais reproposés. Purgée des panneaux morts. |

Un état écrit avant ce changement n'a ni `orphanVus` ni `orphanGardes` : `empty()` les fournit et `load()` complète les clés absentes (`st.setdefault`, `agence.py:155-156`). Pas de migration.

## Besoin d'offre d'orphelin (récit 3)

Un besoin ordinaire (`kind: 'human'`, `owner: OWNER_HUMAIN`) avec :

| Champ | Valeur |
|-------|--------|
| `ref` | `orphan:<panelId>` (un seul besoin ouvert par panneau, `add_need` réutilise l'existant) |
| `title` | `Fermer le panneau « <titre> » (sans agent) ?` |
| `orphan` | `{panel, title, motif}` où `motif` vaut `sans-agent` ou `non-rattache` |
| `source` | absent |

Transitions : `open` → `done` (Fermer, preuve `panneau fermé : <id>`), `open` → `dropped` (Garder, ou panneau disparu, ou panneau devenu protégé).

## Verdict de relance (récit 2, non persisté)

| Champ | Type |
|-------|------|
| `oui` | booléen |
| `raisons` | liste de textes (agents en plein tour, worktrees non poussés, PR ouvertes, daemon redémarre) |
| `illisibles` | liste de noms de sources (`cate`, `git`, `gh`, `daemon`) |

`oui` vaut vrai seulement si `raisons` ne contient aucune cause bloquante et si `illisibles` est vide. Le redémarrage du daemon est une raison non bloquante.

## Récit 4 : aucune donnée

Entrées : chemin de la racine, chemin du worktree. Sortie : rien (best effort).
