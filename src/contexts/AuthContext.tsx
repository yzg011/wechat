import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
// @ts-ignore
import { supabase } from '@/db/supabase';
import type { User } from '@supabase/supabase-js';
// @ts-ignore
import type { Profile } from '@/types/types';
import { toast } from 'sonner';

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('获取用户信息失败:', error);
    return null;
  }
  return data;
}
interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signInWithUsername: (username: string, password: string) => Promise<{ error: Error | null }>;
  signUpWithUsername: (username: string, password: string, nickname?: string, realEmail?: string) => Promise<{ error: Error | null }>;
  sendPasswordResetEmail: (email: string) => Promise<{ error: Error | null }>;
  checkUsernameAvailable: (username: string) => Promise<boolean>;
  verifyResetEmail: (username: string, email: string) => Promise<'ok' | 'mismatch' | 'no_email' | 'no_user'>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = async () => {
    if (!user) {
      setProfile(null);
      return;
    }

    const profileData = await getProfile(user.id);
    setProfile(profileData);
  };

  useEffect(() => {
    supabase
      .auth
      .getSession()
      // @ts-ignore
      .then(({ data: { session } }) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          getProfile(session.user.id).then(setProfile);
        }
      })
      // @ts-ignore
      .catch(error => {
        toast.error(`获取用户信息失败: ${error.message}`);
      })
      .finally(() => {
        setLoading(false);
      });

    // @ts-ignore
    // In this function, do NOT use any await calls. Use `.then()` instead to avoid deadlocks.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        getProfile(session.user.id).then(setProfile);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithUsername = async (username: string, password: string) => {
    try {
      // 通过 SECURITY DEFINER 函数查询真实邮箱（绕过 RLS，未登录也可调用）
      const { data: emailData } = await supabase
        .rpc('get_email_by_username', { p_username: username });

      const realEmail: string | null = emailData ?? null;

      // 优先使用真实邮箱登录（密码重置后 auth.email 已变为真实邮箱）
      if (realEmail) {
        const { error: realErr } = await supabase.auth.signInWithPassword({
          email: realEmail,
          password,
        });
        if (!realErr) return { error: null };
        // 真实邮箱失败，继续尝试虚拟邮箱（兼容旧密码未重置的情况）
      }

      // Fallback：虚拟邮箱登录
      const email = `${username}@miaoda.com`;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signUpWithUsername = async (username: string, password: string, nickname?: string, realEmail?: string) => {
    try {
      const email = `${username}@miaoda.com`;
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { username, nickname: nickname || username },
        },
      });

      if (error) throw error;

      // 若用户填写了真实邮箱，更新 auth.users 的 email 并同步到 profiles
      if (realEmail && data.user) {
        await supabase.auth.updateUser({ email: realEmail });
        await supabase.from('profiles').update({ email: realEmail }).eq('id', data.user.id);
      }

      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const checkUsernameAvailable = async (username: string): Promise<boolean> => {
    const { data } = await supabase.rpc('check_username_available', { p_username: username });
    return data === true;
  };

  const verifyResetEmail = async (username: string, email: string): Promise<'ok' | 'mismatch' | 'no_email' | 'no_user'> => {
    const { data } = await supabase.rpc('verify_reset_email', { p_username: username, p_email: email });
    if (data === null) return 'no_user';
    return data as 'ok' | 'mismatch' | 'no_email';
  };

  const sendPasswordResetEmail = async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signInWithUsername, signUpWithUsername, signOut, refreshProfile, sendPasswordResetEmail, checkUsernameAvailable, verifyResetEmail }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
