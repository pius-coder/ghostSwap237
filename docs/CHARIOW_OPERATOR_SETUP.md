# Chariow operator setup — Henshin credit packs

Do **not** create products or call live APIs from the application codebase during development.
This document is the manual checklist for operators.

## Why License products

Chariow blocks repeat purchases for Downloadable / Course / Bundle (`already_purchased`).
License products always allow repeat purchases. Each sale still generates a Chariow license key;
**Henshin must ignore that key**. Chariow never creates or activates a Henshin PRO licence.

## 1. Create four License products

In the Chariow store dashboard, create four products of type **License**:

| Henshin pack | Credits | Price (USD) | Suggested product name |
|---|---:|---:|---|
| Starter | 18 000 | 30 | Henshin Credits — Starter |
| Basic | 36 000 | 60 | Henshin Credits — Basic |
| Pro | 72 000 | 120 | Henshin Credits — Pro (credits only) |
| Enterprise | 180 000 | 300 | Henshin Credits — Enterprise |

Notes:

- Price currency: **USD**
- Do not enable “pay what you want”
- Do not require shipping
- Product name “Pro” means the credit volume pack, not a Henshin PRO licence

## 2. Collect product IDs

For each product, copy the public product ID (example: `prd_…`) from the product page or API.

## 3. Map IDs in Henshin

Use an authenticated admin API / RPC `admin_upsert_payment_provider_product` with:

- `provider = chariow`
- `currency = USD`
- `amount` matching the table above
- `external_product_id` = Chariow product ID
- `enabled = true`
- a non-empty audit `reason`

Until IDs are set, Chariow mappings remain **disabled** and the UI shows Mobile Money only.

## 4. Create the Pulse

1. Chariow dashboard → Automation → Pulses → Add Pulse
2. Endpoint (HTTPS only):
   - Production: `https://<your-host>/api/payment/chariow-pulse`
   - Rewritten to `/api/wallet?action=chariow-pulse` with raw-body HMAC verification
3. Subscribe at least to:
   - `successful.sale` (required for crediting)
   - `failed.sale`
   - `abandoned.sale`
4. Leave product filter empty (all mapped products) or restrict to the four credit products
5. Save and copy the Pulse signing secret into `CHARIOW_WEBHOOK_SECRET`

## 5. Server environment

```
CHARIOW_API_KEY=sk_live_...
CHARIOW_WEBHOOK_SECRET=...
PAYMENT_RETURN_URL=https://<app>/#/payment-success
APP_PUBLIC_URL=https://<app>
```

Never put these values in `VITE_*` variables, client bundles, logs, or Git.

## 6. Test without a real charge

1. Keep Chariow mappings disabled in staging until products exist
2. Use Chariow sandbox / test mode if available
3. Or POST a signed fixture Pulse locally:
   - raw JSON body
   - header `x-chariow-signature: sha256=<hmac>`
   - header `x-pulse-delivery-id: <unique>`
   - header `x-pulse-event: successful.sale`
4. Confirm:
   - signature verified on raw bytes
   - duplicate delivery IDs return 2xx without double credit
   - `pro_licenses` is unchanged
   - wallet ledger gains a single `purchase` row

## 7. Checkout payload Henshin sends

`POST https://api.chariow.com/v1/checkout` with:

- `product_id`
- `email` (from authenticated Henshin session)
- `first_name`, `last_name`
- `phone.number`, `phone.country_code`
- `currency: USD`
- `redirect_url`
- `custom_metadata.henshin_order_id`
- `custom_metadata.henshin_package_id`
- `custom_metadata.purpose = wallet_credits`
