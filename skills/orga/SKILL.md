---
name: orga
description: Créer le fichier d'orga d'un workspace (.cate/org.json) depuis la description de son équipe, en texte ou à la voix : un agent l'écrit, l'humain relit l'aperçu et clique. Pour « /orga », « décris mon équipe », « crée mon orga ».
---

# Orga par la parole

La personne décrit son équipe (« un PO, un dev front, un devops »). Tu écris le fichier ; elle le relit et clique. Tu n'écris jamais `.cate/org.json` toi-même.

1. Lis le format : `agence org --json` (solo si aucun fichier) et la section « Org » de `docs/architecture.md`. Un poste : `name`, `mission`, `model`, `effort` (`low` à `max`), `tools`, `done` (ce qui prouve qu'il a fini). Un lien : `from`, `to`, `verifiedBy` (optionnel), `click` (`before`, `after`, `never`). Le fichier ne règle jamais les droits : aucun poste ni outil nommé merge, push, envoi, permission.
2. Écris le fichier JSON dans `.cate/tmp/org-proposee.json`, un poste par rôle décrit, `done` concret pour chacun, `maxAgents` au plus le nombre de postes qui travaillent en même temps.
3. `agence org propose .cate/tmp/org-proposee.json --from <ton id>` : invalide, rien n'est posé et la commande liste les erreurs. Corrige le fichier à partir de ces lignes, relance. Si la description ne permet pas de produire un fichier valide, dis-le à la personne, ne devine pas.
4. Valide, la commande montre l'aperçu (postes, liens, parcours d'une tâche, coût, défauts) et pose une carte « Enregistrer cette orga ? ». Attends la réponse (message de l'agence).
5. Réponse « Enregistrer » : `agence org save <id de la carte>`. Autre réponse : n'écris rien, reprends la description avec elle.
