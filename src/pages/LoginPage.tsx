import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { MessageCircle, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const { signInWithUsername, signUpWithUsername } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) { toast.error('请输入用户名'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) { toast.error('用户名只能包含字母、数字和下划线'); return; }
    if (!password) { toast.error('请输入密码'); return; }
    if (mode === 'register') {
      if (password.length < 6) { toast.error('密码至少6位'); return; }
      if (password !== confirmPwd) { toast.error('两次密码不一致'); return; }
      if (!agreed) { toast.error('请先同意用户协议和隐私政策'); return; }
    }
    setLoading(true);
    try {
      if (mode === 'login') {
        const { error } = await signInWithUsername(username, password);
        if (error) { toast.error('用户名或密码错误'); return; }
        toast.success('登录成功');
        navigate('/chat', { replace: true });
      } else {
        const { error } = await signUpWithUsername(username, password, nickname || username);
        if (error) {
          if (error.message?.includes('already')) toast.error('用户名已被使用，请更换');
          else toast.error(error.message || '注册失败');
          return;
        }
        toast.success('注册成功，正在登录…');
        const { error: loginErr } = await signInWithUsername(username, password);
        if (!loginErr) navigate('/chat', { replace: true });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* 左侧品牌区 */}
      <div className="hidden md:flex flex-col items-center justify-center flex-1 bg-primary relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary via-secondary to-[#056b3b] opacity-90" />
        <div className="relative z-10 flex flex-col items-center gap-6 text-white">
          <div className="w-24 h-24 rounded-3xl bg-white/20 flex items-center justify-center backdrop-blur-sm">
            <MessageCircle className="w-14 h-14 text-white" />
          </div>
          <h1 className="text-4xl font-bold tracking-wide">即时通讯</h1>
          <p className="text-white/80 text-lg text-center max-w-xs">连接你与世界，随时随地沟通</p>
          <div className="mt-8 flex gap-3">
            {[0,1,2].map(i => (
              <div key={i} className={`rounded-full bg-white/30 ${i===1?'w-3 h-3':'w-2 h-2'}`} />
            ))}
          </div>
        </div>
      </div>

      {/* 右侧表单区 */}
      <div className="flex flex-col items-center justify-center flex-1 bg-card px-6 py-12 min-w-0">
        <div className="w-full max-w-sm">
          {/* 移动端 Logo */}
          <div className="flex md:hidden items-center gap-3 mb-8 justify-center">
            <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center">
              <MessageCircle className="w-7 h-7 text-white" />
            </div>
            <span className="text-2xl font-bold text-foreground">即时通讯</span>
          </div>

          <h2 className="text-2xl font-bold text-foreground mb-2">
            {mode === 'login' ? '欢迎回来' : '创建账号'}
          </h2>
          <p className="text-muted-foreground text-sm mb-8">
            {mode === 'login' ? '登录以开始聊天' : '填写信息完成注册'}
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                placeholder="仅支持字母、数字、下划线"
                value={username}
                onChange={e => setUsername(e.target.value.trim())}
                autoComplete="username"
                className="h-11"
              />
            </div>

            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label htmlFor="nickname">昵称（可选）</Label>
                <Input
                  id="nickname"
                  placeholder="显示给其他用户的名称"
                  value={nickname}
                  onChange={e => setNickname(e.target.value)}
                  className="h-11"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="password">密码</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPwd ? 'text' : 'password'}
                  placeholder={mode === 'register' ? '至少6位' : '请输入密码'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  className="h-11 pr-10"
                />
                <button type="button" onClick={() => setShowPwd(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label htmlFor="confirmPwd">确认密码</Label>
                <Input
                  id="confirmPwd"
                  type="password"
                  placeholder="再次输入密码"
                  value={confirmPwd}
                  onChange={e => setConfirmPwd(e.target.value)}
                  autoComplete="new-password"
                  className="h-11"
                />
              </div>
            )}

            {mode === 'register' && (
              <div className="flex items-start gap-2 mt-1">
                <Checkbox
                  id="agree"
                  checked={agreed}
                  onCheckedChange={v => setAgreed(v === true)}
                  className="mt-0.5"
                />
                <label htmlFor="agree" className="text-sm text-muted-foreground leading-snug cursor-pointer">
                  我已阅读并同意
                  <button type="button" className="text-primary underline-offset-2 hover:underline ml-1">《用户协议》</button>
                  和
                  <button type="button" className="text-primary underline-offset-2 hover:underline ml-1">《隐私政策》</button>
                </label>
              </div>
            )}

            <Button type="submit" className="h-11 text-base font-semibold mt-2" disabled={loading}>
              {loading ? '请稍候…' : mode === 'login' ? '登录' : '注册'}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            {mode === 'login' ? (
              <>还没有账号？<button className="text-primary font-medium hover:underline" onClick={() => setMode('register')}>立即注册</button></>
            ) : (
              <>已有账号？<button className="text-primary font-medium hover:underline" onClick={() => setMode('login')}>返回登录</button></>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
