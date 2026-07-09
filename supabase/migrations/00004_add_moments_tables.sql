
-- 朋友圈帖子表
CREATE TABLE IF NOT EXISTS public.moments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content text NOT NULL DEFAULT '',
  image_urls text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 点赞表
CREATE TABLE IF NOT EXISTS public.moment_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  moment_id uuid NOT NULL REFERENCES public.moments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(moment_id, user_id)
);

-- 评论表
CREATE TABLE IF NOT EXISTS public.moment_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  moment_id uuid NOT NULL REFERENCES public.moments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.moments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moment_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moment_comments ENABLE ROW LEVEL SECURITY;

-- moments: 自己和好友可见（简化：所有登录用户可读，仅自己可写）
CREATE POLICY "moments_select" ON public.moments FOR SELECT TO authenticated USING (true);
CREATE POLICY "moments_insert" ON public.moments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "moments_delete" ON public.moments FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- likes
CREATE POLICY "likes_select" ON public.moment_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "likes_insert" ON public.moment_likes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "likes_delete" ON public.moment_likes FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- comments
CREATE POLICY "comments_select" ON public.moment_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "comments_insert" ON public.moment_comments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "comments_delete" ON public.moment_comments FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.moments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.moment_likes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.moment_comments;
