---
name: metier
description: Travailler pour un métier non dev dans un projet orchestré par l'agence (CLI agence) : choisir l'accès d'un outil, décrire un métier avec la personne, préparer une écriture par une carte, ne jamais toucher un secret. À lire quand le métier du projet n'est pas dev, quand une fiche nomme un outil externe, ou pour « /metier ».
---

# Métier et connecteurs

Le métier du projet et ses droits sont dans la politique : lis-les, ne les recopie pas.

- `agence pratiques show` : le métier actif (`metier`), les outils ouverts en lecture (`connecteurs.lecture`) et en écriture (`connecteurs.ecriture`).
- `agence connecteur check` : pour chaque outil du métier, son accès (MCP branché, MCP absent, API, navigateur), la présence de son secret et ses droits.

Seul l'humain change le métier ou les droits, depuis le panneau agence. Tu ne lances jamais `agence pratiques set`.

## Au lancement d'une fiche du métier

1. Lance `agence pratiques show` puis `agence connecteur check`.
2. Ouvre les panneaux du métier, listés en fin de `agence connecteur check` : `panneau navigateur : <url>` dans un panneau navigateur relié à l'orchestrateur, `panneau perso : <id>` par le menu du canvas.
3. Si un outil manque, dis-le à l'orchestrateur avec la ligne de `agence connecteur check`. Ne cherche pas un autre accès toi-même.

## Ordre de choix d'un accès

Pour un outil, prends le premier qui existe :

1. un MCP déjà branché (`claude mcp list`, en lecture) ;
2. un MCP existant à installer, d'un éditeur ou d'un dépôt relu (propose-le à l'humain, avec son coût) ;
3. l'API officielle, en lecture seule ;
4. le navigateur, en dernier recours, en lecture seule.

Un nouvel outil entre au catalogue par une PR, jamais par un fichier du projet.

## Décrire un métier avec la personne

Un métier tient en quatre éléments. Pose une question par élément, avec un exemple chiffré :

1. **Connecteurs** : les outils qu'elle lit et ceux où elle écrit.
2. **Panneaux** : ce qu'elle regarde pendant le travail (une page, un panneau perso).
3. **Validateur** : la preuve qui dit « fini » (un fichier, un lien, ou son clic).
4. **Recette** : le travail qui revient (déclencheur, action, preuve).

Rédige la description, puis propose la PR qui l'ajoute au catalogue. La personne valide.

## Écrire : toujours par une carte

Un agent n'écrit jamais directement dans un outil externe. La garde refuse tout appel d'écriture sans carte validée.

1. Prépare la carte : `agence draft new --cible outil:<connecteur>:<outil> '<arguments JSON>'`.
2. L'humain clique Envoyer sur la page de la carte.
3. Appelle l'outil une fois, avec exactement les arguments de `agence draft show <id>`.
4. Termine par `agence draft sent <id> --evidence <résultat>`.

Une carte vaut un appel. Pour un second appel, prépare une seconde carte. Un outil par API ou par navigateur n'écrit pas : l'écriture devient une action « à faire par l'humain », avec le contenu préparé.

## Finir une tâche

`agence need done <besoin> --evidence <chemin ou lien>` contrôle la preuve nommée du métier (fichier non vide dans le workspace, ou lien `https://`). Pour une preuve par clic, `agence need done <besoin>` pose la carte de preuve et l'humain clique « Validé ».

## Secrets

- Ne lis jamais la valeur d'un secret : pas de `echo`, `env`, `cat` d'un fichier `.env`, ni d'outil qui rend un jeton.
- Ne recopie jamais un secret dans un brief, un message, un commit, un fichier ou la politique.
- Un connecteur nomme sa variable, jamais sa valeur. `agence connecteur check` dit seulement si elle est présente.
- Si un outil te rend un secret par erreur, arrête-toi et préviens l'orchestrateur sans le citer.
