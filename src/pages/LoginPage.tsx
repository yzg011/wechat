import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { MessageCircle, Eye, EyeOff, Mail, CheckCircle, XCircle, Loader } from 'lucide-react';

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken';

export default function LoginPage() {
  const { signInWithUsername, signUpWithUsername, sendPasswordResetEmail, checkUsernameAvailable, verifyResetEmail } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);

  // 用户名实时校验
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 忘记密码弹窗
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotUsername, setForgotUsername] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  // 注册模式下：用户名实时防抖校验
  useEffect(() => {
    if (mode !== 'register') return;
    if (!username || !/^[a-zA-Z0-9_]+$/.test(username)) {
      setUsernameStatus('idle');
      return;
    }
    setUsernameStatus('checking');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const available = await checkUsernameAvailable(username);
      setUsernameStatus(available ? 'available' : 'taken');
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [username, mode, checkUsernameAvailable]);

  // 切换模式时重置
  const switchMode = (m: 'login' | 'register') => {
    setMode(m);
    setUsername(''); setNickname(''); setEmail('');
    setPassword(''); setConfirmPwd('');
    setUsernameStatus('idle');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) { toast.error('请输入用户名'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) { toast.error('用户名只能包含字母、数字和下划线'); return; }
    if (!password) { toast.error('请输入密码'); return; }
    if (mode === 'register') {
      if (usernameStatus === 'taken') { toast.error('用户名已被使用，请更换'); return; }
      if (usernameStatus === 'checking') { toast.error('用户名校验中，请稍候'); return; }
      if (password.length < 6) { toast.error('密码至少6位'); return; }
      if (password !== confirmPwd) { toast.error('两次密码不一致'); return; }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error('邮箱格式不正确'); return; }
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
        const { error } = await signUpWithUsername(username, password, nickname || username, email || undefined);
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

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const uname = forgotUsername.trim();
    const mail = forgotEmail.trim();
    if (!uname) { toast.error('请输入用户名'); return; }
    if (!mail) { toast.error('请输入邮箱'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) { toast.error('邮箱格式不正确'); return; }

    setForgotLoading(true);
    // 先校验邮箱是否与注册时一致
    const result = await verifyResetEmail(uname, mail);
    if (result === 'no_user') {
      setForgotLoading(false);
      toast.error('用户名不存在');
      return;
    }
    if (result === 'no_email') {
      setForgotLoading(false);
      toast.error('该账号未绑定邮箱，无法通过邮箱找回密码');
      setForgotOpen(false);
      setForgotUsername(''); setForgotEmail('');
      return;
    }
    if (result === 'mismatch') {
      setForgotLoading(false);
      toast.error('邮箱与注册时填写的不一致，请重新输入');
      setForgotOpen(false);
      setForgotUsername(''); setForgotEmail('');
      return;
    }
    // result === 'ok'，发送重置邮件
    const { error } = await sendPasswordResetEmail(mail);
    setForgotLoading(false);
    if (error) { toast.error('发送失败：' + error.message); return; }
    toast.success('重置邮件已发送，请查收收件箱');
    setForgotOpen(false);
    setForgotUsername(''); setForgotEmail('');
  };

  // 用户名状态图标
  const UsernameStatusIcon = () => {
    if (mode !== 'register' || !username || !/^[a-zA-Z0-9_]+$/.test(username)) return null;
    if (usernameStatus === 'checking') return <Loader className="w-4 h-4 text-muted-foreground animate-spin" />;
    if (usernameStatus === 'available') return <CheckCircle className="w-4 h-4 text-green-500" />;
    if (usernameStatus === 'taken') return <XCircle className="w-4 h-4 text-destructive" />;
    return null;
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
              <div className="relative">
                <Input
                  id="username"
                  placeholder="仅支持字母、数字、下划线"
                  value={username}
                  onChange={e => setUsername(e.target.value.trim())}
                  autoComplete="username"
                  className={`h-11 pr-9 ${mode === 'register' && usernameStatus === 'taken' ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  <UsernameStatusIcon />
                </span>
              </div>
              {mode === 'register' && usernameStatus === 'taken' && (
                <p className="text-xs text-destructive">用户名已被使用，请换一个</p>
              )}
              {mode === 'register' && usernameStatus === 'available' && (
                <p className="text-xs text-green-600">用户名可用</p>
              )}
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

            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label htmlFor="reg-email">
                  邮箱
                  <span className="ml-1.5 text-xs text-muted-foreground font-normal">（可选，用于找回密码）</span>
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="reg-email"
                    name="reg-email"
                    type="email"
                    autoComplete="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={e => setEmail(e.target.value.trim())}
                    className="h-11 pl-9"
                  />
                </div>
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

            <Button type="submit" className="h-11 text-base font-semibold mt-2" disabled={loading || (mode === 'register' && usernameStatus === 'taken')}>
              {loading ? '请稍候…' : mode === 'login' ? '登录' : '注册'}
            </Button>

            {/* 忘记密码入口（仅登录模式） */}
            {mode === 'login' && (
              <div className="text-right -mt-1">
                <button
                  type="button"
                  onClick={() => { setForgotUsername(''); setForgotEmail(''); setForgotOpen(true); }}
                  className="text-sm text-primary hover:underline underline-offset-2"
                >
                  忘记密码？
                </button>
              </div>
            )}
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            {mode === 'login' ? (
              <>还没有账号？<button className="text-primary font-medium hover:underline" onClick={() => switchMode('register')}>立即注册</button></>
            ) : (
              <>已有账号？<button className="text-primary font-medium hover:underline" onClick={() => switchMode('login')}>返回登录</button></>
            )}
          </div>
        </div>
      </div>

      {/* 忘记密码弹窗 */}
      <Dialog open={forgotOpen} onOpenChange={o => { setForgotOpen(o); if (!o) { setForgotUsername(''); setForgotEmail(''); } }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
          <DialogHeader>
            <DialogTitle>找回密码</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            输入你的用户名和注册时绑定的邮箱，验证通过后发送密码重置链接。
          </p>
          <form onSubmit={handleForgotSubmit} className="space-y-4 mt-1">
            <div className="space-y-1.5">
              <Label htmlFor="forgot-username">用户名</Label>
              <Input
                id="forgot-username"
                name="forgot-username"
                autoComplete="username"
                placeholder="你的登录用户名"
                value={forgotUsername}
                onChange={e => setForgotUsername(e.target.value.trim())}
                className="h-11 text-base"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="forgot-email">注册邮箱</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="forgot-email"
                  name="forgot-email"
                  type="email"
                  autoComplete="email"
                  placeholder="your@email.com"
                  value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value.trim())}
                  className="h-11 pl-9 text-base"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" className="flex-1 h-11" onClick={() => setForgotOpen(false)}>
                取消
              </Button>
              <Button type="submit" className="flex-1 h-11" disabled={forgotLoading}>
                {forgotLoading ? '验证中…' : '发送重置邮件'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
