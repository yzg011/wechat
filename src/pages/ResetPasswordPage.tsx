import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { MessageCircle, Eye, EyeOff, KeyRound, CheckCircle } from 'lucide-react';

type Phase = 'loading' | 'form' | 'done' | 'invalid';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('loading');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Supabase 重置邮件会在 URL hash 里携带 access_token
  // onAuthStateChange 会自动将 RECOVERY session 建立
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPhase('form');
      }
    });

    // 若已存在 session（用户刷新了页面）也放行
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setPhase('form');
      else {
        // 等 1.5s 看 onAuthStateChange 是否触发
        setTimeout(() => {
          setPhase(p => p === 'loading' ? 'invalid' : p);
        }, 1500);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPwd.length < 6) { toast.error('密码至少6位'); return; }
    if (newPwd !== confirmPwd) { toast.error('两次密码不一致'); return; }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPwd });
    setSaving(false);

    if (error) {
      toast.error('修改失败：' + error.message);
      return;
    }

    setPhase('done');
    toast.success('密码已修改，正在跳转登录页…');
    // 退出当前 recovery session，让用户用新密码重新登录
    await supabase.auth.signOut();
    setTimeout(() => navigate('/login', { replace: true }), 2000);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-card px-6">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center">
            <MessageCircle className="w-7 h-7 text-white" />
          </div>
          <span className="text-2xl font-bold text-foreground">即时通讯</span>
        </div>

        {phase === 'loading' && (
          <div className="flex flex-col items-center gap-4 py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
            <p className="text-sm text-muted-foreground">正在验证链接…</p>
          </div>
        )}

        {phase === 'invalid' && (
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <KeyRound className="w-12 h-12 text-muted-foreground opacity-40" />
            <p className="text-base font-medium text-foreground">链接已失效</p>
            <p className="text-sm text-muted-foreground">重置链接已过期或已使用，请重新申请。</p>
            <Button className="mt-2 w-full" onClick={() => navigate('/login', { replace: true })}>
              返回登录
            </Button>
          </div>
        )}

        {phase === 'form' && (
          <>
            <h2 className="text-2xl font-bold text-foreground mb-2">设置新密码</h2>
            <p className="text-muted-foreground text-sm mb-8">请输入你的新登录密码，至少6位。</p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-pwd">新密码</Label>
                <div className="relative">
                  <Input
                    id="new-pwd"
                    name="new-password"
                    type={showNew ? 'text' : 'password'}
                    placeholder="至少6位"
                    value={newPwd}
                    onChange={e => setNewPwd(e.target.value)}
                    autoComplete="new-password"
                    className="h-11 pr-10 text-base"
                  />
                  <button type="button" onClick={() => setShowNew(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-pwd">确认新密码</Label>
                <div className="relative">
                  <Input
                    id="confirm-pwd"
                    name="confirm-password"
                    type={showConfirm ? 'text' : 'password'}
                    placeholder="再次输入新密码"
                    value={confirmPwd}
                    onChange={e => setConfirmPwd(e.target.value)}
                    autoComplete="new-password"
                    className="h-11 pr-10 text-base"
                  />
                  <button type="button" onClick={() => setShowConfirm(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button type="submit" className="h-11 text-base font-semibold mt-2" disabled={saving}>
                {saving ? '保存中…' : '确认修改'}
              </Button>
            </form>
          </>
        )}

        {phase === 'done' && (
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <CheckCircle className="w-14 h-14 text-primary" />
            <p className="text-base font-medium text-foreground">密码已修改成功</p>
            <p className="text-sm text-muted-foreground">正在跳转到登录页，请用新密码登录。</p>
          </div>
        )}
      </div>
    </div>
  );
}
