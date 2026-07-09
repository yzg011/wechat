
-- 1. 消息撤回字段
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_recalled boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS recalled_at timestamptz;

-- 撤回消息：sender 在2分钟内可撤回自己的消息
CREATE POLICY "sender_recall_messages" ON public.messages
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = sender_id
    AND created_at > now() - interval '2 minutes'
    AND is_recalled = false
  )
  WITH CHECK (true);

-- 2. 在线状态字段
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen_at timestamptz DEFAULT now();

-- 允许用户更新自己的 last_seen_at（单独 policy，避免与现有 update policy 冲突）
CREATE POLICY "users_update_last_seen" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (true);

-- 3. 群组公告
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS announcement text DEFAULT '';

-- 允许群主更新公告（现有 owner_update_groups 策略已覆盖）
