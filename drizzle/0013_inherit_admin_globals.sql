-- Add agent_configs.inherit_admin_globals : si false, le tenant n'hérite
-- pas des blocs admin (spoken_time, spoken_phone, hangup, per_call_context,
-- config_blocks, admin_global) dans le system prompt assemblé par
-- /api/agent/config. Seuls persona + language directive sont conservés.
--
-- Default TRUE : préserve le comportement actuel pour tous les tenants
-- créés avant la migration (héritage opt-out, pas opt-in).
--
-- UI : checkbox + icon popup dans /dashboard/config et /admin/users/[id]
-- montrant le contenu admin qui serait hérité pour le plan du tenant.

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS inherit_admin_globals BOOLEAN NOT NULL DEFAULT TRUE;
