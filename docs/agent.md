# Agent Tech Assist (`apps/agent`)

L'agent tourne **sur l'appareil du client** (pas sur nos serveurs) : il fait ce
qu'un technicien ferait à distance, mais localement, avec l'accord du client à
chaque modification.

## Boucle

1. **Observer** (lecture seule, sans accord) : services, périphériques audio
   (registre `MMDevices`), volume, sourdine, droits administrateur.
2. **Expliquer et proposer** : un diagnostic en français, puis chaque correction
   avec ce qu'elle change.
3. **Attendre le « oui »** du client, action par action.
4. **Agir** : seules les actions de la liste blanche de la compétence existent.
5. **Vérifier** : relecture de l'état, puis « Entendez-vous du son ? » (l'agent ne
   peut pas l'entendre).
6. **Passer la main** à un technicien si l'agent n'y arrive pas (échec d'une
   action, problème persistant, matériel/pilote en cause). Le technicien voit le
   journal.

Chaque étape est envoyée à `POST /api/app/sessions/:id/events` (audit
`agent.<type>`) et affichée en console. Un journal serveur en panne n'empêche pas
le dépannage.

## Sûreté

- L'agent n'exécute **jamais** de commande libre venue du serveur ni d'un modèle :
  uniquement des scripts écrits dans le dépôt (`skills/*.ts`).
- Les scripts PowerShell partent en `-EncodedCommand` (UTF-16LE/base64) : pas
  d'interprétation par un shell intermédiaire.
- Tout identifiant lu sur la machine est validé (GUID) avant d'entrer dans un
  script ; les noms affichés n'y entrent jamais.

## Compétence « son » (`skills/sound.ts`)

| Code problème | Action proposée | Admin |
|---|---|---|
| `audio_service_stopped` | démarrer `AudioEndpointBuilder` / `Audiosrv` | oui |
| `render_disabled` | réactiver la sortie (`IPolicyConfig`) — **`verified: false`** | oui |
| `muted` | lever la sourdine (Core Audio) | non |
| `volume_low` (< 5 %) | remettre le volume à 50 % | non |
| `render_unplugged` | conseil (brancher), pas d'action | — |
| `audio_service_missing`, `no_render_device` | passe la main | — |

## Lancer (Windows)

```bash
npm run build --workspace apps/agent
node apps/agent/dist/cli.js --skill sound \
  --api https://<api> --token <jeton app> --session <id session>
```
Sans `--api/--token/--session`, l'agent fonctionne en local sans journal serveur.
Pour les actions « admin », lancer dans un terminal administrateur.

## Ce qui n'est PAS validé

- **Aucun test sur un vrai Windows.** Les 47 tests utilisent un faux Windows ;
  les scripts PowerShell/COM sont contrôlés en structure seulement. À essayer sur
  une vraie machine avant toute mise en service, en particulier l'action
  `enable_endpoint` (interface COM non documentée, marquée `verified: false`).
- **Pas de modèle IA branché** : le planificateur est à règles. Un LLM pourra
  choisir parmi les actions de la liste blanche, jamais écrire de commandes.
- **Pas d'installateur** (EXE signé, APK) ni de génération de l'empreinte
  matérielle côté client ; les liens de téléchargement du site restent vides.
- Android et les autres compétences (réseau, lenteur, imprimante…) : à faire.
