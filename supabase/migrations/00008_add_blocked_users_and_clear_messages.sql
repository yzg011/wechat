
-- 1. 拉黑表
CREATE TABLE IF NOT EXISTS blocked_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id)
);

ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view_own_blocks" ON blocked_users FOR SELECT USING (auth.uid() = blocker_id);
CREATE POLICY "insert_own_blocks" ON blocked_users FOR INSERT WITH CHECK (auth.uid() = blocker_id);
CREATE POLICY "delete_own_blocks" ON blocked_users FOR DELETE USING (auth.uid() = blocker_id);

-- 2. 清除会话消息（SECURITY DEFINER，允许参与者清空整个会话的消息）
CREATE OR REPLACE FUNCTION clear_conversation_messages(p_conv_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- 验证调用者是该会话的参与者
  IF NOT EXISTS (
    SELECT 1 FROM conversation_participants
    WHERE conversation_id = p_conv_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_participant';
  END IF;

  DELETE FROM messages WHERE conversation_id = p_conv_id;
END;
$$;
