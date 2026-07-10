
-- 邀请链接表
CREATE TABLE invite_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE invite_links ENABLE ROW LEVEL SECURITY;

-- 任何人（含未登录的 anon）都可查询邀请链接（用于验证链接有效性）
CREATE POLICY "anyone_view_invite_links" ON invite_links FOR SELECT USING (true);

-- 已登录用户可创建自己的邀请链接
CREATE POLICY "creator_insert_invite_links" ON invite_links FOR INSERT WITH CHECK (auth.uid() = created_by);

-- 创建者可撤销（UPDATE status）
CREATE POLICY "creator_update_invite_links" ON invite_links FOR UPDATE USING (auth.uid() = created_by);

-- 创建者可删除
CREATE POLICY "creator_delete_invite_links" ON invite_links FOR DELETE USING (auth.uid() = created_by);

-- 访客通过邀请链接加入聊天的 SECURITY DEFINER 函数
CREATE OR REPLACE FUNCTION join_via_invite(p_token text, p_nickname text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_link invite_links%ROWTYPE;
  v_user_id uuid := auth.uid();
  v_conv_id uuid;
BEGIN
  -- 验证邀请链接有效
  SELECT * INTO v_link FROM invite_links WHERE token = p_token AND status = 'active';
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'invalid_or_revoked');
  END IF;

  -- 禁止自邀
  IF v_user_id = v_link.created_by THEN
    RETURN json_build_object('error', 'self_invite');
  END IF;

  -- 为访客创建/更新 profile
  INSERT INTO profiles (id, username, nickname, role)
  VALUES (
    v_user_id,
    'guest_' || left(replace(v_user_id::text, '-', ''), 8),
    p_nickname,
    'user'
  )
  ON CONFLICT (id) DO UPDATE SET
    nickname = EXCLUDED.nickname,
    updated_at = now();

  -- 创建新的私聊会话（每位访客各自独立会话）
  INSERT INTO conversations (type) VALUES ('private') RETURNING id INTO v_conv_id;

  -- 把发起人和访客都加入会话
  INSERT INTO conversation_participants (conversation_id, user_id)
  VALUES (v_conv_id, v_link.created_by)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  INSERT INTO conversation_participants (conversation_id, user_id)
  VALUES (v_conv_id, v_user_id)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN json_build_object('conversation_id', v_conv_id, 'success', true);
END;
$$;
