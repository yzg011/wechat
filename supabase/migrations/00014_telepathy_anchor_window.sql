
-- 重写心有灵犀配对逻辑：
-- 以第一个人提交的时间为锚点，5分钟内所有人归入同一场次
-- 2人→私聊，后续加入自动升级为群聊
CREATE OR REPLACE FUNCTION submit_telepathy_keyword(p_keyword text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_my_id        uuid        := auth.uid();
  v_keyword      text        := lower(trim(p_keyword));
  v_first_at     timestamptz;
  v_window_end   timestamptz;
  v_all_users    uuid[];
  v_user_count   int;
  v_conv_id      uuid;
  v_old_conv_id  uuid;
  v_old_type     text;
  v_group_id     uuid;
BEGIN
  -- 基本校验
  IF length(v_keyword) < 1 OR length(v_keyword) > 30 THEN
    RETURN json_build_object('status','error','message','词语长度须在1-30字之间');
  END IF;

  -- 查找本关键词当前活跃场次的锚定时间（最早一条、5分钟内的未过期词条）
  SELECT MIN(created_at) INTO v_first_at
  FROM telepathy_entries
  WHERE keyword = v_keyword
    AND created_at >= now() - interval '5 minutes';

  -- 若无活跃场次，或活跃场次已过期（时间窗已关闭），则本用户开启新场次
  IF v_first_at IS NULL THEN
    INSERT INTO telepathy_entries(user_id, keyword) VALUES(v_my_id, v_keyword);
    RETURN json_build_object('status','waiting','message','词语已记录，等待与你有缘的人…');
  END IF;

  v_window_end := v_first_at + interval '5 minutes';

  -- 本用户是否已在本场次中
  IF EXISTS (
    SELECT 1 FROM telepathy_entries
    WHERE user_id = v_my_id AND keyword = v_keyword
      AND created_at >= v_first_at AND created_at <= v_window_end
  ) THEN
    -- 已在场次，查当前匹配状态
    SELECT conversation_id INTO v_conv_id
    FROM telepathy_entries
    WHERE user_id = v_my_id AND keyword = v_keyword
      AND created_at >= v_first_at
    ORDER BY created_at DESC LIMIT 1;

    IF v_conv_id IS NOT NULL THEN
      RETURN json_build_object('status','matched','conversation_id',v_conv_id,
        'match_count',(SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = v_conv_id));
    END IF;
    RETURN json_build_object('status','waiting','message','已在等待配对中');
  END IF;

  -- 将当前用户加入本场次
  INSERT INTO telepathy_entries(user_id, keyword) VALUES(v_my_id, v_keyword);

  -- 收集本场次（锚定时间起5分钟内）所有用户（含自己）
  SELECT ARRAY_AGG(DISTINCT user_id) INTO v_all_users
  FROM telepathy_entries
  WHERE keyword = v_keyword
    AND created_at >= v_first_at
    AND created_at <= v_window_end;

  v_user_count := coalesce(array_length(v_all_users, 1), 0);

  IF v_user_count < 2 THEN
    RETURN json_build_object('status','waiting','message','词语已记录，等待配对中…');
  END IF;

  -- 查找本场次已有的会话（如有）
  SELECT DISTINCT e.conversation_id INTO v_old_conv_id
  FROM telepathy_entries e
  WHERE e.keyword = v_keyword
    AND e.created_at >= v_first_at
    AND e.conversation_id IS NOT NULL
  LIMIT 1;

  IF v_old_conv_id IS NULL THEN
    -- 首次配对：2人建私聊，3人以上建群聊
    IF v_user_count = 2 THEN
      INSERT INTO conversations(type) VALUES('private') RETURNING id INTO v_conv_id;
      INSERT INTO conversation_participants(conversation_id, user_id)
        SELECT v_conv_id, unnest(v_all_users);
    ELSE
      INSERT INTO groups(name, owner_id)
        VALUES('心有灵犀·' || v_keyword, v_my_id) RETURNING id INTO v_group_id;
      INSERT INTO conversations(type, group_id) VALUES('group', v_group_id) RETURNING id INTO v_conv_id;
      INSERT INTO group_members(group_id, user_id)
        SELECT v_group_id, unnest(v_all_users);
      INSERT INTO conversation_participants(conversation_id, user_id)
        SELECT v_conv_id, unnest(v_all_users);
    END IF;

  ELSE
    -- 已有会话：判断是否需要升级私聊→群聊
    SELECT type INTO v_old_type FROM conversations WHERE id = v_old_conv_id;

    IF v_old_type = 'private' AND v_user_count >= 3 THEN
      -- 升级：原私聊→新群聊，将所有人（含原两人）加入
      INSERT INTO groups(name, owner_id)
        VALUES('心有灵犀·' || v_keyword,
          (SELECT user_id FROM conversation_participants WHERE conversation_id = v_old_conv_id LIMIT 1))
        RETURNING id INTO v_group_id;
      INSERT INTO conversations(type, group_id) VALUES('group', v_group_id) RETURNING id INTO v_conv_id;
      -- 加入所有场次用户
      INSERT INTO group_members(group_id, user_id)
        SELECT v_group_id, unnest(v_all_users);
      INSERT INTO conversation_participants(conversation_id, user_id)
        SELECT v_conv_id, unnest(v_all_users)
        ON CONFLICT DO NOTHING;
      -- 将本场次所有词条指向新群聊
      UPDATE telepathy_entries
      SET conversation_id = v_conv_id, matched_at = now()
      WHERE keyword = v_keyword AND created_at >= v_first_at;
      RETURN json_build_object('status','matched','conversation_id',v_conv_id,'match_count',v_user_count);

    ELSIF v_old_type = 'group' THEN
      -- 已是群聊：直接加入
      v_conv_id := v_old_conv_id;
      SELECT group_id INTO v_group_id FROM conversations WHERE id = v_conv_id;
      INSERT INTO group_members(group_id, user_id) VALUES(v_group_id, v_my_id) ON CONFLICT DO NOTHING;
      INSERT INTO conversation_participants(conversation_id, user_id) VALUES(v_conv_id, v_my_id) ON CONFLICT DO NOTHING;

    ELSE
      -- 私聊且仍是2人（不应出现，但兜底）
      v_conv_id := v_old_conv_id;
    END IF;
  END IF;

  -- 标记本场次所有词条已配对
  UPDATE telepathy_entries
  SET matched_at = now(), conversation_id = v_conv_id
  WHERE keyword = v_keyword
    AND created_at >= v_first_at
    AND user_id = ANY(v_all_users);

  RETURN json_build_object(
    'status','matched',
    'conversation_id', v_conv_id,
    'match_count', v_user_count
  );
END;
$$;

-- 同步更新状态查询：以5分钟窗口为准，并返回会话人数
CREATE OR REPLACE FUNCTION get_my_telepathy_status()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_entry  record;
  v_count  int := 0;
BEGIN
  -- 优先找5分钟内的词条（等待中或已配对）
  SELECT * INTO v_entry
  FROM telepathy_entries
  WHERE user_id = auth.uid()
    AND created_at >= now() - interval '5 minutes'
  ORDER BY created_at DESC LIMIT 1;

  -- 若无，则找最近一条已配对记录（配对后超过5分钟仍可进入聊天）
  IF NOT FOUND THEN
    SELECT * INTO v_entry
    FROM telepathy_entries
    WHERE user_id = auth.uid()
      AND matched_at IS NOT NULL
    ORDER BY matched_at DESC LIMIT 1;
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;

  IF v_entry.conversation_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count
    FROM conversation_participants
    WHERE conversation_id = v_entry.conversation_id;
  END IF;

  RETURN json_build_object(
    'keyword',         v_entry.keyword,
    'status',          CASE WHEN v_entry.matched_at IS NOT NULL THEN 'matched' ELSE 'waiting' END,
    'conversation_id', v_entry.conversation_id,
    'created_at',      v_entry.created_at,
    'match_count',     v_count
  );
END;
$$;
