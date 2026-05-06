-- ===========================================
-- HomeCare Database Schema
-- Supabase PostgreSQL
-- ===========================================

-- 확장 기능 활성화
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===========================================
-- 1. Devices 테이블 (Edge Device 정보)
-- ===========================================
CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('camera', 'microphone', 'sensor')),
  location TEXT,
  status TEXT DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'error')),
  last_heartbeat TIMESTAMPTZ,
  metrics JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);

-- ===========================================
-- 2. Events 테이블 (감지된 이벤트)
-- ===========================================
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('visitor', 'motion', 'sound', 'danger', 'other')),
  description TEXT NOT NULL,
  danger_level TEXT DEFAULT 'normal' CHECK (danger_level IN ('normal', 'warning', 'danger')),
  image_url TEXT,
  audio_url TEXT,
  metadata JSONB DEFAULT '{}',
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_device_id    ON events(device_id);
CREATE INDEX IF NOT EXISTS idx_events_type         ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_danger_level ON events(danger_level);
CREATE INDEX IF NOT EXISTS idx_events_timestamp    ON events(timestamp DESC);



-- ===========================================
-- 3. Conversations 테이블 (대화 기록)
-- ===========================================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);

-- ===========================================
-- 4. Messages 테이블 (대화 메시지)
-- ===========================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at      ON messages(created_at DESC);

-- ===========================================
-- 5. 트리거: updated_at 자동 업데이트
-- ===========================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_devices_updated_at ON devices;
CREATE TRIGGER update_devices_updated_at
  BEFORE UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================================
-- 6. RLS (Row Level Security) 정책
-- ===========================================

-- Devices 테이블 RLS
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own devices"    ON devices;
DROP POLICY IF EXISTS "Users can insert their own devices"  ON devices;
DROP POLICY IF EXISTS "Users can update their own devices"  ON devices;
DROP POLICY IF EXISTS "Users can delete their own devices"  ON devices;
DROP POLICY IF EXISTS "Service role can do everything on devices" ON devices;

CREATE POLICY "Users can view their own devices"
  ON devices FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "Users can insert their own devices"
  ON devices FOR INSERT WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Users can update their own devices"
  ON devices FOR UPDATE USING (auth.uid()::text = user_id);

CREATE POLICY "Users can delete their own devices"
  ON devices FOR DELETE USING (auth.uid()::text = user_id);

CREATE POLICY "Service role can do everything on devices"
  ON devices FOR ALL USING (auth.role() = 'service_role');

-- Events 테이블 RLS
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view events from their devices"  ON events;
DROP POLICY IF EXISTS "Service role can do everything on events"  ON events;

CREATE POLICY "Users can view events from their devices"
  ON events FOR SELECT
  USING (
    device_id IN (
      SELECT id FROM devices WHERE user_id = auth.uid()::text
    )
  );

CREATE POLICY "Service role can do everything on events"
  ON events FOR ALL USING (auth.role() = 'service_role');

-- Conversations 테이블 RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own conversations" ON conversations;

CREATE POLICY "Users can manage their own conversations"
  ON conversations FOR ALL USING (auth.uid()::text = user_id);

-- Messages 테이블 RLS
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view messages in their conversations"  ON messages;
DROP POLICY IF EXISTS "Users can insert messages in their conversations" ON messages;

CREATE POLICY "Users can view messages in their conversations"
  ON messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM conversations WHERE user_id = auth.uid()::text
    )
  );

CREATE POLICY "Users can insert messages in their conversations"
  ON messages FOR INSERT
  WITH CHECK (
    conversation_id IN (
      SELECT id FROM conversations WHERE user_id = auth.uid()::text
    )
  );

-- ===========================================
-- 7. 샘플 데이터 (개발용)
-- ===========================================
INSERT INTO devices (id, user_id, name, type, location, status)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'dev-user-001', '거실 카메라', 'camera', '거실', 'online'),
  ('22222222-2222-2222-2222-222222222222', 'dev-user-001', '현관 카메라', 'camera', '현관', 'online')
ON CONFLICT (id) DO NOTHING;

INSERT INTO events (device_id, type, description, danger_level, timestamp)
VALUES
  ('22222222-2222-2222-2222-222222222222', 'visitor', '택배 기사 방문 - 소포 배달', 'normal', NOW() - INTERVAL '3 hours'),
  ('22222222-2222-2222-2222-222222222222', 'visitor', '가족 귀가',                  'normal', NOW() - INTERVAL '1 hour'),
  ('11111111-1111-1111-1111-111111111111', 'motion',  '거실에서 움직임 감지',       'normal', NOW() - INTERVAL '30 minutes')
ON CONFLICT DO NOTHING;
