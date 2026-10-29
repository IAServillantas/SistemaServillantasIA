# Supabase

## 1. Aplicar schema

En el SQL Editor del proyecto, ejecuta en orden:

1. `supabase/migrations/20261029100000_inventory_init.sql`
2. `supabase/migrations/20261029120000_auth_profiles.sql`

## Auth / roles

| Rol | Acceso |
|-----|--------|
| `super_admin` | Hub + inventario + criticas + Chihuahua |
| `juarez` | Hub + inventario + criticas |
| `chihuahua` | Hub + Chihuahua |

Crear usuarios (despues de la migracion de perfiles):

```bash
npm run seed:users
```

En Supabase → Authentication: desactiva "Confirm email" en desarrollo o deja `email_confirm: true` del seed.

## 2. Variables

Copia `.env.example` → `.env.local` en la raiz (Vercel / local API).

Copia `frontend/shared/supabase-config.example.js` → `frontend/shared/supabase-config.js` y pega `url` + `anonKey`.

## 3. Tablas

| Tabla | Uso |
|-------|-----|
| `inventory_snapshots` | Cargas de inventario; una activa por `site_code` (`general` \| `chihuahua`) |
| `inventory_rules` | Umbrales (semilla igual a `backend/config/inventory-rules.json`) |

RPC `publish_inventory_snapshot` (solo `service_role`) publica una carga y desactiva la anterior.
