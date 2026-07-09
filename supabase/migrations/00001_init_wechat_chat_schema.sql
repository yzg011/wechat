
-- 用户角色枚举
CREATE TYPE public.user_role AS ENUM ('user', 'admin');

-- profiles 表（用户基本信息）
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE NOT NULL,
  nickname text NOT NULL DEFAULT '',
  avatar_url text,
  bio text DEFAULT '',
  role public.user_role NOT NULL DEFAULT 'user',
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 好友关系表
CREATE TABLE public.friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(requester_id, addressee_id)
);

-- 群组表
CREATE TABLE public.groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  avatar_url text,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 群组成员表
CREATE TABLE public.group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_id, user_id)
);

-- 会话表（私聊和群聊）
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL DEFAULT 'private' CHECK (type IN ('private', 'group')),
  group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 会话参与者表（私聊用）
CREATE TABLE public.conversation_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_read_at timestamptz DEFAULT now(),
  UNIQUE(conversation_id, user_id)
);

-- 消息表
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content text,
  message_type text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'emoji')),
  image_url text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Storage bucket for avatars
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true)
  ON CONFLICT (id) DO NOTHING;

-- Storage bucket for chat images
INSERT INTO storage.buckets (id, name, public) VALUES ('chat-images', 'chat-images', true)
  ON CONFLICT (id) DO NOTHING;

-- handle_new_user 触发器
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, username, nickname, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'nickname', split_part(NEW.email, '@', 1)),
    'user'::public.user_role
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- get_user_role helper（防RLS递归）
CREATE OR REPLACE FUNCTION public.get_user_role(uid uuid)
RETURNS public.user_role
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = uid;
$$;

-- 判断是否为好友
CREATE OR REPLACE FUNCTION public.are_friends(uid1 uuid, uid2 uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE status = 'accepted'
      AND ((requester_id = uid1 AND addressee_id = uid2)
        OR (requester_id = uid2 AND addressee_id = uid1))
  );
$$;

-- 判断是否为群成员
CREATE OR REPLACE FUNCTION public.is_group_member(gid uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = gid AND user_id = uid
  );
$$;

-- 判断用户是否参与了某个会话
CREATE OR REPLACE FUNCTION public.is_conversation_participant(cid uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = cid AND user_id = uid
  )
  OR EXISTS (
    SELECT 1 FROM public.conversations c
    JOIN public.group_members gm ON gm.group_id = c.group_id
    WHERE c.id = cid AND gm.user_id = uid AND c.type = 'group'
  );
$$;

-- 获取或创建私聊会话
CREATE OR REPLACE FUNCTION public.get_or_create_private_conversation(other_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_id uuid;
  v_my_id uuid := auth.uid();
BEGIN
  -- 查找已存在的私聊会话
  SELECT cp1.conversation_id INTO v_conv_id
  FROM public.conversation_participants cp1
  JOIN public.conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
  JOIN public.conversations c ON c.id = cp1.conversation_id
  WHERE cp1.user_id = v_my_id
    AND cp2.user_id = other_user_id
    AND c.type = 'private';

  IF v_conv_id IS NOT NULL THEN
    RETURN v_conv_id;
  END IF;

  -- 创建新的私聊会话
  INSERT INTO public.conversations (type) VALUES ('private') RETURNING id INTO v_conv_id;
  INSERT INTO public.conversation_participants (conversation_id, user_id)
    VALUES (v_conv_id, v_my_id), (v_conv_id, other_user_id);

  RETURN v_conv_id;
END;
$$;

-- RLS 策略
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- profiles RLS
CREATE POLICY "admins_full_profiles" ON public.profiles
  FOR ALL TO authenticated USING (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "users_view_own_profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "users_view_all_profiles" ON public.profiles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "users_update_own_profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id)
  WITH CHECK (role IS NOT DISTINCT FROM public.get_user_role(auth.uid()));

-- friendships RLS
CREATE POLICY "users_view_own_friendships" ON public.friendships
  FOR SELECT TO authenticated USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

CREATE POLICY "users_insert_friendships" ON public.friendships
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "users_update_own_friendships" ON public.friendships
  FOR UPDATE TO authenticated USING (auth.uid() = addressee_id);

-- groups RLS
CREATE POLICY "group_members_view_groups" ON public.groups
  FOR SELECT TO authenticated USING (public.is_group_member(id, auth.uid()) OR owner_id = auth.uid());

CREATE POLICY "authenticated_create_groups" ON public.groups
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "owner_update_groups" ON public.groups
  FOR UPDATE TO authenticated USING (auth.uid() = owner_id);

CREATE POLICY "owner_delete_groups" ON public.groups
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- group_members RLS
CREATE POLICY "members_view_group_members" ON public.group_members
  FOR SELECT TO authenticated USING (public.is_group_member(group_id, auth.uid()));

CREATE POLICY "owner_insert_group_members" ON public.group_members
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.groups WHERE id = group_id AND owner_id = auth.uid())
    OR auth.uid() = user_id
  );

CREATE POLICY "owner_delete_group_members" ON public.group_members
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.groups WHERE id = group_id AND owner_id = auth.uid())
    OR auth.uid() = user_id
  );

-- conversations RLS
CREATE POLICY "participants_view_conversations" ON public.conversations
  FOR SELECT TO authenticated USING (public.is_conversation_participant(id, auth.uid()));

CREATE POLICY "authenticated_create_conversations" ON public.conversations
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "participants_update_conversations" ON public.conversations
  FOR UPDATE TO authenticated USING (public.is_conversation_participant(id, auth.uid()));

-- conversation_participants RLS
CREATE POLICY "view_own_conversation_participants" ON public.conversation_participants
  FOR SELECT TO authenticated USING (public.is_conversation_participant(conversation_id, auth.uid()));

CREATE POLICY "insert_conversation_participants" ON public.conversation_participants
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "update_own_last_read" ON public.conversation_participants
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- messages RLS
CREATE POLICY "participants_view_messages" ON public.messages
  FOR SELECT TO authenticated USING (public.is_conversation_participant(conversation_id, auth.uid()));

CREATE POLICY "participants_insert_messages" ON public.messages
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = sender_id AND public.is_conversation_participant(conversation_id, auth.uid())
  );

CREATE POLICY "sender_update_messages" ON public.messages
  FOR UPDATE TO authenticated USING (auth.uid() = sender_id);

-- Storage policies
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'avatars');

CREATE POLICY "avatars_authenticated_upload" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars');

CREATE POLICY "avatars_owner_update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "chat_images_public_read" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'chat-images');

CREATE POLICY "chat_images_authenticated_upload" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'chat-images');

-- Realtime 发布
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;

-- 索引优化
CREATE INDEX idx_messages_conversation_id ON public.messages(conversation_id, created_at DESC);
CREATE INDEX idx_conversation_participants_user ON public.conversation_participants(user_id);
CREATE INDEX idx_group_members_group ON public.group_members(group_id);
CREATE INDEX idx_group_members_user ON public.group_members(user_id);
CREATE INDEX idx_friendships_requester ON public.friendships(requester_id);
CREATE INDEX idx_friendships_addressee ON public.friendships(addressee_id);
