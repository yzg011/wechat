
-- 为 profiles 表添加位置字段
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS latitude  double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS location_updated_at timestamptz;

-- 创建「查找附近用户」函数（Haversine 公式，单位：公里）
CREATE OR REPLACE FUNCTION find_nearby_users(
  p_lat   double precision,
  p_lng   double precision,
  p_radius_km double precision DEFAULT 5,
  p_limit  int DEFAULT 50
)
RETURNS TABLE (
  id              uuid,
  username        text,
  nickname        text,
  avatar_url      text,
  bio             text,
  last_seen_at    timestamptz,
  distance_km     double precision
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
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
  WHERE
    p.id <> auth.uid()
    AND p.latitude  IS NOT NULL
    AND p.longitude IS NOT NULL
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
