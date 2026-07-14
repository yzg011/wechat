
-- 修复所有 conversation_participants / group_members INSERT 缺少 ON CONFLICT DO NOTHING 的问题
CREATE OR REPLACE FUNCTION submit_telepathy_keyword(p_keyword text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_my_id           uuid        := auth.uid();
  v_keyword         text        := lower(trim(p_keyword));
  v_since           timestamptz := now() - interval '5 minutes';
  v_existing_conv   uuid;
  v_conv_type       text;
  v_existing_group  uuid;
  v_existing_users  uuid[];
  v_partners        uuid[];
  v_all_users       uuid[];
  v_conv_id         uuid;
  v_group_id        uuid;
  v_anchor_time     timestamptz;
  v_first_user_id   uuid;
BEGIN
  /* ── 校验 ── */
  IF length(v_keyword) < 1 OR length(v_keyword) > 30 THEN
    RETURN json_build_object('status','error','message','词语长度须在1-30字之间');
  END IF;

  /* ── 当前用户 5 分钟内已提交过该词语 → 返回当前状态 ── */
  IF EXISTS (
    SELECT 1 FROM telepathy_entries
    WHERE user_id = v_my_id AND keyword = v_keyword
      AND created_at >= v_since
  ) THEN
    RETURN json_build_object('status','waiting','message','已在等待配对中');
  END IF;

  /* ── 检查 5 分钟内是否已有同词语的配对成功对话 ── */
  SELECT DISTINCT e.conversation_id INTO v_existing_conv
  FROM telepathy_entries e
  WHERE e.keyword    = v_keyword
    AND e.created_at >= v_since
    AND e.matched_at IS NOT NULL
    AND e.conversation_id IS NOT NULL
  LIMIT 1;

  IF v_existing_conv IS NOT NULL THEN
    /* ── 已有配对对话：加入该对话 ── */
    SELECT type, group_id INTO v_conv_type, v_existing_group
    FROM conversations WHERE id = v_existing_conv;

    IF v_conv_type = 'private' THEN
      /* 私聊 → 升级为群聊 */
      SELECT ARRAY_AGG(cp.user_id) INTO v_existing_users
      FROM conversation_participants cp
      WHERE cp.conversation_id = v_existing_conv;

      v_all_users := v_existing_users || ARRAY[v_my_id];

      SELECT e2.user_id INTO v_first_user_id
      FROM telepathy_entries e2
      WHERE e2.conversation_id = v_existing_conv
      ORDER BY e2.created_at ASC LIMIT 1;

      INSERT INTO groups(name, owner_id)
        VALUES('心有灵犀·' || v_keyword, v_first_user_id)
        RETURNING id INTO v_group_id;

      INSERT INTO conversations(type, group_id)
        VALUES('group', v_group_id)
        RETURNING id INTO v_conv_id;

      INSERT INTO group_members(group_id, user_id)
        SELECT v_group_id, unnest(v_all_users)
        ON CONFLICT DO NOTHING;                          -- ← 防重复

      INSERT INTO conversation_participants(conversation_id, user_id)
        SELECT v_conv_id, unnest(v_all_users)
        ON CONFLICT DO NOTHING;                          -- ← 防重复

      UPDATE telepathy_entries
        SET conversation_id = v_conv_id
        WHERE conversation_id = v_existing_conv;

    ELSE
      /* 已是群聊 → 直接加入 */
      v_conv_id  := v_existing_conv;
      v_group_id := v_existing_group;

      INSERT INTO group_members(group_id, user_id)
        VALUES(v_group_id, v_my_id)
        ON CONFLICT DO NOTHING;                          -- ← 防重复

      INSERT INTO conversation_participants(conversation_id, user_id)
        VALUES(v_conv_id, v_my_id)
        ON CONFLICT DO NOTHING;                          -- ← 防重复

      SELECT ARRAY_AGG(user_id) INTO v_all_users
      FROM conversation_participants
      WHERE conversation_id = v_conv_id;
    END IF;

    /* 插入词条（已配对状态） */
    INSERT INTO telepathy_entries(user_id, keyword, matched_at, conversation_id)
      VALUES(v_my_id, v_keyword, now(), v_conv_id);

    SELECT MIN(e3.created_at) INTO v_anchor_time
    FROM telepathy_entries e3
    WHERE e3.conversation_id = v_conv_id;

    RETURN json_build_object(
      'status',          'matched',
      'conversation_id', v_conv_id,
      'match_count',     (SELECT COUNT(*) FROM telepathy_entries WHERE conversation_id = v_conv_id),
      'created_at',      v_anchor_time
    );
  END IF;

  /* ── 无已配对对话：插入词条，尝试与等待者配对 ── */
  INSERT INTO telepathy_entries(user_id, keyword) VALUES(v_my_id, v_keyword);

  SELECT ARRAY_AGG(user_id) INTO v_partners
  FROM telepathy_entries
  WHERE keyword    = v_keyword
    AND created_at >= v_since
    AND matched_at IS NULL
    AND user_id   <> v_my_id;

  IF v_partners IS NULL OR array_length(v_partners, 1) = 0 THEN
    RETURN json_build_object('status','waiting','message','词语已记录，等待配对中…');
  END IF;

  v_all_users := v_partners || ARRAY[v_my_id];

  SELECT MIN(created_at) INTO v_anchor_time
  FROM telepathy_entries
  WHERE keyword = v_keyword AND created_at >= v_since
    AND user_id = ANY(v_all_users);

  SELECT user_id INTO v_first_user_id
  FROM telepathy_entries
  WHERE keyword    = v_keyword
    AND created_at >= v_since
    AND matched_at IS NULL
    AND user_id    = ANY(v_all_users)
  ORDER BY created_at ASC LIMIT 1;

  IF array_length(v_all_users, 1) = 2 THEN
    /* 2 人 → 私聊 */
    SELECT cp1.conversation_id INTO v_conv_id
    FROM conversation_participants cp1
    JOIN conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
    JOIN conversations c ON c.id = cp1.conversation_id
    WHERE cp1.user_id = v_all_users[1]
      AND cp2.user_id = v_all_users[2]
      AND c.type = 'private'
    LIMIT 1;

    IF v_conv_id IS NULL THEN
      INSERT INTO conversations(type) VALUES('private') RETURNING id INTO v_conv_id;
      INSERT INTO conversation_participants(conversation_id, user_id)
        VALUES(v_conv_id, v_all_users[1]), (v_conv_id, v_all_users[2])
        ON CONFLICT DO NOTHING;                          -- ← 防重复
    END IF;
  ELSE
    /* 3 人及以上 → 群聊 */
    INSERT INTO groups(name, owner_id)
      VALUES('心有灵犀·' || v_keyword, v_first_user_id)
      RETURNING id INTO v_group_id;
    INSERT INTO conversations(type, group_id) VALUES('group', v_group_id) RETURNING id INTO v_conv_id;
    INSERT INTO group_members(group_id, user_id)
      SELECT v_group_id, unnest(v_all_users)
      ON CONFLICT DO NOTHING;                            -- ← 防重复
    INSERT INTO conversation_participants(conversation_id, user_id)
      SELECT v_conv_id, unnest(v_all_users)
      ON CONFLICT DO NOTHING;                            -- ← 防重复
  END IF;

  UPDATE telepathy_entries
    SET matched_at = now(), conversation_id = v_conv_id
    WHERE keyword    = v_keyword
      AND created_at >= v_since
      AND matched_at IS NULL
      AND user_id    = ANY(v_all_users);

  RETURN json_build_object(
    'status',          'matched',
    'conversation_id', v_conv_id,
    'match_count',     array_length(v_all_users, 1),
    'created_at',      v_anchor_time
  );
END;
$$;
