-- Wave 3: Create tables for chat messages, character memory, story sessions
-- Run each section separately in Supabase SQL Editor

-- ==========================================
-- SECTION 1: Extensions
-- ==========================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ==========================================
-- SECTION 2: Chat messages
-- ==========================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  message TEXT NOT NULL,
  sender TEXT NOT NULL,
  emotion TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- SECTION 3: Character memory
-- ==========================================
CREATE TABLE IF NOT EXISTS character_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  summary TEXT DEFAULT '',
  key_facts JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, character_id)
);

-- ==========================================
-- SECTION 4: Story sessions
-- ==========================================
CREATE TABLE IF NOT EXISTS story_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_prompt TEXT NOT NULL,
  outline TEXT DEFAULT '',
  beats JSONB DEFAULT '[]'::jsonb,
  current_beat INT DEFAULT 0,
  confirmed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- SECTION 5: Indexes + RLS
-- ==========================================
CREATE INDEX idx_chat_messages_user_char ON chat_messages(user_id, character_id, created_at);
CREATE INDEX idx_character_memory_user_char ON character_memory(user_id, character_id);
CREATE INDEX idx_story_sessions_user ON story_sessions(user_id, created_at DESC);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own messages" ON chat_messages FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own memory" ON character_memory FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own stories" ON story_sessions FOR ALL USING (auth.uid() = user_id);
