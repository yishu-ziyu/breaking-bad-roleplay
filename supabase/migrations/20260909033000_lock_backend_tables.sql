-- Restoring the legacy Supabase project also restores its old backend tables.
-- These are accessed by the backend DB owner, never by browser clients.
-- Player cloud sync uses chat_messages, character_memory and story_sessions;
-- their existing user-scoped policies remain unchanged.
BEGIN;
ALTER TABLE public.alembic_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_dossiers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.alembic_version, public.sessions, public.messages,
  public.character_states, public.character_dossiers FROM anon, authenticated;
COMMIT;
