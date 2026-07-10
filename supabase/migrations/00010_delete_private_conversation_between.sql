
-- 删除两个用户之间的私聊会话（CASCADE 自动清理 messages 和 conversation_participants）
CREATE OR REPLACE FUNCTION delete_private_conversation_between(other_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_my_id uuid := auth.uid();
  v_conv_id uuid;
BEGIN
  SELECT cp1.conversation_id INTO v_conv_id
  FROM conversation_participants cp1
  JOIN conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
  JOIN conversations c ON c.id = cp1.conversation_id
  WHERE cp1.user_id = v_my_id
    AND cp2.user_id = other_user_id
    AND c.type = 'private'
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    DELETE FROM conversations WHERE id = v_conv_id;
  END IF;
END;
$$;

-- 删除好友关系并清除私聊会话（一步完成）
CREATE OR REPLACE FUNCTION unfriend_and_delete_conversation(other_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_my_id uuid := auth.uid();
BEGIN
  -- 删除好友关系（双向）
  DELETE FROM friendships
  WHERE (requester_id = v_my_id AND addressee_id = other_user_id)
     OR (requester_id = other_user_id AND addressee_id = v_my_id);

  -- 删除私聊会话（CASCADE 处理 messages + participants）
  PERFORM delete_private_conversation_between(other_user_id);
END;
$$;
