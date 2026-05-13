-- Change the default Realtime model for new signups from gpt-realtime-mini
-- to gpt-realtime-2. Mini était choisi historiquement pour son coût plus
-- bas, mais la qualité voix/raisonnement de gpt-realtime-2 justifie le
-- coût pour les tests/démos courants.
--
-- Aussi : on update les tenants existants qui ont encore 'gpt-realtime-mini'
-- (= valeur par défaut au moment de leur signup) vers 'gpt-realtime-2'.
-- Si un admin avait CHOISI explicitement mini pour une raison, il peut
-- toujours le rebasculer manuellement depuis /dashboard (dropdown admin).

ALTER TABLE agent_configs ALTER COLUMN model SET DEFAULT 'gpt-realtime-2';

UPDATE agent_configs SET model = 'gpt-realtime-2' WHERE model = 'gpt-realtime-mini';
