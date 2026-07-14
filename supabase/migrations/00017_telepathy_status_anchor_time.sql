
-- 修复 get_my_telepathy_status：matched 状态返回窗口锚定时间（最早提交者的 created_at）
-- 而非当前用户自己的 created_at，确保所有人倒计时同步
CREATE OR REPLACE FUNCTION get_my_telepathy_status()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT json_build_object(
      'keyword',         e.keyword,
      'status',          CASE WHEN e.matched_at IS NOT NULL THEN 'matched' ELSE 'waiting' END,
      'conversation_id', e.conversation_id,
      'match_count',     CASE
                           WHEN e.matched_at IS NOT NULL AND e.conversation_id IS NOT NULL THEN (
                             SELECT COUNT(*)::int
                             FROM telepathy_entries e2
                             WHERE e2.conversation_id = e.conversation_id
                           )
                           ELSE NULL
                         END,
      -- matched 时返回本次配对最早提交者的时间（锚定时间），waiting 时返回自己的提交时间
      'created_at',      CASE
                           WHEN e.matched_at IS NOT NULL AND e.conversation_id IS NOT NULL THEN (
                             SELECT MIN(e2.created_at)
                             FROM telepathy_entries e2
                             WHERE e2.conversation_id = e.conversation_id
                           )
                           ELSE e.created_at
                         END
    )
    FROM telepathy_entries e
    WHERE e.user_id = auth.uid()
      AND e.created_at >= now() - interval '24 hours'
    ORDER BY e.created_at DESC LIMIT 1),
    'null'::json
  );
$$;
