
-- 1. 补充 friendships DELETE 策略（之前只有 SELECT/INSERT/UPDATE）
CREATE POLICY "users_delete_own_friendships" ON public.friendships
  FOR DELETE TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- 2. SECURITY DEFINER 函数：查找或创建群聊会话（绕过 RLS 嵌套问题）
CREATE OR REPLACE FUNCTION public.get_or_create_group_conversation(p_group_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  -- 确认调用者是群成员
  IF NOT public.is_group_member(p_group_id, v_uid) THEN
    RAISE EXCEPTION '非群组成员';
  END IF;

  -- 查找已有群聊会话
  SELECT id INTO v_conv_id
  FROM public.conversations
  WHERE type = 'group' AND group_id = p_group_id
  LIMIT 1;

  -- 若不存在则创建
  IF v_conv_id IS NULL THEN
    INSERT INTO public.conversations (type, group_id)
    VALUES ('group', p_group_id)
    RETURNING id INTO v_conv_id;
  END IF;

  RETURN v_conv_id;
END;
$$;
