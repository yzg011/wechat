
-- 根本原因：
-- 1. private→group 升级时，v_all_users = v_existing_users || [v_my_id]
--    若当前用户已在 v_existing_users 中，数组出现重复元素
-- 2. PostgreSQL 的 ON CONFLICT DO NOTHING 只处理与已有行的冲突，
--    同一 INSERT 内批量行之间的重复不受保护，仍会抛 23505
-- 修复：① 在使用前去重数组；② 加入「用户已在对话中」的早退出

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

    /* ── 早退出：当前用户已是该对话成员，无需重复加入 ── */
    IF EXISTS (
      SELECT 1 FROM conversation_participants
      WHERE conversation_id = v_existing_conv AND user_id = v_my_id
    ) THEN
      SELECT MIN(e2.created_at) INTO v_anchor_time
      FROM telepathy_entries e2 WHERE e2.conversation_id = v_existing_conv;

      RETURN json_build_object(
        'status',          'matched',
        'conversation_id', v_existing_conv,
        'match_count',     (SELECT COUNT(*) FROM telepathy_entries WHERE conversation_id = v_existing_conv),
        'created_at',      v_anchor_time
      );
    END IF;

    /* ── 加入该对话 ── */
    SELECT type, group_id INTO v_conv_type, v_existing_group
    FROM conversations WHERE id = v_existing_conv;

    IF v_conv_type = 'private' THEN
      /* 私聊 → 升级为群聊 */

      /* 取现有成员（去重 + 排除当前用户以防重复） */
      SELECT ARRAY_AGG(DISTINCT cp.user_id) INTO v_existing_users
      FROM conversation_participants cp
      WHERE cp.conversation_id = v_existing_conv
        AND cp.user_id <> v_my_id;

      /* 去重合并：已在早退出处排除了 v_my_id，这里安全追加 */
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
        ON CONFLICT DO NOTHING;

      INSERT INTO conversation_participants(conversation_id, user_id)
        SELECT v_conv_id, unnest(v_all_users)
        ON CONFLICT DO NOTHING;

      UPDATE telepathy_entries
        SET conversation_id = v_conv_id
        WHERE conversation_id = v_existing_conv;

    ELSE
      /* 已是群聊 → 直接加入 */
      v_conv_id  := v_existing_conv;
      v_group_id := v_existing_group;

      INSERT INTO group_members(group_id, user_id)
        VALUES(v_group_id, v_my_id)
        ON CONFLICT DO NOTHING;

      INSERT INTO conversation_participants(conversation_id, user_id)
        VALUES(v_conv_id, v_my_id)
        ON CONFLICT DO NOTHING;

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

  /* 去重：收集等待中的其他用户（排除自己） */
  SELECT ARRAY_AGG(DISTINCT user_id) INTO v_partners
  FROM telepathy_entries
  WHERE keyword    = v_keyword
    AND created_at >= v_since
    AND matched_at IS NULL
    AND user_id   <> v_my_id;

  IF v_partners IS NULL OR array_length(v_partners, 1) = 0 THEN
    RETURN json_build_object('status','waiting','message','词语已记录，等待配对中…');
  END IF;

  /* 合并时去重（防止并发写入重复 user_id） */
  SELECT ARRAY_AGG(DISTINCT uid) INTO v_all_users
  FROM unnest(v_partners || ARRAY[v_my_id]) uid;

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
        SELECT v_conv_id, unnest(v_all_users)
        ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    /* 3 人及以上 → 群聊 */
    INSERT INTO groups(name, owner_id)
      VALUES('心有灵犀·' || v_keyword, v_first_user_id)
      RETURNING id INTO v_group_id;
    INSERT INTO conversations(type, group_id) VALUES('group', v_group_id) RETURNING id INTO v_conv_id;
    INSERT INTO group_members(group_id, user_id)
      SELECT v_group_id, unnest(v_all_users)
      ON CONFLICT DO NOTHING;
    INSERT INTO conversation_participants(conversation_id, user_id)
      SELECT v_conv_id, unnest(v_all_users)
      ON CONFLICT DO NOTHING;
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
