
-- 1. 允许用户删除自己发送的消息
CREATE POLICY "sender_delete_messages" ON messages
  FOR DELETE USING (uid() = sender_id);

-- 2. 创建"仅对我删除"记录表（用于删除他人消息）
CREATE TABLE IF NOT EXISTS message_deletions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id    uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, message_id)
);
ALTER TABLE message_deletions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_manage_deletions" ON message_deletions
  FOR ALL USING (uid() = user_id) WITH CHECK (uid() = user_id);
