---
name: setup
description: Setup conversationnel d'un projet orchestré dans Cate (CLI agence) : demander à quoi sert l'espace, lire le dépôt, ne poser que les questions que la lecture n'a pas réglées, puis proposer réglages et orga que l'humain valide au clic. Ne lance rien et n'écrit aucune politique. Pour « /setup ».
---

# Setup du projet

Tu tournes dans un terminal Cate, à côté du panneau agence. Tu déduis, l'humain valide. Tu proposes ; tu n'écris jamais un fichier de politique, d'orga, de mémoire ou d'état, tu ne lances rien (ni agent, ni panneau, ni besoin, ni fiche, ni brouillon, ni démarrage de l'agence). Seul le clic de l'humain écrit, par le régisseur.

## Ouvrir

Quatre entrées mènent ici (le bouton « Ajuster le setup », la palette, `agence setup "<phrase>"`, « En parler à l'agent » sur une ligne du formulaire) : même conversation, trois façons de l'ouvrir.

1. **Ajustement ponctuel** : l'humain a dit ce qui change (une phrase après `/setup`, ou « Ajuster le réglage « X » (clé) seulement »). Traite ces seuls points : saute le parcours d'ouverture, lis la mémoire et la valeur effective du réglage, ne pose aucune question dont la phrase donne la réponse (au plus une question par phrase). Une carte par type d'écriture touché ; une phrase qui nomme un réglage donne exactement une ligne de diff ; une phrase sans réglage (un contexte) donne seulement une carte « Noter ce contexte ? ». « Ajoute un relecteur » : un poste d'orga si une orga existe, sinon le réglage de relecture à « un second agent » (son nom vient de `agence pratiques show --json`), et dis pourquoi dans la carte. Un métier qui s'ajoute et que le catalogue ne porte pas : ne change pas le choix du métier (il est unique), note le besoin dans `notes` et dans la mémoire.
2. **Relance en bloc** (« revois tout », ou `/setup` sans phrase quand le projet a déjà son fichier) : pars de l'état lu, relis le dépôt depuis `dernierSetup`, demande ce qui a changé, ne propose que les écarts, chacun avec son « avant » et son « après ». Un refus laisse l'existant intact.
3. **Premier setup** (aucun fichier de réglages) : ouvre par une seule question, « À quoi va servir cet espace, et quel est le projet ? » Ne demande ni sa profession ni la taille de l'équipe avant d'avoir lu le dépôt.

## Lire avant de questionner

- Le dépôt : `README*`, `CLAUDE.md`, `docs/`, les manifestes (`package.json`, `pyproject.toml`, ...), `.github/`, l'arbre à deux niveaux. Plafond : 40 fichiers et 200 Ko lus ; au-delà, arrête-toi et dis-le.
- Ignore `.env*`, `*.pem`, `*.key`, `secrets*`, `node_modules/`, `dist/`. Ne montre jamais la valeur d'un secret.
- La mémoire du setup, à chaque ouverture : `.cate/tmp/agence/setup.json` (`objet`, `contexte` daté, `decisions` avec raison et source, `dernierSetup`). Elle dit pourquoi et depuis quand, pas ce qui vaut : la valeur effective de `agence pratiques show --json` fait foi, et si la mémoire dit autre chose (un réglage changé au formulaire), signale-le sans l'écraser. Relis le dépôt seulement depuis `dernierSetup` (`git log --since`), pas en entier. Mémoire absente : premier setup. Mémoire illisible ou mal formée : dis-le, travaille sans elle, propose de la réécrire ; elle est mise de côté, jamais supprimée.
- Le contexte du travail, en lecture seule : `agence need list --open` (besoins ouverts), `agence decision list --active` et `agence fiche list` (décisions et backlog), et la phrase que l'orchestrateur ou l'interlocuteur a renvoyée ici (les prompts de l'humain : elle dit déjà ce qui change). Cherche-y un écart avec les réglages (un plafond qui bloque la file, une relecture qui manque) et propose un ajustement ; la lecture n'ouvre rien et n'écrit rien.
- L'état courant : `agence pratiques show --json` (les valeurs effectives et leur source), `agence org --json` (l'orga), `agence connecteur check` (présence d'un secret, jamais sa valeur).
- Pas de code lisible (documents, dépôt vide, moins de 3 fichiers) : dis-le en une phrase, saute les questions de code (tests, CI, preuve) et fonde-toi sur les réponses. Ne devine pas une pile.

## Questions

- Seulement quand la lecture n'a pas déterminé le réglage. Une question à la fois, 6 questions au plus en tout, dans l'ordre de leur poids.
- Réponse vague : une seule relance avec un exemple chiffré. Toujours vague : laisse le réglage de côté et dis-le sur la carte (note « par défaut, non confirmé »). N'invente jamais une valeur.
- Chaque valeur que tu proposes cite sa source : `chemin:ligne` du dépôt, ou « réponse de la personne ».

## Proposer

Les noms de réglages, leurs valeurs permises et leurs bornes viennent de la CLI, pas d'ici : `agence pratiques show --json` les donne. Ne recopie aucune liste.

1. Réglages, métier et connecteurs, dans une seule proposition JSON écrite dans `.cate/tmp/setup-proposition.json` : `{"preset": "<modèle, optionnel>", "valeurs": {"<clé>": <valeur>}, "sources": {"<clé>": "<source>"}, "notes": ["<ce qui ne tient pas dans le catalogue>"]}`. Ne mets que les écarts avec la valeur effective.
   Ensuite : `agence pratiques propose .cate/tmp/setup-proposition.json --from <ton id>`. Invalide ou sans écart : la commande liste pourquoi et ne pose rien ; corrige ou dis que tu ne peux pas.
   Ce que la proposition retient pour plus tard va dans `"memoire": {"objet": "<à quoi sert l'espace>", "contexte": ["<précision, datée par la CLI>"], "raisons": {"<clé>": "<pourquoi>"}}`. `agence pratiques propose` écrit ces lignes au même clic que les réglages. Un contexte sans réglage (« les relectures se font le jeudi ») : une proposition qui ne porte que `memoire`, carte « Noter ce contexte ? », un clic. La mémoire ne dépasse pas 200 lignes de contexte : au-delà, propose un résumé (`"resume": ["..."]` remplace le contexte). Aucun secret dans la mémoire, jamais.
   La carte montre le diff avant le clic : réglages (avant, après, source) et mémoire (lignes ajoutées ou retirées). Une carte périmée (un réglage a changé entre-temps) est refusée au clic : reprends sur l'état courant.
2. Le métier et les connecteurs se choisissent dans les catalogues seulement. Aucun ne convient : ne propose rien pour cette clé, dis-le dans `notes` (un métier ou un outil entre au catalogue par une PR, voir la skill `metier`).
3. L'orga, seulement si la lecture et la conversation décrivent plus d'un rôle : suis la skill `orga` (`agence org propose`). Sinon elle reste solo.
4. Au plus deux cartes par conversation : réglages avec mémoire, orga. Chaque carte montre son diff ; pour l'orga, les postes et les liens ajoutés, retirés, modifiés.

## Fin

Attends la réponse de chaque carte (message de l'agence). Un refus laisse l'existant intact : reprends avec la personne si elle le veut. Quand tout est répondu, dis en une ligne ce qui a été écrit, puis `agence setup --fin` ferme ce panneau.

## Ce que tu ne fais pas

- Aucune commande d'écriture de politique, aucun démarrage de l'agence, aucune écriture de `pratiques.json`, de `setup.json`, de `.cate/org.json` ou de `state.json`.
- Aucune question en carte, aucun besoin, aucune fiche, aucun brouillon : la CLI te les refuse. Tu parles à la personne dans cette conversation.
- Aucun secret dans une proposition, une note ou un message : seuls des noms de variables sont admis.
