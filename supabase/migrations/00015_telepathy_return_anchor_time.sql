
-- 更新 submit_telepathy_keyword：匹配成功时返回窗口锚定时间（最早提交者的 created_at）
CREATE OR REPLACE FUNCTION submit_telepathy_keyword(p_keyword text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_my_id       uuid        := auth.uid();
  v_keyword     text        := lower(trim(p_keyword));
  v_since       timestamptz := now() - interval '24 hours';
  v_partners    uuid[];
  v_all_users   uuid[];
  v_conv_id     uuid;
  v_group_id    uuid;
  v_anchor_time timestamptz;
BEGIN
  -- 校验
  IF length(v_keyword) < 1 OR length(v_keyword) > 30 THEN
    RETURN json_build_object('status','error','message','词语长度须在1-30字之间');
  END IF;

  -- 防止24小时内重复提交同一词语
  IF EXISTS (
    SELECT 1 FROM telepathy_entries
    WHERE user_id = v_my_id AND keyword = v_keyword
      AND created_at >= v_since AND matched_at IS NULL
  ) THEN
    RETURN json_build_object('status','waiting','message','已在等待配对中');
  END IF;

  -- 插入词条
  INSERT INTO telepathy_entries(user_id, keyword) VALUES(v_my_id, v_keyword);

  -- 查找24小时内输入相同词语的其他未配对用户
  SELECT ARRAY_AGG(user_id) INTO v_partners
  FROM telepathy_entries
  WHERE keyword = v_keyword
    AND created_at >= v_since
    AND matched_at IS NULL
    AND user_id <> v_my_id;

  -- 无其他人 → 等待
  IF v_partners IS NULL OR array_length(v_partners, 1) = 0 THEN
    RETURN json_build_object('status','waiting','message','词语已记录，等待配对中…');
  END IF;

  -- 组合所有人（含自己）
  v_all_users := v_partners || ARRAY[v_my_id];

  -- 获取本次配对窗口锚定时间（最早提交者的 created_at）
  SELECT MIN(created_at) INTO v_anchor_time
  FROM telepathy_entries
  WHERE keyword = v_keyword
    AND created_at >= v_since
    AND user_id = ANY(v_all_users);

  IF array_length(v_all_users, 1) = 2 THEN
    -- 2人 → 私聊
    SELECT cp1.conversation_id INTO v_conv_id
    FROM conversation_participants cp1
    JOIN conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
    JOIN conversations c ON c.id = cp1.conversation_id
    WHERE cp1.user_id = v_all_users[1] AND cp2.user_id = v_all_users[2] AND c.type = 'private'
    LIMIT 1;

    IF v_conv_id IS NULL THEN
      INSERT INTO conversations(type) VALUES('private') RETURNING id INTO v_conv_id;
      INSERT INTO conversation_participants(conversation_id, user_id)
        VALUES(v_conv_id, v_all_users[1]), (v_conv_id, v_all_users[2]);
    END IF;
  ELSE
    -- 3人及以上 → 群聊
    INSERT INTO groups(name, owner_id)
      VALUES('心有灵犀·' || v_keyword, v_my_id)
      RETURNING id INTO v_group_id;
    INSERT INTO conversations(type, group_id) VALUES('group', v_group_id) RETURNING id INTO v_conv_id;
    INSERT INTO group_members(group_id, user_id)
      SELECT v_group_id, unnest(v_all_users);
    INSERT INTO conversation_participants(conversation_id, user_id)
      SELECT v_conv_id, unnest(v_all_users);
  END IF;

  -- 标记所有词条已配对
  UPDATE telepathy_entries
  SET matched_at = now(), conversation_id = v_conv_id
  WHERE keyword = v_keyword
    AND created_at >= v_since
    AND matched_at IS NULL
    AND user_id = ANY(v_all_users);

  RETURN json_build_object(
    'status',          'matched',
    'conversation_id', v_conv_id,
    'match_count',     array_length(v_all_users, 1),
    'created_at',      v_anchor_time   -- ← 新增：窗口锚定时间（最早提交者）
  );
END;
$$;
