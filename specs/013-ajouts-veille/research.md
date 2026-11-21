# Recherche : ajouts de la veille du 20/11 (spec 013)

Les sections du lot 0 (T001 à T004) s'ajoutent à ce fichier ; celle-ci est celle du lot 5.

## Lot 5 : part de l'attente après #100 (T050, T051, #176)

### Mesure (T050)

Outil : `python3 -I tools/agence/attente_mesure.py <dossier>`, en lecture seule, sur une copie des 5 journaux de session les plus récents du projet cate (dossier des journaux Claude Code du projet, sans `--usage-json`), modifiés du 2026-11-20 16:43 au 2026-11-21 01:37 (heure de Paris). Même méthode que `specs/006-cout-attente-orchestrateur/mesure.md` (avant), même outil que son lot 1.

| Indicateur | Avant (006, 10 sessions, 18 au 20/11) | Après (5 sessions, 20 et 21/11) |
|---|---|---|
| Tours, jetons lus | 1 730 tours, 442,7 M | 514 tours, 111,1 M |
| Passages d'attente (part des jetons lus) | 97 passages, 11,35 % | 24 passages, 5,48 % |
| Jetons lus par passage (médiane) | 362 028 | 193 551 |
| Tours forcés par un Stop hook | 131 tours, 13,9 % | 35 tours, 7,7 % |
| Contexte médian par tour | 220 140 | 186 934 |
| Appels `agent wait` | 96, dont 95 à 60 s | 24 : 17 entre 300 et 570 s, 6 entre 45 et 120 s, 1 sans délai |
| Durée totale des appels d'attente | non relevée | 4 967 s, soit 207 s par appel en moyenne |

Sortie brute de l'outil (après) : `passages_attente.part: 0.0548`, `stop_hook.part: 0.077`, `appels_attente.duree_s: 4967`, `appels_attente.passages_par_10min: 2.8991`, `contexte.mediane: 186933.5`.

### Lecture

- L'attente par événement de #100 a divisé par deux la part des passages d'attente (11,35 % vers 5,48 %) et le coût d'un passage (contexte plus petit).
- Il reste une boucle : 24 passages, 5,48 % des jetons lus. Mais un appel dure 207 s en moyenne pour un délai demandé de 300 à 570 s dans la plupart des cas : la majorité des attentes se terminent sur un événement (un agent rapporte ou finit), pas sur leur délai.
- Un recul exponentiel ne réduit que les réveils dus au délai. Ici les délais sont déjà proches du plafond de 10 min de l'outil Bash, et la plupart des réveils viennent d'un événement : le gain est borné bien au-dessous de 5,48 %, sans doute proche de zéro.
- Le reste le plus lourd n'est pas l'attente mais les tours forcés par un Stop hook (7,7 %) : le skill orchestrateur interdit déjà un `/goal` qui dépend d'un clic, d'un merge ou d'un agent, et la consigne n'est pas toujours suivie.

### Proposition (T051)

- Ne pas coder de recul exponentiel : la mesure ne montre aucun reste qu'il réduirait (FR-006). Proposer de fermer #176 comme sous-tâche de #100, cette mesure citée (hypothèse Q2 de la spec).
- Piste séparée, hors de ce lot et non codée : une garde qui refuse un `/goal` dans le panneau orchestrateur viserait les 7,7 % restants. À trancher par l'humain.

### Non vérifié

- Que les 5 journaux soient tous des sessions d'orchestrateur : le dossier du projet mêle orchestrateur et interlocuteur ; sans `--usage-json`, l'outil ne trie pas par panneau.
- La qualité (FR-006) : aucune comparaison de résultat entre les deux périodes, seul le coût est mesuré.
