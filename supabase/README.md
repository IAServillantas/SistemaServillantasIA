# Supabase

## 1. Aplicar schema

En el SQL Editor del proyecto, ejecuta el archivo:

`supabase/migrations/20261029100000_inventory_init.sql`

O con CLI (si el proyecto esta linkeado):

```bash
supabase db push
```

## 2. Variables

Copia `.env.example` → `.env.local` en la raiz (Vercel / local API).

Copia `frontend/shared/supabase-config.example.js` → `frontend/shared/supabase-config.js` y pega `url` + `anonKey`.

## 3. Tablas

| Tabla | Uso |
|-------|-----|
| `inventory_snapshots` | Cargas de inventario; una activa por `site_code` (`general` \| `chihuahua`) |
| `inventory_rules` | Umbrales (semilla igual a `backend/config/inventory-rules.json`) |

RPC `publish_inventory_snapshot` (solo `service_role`) publica una carga y desactiva la anterior.
