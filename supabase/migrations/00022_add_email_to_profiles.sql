
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email text;
COMMENT ON COLUMN profiles.email IS '用户绑定的真实邮箱，用于找回密码';
