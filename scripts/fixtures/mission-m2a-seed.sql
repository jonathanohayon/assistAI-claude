-- MOCK seed for the config route snapshots (scripts/config-bytes-snapshot.ts,
-- scripts/session-config-check.ts). Mock data only (example.test, +9722000…).
-- Load into a THROWAWAY Postgres after `node scripts/migrate.mjs` (needs
-- migration 0049: outbound_agents.mission).
insert into users (id,email,password_hash,display_name,subscription_plan) values
 ('00000000-0000-0000-0000-00000000000a','a@example.test','x','Salon Mock','premium'),
 ('00000000-0000-0000-0000-00000000000b','b@example.test','x','Clinique Mock','global'),
 ('00000000-0000-0000-0000-00000000000c','c@example.test','x','Legacy Mock','global');
insert into agent_configs (user_id,instructions,greeting_instructions,agent_name,voice,speed,primary_language,business,knowledge,personality,voice_profile,realtime_provider,transfer_number,inherit_admin_globals) values
 ('00000000-0000-0000-0000-00000000000a','Tu es Sarah, réceptionniste du Salon Mock. Sois brève.','Bonjour, salon Mock ! Comment puis-je vous aider ?','Sarah','marin',1.0,'fr',
  '{"identity":{"name":"Salon Mock","tagline":"Coiffure","email":"a@example.test"},"centres":[{"id":"c1","name":"Centre A","address":"1 rue Mock","hours":{"mon":{"open":true,"openTime":"09:00","closeTime":"18:00"},"tue":{"open":false,"openTime":"09:00","closeTime":"18:00"},"wed":{"open":true,"openTime":"10:00","closeTime":"14:00"},"thu":{"open":true,"openTime":"09:00","closeTime":"18:00"},"fri":{"open":true,"openTime":"09:00","closeTime":"13:00"},"sat":{"open":false,"openTime":"09:00","closeTime":"18:00"},"sun":{"open":true,"openTime":"09:00","closeTime":"18:00"}}}],"services":[{"id":"s1","name":"Coupe","durationMinutes":60,"priceILS":120,"centreIds":"all","description":"Coupe et brushing"}],"centresRules":"Lundi = Centre A","knowledgeBase":"Parking gratuit."}'::jsonb,
  '[]'::jsonb,'{"vitesse":6,"creativite":3}'::jsonb,'{"turnSensitivity":4,"keyTerms":["balayage"],"pace":"fast","speakingStyle":"calme"}'::jsonb,'xai','+97230000000',true),
 ('00000000-0000-0000-0000-00000000000b','Tu es Dana.','','Dana','cedar',1.13,'he','{}'::jsonb,'[]'::jsonb,'{}'::jsonb,null,null,'',false),
 ('00000000-0000-0000-0000-00000000000c','Consignes legacy.','','', 'coral',1.0,'en','{"identity":{"name":"","tagline":"","email":""},"centres":[],"services":[],"centresRules":"regle"}'::jsonb,
  '[{"id":"k1","toolName":"t","businessName":"Legacy Mock","openingHours":"9-18","description":"Ancien format"}]'::jsonb,'{}'::jsonb,null,null,'',true);
insert into phone_numbers (user_id,phone_number) values
 ('00000000-0000-0000-0000-00000000000a','+97220000000'),
 ('00000000-0000-0000-0000-00000000000c','+97220000001');
insert into outbound_agents (id,user_id,name,agent_name,voice,language,instructions,greeting,knowledge,knowledge_sources,personality,noise_reduction_level) values
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000000a','Vente Mock','Léa','sage','fr','Propose un rendez-vous.','Bonjour {{name}}, ici Léa du Salon Mock.','Offre : coupe à 120.','["https://example.test"]'::jsonb,'{"vitesse":8,"creativite":2,"reactivite":7}'::jsonb,6),
 ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-00000000000b','Défaut Mock','Sarah','marin','he','','','', '[]'::jsonb,'{}'::jsonb,8);
insert into campaigns (id,user_id,name,agent_id,goal_preset,objective,success_criteria,status) values
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000000a','Camp Mock','00000000-0000-0000-0000-0000000000c1','appointment','Prendre un rendez-vous.','Un rendez-vous fixé.','running'),
 ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-00000000000b','Camp sans agent',null,'qualify','Qualifier.','','running');
insert into campaign_contacts (id,campaign_id,user_id,phone_number,contact_name,vars) values
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000000a','+972500000000','Dana','{"ville":"Mockville"}'::jsonb),
 ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-00000000000b','+972500000001','Noa','{}'::jsonb);
-- ── M2a additions (mock only): one campaign per goal preset + an unknown
-- stored preset, each with an objective, success criteria and contact vars;
-- agent …c3 HAS a stored mission (needs migration 0049), …c1 has none.
insert into app_settings (key,value) values
 ('campaign_goal_framings','{"sales":"  Framing vente ADMIN mock : présente l''offre {{offre}}.  ","lead_gen":"   "}');
insert into outbound_agents (id,user_id,name,agent_name,voice,language,instructions,greeting,knowledge,knowledge_sources,personality,noise_reduction_level,mission) values
 ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-00000000000a','Mission Mock','Noam','marin','fr','Consignes {{name}} à {{VILLE}}.','','Offre mock : {{offre}}.','[]'::jsonb,'{}'::jsonb,8,'{"version":1,"kind":"book_for_seller","cold":false}'::jsonb);
insert into campaigns (id,user_id,name,agent_id,goal_preset,objective,success_criteria,status) values
 ('00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-00000000000a','Camp cold','00000000-0000-0000-0000-0000000000c1','cold','  Appeler {{name}} ({{phone}}) à {{ville}}.  ','Un intérêt exprimé pour {{offre}}.','running'),
 ('00000000-0000-0000-0000-0000000000d4','00000000-0000-0000-0000-00000000000a','Camp sales','00000000-0000-0000-0000-0000000000c1','sales','Vendre {{offre}} à {{Name}}.','Une vente conclue.','running'),
 ('00000000-0000-0000-0000-0000000000d5','00000000-0000-0000-0000-00000000000a','Camp lead_gen','00000000-0000-0000-0000-0000000000c1','lead_gen','Qualifier {{name}} de {{ville}}.','Budget et délai connus.','running'),
 ('00000000-0000-0000-0000-0000000000d6','00000000-0000-0000-0000-00000000000a','Camp marketing','00000000-0000-0000-0000-0000000000c1','marketing','Annoncer {{offre}}.','Intérêt mesuré.','running'),
 ('00000000-0000-0000-0000-0000000000d7','00000000-0000-0000-0000-00000000000a','Camp custom','00000000-0000-0000-0000-0000000000c3','custom','Objectif libre pour {{name}}.','Critère libre.','running'),
 ('00000000-0000-0000-0000-0000000000d8','00000000-0000-0000-0000-00000000000a','Camp legacy','00000000-0000-0000-0000-0000000000c3','legacy_unknown','Objectif legacy {{ville}}.','Critère legacy.','running'),
 ('00000000-0000-0000-0000-0000000000d9','00000000-0000-0000-0000-00000000000b','Camp sans agent cold',null,'cold','Prospecter {{name}}.','Un rappel accepté.','running');
insert into campaign_contacts (id,campaign_id,user_id,phone_number,contact_name,vars) values
 ('00000000-0000-0000-0000-0000000000e3','00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-00000000000a','+972500000003','Avi','{"ville":"Mockville","offre":"Automne"}'::jsonb),
 ('00000000-0000-0000-0000-0000000000e4','00000000-0000-0000-0000-0000000000d4','00000000-0000-0000-0000-00000000000a','+972500000004','Bat','{"ville":"Mockville","offre":"Automne"}'::jsonb),
 ('00000000-0000-0000-0000-0000000000e5','00000000-0000-0000-0000-0000000000d5','00000000-0000-0000-0000-00000000000a','+972500000005','','{"ville":"Mockville","offre":"Automne"}'::jsonb),
 ('00000000-0000-0000-0000-0000000000e6','00000000-0000-0000-0000-0000000000d6','00000000-0000-0000-0000-00000000000a','+972500000006','Dov','{"offre":"Automne"}'::jsonb),
 ('00000000-0000-0000-0000-0000000000e7','00000000-0000-0000-0000-0000000000d7','00000000-0000-0000-0000-00000000000a','+972500000007','Eli','{"ville":"Mockville","offre":"Automne"}'::jsonb),
 ('00000000-0000-0000-0000-0000000000e8','00000000-0000-0000-0000-0000000000d8','00000000-0000-0000-0000-00000000000a','+972500000008','Gal','{"ville":"Mockville"}'::jsonb),
 ('00000000-0000-0000-0000-0000000000e9','00000000-0000-0000-0000-0000000000d9','00000000-0000-0000-0000-00000000000b','+972500000009','Hen','{"ville":"Mockville"}'::jsonb);
