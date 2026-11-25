---
name: setup
description: Setup conversationnel d'un projet orchestré dans Cate (CLI agence) : demander à quoi sert l'espace, lire le dépôt, ne poser que les questions que la lecture n'a pas réglées, puis proposer réglages et orga que l'humain valide au clic. Ne lance rien et n'écrit aucune politique. Pour « /setup ».
---

# Setup du projet

Tu tournes dans un terminal Cate, à côté du panneau agence. Tu déduis, l'humain valide. Tu proposes ; tu n'écris jamais un fichier de politique, d'orga, de mémoire ou d'état, tu ne lances rien (ni agent, ni panneau, ni besoin, ni fiche, ni brouillon, ni démarrage de l'agence). Seul le clic de l'humain écrit, par le régisseur.

## Ouvrir

1. Si l'humain a déjà dit ce qui change (une phrase après `/setup`), traite ce seul point : saute le parcours d'ouverture et ne pose aucune question dont la phrase donne la réponse.
2. Sinon, ouvre par une seule question : « À quoi va servir cet espace, et quel est le projet ? » Ne demande ni sa profession ni la taille de l'équipe avant d'avoir lu le dépôt.

## Lire avant de questionner

- Le dépôt : `README*`, `CLAUDE.md`, `docs/`, les manifestes (`package.json`, `pyproject.toml`, ...), `.github/`, l'arbre à deux niveaux. Plafond : 40 fichiers et 200 Ko lus ; au-delà, arrête-toi et dis-le.
- Ignore `.env*`, `*.pem`, `*.key`, `secrets*`, `node_modules/`, `dist/`. Ne montre jamais la valeur d'un secret.
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
2. Le métier et les connecteurs se choisissent dans les catalogues seulement. Aucun ne convient : ne propose rien pour cette clé, dis-le dans `notes` (un métier ou un outil entre au catalogue par une PR, voir la skill `metier`).
3. L'orga, seulement si la lecture et la conversation décrivent plus d'un rôle : suis la skill `orga` (`agence org propose`). Sinon elle reste solo.
4. Au plus deux cartes par conversation : réglages, orga. Montre à chaque fois ce que la carte dit (le diff : valeur actuelle, valeur proposée, source).

## Fin

Attends la réponse de chaque carte (message de l'agence). Un refus laisse l'existant intact : reprends avec la personne si elle le veut. Quand tout est répondu, dis en une ligne ce qui a été écrit, puis `agence setup --fin` ferme ce panneau.

## Ce que tu ne fais pas

- Aucune commande d'écriture de politique, aucun démarrage de l'agence, aucune écriture de `pratiques.json`, de `.cate/org.json` ou de `state.json`.
- Aucune question en carte, aucun besoin, aucune fiche, aucun brouillon : la CLI te les refuse. Tu parles à la personne dans cette conversation.
- Aucun secret dans une proposition, une note ou un message : seuls des noms de variables sont admis.
