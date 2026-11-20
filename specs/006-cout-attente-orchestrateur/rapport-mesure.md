# Rapport de mesure : coût de l'attente (spec 006)

## Avant

Mesure du 2026-11-20, faite par `tools/agence/attente_mesure.py` (lot 1, T003) en lecture seule sur les journaux du panneau « Orchestrateur » du projet cate : 10 sessions lues sur 22 (les 12 autres : journal absent ou purgé, comptées « non lues »). Commande :

```
cate agent usage --json | (garder le panneau Orchestrateur) > usage.json
python3 -I tools/agence/attente_mesure.py ~/.claude/projects/-Users-ADFINITAS-Documents-cate --usage-json usage.json
```

Aucun journal n'est copié dans le dépôt.

| Indicateur | `mesure.md` (script jetable) | `attente_mesure.py` |
|---|---|---|
| Tours | 1 730 | 1 730 |
| Jetons lus | 442 732 472 | 442 732 472 |
| Jetons de sortie | 1 028 668 | 1 028 668 |
| Cause : résultat d'outil | 1 214 tours, 291,0 M | 1 214 tours, 291 006 440 |
| Cause : Stop hook | 132 tours, 61,5 M | 131 tours, 61 320 165 |
| Cause : message d'agent ou notification | 28 tours, 5,9 M | 21 tours, 4 251 903 |
| Cause : saisie humaine ou autre | 356 tours, 84,4 M | 364 tours, 86 153 964 |
| I1 jetons lus par passage d'attente | 370 127 en moyenne, 364 645 en médiane (97 passages) | 344 252 en moyenne, 362 028 en médiane (146 passages) |
| I2 part des passages d'attente | 8,1 % (35,9 M) | 11,35 % (50 260 754) |
| I3 tours forcés par un Stop hook | 132, 13,9 % | 131, 13,85 % |
| I4 contexte médian par tour | 220 140 (moyenne 255 914) | 220 140 (moyenne 255 915) |
| Hors attente | 1 633 tours, médiane 208 475, moyenne 249 130 | 1 584 tours, médiane 205 089, moyenne 247 773 |
| Appels `agent wait` | 96 (95 à 60 000 ms) | 146 (138 à 60 000 ms, 2 à 45 000, 1 à 5 000, 1 à 420 000, 1 à 1 500 000, 3 sans) |
| Durée des appels d'attente | non mesurée | 7 392 s |
| Passages par 10 min d'attente | non mesuré | 11,85 |

### Écarts, expliqués

- **Passages d'attente : 146 contre 97, définition corrigée.** Le script jetable ne voyait un appel `agent wait` que si son bloc `tool_use` était la première ligne du message. Claude Code écrit un bloc par ligne avec le même `message.id` : un appel précédé d'un bloc de réflexion ou de texte était perdu. En ne gardant que la première ligne, le script de lot retrouve exactement le nombre de `mesure.md` (97 passages, 35 902 325 jetons lus, moyenne 370 127). `attente_mesure.py` lit tous les blocs du message. Conséquence : l'attente passive pèse **11,35 %** des jetons lus et non 8,1 %. Le gros poste reste la taille du contexte (65,7 % de jetons lus en boucle d'outils), la conclusion de `mesure.md` ne change pas ; la valeur de référence de SC-002 (I2 avant) est 11,35 %.
- **Causes Stop hook, agent, autre : 1, 7 et 8 tours déplacés** (total inchangé, 516 tours, 0,3 % des jetons lus). Le script jetable classait par une règle plus large dont le texte n'est pas conservé ; le script de lot classe par préfixe du message : `Stop hook feedback` (Stop hook), `<task-notification>` ou `Another Claude session sent` (agent), tout résultat d'outil (outil), le reste (autre). Les messages ambigus (un humain qui cite un agent, un relais Cate « Agent #n bloqué ») tombent dans « autre ». Non cherché plus loin : l'écart ne change aucune conclusion.
- **Moyenne du contexte 255 915 contre 255 914** : arrondi (442 732 472 / 1 730 = 255 914,7).
- **Hors attente** : suit le nombre de passages (1 584 tours au lieu de 1 633).

### À retenir pour le lot 4

I1 à I4 « avant » : I1 = 344 252 (moyenne), I2 = 11,35 %, I3 = 131 tours (13,85 %), I4 = 220 140. Échantillon : un projet, un orchestrateur, du 2026-11-18 au 2026-11-20, 10 sessions.
