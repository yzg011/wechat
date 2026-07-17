
-- 检查用户名是否可用（未登录可调用）
CREATE OR REPLACE FUNCTION check_username_available(p_username text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM profiles WHERE username = p_username
  );
$$;

GRANT EXECUTE ON FUNCTION check_username_available(text) TO anon, authenticated;

-- 校验用户输入的邮箱是否与该用户名注册时绑定的邮箱一致（未登录可调用）
-- 返回: 'ok' | 'mismatch' | 'no_email'
CREATE OR REPLACE FUNCTION verify_reset_email(p_username text, p_email text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT CASE
    WHEN email IS NULL OR email = '' THEN 'no_email'
    WHEN lower(email) = lower(p_email) THEN 'ok'
    ELSE 'mismatch'
  END
  FROM profiles WHERE username = p_username
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION verify_reset_email(text, text) TO anon, authenticated;
