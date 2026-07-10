
-- 1. 为所有已有群成员补充 conversation_participants 行（防止遗漏）
INSERT INTO conversation_participants (conversation_id, user_id)
SELECT c.id, gm.user_id
FROM conversations c
JOIN group_members gm ON gm.group_id = c.group_id
WHERE c.type = 'group'
ON CONFLICT (conversation_id, user_id) DO NOTHING;

-- 2. 创建触发器：有人加入群组时自动创建 conversation_participants 行
CREATE OR REPLACE FUNCTION sync_group_member_to_participant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_conv_id uuid;
BEGIN
  SELECT id INTO v_conv_id
  FROM conversations
  WHERE type = 'group' AND group_id = NEW.group_id
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    INSERT INTO conversation_participants (conversation_id, user_id)
    VALUES (v_conv_id, NEW.user_id)
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_group_member_to_participant ON group_members;
CREATE TRIGGER trg_sync_group_member_to_participant
  AFTER INSERT ON group_members
  FOR EACH ROW EXECUTE FUNCTION sync_group_member_to_participant();
