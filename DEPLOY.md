# Publicar en Vercel (monorepo)

Root Directory: **.** (raiz del repo, no `frontend/`).

## 0. Runtime Node

Usar **Node.js 22.23.4** (parche de seguridad oct 2026: CVE-2026-111497 Brotli y otros).
El repo fija `engines.node = 22.23.4` y `.nvmrc`.

## 1. Schema en Supabase (una vez)

SQL Editor → Run en orden:

1. `supabase/migrations/20261029100000_inventory_init.sql`
2. `supabase/migrations/20261029120000_auth_profiles.sql`

Luego:

```bash
npm run check:supabase
npm run seed:users
```

Verificar:

```bash
npm run check:supabase
```

## 2. Variables en Vercel → Settings → Environment Variables

| Variable | Valor |
|----------|--------|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role (solo server) |
| `INVENTORY_UPLOAD_TOKEN` | opcional |

Production + Preview.

## 3. Deploy

```bash
npx vercel
# produccion:
npx vercel --prod
```

O conecta el repo `luistorres8709/iaservillantas` en el dashboard de Vercel (Framework Preset: Other).

Build usa `npm run sync:config` y publica `frontend/` + funciones `api/*`.

## 4. Probar

- `/` hub
- `/chihuahua/` carga Excel → guarda snapshot
- `/api/config` → `{ configured: true }`
- `/api/inventory/latest?site=chihuahua`
