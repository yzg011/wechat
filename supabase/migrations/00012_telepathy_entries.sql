
-- 心有灵犀词条表
CREATE TABLE IF NOT EXISTS telepathy_entries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  keyword         text        NOT NULL,  -- 已标准化（小写+去首尾空格）
  created_at      timestamptz NOT NULL DEFAULT now(),
  matched_at      timestamptz,
  conversation_id uuid        REFERENCES conversations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_telepathy_keyword ON telepathy_entries(keyword, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telepathy_user    ON telepathy_entries(user_id, created_at DESC);

ALTER TABLE telepathy_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "用户可读自己的词条" ON telepathy_entries FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "用户可插入自己的词条" ON telepathy_entries FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 提交心有灵犀词语并尝试配对
CREATE OR REPLACE FUNCTION submit_telepathy_keyword(p_keyword text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_my_id     uuid   := auth.uid();
  v_keyword   text   := lower(trim(p_keyword));
  v_since     timestamptz := now() - interval '24 hours';
  v_partners  uuid[];
  v_all_users uuid[];
  v_conv_id   uuid;
  v_group_id  uuid;
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
    'status','matched',
    'conversation_id', v_conv_id,
    'match_count', array_length(v_all_users, 1)
  );
END;
$$;

-- 查询用户最近一条等待中或已配对的词条
CREATE OR REPLACE FUNCTION get_my_telepathy_status()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT json_build_object(
      'keyword', keyword,
      'status', CASE WHEN matched_at IS NOT NULL THEN 'matched' ELSE 'waiting' END,
      'conversation_id', conversation_id,
      'created_at', created_at
    )
    FROM telepathy_entries
    WHERE user_id = auth.uid()
      AND created_at >= now() - interval '24 hours'
    ORDER BY created_at DESC LIMIT 1),
    'null'::json
  );
$$;
