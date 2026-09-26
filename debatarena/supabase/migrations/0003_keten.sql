-- Review-keten: versies van het adviesdocument, reviews per ronde, oordelen en ingrepen van de baas.
alter table runs add column if not exists keten jsonb;
