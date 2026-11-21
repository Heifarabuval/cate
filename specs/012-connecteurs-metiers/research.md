# Recherche : connecteurs du cobaye et du data manager (lot 0 de la spec 012)

**Lu le** : 2026-11-21. **Branche** : `docs/v2-recherche` (depuis `docs/spec-012-connecteurs-metiers`). **Portée** : T002, T003, T004. T001 est laissée à l'humain (voir plus bas). Rien n'a été écrit dans un vrai outil.

## Méthode et limites

- **Sources web** : recherche web (résumés de résultats) puis lecture des pages officielles par un agent de lecture de pages publiques. Chaque ligne cite l'URL lue. Un résumé de moteur de recherche seul est marqué « résumé de recherche, page non ouverte ».
- **Accès déjà branchés** : sortie de `claude mcp list` du 2026-11-21 (lecture seule). Les noms d'outils des connecteurs claude.ai viennent de la liste d'outils de cette session, aucun n'a été appelé.
- **Serveur `mcp-dsp`** : code source local lu en lecture seule (dépôt de l'organisation de l'agence, `README.md`, `src/index.ts`, `src/firebase.ts`) ; aucun outil appelé, surtout pas `dsp_get_token`.
- **Aucun nom de client ni de projet** n'a été donné à un service externe.
- **Non vérifié** veut dire : absent des pages lues ou non ouvert. Rien n'est déduit.
- Coût mensuel : presque partout **non trouvé**. Les serveurs MCP open source ne coûtent rien en licence ; le coût réel (compte, jetons du client IA) n'est pas chiffré ici.

## T001 [H] : cobaye, tâche de référence, bannière de consentement

Laissée à Heifara (009 T041, Q6 de la spec). **Hypothèse retenue** : le cobaye est le media planner (009 Q4). Aucune question posée à l'humain : l'hypothèse ne change pas le périmètre du lot. La bannière de consentement du data manager reste **à nommer** : aucune recherche n'a été faite sur ce produit (la spec l'interdit avant son nom). Id de question et réponse : sans objet, rien posé.

## Grille

Ordre de choix (spec 012, vocabulaire) : 1. MCP déjà branché, 2. MCP existant, 3. API officielle, 4. navigateur.

| Métier | Outil | Meilleur accès trouvé | Lecture et écriture séparables | Environnement de test | État |
|---|---|---|---|---|---|
| data manager | Gestionnaire de balises (hypothèse : Google Tag Manager, produit non nommé par la spec) | 3. API officielle v2 ; pas de MCP Google trouvé ; MCP tiers existent | Oui, par portée OAuth : `tagmanager.readonly` contre `tagmanager.publish` | Seulement « compte de test » recommandé | Vérifié pour l'API, non vérifié pour les MCP tiers |
| data manager | Analytics (hypothèse : GA4) | 2. MCP Google Analytics, Google, lecture par défaut | Oui : écriture derrière `--allow-write` et la portée `analytics.edit` | Non trouvé | Vérifié |
| data manager | Test A/B | 2. MCP de l'éditeur selon le produit (Kameleoon, AB Tasty, VWO) ; produit non nommé | Pas de mode lecture seule trouvé ; outils séparés par nom | Non trouvé | Partiel |
| data manager | Bannière de consentement | Produit inconnu | Non vérifié | Non vérifié | **Non vérifié, produit à nommer** |
| data manager | Régies publicitaires | 2. MCP Google Ads (lecture), Meta Ads, AdRoll, Microsoft Advertising selon la régie | Google Ads : oui ; Meta et AdRoll : non trouvé | Non trouvé | Partiel |
| media planner | Régies (budgets, dépenses, diffusion) | 1. `mcp-dsp` déjà branché, lecture de rapports bruts, **outil `dsp_get_token` à exclure** | Oui par nom d'outil, voir section dédiée | Non : lit la base de production | Vérifié dans le code local, droits réels non vérifiés |
| chef de projet | Tableur, messagerie | 1. connecteurs claude.ai déjà branchés (Sheets, Slack, Gmail) | Oui par nom d'outil | Non trouvé | Vérifié pour l'accès, planning non nommé |

## T003 : data manager

### Gestionnaire de balises (Tag Manager, hypothèse Google)

- **API officielle v2** : portées `tagmanager.readonly` (lecture), `tagmanager.edit.containers`, `tagmanager.edit.containerversions`, `tagmanager.publish` (publication), `tagmanager.delete.containers`, `tagmanager.manage.users`, `tagmanager.manage.accounts`. Source : https://developers.google.com/tag-platform/tag-manager/api/v2/authorization
- **Publication** : méthode `accounts.containers.versions.publish`. Source : https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.containers.versions
- **Quota** : 10 000 requêtes par projet et par jour, 0,25 requête par seconde par projet ; dépassement : HTTP 403. Source : https://developers.google.com/tag-platform/tag-manager/api/v2/limits-quotas
- **Environnement de test** : le guide recommande un « compte de test », pas de conteneur bac à sable dédié trouvé. Source : https://developers.google.com/tag-platform/tag-manager/api/v2/devguide
- **MCP Google pour Tag Manager** : non trouvé sur les pages lues.
- **MCP tiers** (résumé de recherche, dépôts non ouverts) : plusieurs serveurs communautaires listés sur des annuaires, certains annoncés « lecture seule par défaut » avec création, publication et suppression derrière des variables d'environnement. Exemples : https://github.com/paolobietolini/gtm-mcp-server, https://mcpservers.org/en/servers/neep305/mcp-for-gtm, https://glama.ai/mcp/servers/edid1zkc27. **Non vérifié** : propriétaire, code, portées demandées. Aucun ne se branche sans relecture de son code.
- **Classement lecture ou écriture** : par portée, pas par nom d'outil. Un jeton `tagmanager.readonly` ne peut pas publier ; c'est une seconde barrière, côté fournisseur, qui tient même si la garde de l'agence se trompe.
- **Authentification** : OAuth 2.0 ou compte de service. Variable de secret : à choisir par le connecteur (nom seulement), aucun nom imposé par la doc lue.
- **Coût** : non trouvé (l'API ne montre aucun tarif sur les pages lues).
- **Recommandation d'accès** : rang 3, API officielle en lecture seule avec la portée `tagmanager.readonly`, via un script d'accès. Une écriture par API est hors v1 (Q2 de la spec) : la publication d'un conteneur est une action « à faire par l'humain ».

### Analytics (hypothèse GA4)

- **MCP** : https://github.com/googleanalytics/google-analytics-mcp (README lu). Hébergement : local (`pipx run analytics-mcp`) ou HTTP / Cloud Run. Licence Apache-2.0. Statut annoncé par Google (expérimental, lecture seule) : voir https://developers.google.com/analytics/devguides/MCP (résumé de recherche, page non ouverte) ; le README lu ne donne pas de statut.
- **Outils de lecture** : `get_account_summaries`, `get_property_details`, `list_google_ads_links`, `list_property_annotations`, `list_key_events`, `run_report`, `run_funnel_report`, `run_conversions_report`, `get_custom_dimensions_and_metrics`, `run_realtime_report`.
- **Outils d'écriture** (exigent `--allow-write` et la portée `analytics.edit`) : `create_property_annotation`, `create_custom_dimension`, `create_key_event`.
- **Authentification** : identifiants par défaut d'application (ADC), portée `https://www.googleapis.com/auth/analytics.readonly` requise, `analytics.edit` pour l'écriture. Variable de secret : `GOOGLE_APPLICATION_CREDENTIALS` si compte de service (nom seulement).
- **Délai d'arrivée d'un événement** : le rapport temps réel (`runRealtimeReport`) couvre de maintenant à 30 minutes (60 pour GA360) et les événements y apparaissent « quelques secondes » après l'envoi. Source : https://developers.google.com/analytics/devguides/reporting/data/v1/realtime-basics. Délai des rapports standard : **non trouvé** (page « Reporting data expectations » non lue).
- **Coût** : non trouvé. **Environnement de test** : non trouvé.
- **Recommandation d'accès** : rang 2, ce MCP **sans** `--allow-write`. Preuve du pixel : `run_realtime_report` après avoir déclenché l'événement dans le navigateur du panneau.

### Test A/B

- **Kameleoon** : serveur MCP de l'éditeur, 62 outils. Lecture : `experiment_get`, `experiment_list`, `experiment_results_get`, `feature_flag_get`, `feature_flag_list`, etc. Écriture : `experiment_create`, `experiment_update`, `experiment_lifecycle_update` (démarrer, pauser, arrêter, supprimer), `experiment_traffic_allocation_set`, `feature_flag_enable`, `feature_flag_disable`, `goal_*`, `segment_*`. Mode lecture seule : **non trouvé** ; la page demande une confirmation avant un changement sur du trafic réel. Hébergement, authentification (renvoi vers une page non lue), prix, environnement de test : non trouvés. Source : https://docs.kameleoon.com/mcp/mcp-server
- **AB Tasty** : dépôt de l'éditeur, local (npx en stdio ou serveur HTTP local), licence MIT. Lecture : `decision_api_get_campaigns`, `decision_api_get_campaign`, `decision_api_get_flags`. Écriture ou effet : `decision_api_activate_campaign`, `resource_loader_api_load_webexp_resources`, `resource_loader_api_load_featexp_resources` (paramètre `dryrun`). Pas d'outil de résultats ni de gestion d'expérience. Authentification : identifiant d'environnement et clé d'API en en-têtes (`x-fear-env-id`, `x-fear-api-key`). Source : https://github.com/flagship-io/mcp-server
- **VWO (Wingify)** : MCP de gestion des drapeaux et de l'expérimentation, local (npx), licence Apache-2.0. Lecture : liste et détail des drapeaux et règles, projets et environnements, métriques. Écriture : créer, mettre à jour, basculer, supprimer drapeaux et règles. Authentification : `WINGIFY_ACCOUNT_ID` et `WINGIFY_API_KEY` (noms seulement). Source : https://github.com/wingify/vwo-fme-mcp
- **Optimizely** : aucune page MCP trouvée sur https://docs.optimizely.com/ (page d'accueil sans contenu lu).
- **Produit réel du data manager non nommé** : le classement ci-dessus vaut pour ces trois seulement. Aucun ne montre de mode lecture seule : pour un connecteur retenu, les outils d'écriture vont dans `ecriture` du catalogue et la garde les refuse sans carte.

### Bannière de consentement

Produit exact inconnu (009 Q5). **Non vérifié, aucune recherche faite.** À nommer avant le lot 5.

### Régies publicitaires (pixels et conversions)

- **Google Ads** : MCP officiel du dépôt `googleads`. Lecture : `search_search` (requête GAQL), `metadata_get_resource_metadata`, `customers_list_accessible_customers`. Écriture limitée (propose puis confirme, `validate_only`) : `assets_create_asset`, `assets_upload_video_asset`, `labels_manage_labels`, `labels_manage_label_associations`. La page dit qu'il ne crée ni ne modifie campagnes, groupes d'annonces, budgets ni enchères. Authentification : ADC avec `https://www.googleapis.com/auth/adwords` (stdio), client web OAuth 2.0 pour Cloud Run. La page dit que les jetons de développeur sont retirés le 9 septembre 2026 ; ce que cela change pour un compte aujourd'hui n'est **pas vérifié**. Déploiement Cloud Run : projet avec facturation, tarif non indiqué. Sources : https://developers.google.com/google-ads/api/docs/developer-toolkit/mcp-server et https://github.com/googleads/google-ads-mcp
- **Meta** : serveur MCP hébergé par Meta (`mcp.facebook.com/ads`). Catégories : reporting, création et édition de campagnes, catalogues, signaux et jeux de données, tests A/B. Pas de noms d'outils sur les pages lues, pas de mode lecture seule trouvé. Authentification : OAuth (Facebook Login for Business) ou jeton d'accès déjà obtenu ; revue d'application nécessaire seulement pour gérer les données d'autres entreprises. Sources : https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-overview et https://developers.facebook.com/blog/post/2026/07/16/meta-ads-mcp-server/. Coût et environnement de test : non trouvés.
- **AdRoll** : MCP de l'éditeur, bêta (billet du 27 mai 2026) : lecture (performance, rapports), écriture (brouillons de campagnes, « certains flux de gestion »), qui « dépend des permissions de l'utilisateur ». Pas de noms d'outils. L'article d'aide est resté illisible (HTTP 403). Source : https://www.adroll.com/blog/adroll-mcp-server
- **Microsoft Advertising** : page MCP de l'éditeur : lecture décrite (comptes, métriques) ; l'écriture, l'hébergement et l'authentification ne sont pas sur la page lue ; mention « at launch » : disponibilité **non vérifiée**. Connexion annoncée gratuite, l'assistant IA pouvant être payant. Source : https://about.ads.microsoft.com/en/solutions/technology/mcp-server
- **The Trade Desk** : aucun MCP officiel trouvé ; un projet communautaire existe (résumé de recherche, non ouvert), non évalué.
- **Antvoice** : aucune recherche web faite, **non vérifié**. Le seul accès connu est l'outil `dsp_fetch_antvoice` de `mcp-dsp`.

## T002 : cobaye (media planner)

### `mcp-dsp` : vérifié dans le code local et la liste d'outils

- **Propriétaire** : dépôt de l'organisation GitHub de l'agence (`media_reporting`, sous-dossier `mcp-dsp`), serveur local en stdio lancé par `node`. `claude mcp list` du 2026-11-21 : connecté. Le README se présente comme un serveur de diagnostic (« debug ») qui lit les jetons dans Firestore, les déchiffre et appelle les API des régies.
- **Treize outils** (`src/index.ts`) :
  - **Lecture de données de régie** : `dsp_fetch_meta`, `dsp_fetch_google_ads`, `dsp_fetch_bing`, `dsp_fetch_thetradedesk`, `dsp_fetch_adroll`, `dsp_fetch_antvoice` (lignes brutes sur une période).
  - **Listes** : `dsp_list_connectors`, `dsp_list_meta_accounts`, `dsp_list_google_accounts`, `dsp_list_bing_accounts`, `dsp_list_adroll_org`.
  - **Test** : `dsp_test_meta` (appelle `/me` sur l'API Meta pour tester un jeton).
  - **À exclure** : `dsp_get_token` « déchiffre et renvoie les jetons » d'un connecteur. Son nom ressemble à une lecture, mais il met des secrets dans le contexte d'un agent (FR-006 de la spec, 009 FR-009). Il ne doit figurer ni dans `lecture` ni dans `ecriture` du catalogue **et la garde doit le refuser sans carte possible** (voir « Écarts pour la spec »).
- **Écritures** : `grep` sur `src/` des motifs `.set(`, `.update(`, `.add(`, `.delete(`, `POST`, `PUT`, `PATCH`, `DELETE`, `mutation` : aucune écriture Firestore ni mutation d'API repérée (hors `decipher.update`, qui est du chiffrement). Bing soumet un job de rapport d'après la description de l'outil, pas une modification de campagne : non relu ligne à ligne. **Non vérifié** : les droits réels des jetons stockés (un jeton peut permettre plus que ce que le code appelle).
- **Authentification et secrets** : variables d'environnement `FIREBASE_PROJECT_ID`, `ENCRYPTION_KEY`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `BING_DEVELOPER_TOKEN`, `BING_CUSTOMER_ID`, `GOOGLE_APPLICATION_CREDENTIALS` (noms seulement, README). Le serveur lit donc la base de **production** : aucun environnement de test.
- **Couverture pour le validateur chiffré** : dépenses et diffusion par régie, oui (lignes brutes). **Budgets** : non vérifié, le serveur ne dit pas lire les budgets planifiés ; ils viendraient d'un tableur ou du plan média.
- **Classement proposé pour le catalogue** (`serveur` = `mcp-dsp`) : `lecture` = les six `dsp_fetch_*`, cinq `dsp_list_*`, `dsp_test_meta` ; `ecriture` = aucun ; `interdit` = `dsp_get_token`. La clé `interdit` n'existe pas dans le schéma de la spec : voir plus bas.

### Chef de projet : connecteurs déjà branchés (`claude mcp list`, 2026-11-21)

Tous « Connected » : Google Sheets, Google Docs, Google Slides, Google Drive, Google Calendar, Gmail, Slack (connecteurs claude.ai), plus Figma. Le serveur Slack du greffon et un second Figma demandent une authentification.

- **Tableur de budget (Sheets)** : lecture `get_values`, `get_spreadsheet` ; écriture `append_values`, `update_values`, `update_formulas`, `batch_clear_values`, `insert_dimension`, `update_spreadsheet`, `copy_sheet_to_another_spreadsheet`.
- **Messagerie** : Slack, lecture `slack_read_*`, `slack_search_*` ; écriture `slack_send_message`, `slack_send_message_draft`, `slack_schedule_message`, `slack_update_canvas`, `slack_create_canvas`, `slack_add_reaction`. Gmail, lecture `search_threads`, `get_message`, `get_thread` ; écriture `send_message`, `reply`, `forward`, `create_draft`, `trash_*`, `label_*`.
- **Planning** : outil exact non nommé par la spec : non vérifié (Google Calendar est branché, `create_event`, `update_event`, `delete_event` seraient des écritures).
- **Écart de la garde actuelle** : `est_envoi` (`tools/agence/agence.py:2467-2468`) ne couvre que `slack_send_message` et `Gmail__send_message`. `reply`, `forward`, `slack_schedule_message` et `slack_send_message_draft` partent aussi vers l'extérieur et lui échappent. Le classement en échec fermé du lot 2 (T020) les couvre dès qu'un connecteur déclare ces serveurs ; avant, rien ne les arrête.

## T004 : la tâche de référence tient-elle en lecture et en cartes ?

**Réponse** : oui, sous une réserve. Tâche proposée : « rapprocher les dépenses réelles d'une campagne avec son budget planifié et signaler l'écart », qui tient en lecture (`dsp_fetch_*` pour les dépenses, un tableur lu pour le budget) et en une carte d'écriture facultative (écrire l'écart dans le tableur). **Preuve nommée proposée** : `rapprochement-depenses`, type `fichier` (un export des totaux par régie et de l'écart, non vide, empreinte notée). **Réserve** : les budgets planifiés ne viennent pas de `mcp-dsp` (non vérifié) ; si le cobaye les tient ailleurs que dans un tableur lisible, la tâche ne tient plus en lecture seule et R3 du plan se rouvre.

## Écarts pour la spec 012 (à trancher par l'humain)

1. **Outil de lecture qui expose un secret** (`dsp_get_token`). Le schéma n'a que `lecture` et `ecriture`, et la garde traite un outil inconnu d'un serveur déclaré comme une écriture (FR-003 : refus sauf carte cliquée). Une carte pourrait donc autoriser `dsp_get_token`. Option : une liste `interdit` par connecteur, que la garde refuse même avec une carte. Hypothèse retenue ici : non tranchée, notée seulement.
2. **Portée du jeton comme seconde barrière.** Pour les accès par API (rang 3), préférer des identifiants à portée lecture seule (`tagmanager.readonly`, `analytics.readonly`) : la lecture reste sûre même si la garde se trompe.
3. **`claude mcp list` donne l'état, pas les droits.** `agence connecteur check` (lot 4) peut dire « branché », jamais « lecture seule » : les droits des jetons ne se lisent pas.
4. **Aucun environnement de test trouvé** pour les outils du cobaye ni du data manager (seulement le « compte de test » de Tag Manager). La recette R1 du lot 6 devra nommer un bac à sable avec l'humain.

## Non vérifié (liste)

- Produit de bannière de consentement, produit d'outil de planning, produit de tag manager, produit d'A/B du data manager.
- Tout coût mensuel d'outil ou de compte (aucun trouvé).
- Environnement de test de tous les outils sauf le « compte de test » conseillé pour Tag Manager.
- Droits réels des jetons derrière `mcp-dsp` ; budgets planifiés dans `mcp-dsp`.
- Statut (bêta ou stable) des serveurs Google Analytics, Google Ads, Kameleoon, AB Tasty, VWO, Meta : absent des pages lues.
- Disponibilité réelle du MCP Microsoft Advertising et de The Trade Desk ; Antvoice entier.
- Délai d'arrivée des rapports standard GA4.
- MCP tiers de Tag Manager : propriétaire, code, portées.
