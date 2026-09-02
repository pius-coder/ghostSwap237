# Support Henshin + WhatsApp Baileys

La conversation de support est stockée dans Supabase et visible dans l’onglet **Administration → Support**. WhatsApp sert de notification : il ne remplace pas l’historique Henshin.

## Mise en service

1. Appliquer `supabase/20260901_support_inbox_baileys.sql` au projet Supabase après la migration finance du 31 août.
2. Générer deux secrets aléatoires distincts d’au moins 32 caractères.
3. Configurer le serveur Henshin avec `WHATSAPP_BAILEYS_URL`, `WHATSAPP_BAILEYS_SECRET` et `NOTIFICATION_DISPATCH_TOKEN`.
4. Déployer `whatsapp-service.Dockerfile` comme service persistant, avec un volume privé monté sur `/data/baileys`.
5. Configurer ce service avec le même `WHATSAPP_BAILEYS_SECRET`, le même `NOTIFICATION_DISPATCH_TOKEN` et `HENSHIN_NOTIFICATION_DISPATCH_URL=https://<henshin>/api/dispatch-notifications`.
6. Au premier lancement, scanner le QR affiché dans les logs via **WhatsApp → Appareils connectés**.

En local, `bun run dev:support` lance l’API, Vite et la passerelle. Le dossier `.baileys-auth` contient des clés cryptographiques de longue durée et ne doit jamais être commité, copié dans le renderer ou placé sur un volume public.

Baileys est une intégration WhatsApp Web non officielle. Elle doit être utilisée uniquement pour les notifications de support attendues, sans envoi de masse.

## Déploiement sur Temps avec sslip.io

Créer un projet Temps distinct de l’application Vercel à partir du même dépôt :

- App Directory / contexte de build : `app`
- Dockerfile personnalisé : `whatsapp-service.Dockerfile`
- Répliques : `1`
- Volume persistant : `/data/baileys`

Variables d’environnement d’exécution du projet Temps :

```env
WHATSAPP_BAILEYS_SECRET=<secret-aléatoire-de-32-caractères-minimum>
NOTIFICATION_DISPATCH_TOKEN=<autre-secret-aléatoire-de-32-caractères-minimum>
BAILEYS_AUTH_DIR=/data/baileys
HENSHIN_NOTIFICATION_DISPATCH_URL=https://<projet-vercel>/api/dispatch-notifications
```

Temps fournit `PORT` et le domaine HTTPS `sslip.io`. Après le déploiement, scanner le QR dans les logs, puis vérifier `/health`. Configurer ensuite Vercel avec :

```env
WHATSAPP_BAILEYS_URL=https://<domaine-sslip-temps>/notifications
WHATSAPP_BAILEYS_SECRET=<même-secret-que-Temps>
NOTIFICATION_DISPATCH_TOKEN=<même-token-que-Temps>
```

Redéployer Vercel après l’ajout des variables. Aucun de ces secrets ne doit commencer par `VITE_`.
