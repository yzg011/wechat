
-- 允许未登录用户通过用户名查询绑定的真实邮箱（用于登录流程）
CREATE OR REPLACE FUNCTION get_email_by_username(p_username text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT email FROM profiles WHERE username = p_username LIMIT 1;
$$;

-- 仅允许任何人调用（包括 anon）
GRANT EXECUTE ON FUNCTION get_email_by_username(text) TO anon, authenticated;
