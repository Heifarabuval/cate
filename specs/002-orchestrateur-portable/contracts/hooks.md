# Contrat : `agence hooks` et les entrées de `settings.json`

## Commandes

| Commande | Effet | Codes |
|---|---|---|
| `agence hooks install [--settings <chemin>]` | fusionne les 2 entrées ci-dessous dans `~/.claude/settings.json` (défaut) ; sauvegarde `settings.json.bak-agence-<AAAAMMJJ-HHMMSS>` si le fichier change ; idempotent | 0 écrit ou déjà à jour, 2 JSON illisible (rien écrit) |
| `agence hooks uninstall [--settings <chemin>]` | retire les seules entrées agence ; un tableau `PreToolUse` vidé est retiré, `hooks` vide aussi | 0 |
| `agence hooks status [--json]` | `actif`, `inactif` ou `partiel` ; lu par `doctor` et par le régisseur | 0 actif, 1 sinon |

Règles :
- Écriture atomique (`tempfile` + `os.replace`, comme `tx`, `agence.py:128-131`). Un lien symbolique est résolu : on écrit sa cible.
- Une entrée agence se reconnaît à sa commande, qui contient `agence-hook` ; rien d'autre n'est lu ni modifié.
- Aucune permission ajoutée (`permissions.allow` intact).
- Cate n'appelle jamais ces commandes (CLAUDE.md du fork, section State).

## Entrées écrites

```json
{"hooks": {"PreToolUse": [
  {"matcher": "mcp__.*(slack_send_message|Gmail__send_message)$",
   "hooks": [{"type": "command", "command": "sh -c 'f=\"$HOME/.cate/runtime/$(cat \"$HOME/.cate/runtime/current\" 2>/dev/null)/agence/agence-hook\"; [ -x \"$f\" ] && exec \"$f\" send; printf %s \"{\\\"hookSpecificOutput\\\":{\\\"hookEventName\\\":\\\"PreToolUse\\\",\\\"permissionDecision\\\":\\\"ask\\\",\\\"permissionDecisionReason\\\":\\\"garde agence introuvable : envoi à confirmer\\\"}}\"'"}]},
  {"matcher": "Bash|WebFetch|Write|Edit|MultiEdit",
   "hooks": [{"type": "command", "command": "sh -c 'f=\"$HOME/.cate/runtime/$(cat \"$HOME/.cate/runtime/current\" 2>/dev/null)/agence/agence-hook\"; [ -x \"$f\" ] && exec \"$f\" pages; exit 0'"}]}
]}}
```

Le texte exact se fige au lot 3 ; le test compare à un fichier attendu, pas à ce bloc.

- `send` : échoue fermé. Sans CLI, décision `ask`. Avec CLI : `allow` si brouillon cliqué identique (`send_match`, `agence.py:1501-1518`), sinon `ask` (reprend la dernière ligne de `send-guard.sh:15`, sans l'exception du DM de Heifara).
- `pages` : échoue ouvert. Sans CLI, pas de projet orchestré possible. Avec CLI : `guard()` actuel (`agence.py:1520-1560`), sortie immédiate sans `state.json` (comme `agence-guard.sh:5-11`).
- `agence-hook` : lanceur POSIX livré dans `agence/` du tarball (`exec python3 agence.py guard --mode "$1"`), même test de python3 que le lanceur `agence`.

## Chez Heifara

Ses hooks `send-guard.sh` et `agence-guard.sh` restent branchés par `skills.sh` jusqu'au lot 5. Au lot 5 : `common/settings.base.json:43` et `:62` remplacés par les entrées ci-dessus, `send-guard.sh` garde son exception DM dans une entrée personnelle séparée. Les deux gardes ne doivent jamais tourner ensemble sur un même outil : un `allow` d'un hook ne lève pas l'`ask` de l'autre (hypothèse à confirmer sur la fusion des décisions de Claude Code ; test réel au lot 5).
