-- Authentik signs people in now; Dossier no longer rate-limits password sign-ins.
DROP TABLE IF EXISTS "LoginThrottle";
