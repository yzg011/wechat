-- ============================================================
-- SECTION: SCHEMA
-- ============================================================

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS "public";


--
-- Name: SCHEMA "public"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA "public" IS 'standard public schema';


--
-- Name: pg_graphql; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";


--
-- Name: EXTENSION "pg_graphql"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "pg_graphql" IS 'pg_graphql: GraphQL support';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";


--
-- Name: EXTENSION "pgcrypto"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "pgcrypto" IS 'cryptographic functions';


--
-- Name: supabase_vault; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";


--
-- Name: EXTENSION "supabase_vault"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "supabase_vault" IS 'Supabase Vault Extension';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'user_role'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE TYPE "public"."user_role" AS ENUM (
    'user',
    'admin'
);
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: are_friends("uuid", "uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."are_friends"("uid1" "uuid", "uid2" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE status = 'accepted'
      AND ((requester_id = uid1 AND addressee_id = uid2)
        OR (requester_id = uid2 AND addressee_id = uid1))
  );
$$;


--
-- Name: clear_conversation_messages("uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."clear_conversation_messages"("p_conv_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- 验证调用者是该会话的参与者
  IF NOT EXISTS (
    SELECT 1 FROM conversation_participants
    WHERE conversation_id = p_conv_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_participant';
  END IF;

  DELETE FROM messages WHERE conversation_id = p_conv_id;
END;
$$;


--
-- Name: delete_private_conversation_between("uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."delete_private_conversation_between"("other_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_my_id uuid := auth.uid();
  v_conv_id uuid;
BEGIN
  SELECT cp1.conversation_id INTO v_conv_id
  FROM conversation_participants cp1
  JOIN conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
  JOIN conversations c ON c.id = cp1.conversation_id
  WHERE cp1.user_id = v_my_id
    AND cp2.user_id = other_user_id
    AND c.type = 'private'
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    DELETE FROM conversations WHERE id = v_conv_id;
  END IF;
END;
$$;


--
-- Name: find_nearby_users(double precision, double precision, double precision, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."find_nearby_users"("p_lat" double precision, "p_lng" double precision, "p_radius_km" double precision DEFAULT 5, "p_limit" integer DEFAULT 50) RETURNS TABLE("id" "uuid", "username" "text", "nickname" "text", "avatar_url" "text", "bio" "text", "last_seen_at" timestamp with time zone, "distance_km" double precision)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT
    p.id,
    p.username,
    p.nickname,
    p.avatar_url,
    p.bio,
    p.last_seen_at,
    round((
      6371 * acos(
        cos(radians(p_lat)) * cos(radians(p.latitude))
        * cos(radians(p.longitude) - radians(p_lng))
        + sin(radians(p_lat)) * sin(radians(p.latitude))
      )
    )::numeric, 2)::double precision AS distance_km
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE
    p.id <> auth.uid()
    AND p.latitude  IS NOT NULL
    AND p.longitude IS NOT NULL
    -- 排除临时邀请账号（邮箱以 @tmp.chat 结尾或用户名以 guest_ 开头）
    AND u.email NOT LIKE '%@tmp.chat'
    AND p.username NOT LIKE 'guest_%'
    -- 粗略矩形过滤，避免全表扫描
    AND p.latitude  BETWEEN p_lat - (p_radius_km / 111.0) AND p_lat + (p_radius_km / 111.0)
    AND p.longitude BETWEEN p_lng - (p_radius_km / (111.0 * cos(radians(p_lat)))) AND p_lng + (p_radius_km / (111.0 * cos(radians(p_lat))))
    AND (
      6371 * acos(
        GREATEST(-1, LEAST(1,
          cos(radians(p_lat)) * cos(radians(p.latitude))
          * cos(radians(p.longitude) - radians(p_lng))
          + sin(radians(p_lat)) * sin(radians(p.latitude))
        ))
      )
    ) <= p_radius_km
  ORDER BY distance_km ASC
  LIMIT p_limit;
$$;


--
-- Name: get_my_telepathy_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."get_my_telepathy_status"() RETURNS json
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
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


--
-- Name: get_or_create_group_conversation("uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."get_or_create_group_conversation"("p_group_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


--
-- Name: get_or_create_private_conversation("uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."get_or_create_private_conversation"("other_user_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


--
-- Name: get_user_role("uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."get_user_role"("uid" "uuid") RETURNS "public"."user_role"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT role FROM public.profiles WHERE id = uid;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


--
-- Name: is_conversation_participant("uuid", "uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."is_conversation_participant"("cid" "uuid", "uid" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


--
-- Name: is_group_member("uuid", "uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."is_group_member"("gid" "uuid", "uid" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = gid AND user_id = uid
  );
$$;


--
-- Name: join_via_invite("text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."join_via_invite"("p_token" "text", "p_nickname" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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


--
-- Name: submit_telepathy_keyword("text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."submit_telepathy_keyword"("p_keyword" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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

  /* ── 当前用户必须有 profile ── */
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_my_id) THEN
    RETURN json_build_object('status','error','message','用户信息未初始化，请重新登录');
  END IF;

  /* ── 当前用户 5 分钟内已提交过该词语 ── */
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

    /* 早退出：当前用户已是该对话成员 */
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

    SELECT type, group_id INTO v_conv_type, v_existing_group
    FROM conversations WHERE id = v_existing_conv;

    IF v_conv_type = 'private' THEN
      /* 私聊 → 升级为群聊；排除当前用户防重复，并只保留有 profile 的用户 */
      SELECT ARRAY_AGG(DISTINCT cp.user_id) INTO v_existing_users
      FROM conversation_participants cp
      JOIN profiles p ON p.id = cp.user_id
      WHERE cp.conversation_id = v_existing_conv
        AND cp.user_id <> v_my_id;

      v_all_users := COALESCE(v_existing_users, ARRAY[]::uuid[]) || ARRAY[v_my_id];

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

      /* 只插入有 profile 的用户（JOIN profiles 过滤） */
      INSERT INTO group_members(group_id, user_id)
        SELECT v_group_id, uid
        FROM unnest(v_all_users) AS uid
        JOIN profiles p ON p.id = uid
        ON CONFLICT DO NOTHING;

      INSERT INTO conversation_participants(conversation_id, user_id)
        SELECT v_conv_id, uid
        FROM unnest(v_all_users) AS uid
        JOIN profiles p ON p.id = uid
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

  SELECT ARRAY_AGG(DISTINCT user_id) INTO v_partners
  FROM telepathy_entries
  WHERE keyword    = v_keyword
    AND created_at >= v_since
    AND matched_at IS NULL
    AND user_id   <> v_my_id;

  IF v_partners IS NULL OR array_length(v_partners, 1) = 0 THEN
    RETURN json_build_object('status','waiting','message','词语已记录，等待配对中…');
  END IF;

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
        SELECT v_conv_id, uid
        FROM unnest(v_all_users) AS uid
        JOIN profiles p ON p.id = uid
        ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    INSERT INTO groups(name, owner_id)
      VALUES('心有灵犀·' || v_keyword, v_first_user_id)
      RETURNING id INTO v_group_id;
    INSERT INTO conversations(type, group_id) VALUES('group', v_group_id) RETURNING id INTO v_conv_id;

    INSERT INTO group_members(group_id, user_id)
      SELECT v_group_id, uid
      FROM unnest(v_all_users) AS uid
      JOIN profiles p ON p.id = uid
      ON CONFLICT DO NOTHING;

    INSERT INTO conversation_participants(conversation_id, user_id)
      SELECT v_conv_id, uid
      FROM unnest(v_all_users) AS uid
      JOIN profiles p ON p.id = uid
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


--
-- Name: sync_group_member_to_participant(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."sync_group_member_to_participant"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_conv_id uuid;
BEGIN
  SELECT id INTO v_conv_id
  FROM conversations
  WHERE type = 'group' AND group_id = NEW.group_id
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    INSERT INTO conversation_participants (conversation_id, user_id)
    VALUES (v_conv_id, NEW.user_id)
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: unfriend_and_delete_conversation("uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."unfriend_and_delete_conversation"("other_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_my_id uuid := auth.uid();
BEGIN
  -- 删除好友关系（双向）
  DELETE FROM friendships
  WHERE (requester_id = v_my_id AND addressee_id = other_user_id)
     OR (requester_id = other_user_id AND addressee_id = v_my_id);

  -- 删除私聊会话（CASCADE 处理 messages + participants）
  PERFORM delete_private_conversation_between(other_user_id);
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: blocked_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."blocked_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "blocker_id" "uuid" NOT NULL,
    "blocked_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: conversation_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."conversation_participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "last_read_at" timestamp with time zone DEFAULT "now"()
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text" DEFAULT 'private'::"text" NOT NULL,
    "group_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "conversations_type_check" CHECK (("type" = ANY (ARRAY['private'::"text", 'group'::"text"])))
);


--
-- Name: friendships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."friendships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "requester_id" "uuid" NOT NULL,
    "addressee_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "friendships_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'rejected'::"text"])))
);


--
-- Name: group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."group_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "avatar_url" "text",
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "announcement" "text" DEFAULT ''::"text"
);


--
-- Name: invite_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."invite_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(16), 'hex'::"text") NOT NULL,
    "created_by" "uuid" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "invite_links_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'revoked'::"text"])))
);


--
-- Name: message_deletions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."message_deletions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "message_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "content" "text",
    "message_type" "text" DEFAULT 'text'::"text" NOT NULL,
    "image_url" "text",
    "is_read" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_recalled" boolean DEFAULT false NOT NULL,
    "recalled_at" timestamp with time zone,
    CONSTRAINT "messages_message_type_check" CHECK (("message_type" = ANY (ARRAY['text'::"text", 'image'::"text", 'emoji'::"text"])))
);


--
-- Name: moment_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."moment_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "moment_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: moment_likes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."moment_likes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "moment_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: moments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."moments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "image_urls" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "username" "text" NOT NULL,
    "nickname" "text" DEFAULT ''::"text" NOT NULL,
    "avatar_url" "text",
    "bio" "text" DEFAULT ''::"text",
    "role" "public"."user_role" DEFAULT 'user'::"public"."user_role" NOT NULL,
    "email" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"(),
    "latitude" double precision,
    "longitude" double precision,
    "location_updated_at" timestamp with time zone
);


--
-- Name: telepathy_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."telepathy_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "keyword" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "matched_at" timestamp with time zone,
    "conversation_id" "uuid"
);


--
-- Name: blocked_users blocked_users_blocker_id_blocked_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'blocked_users_blocker_id_blocked_id_key'
      AND n.nspname = 'public'
      AND c.relname = 'blocked_users'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."blocked_users"
    ADD CONSTRAINT "blocked_users_blocker_id_blocked_id_key" UNIQUE ("blocker_id", "blocked_id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: blocked_users blocked_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'blocked_users_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'blocked_users'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."blocked_users"
    ADD CONSTRAINT "blocked_users_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: conversation_participants conversation_participants_conversation_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'conversation_participants_conversation_id_user_id_key'
      AND n.nspname = 'public'
      AND c.relname = 'conversation_participants'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_conversation_id_user_id_key" UNIQUE ("conversation_id", "user_id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: conversation_participants conversation_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'conversation_participants_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'conversation_participants'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'conversations_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'conversations'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: friendships friendships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'friendships_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'friendships'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."friendships"
    ADD CONSTRAINT "friendships_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: friendships friendships_requester_id_addressee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'friendships_requester_id_addressee_id_key'
      AND n.nspname = 'public'
      AND c.relname = 'friendships'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."friendships"
    ADD CONSTRAINT "friendships_requester_id_addressee_id_key" UNIQUE ("requester_id", "addressee_id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: group_members group_members_group_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'group_members_group_id_user_id_key'
      AND n.nspname = 'public'
      AND c.relname = 'group_members'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_group_id_user_id_key" UNIQUE ("group_id", "user_id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: group_members group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'group_members_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'group_members'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'groups_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'groups'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: invite_links invite_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'invite_links_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'invite_links'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."invite_links"
    ADD CONSTRAINT "invite_links_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: invite_links invite_links_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'invite_links_token_key'
      AND n.nspname = 'public'
      AND c.relname = 'invite_links'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."invite_links"
    ADD CONSTRAINT "invite_links_token_key" UNIQUE ("token");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: message_deletions message_deletions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'message_deletions_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'message_deletions'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."message_deletions"
    ADD CONSTRAINT "message_deletions_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: message_deletions message_deletions_user_id_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'message_deletions_user_id_message_id_key'
      AND n.nspname = 'public'
      AND c.relname = 'message_deletions'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."message_deletions"
    ADD CONSTRAINT "message_deletions_user_id_message_id_key" UNIQUE ("user_id", "message_id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'messages_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'messages'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: moment_comments moment_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'moment_comments_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'moment_comments'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."moment_comments"
    ADD CONSTRAINT "moment_comments_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: moment_likes moment_likes_moment_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'moment_likes_moment_id_user_id_key'
      AND n.nspname = 'public'
      AND c.relname = 'moment_likes'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."moment_likes"
    ADD CONSTRAINT "moment_likes_moment_id_user_id_key" UNIQUE ("moment_id", "user_id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: moment_likes moment_likes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'moment_likes_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'moment_likes'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."moment_likes"
    ADD CONSTRAINT "moment_likes_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: moments moments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'moments_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'moments'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."moments"
    ADD CONSTRAINT "moments_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'profiles_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles profiles_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'profiles_username_key'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: telepathy_entries telepathy_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'telepathy_entries_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'telepathy_entries'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."telepathy_entries"
    ADD CONSTRAINT "telepathy_entries_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: idx_conversation_participants_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_conversation_participants_user" ON "public"."conversation_participants" USING "btree" ("user_id");


--
-- Name: idx_friendships_addressee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_friendships_addressee" ON "public"."friendships" USING "btree" ("addressee_id");


--
-- Name: idx_friendships_requester; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_friendships_requester" ON "public"."friendships" USING "btree" ("requester_id");


--
-- Name: idx_group_members_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_group_members_group" ON "public"."group_members" USING "btree" ("group_id");


--
-- Name: idx_group_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_group_members_user" ON "public"."group_members" USING "btree" ("user_id");


--
-- Name: idx_messages_conversation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_messages_conversation_id" ON "public"."messages" USING "btree" ("conversation_id", "created_at" DESC);


--
-- Name: idx_telepathy_keyword; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_telepathy_keyword" ON "public"."telepathy_entries" USING "btree" ("keyword", "created_at" DESC);


--
-- Name: idx_telepathy_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_telepathy_user" ON "public"."telepathy_entries" USING "btree" ("user_id", "created_at" DESC);


--
-- Name: group_members trg_sync_group_member_to_participant; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER "trg_sync_group_member_to_participant" AFTER INSERT ON "public"."group_members" FOR EACH ROW EXECUTE FUNCTION "public"."sync_group_member_to_participant"();


--
-- Name: blocked_users blocked_users_blocked_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'blocked_users_blocked_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'blocked_users'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."blocked_users"
    ADD CONSTRAINT "blocked_users_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: blocked_users blocked_users_blocker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'blocked_users_blocker_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'blocked_users'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."blocked_users"
    ADD CONSTRAINT "blocked_users_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: conversation_participants conversation_participants_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'conversation_participants_conversation_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'conversation_participants'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: conversation_participants conversation_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'conversation_participants_user_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'conversation_participants'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: conversations conversations_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'conversations_group_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'conversations'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: friendships friendships_addressee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'friendships_addressee_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'friendships'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."friendships"
    ADD CONSTRAINT "friendships_addressee_id_fkey" FOREIGN KEY ("addressee_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: friendships friendships_requester_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'friendships_requester_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'friendships'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."friendships"
    ADD CONSTRAINT "friendships_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: group_members group_members_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'group_members_group_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'group_members'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: group_members group_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'group_members_user_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'group_members'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: groups groups_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'groups_owner_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'groups'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: invite_links invite_links_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'invite_links_created_by_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'invite_links'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."invite_links"
    ADD CONSTRAINT "invite_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: message_deletions message_deletions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'message_deletions_message_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'message_deletions'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."message_deletions"
    ADD CONSTRAINT "message_deletions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: message_deletions message_deletions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'message_deletions_user_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'message_deletions'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."message_deletions"
    ADD CONSTRAINT "message_deletions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'messages_conversation_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'messages'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: messages messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'messages_sender_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'messages'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: moment_comments moment_comments_moment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'moment_comments_moment_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'moment_comments'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."moment_comments"
    ADD CONSTRAINT "moment_comments_moment_id_fkey" FOREIGN KEY ("moment_id") REFERENCES "public"."moments"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: moment_comments moment_comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'moment_comments_user_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'moment_comments'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."moment_comments"
    ADD CONSTRAINT "moment_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: moment_likes moment_likes_moment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'moment_likes_moment_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'moment_likes'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."moment_likes"
    ADD CONSTRAINT "moment_likes_moment_id_fkey" FOREIGN KEY ("moment_id") REFERENCES "public"."moments"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: moment_likes moment_likes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'moment_likes_user_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'moment_likes'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."moment_likes"
    ADD CONSTRAINT "moment_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: moments moments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'moments_user_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'moments'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."moments"
    ADD CONSTRAINT "moments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'profiles_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: telepathy_entries telepathy_entries_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'telepathy_entries_conversation_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'telepathy_entries'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."telepathy_entries"
    ADD CONSTRAINT "telepathy_entries_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE SET NULL;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: telepathy_entries telepathy_entries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'telepathy_entries_user_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'telepathy_entries'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."telepathy_entries"
    ADD CONSTRAINT "telepathy_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles admins_full_profiles; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'admins_full_profiles'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "admins_full_profiles" ON "public"."profiles" TO "authenticated" USING (("public"."get_user_role"("auth"."uid"()) = 'admin'::"public"."user_role"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: invite_links anyone_view_invite_links; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'anyone_view_invite_links'
      AND n.nspname = 'public'
      AND c.relname = 'invite_links'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "anyone_view_invite_links" ON "public"."invite_links" FOR SELECT USING (true);
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: conversations authenticated_create_conversations; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'authenticated_create_conversations'
      AND n.nspname = 'public'
      AND c.relname = 'conversations'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "authenticated_create_conversations" ON "public"."conversations" FOR INSERT TO "authenticated" WITH CHECK (true);
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: groups authenticated_create_groups; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'authenticated_create_groups'
      AND n.nspname = 'public'
      AND c.relname = 'groups'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "authenticated_create_groups" ON "public"."groups" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "owner_id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: blocked_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."blocked_users" ENABLE ROW LEVEL SECURITY;

--
-- Name: moment_comments comments_delete; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'comments_delete'
      AND n.nspname = 'public'
      AND c.relname = 'moment_comments'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "comments_delete" ON "public"."moment_comments" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: moment_comments comments_insert; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'comments_insert'
      AND n.nspname = 'public'
      AND c.relname = 'moment_comments'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "comments_insert" ON "public"."moment_comments" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: moment_comments comments_select; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'comments_select'
      AND n.nspname = 'public'
      AND c.relname = 'moment_comments'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "comments_select" ON "public"."moment_comments" FOR SELECT TO "authenticated" USING (true);
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: conversation_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."conversation_participants" ENABLE ROW LEVEL SECURITY;

--
-- Name: conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;

--
-- Name: invite_links creator_delete_invite_links; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'creator_delete_invite_links'
      AND n.nspname = 'public'
      AND c.relname = 'invite_links'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "creator_delete_invite_links" ON "public"."invite_links" FOR DELETE USING (("auth"."uid"() = "created_by"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: invite_links creator_insert_invite_links; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'creator_insert_invite_links'
      AND n.nspname = 'public'
      AND c.relname = 'invite_links'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "creator_insert_invite_links" ON "public"."invite_links" FOR INSERT WITH CHECK (("auth"."uid"() = "created_by"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: invite_links creator_update_invite_links; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'creator_update_invite_links'
      AND n.nspname = 'public'
      AND c.relname = 'invite_links'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "creator_update_invite_links" ON "public"."invite_links" FOR UPDATE USING (("auth"."uid"() = "created_by"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: blocked_users delete_own_blocks; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'delete_own_blocks'
      AND n.nspname = 'public'
      AND c.relname = 'blocked_users'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "delete_own_blocks" ON "public"."blocked_users" FOR DELETE USING (("auth"."uid"() = "blocker_id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: friendships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."friendships" ENABLE ROW LEVEL SECURITY;

--
-- Name: group_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."group_members" ENABLE ROW LEVEL SECURITY;

--
-- Name: groups group_members_view_groups; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'group_members_view_groups'
      AND n.nspname = 'public'
      AND c.relname = 'groups'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "group_members_view_groups" ON "public"."groups" FOR SELECT TO "authenticated" USING (("public"."is_group_member"("id", "auth"."uid"()) OR ("owner_id" = "auth"."uid"())));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."groups" ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_participants insert_conversation_participants; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'insert_conversation_participants'
      AND n.nspname = 'public'
      AND c.relname = 'conversation_participants'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "insert_conversation_participants" ON "public"."conversation_participants" FOR INSERT TO "authenticated" WITH CHECK (true);
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: blocked_users insert_own_blocks; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'insert_own_blocks'
      AND n.nspname = 'public'
      AND c.relname = 'blocked_users'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "insert_own_blocks" ON "public"."blocked_users" FOR INSERT WITH CHECK (("auth"."uid"() = "blocker_id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: invite_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."invite_links" ENABLE ROW LEVEL SECURITY;

--
-- Name: moment_likes likes_delete; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'likes_delete'
      AND n.nspname = 'public'
      AND c.relname = 'moment_likes'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "likes_delete" ON "public"."moment_likes" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: moment_likes likes_insert; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'likes_insert'
      AND n.nspname = 'public'
      AND c.relname = 'moment_likes'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "likes_insert" ON "public"."moment_likes" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: moment_likes likes_select; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'likes_select'
      AND n.nspname = 'public'
      AND c.relname = 'moment_likes'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "likes_select" ON "public"."moment_likes" FOR SELECT TO "authenticated" USING (true);
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: group_members members_view_group_members; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'members_view_group_members'
      AND n.nspname = 'public'
      AND c.relname = 'group_members'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "members_view_group_members" ON "public"."group_members" FOR SELECT TO "authenticated" USING ("public"."is_group_member"("group_id", "auth"."uid"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: message_deletions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."message_deletions" ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;

--
-- Name: moment_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."moment_comments" ENABLE ROW LEVEL SECURITY;

--
-- Name: moment_likes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."moment_likes" ENABLE ROW LEVEL SECURITY;

--
-- Name: moments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."moments" ENABLE ROW LEVEL SECURITY;

--
-- Name: moments moments_delete; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'moments_delete'
      AND n.nspname = 'public'
      AND c.relname = 'moments'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "moments_delete" ON "public"."moments" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: moments moments_insert; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'moments_insert'
      AND n.nspname = 'public'
      AND c.relname = 'moments'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "moments_insert" ON "public"."moments" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: moments moments_select; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'moments_select'
      AND n.nspname = 'public'
      AND c.relname = 'moments'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "moments_select" ON "public"."moments" FOR SELECT TO "authenticated" USING (true);
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: group_members owner_delete_group_members; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'owner_delete_group_members'
      AND n.nspname = 'public'
      AND c.relname = 'group_members'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "owner_delete_group_members" ON "public"."group_members" FOR DELETE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."groups"
  WHERE (("groups"."id" = "group_members"."group_id") AND ("groups"."owner_id" = "auth"."uid"())))) OR ("auth"."uid"() = "user_id")));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: groups owner_delete_groups; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'owner_delete_groups'
      AND n.nspname = 'public'
      AND c.relname = 'groups'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "owner_delete_groups" ON "public"."groups" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "owner_id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: group_members owner_insert_group_members; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'owner_insert_group_members'
      AND n.nspname = 'public'
      AND c.relname = 'group_members'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "owner_insert_group_members" ON "public"."group_members" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."groups"
  WHERE (("groups"."id" = "group_members"."group_id") AND ("groups"."owner_id" = "auth"."uid"())))) OR ("auth"."uid"() = "user_id")));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: message_deletions owner_manage_deletions; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'owner_manage_deletions'
      AND n.nspname = 'public'
      AND c.relname = 'message_deletions'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "owner_manage_deletions" ON "public"."message_deletions" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: groups owner_update_groups; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'owner_update_groups'
      AND n.nspname = 'public'
      AND c.relname = 'groups'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "owner_update_groups" ON "public"."groups" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "owner_id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: messages participants_insert_messages; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'participants_insert_messages'
      AND n.nspname = 'public'
      AND c.relname = 'messages'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "participants_insert_messages" ON "public"."messages" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "sender_id") AND "public"."is_conversation_participant"("conversation_id", "auth"."uid"())));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: conversations participants_update_conversations; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'participants_update_conversations'
      AND n.nspname = 'public'
      AND c.relname = 'conversations'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "participants_update_conversations" ON "public"."conversations" FOR UPDATE TO "authenticated" USING ("public"."is_conversation_participant"("id", "auth"."uid"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: conversations participants_view_conversations; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'participants_view_conversations'
      AND n.nspname = 'public'
      AND c.relname = 'conversations'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "participants_view_conversations" ON "public"."conversations" FOR SELECT TO "authenticated" USING ("public"."is_conversation_participant"("id", "auth"."uid"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: messages participants_view_messages; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'participants_view_messages'
      AND n.nspname = 'public'
      AND c.relname = 'messages'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "participants_view_messages" ON "public"."messages" FOR SELECT TO "authenticated" USING ("public"."is_conversation_participant"("conversation_id", "auth"."uid"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

--
-- Name: messages sender_delete_messages; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'sender_delete_messages'
      AND n.nspname = 'public'
      AND c.relname = 'messages'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "sender_delete_messages" ON "public"."messages" FOR DELETE USING (("auth"."uid"() = "sender_id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: messages sender_recall_messages; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'sender_recall_messages'
      AND n.nspname = 'public'
      AND c.relname = 'messages'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "sender_recall_messages" ON "public"."messages" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "sender_id") AND ("created_at" > ("now"() - '00:02:00'::interval)) AND ("is_recalled" = false))) WITH CHECK (true);
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: messages sender_update_messages; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'sender_update_messages'
      AND n.nspname = 'public'
      AND c.relname = 'messages'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "sender_update_messages" ON "public"."messages" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "sender_id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: telepathy_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."telepathy_entries" ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_participants update_own_last_read; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'update_own_last_read'
      AND n.nspname = 'public'
      AND c.relname = 'conversation_participants'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "update_own_last_read" ON "public"."conversation_participants" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: friendships users_delete_own_friendships; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'users_delete_own_friendships'
      AND n.nspname = 'public'
      AND c.relname = 'friendships'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "users_delete_own_friendships" ON "public"."friendships" FOR DELETE TO "authenticated" USING ((("auth"."uid"() = "requester_id") OR ("auth"."uid"() = "addressee_id")));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: friendships users_insert_friendships; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'users_insert_friendships'
      AND n.nspname = 'public'
      AND c.relname = 'friendships'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "users_insert_friendships" ON "public"."friendships" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "requester_id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles users_update_last_seen; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'users_update_last_seen'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "users_update_last_seen" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK (true);
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: friendships users_update_own_friendships; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'users_update_own_friendships'
      AND n.nspname = 'public'
      AND c.relname = 'friendships'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "users_update_own_friendships" ON "public"."friendships" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "addressee_id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles users_update_own_profile; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'users_update_own_profile'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "users_update_own_profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK ((NOT ("role" IS DISTINCT FROM "public"."get_user_role"("auth"."uid"()))));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles users_view_all_profiles; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'users_view_all_profiles'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "users_view_all_profiles" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: friendships users_view_own_friendships; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'users_view_own_friendships'
      AND n.nspname = 'public'
      AND c.relname = 'friendships'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "users_view_own_friendships" ON "public"."friendships" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "requester_id") OR ("auth"."uid"() = "addressee_id")));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles users_view_own_profile; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'users_view_own_profile'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "users_view_own_profile" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: blocked_users view_own_blocks; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'view_own_blocks'
      AND n.nspname = 'public'
      AND c.relname = 'blocked_users'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "view_own_blocks" ON "public"."blocked_users" FOR SELECT USING (("auth"."uid"() = "blocker_id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: conversation_participants view_own_conversation_participants; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'view_own_conversation_participants'
      AND n.nspname = 'public'
      AND c.relname = 'conversation_participants'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "view_own_conversation_participants" ON "public"."conversation_participants" FOR SELECT TO "authenticated" USING ("public"."is_conversation_participant"("conversation_id", "auth"."uid"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: telepathy_entries 用户可插入自己的词条; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = '用户可插入自己的词条'
      AND n.nspname = 'public'
      AND c.relname = 'telepathy_entries'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "用户可插入自己的词条" ON "public"."telepathy_entries" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: telepathy_entries 用户可读自己的词条; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = '用户可读自己的词条'
      AND n.nspname = 'public'
      AND c.relname = 'telepathy_entries'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "用户可读自己的词条" ON "public"."telepathy_entries" FOR SELECT USING (("auth"."uid"() = "user_id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- PostgreSQL database dump complete
--




-- ============================================================
-- SECTION: DIFF FILTER OBJECTS
-- ============================================================
-- Objects that match diff-filter.json but cannot be represented
-- precisely by pg_dump --filter.

-- auth.users trigger: on_auth_user_created
DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal
      AND t.tgname = 'on_auth_user_created'
      AND n.nspname = 'auth'
      AND c.relname = 'users'
  ) THEN
    EXECUTE 'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();';
  END IF;
END
$pg_schema_restore$;
-- policy: avatars_authenticated_upload on storage.objects
DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'avatars_authenticated_upload'
      AND n.nspname = 'storage'
      AND c.relname = 'objects'
  ) THEN
    EXECUTE 'CREATE POLICY avatars_authenticated_upload ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((bucket_id = ''avatars''::text));';
  END IF;
END
$pg_schema_restore$;
-- policy: avatars_owner_update on storage.objects
DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'avatars_owner_update'
      AND n.nspname = 'storage'
      AND c.relname = 'objects'
  ) THEN
    EXECUTE 'CREATE POLICY avatars_owner_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = ''avatars''::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));';
  END IF;
END
$pg_schema_restore$;
-- policy: avatars_public_read on storage.objects
DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'avatars_public_read'
      AND n.nspname = 'storage'
      AND c.relname = 'objects'
  ) THEN
    EXECUTE 'CREATE POLICY avatars_public_read ON storage.objects AS PERMISSIVE FOR SELECT TO PUBLIC USING ((bucket_id = ''avatars''::text));';
  END IF;
END
$pg_schema_restore$;
-- policy: chat_images_authenticated_upload on storage.objects
DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'chat_images_authenticated_upload'
      AND n.nspname = 'storage'
      AND c.relname = 'objects'
  ) THEN
    EXECUTE 'CREATE POLICY chat_images_authenticated_upload ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((bucket_id = ''chat-images''::text));';
  END IF;
END
$pg_schema_restore$;
-- policy: chat_images_public_read on storage.objects
DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'chat_images_public_read'
      AND n.nspname = 'storage'
      AND c.relname = 'objects'
  ) THEN
    EXECUTE 'CREATE POLICY chat_images_public_read ON storage.objects AS PERMISSIVE FOR SELECT TO PUBLIC USING ((bucket_id = ''chat-images''::text));';
  END IF;
END
$pg_schema_restore$;
-- publication table: supabase_realtime -> public.conversations
DO $pg_schema_restore$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') AND NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    WHERE p.pubname = 'supabase_realtime'
      AND pr.prrelid = to_regclass('public.conversations')
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;';
  END IF;
END
$pg_schema_restore$;
-- publication table: supabase_realtime -> public.friendships
DO $pg_schema_restore$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') AND NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    WHERE p.pubname = 'supabase_realtime'
      AND pr.prrelid = to_regclass('public.friendships')
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;';
  END IF;
END
$pg_schema_restore$;
-- publication table: supabase_realtime -> public.messages
DO $pg_schema_restore$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') AND NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    WHERE p.pubname = 'supabase_realtime'
      AND pr.prrelid = to_regclass('public.messages')
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;';
  END IF;
END
$pg_schema_restore$;
-- publication table: supabase_realtime -> public.moment_comments
DO $pg_schema_restore$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') AND NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    WHERE p.pubname = 'supabase_realtime'
      AND pr.prrelid = to_regclass('public.moment_comments')
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.moment_comments;';
  END IF;
END
$pg_schema_restore$;
-- publication table: supabase_realtime -> public.moment_likes
DO $pg_schema_restore$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') AND NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    WHERE p.pubname = 'supabase_realtime'
      AND pr.prrelid = to_regclass('public.moment_likes')
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.moment_likes;';
  END IF;
END
$pg_schema_restore$;
-- publication table: supabase_realtime -> public.moments
DO $pg_schema_restore$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') AND NOT EXISTS (
    SELECT 1 FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    WHERE p.pubname = 'supabase_realtime'
      AND pr.prrelid = to_regclass('public.moments')
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.moments;';
  END IF;
END
$pg_schema_restore$;

-- ============================================================
-- SECTION: STORAGE BUCKETS DATA
-- ============================================================

INSERT INTO "storage"."buckets" ("id", "name", "owner", "created_at", "updated_at", "public", "avif_autodetection", "file_size_limit", "allowed_mime_types", "owner_id", "type") VALUES ('avatars', 'avatars', NULL, '2026-07-07 09:14:59.496278+00', '2026-07-07 09:14:59.496278+00', 'true', 'false', NULL, NULL, NULL, 'STANDARD') ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "owner" = EXCLUDED."owner", "created_at" = EXCLUDED."created_at", "updated_at" = EXCLUDED."updated_at", "public" = EXCLUDED."public", "avif_autodetection" = EXCLUDED."avif_autodetection", "file_size_limit" = EXCLUDED."file_size_limit", "allowed_mime_types" = EXCLUDED."allowed_mime_types", "owner_id" = EXCLUDED."owner_id", "type" = EXCLUDED."type";
INSERT INTO "storage"."buckets" ("id", "name", "owner", "created_at", "updated_at", "public", "avif_autodetection", "file_size_limit", "allowed_mime_types", "owner_id", "type") VALUES ('chat-images', 'chat-images', NULL, '2026-07-07 09:14:59.496278+00', '2026-07-07 09:14:59.496278+00', 'true', 'false', NULL, NULL, NULL, 'STANDARD') ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "owner" = EXCLUDED."owner", "created_at" = EXCLUDED."created_at", "updated_at" = EXCLUDED."updated_at", "public" = EXCLUDED."public", "avif_autodetection" = EXCLUDED."avif_autodetection", "file_size_limit" = EXCLUDED."file_size_limit", "allowed_mime_types" = EXCLUDED."allowed_mime_types", "owner_id" = EXCLUDED."owner_id", "type" = EXCLUDED."type";

-- ============================================================
-- SECTION: CRON JOBS
-- ============================================================
-- 用户自定义 pg_cron 任务。

