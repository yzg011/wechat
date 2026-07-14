
-- 重写 submit_telepathy_keyword：
-- 1. 搜索窗口从 24 小时缩减为 5 分钟
-- 2. 5 分钟内已有相同词语的等待者 → 必须配对成功，不允许单独等待
-- 3. 5 分钟内已有相同词语的已配对群组 → 直接加入该群组（私聊自动升级为群聊）
CREATE OR REPLACE FUNCTION submit_telepathy_keyword(p_keyword text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_my_id           uuid        := auth.uid();
  v_keyword         text        := lower(trim(p_keyword));
  v_since           timestamptz := now() - interval '5 minutes';
  v_existing_conv   uuid;        -- 5 分钟内已存在的配对对话
  v_conv_type       text;        -- 已有对话类型（private/group）
  v_existing_group  uuid;        -- 已有对话关联的群组
  v_existing_users  uuid[];      -- 已有对话的所有成员
  v_partners        uuid[];      -- 等待中的其他用户
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
  WHERE e.keyword  = v_keyword
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

      /* 获取原有成员 */
      SELECT ARRAY_AGG(cp.user_id) INTO v_existing_users
      FROM conversation_participants cp
      WHERE cp.conversation_id = v_existing_conv;

      v_all_users := v_existing_users || ARRAY[v_my_id];

      /* 获取最早提交者作为群主 */
      SELECT e2.user_id INTO v_first_user_id
      FROM telepathy_entries e2
      WHERE e2.conversation_id = v_existing_conv
      ORDER BY e2.created_at ASC LIMIT 1;

      /* 建群组 */
      INSERT INTO groups(name, owner_id)
        VALUES('心有灵犀·' || v_keyword, v_first_user_id)
        RETURNING id INTO v_group_id;

      /* 建群聊对话 */
      INSERT INTO conversations(type, group_id)
        VALUES('group', v_group_id)
        RETURNING id INTO v_conv_id;

      /* 加入所有成员 */
      INSERT INTO group_members(group_id, user_id)
        SELECT v_group_id, unnest(v_all_users);
      INSERT INTO conversation_participants(conversation_id, user_id)
        SELECT v_conv_id, unnest(v_all_users);

      /* 将原有词条全部指向新群聊 */
      UPDATE telepathy_entries
        SET conversation_id = v_conv_id
        WHERE conversation_id = v_existing_conv;

    ELSE
      /* 已是群聊 → 直接加入 */
      v_conv_id      := v_existing_conv;
      v_group_id     := v_existing_group;

      INSERT INTO group_members(group_id, user_id)
        VALUES(v_group_id, v_my_id)
        ON CONFLICT DO NOTHING;
      INSERT INTO conversation_participants(conversation_id, user_id)
        VALUES(v_conv_id, v_my_id)
        ON CONFLICT DO NOTHING;

      /* 确保 v_all_users 含当前用户，用于后续统计 */
      SELECT ARRAY_AGG(user_id) INTO v_all_users
      FROM conversation_participants
      WHERE conversation_id = v_conv_id;
    END IF;

    /* 插入词条（已配对状态） */
    INSERT INTO telepathy_entries(user_id, keyword, matched_at, conversation_id)
      VALUES(v_my_id, v_keyword, now(), v_conv_id);

    /* 锚定时间 = 该对话最早词条的时间 */
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

  /* 无等待者 → 继续等待 */
  IF v_partners IS NULL OR array_length(v_partners, 1) = 0 THEN
    RETURN json_build_object('status','waiting','message','词语已记录，等待配对中…');
  END IF;

  /* 有等待者 → 全部配对 */
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
        VALUES(v_conv_id, v_all_users[1]), (v_conv_id, v_all_users[2]);
    END IF;
  ELSE
    /* 3 人及以上 → 群聊，群主为最先提交者 */
    INSERT INTO groups(name, owner_id)
      VALUES('心有灵犀·' || v_keyword, v_first_user_id)
      RETURNING id INTO v_group_id;
    INSERT INTO conversations(type, group_id) VALUES('group', v_group_id) RETURNING id INTO v_conv_id;
    INSERT INTO group_members(group_id, user_id)
      SELECT v_group_id, unnest(v_all_users);
    INSERT INTO conversation_participants(conversation_id, user_id)
      SELECT v_conv_id, unnest(v_all_users);
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

-- 同步更新 get_my_telepathy_status 的查询窗口为 5 分钟
CREATE OR REPLACE FUNCTION get_my_telepathy_status()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT json_build_object(
      'keyword',         e.keyword,
      'status',          CASE WHEN e.matched_at IS NOT NULL THEN 'matched' ELSE 'waiting' END,
      'conversation_id', e.conversation_id,
      'match_count',     CASE
                           WHEN e.matched_at IS NOT NULL AND e.conversation_id IS NOT NULL THEN (
                             SELECT COUNT(*)::int FROM telepathy_entries e2
                             WHERE e2.conversation_id = e.conversation_id
                           )
                           ELSE NULL
                         END,
      'created_at',      CASE
                           WHEN e.matched_at IS NOT NULL AND e.conversation_id IS NOT NULL THEN (
                             SELECT MIN(e2.created_at) FROM telepathy_entries e2
                             WHERE e2.conversation_id = e.conversation_id
                           )
                           ELSE e.created_at
                         END
    )
    FROM telepathy_entries e
    WHERE e.user_id    = auth.uid()
      AND e.created_at >= now() - interval '5 minutes'
    ORDER BY e.created_at DESC LIMIT 1),
    'null'::json
  );
$$;
