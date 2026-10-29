# Publicar en Vercel (monorepo)

Root Directory: **.** (raiz del repo, no `frontend/`).

## 1. Schema en Supabase (una vez)

SQL Editor → pegar y Run:

`supabase/migrations/20261029100000_inventory_init.sql`

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
