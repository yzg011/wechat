import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { getInviteLinkByToken, joinViaInvite } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { MessageCircle, Loader2, AlertTriangle } from 'lucide-react';

type PageState = 'loading' | 'valid' | 'invalid' | 'joining';

/** 生成访客临时账号凭据 */
function genGuestCredentials() {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return {
    email: `guest_${rand}@tmp.chat`,
    password: `Gst_${rand}_${Date.now()}`,
    username: `guest_${rand.slice(0, 8)}`,
  };
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [pageState, setPageState] = useState<PageState>('loading');
  const [nickname, setNickname] = useState('');

  // 验证邀请链接有效性（无需登录）
  useEffect(() => {
    if (!token) { setPageState('invalid'); return; }
    getInviteLinkByToken(token).then(link => {
      setPageState(link && link.status === 'active' ? 'valid' : 'invalid');
    });
  }, [token]);

  const handleJoin = async () => {
    if (!nickname.trim()) { toast.error('请输入您的昵称'); return; }
    if (!token) return;
    setPageState('joining');

    // 1. 检查是否已有会话；若无则注册临时访客账号
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      const creds = genGuestCredentials();
      const { error: signUpErr } = await supabase.auth.signUp({
        email: creds.email,
        password: creds.password,
        options: {
          data: { username: creds.username, nickname: nickname.trim() },
        },
      });
      if (signUpErr) {
        toast.error('加入失败，请刷新重试');
        setPageState('valid');
        return;
      }
    }

    // 2. 调用 join_via_invite RPC
    const { conversationId, error } = await joinViaInvite(token, nickname.trim());
    if (error === 'invalid_or_revoked') {
      toast.error('邀请链接已失效或被撤销');
      setPageState('invalid');
      return;
    }
    if (error === 'self_invite') {
      toast.error('不能使用自己创建的邀请链接');
      setPageState('valid');
      return;
    }
    if (error || !conversationId) {
      toast.error('加入失败：' + (error ?? '未知错误'));
      setPageState('valid');
      return;
    }

    // 3. 跳转到聊天页
    navigate(`/chat/${conversationId}`, { replace: true });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo 区域 */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center shadow-lg mb-4">
            <MessageCircle className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">聊天邀请</h1>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          {/* 加载中 */}
          {pageState === 'loading' && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">正在验证邀请链接…</p>
            </div>
          )}

          {/* 链接无效 */}
          {pageState === 'invalid' && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <AlertTriangle className="w-10 h-10 text-destructive" />
              <p className="font-semibold text-foreground">邀请链接已失效</p>
              <p className="text-sm text-muted-foreground">该链接可能已被撤销或不存在，请联系邀请人重新获取。</p>
            </div>
          )}

          {/* 输入昵称 */}
          {(pageState === 'valid' || pageState === 'joining') && (
            <div className="space-y-5">
              <div className="text-center">
                <p className="text-base font-semibold text-foreground">您收到了一个聊天邀请</p>
                <p className="text-sm text-muted-foreground mt-1">输入昵称即可直接开始聊天，无需注册</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-nickname">您的昵称</Label>
                <Input
                  id="invite-nickname"
                  value={nickname}
                  onChange={e => setNickname(e.target.value)}
                  placeholder="请输入您的昵称"
                  maxLength={20}
                  className="h-11"
                  onKeyDown={e => e.key === 'Enter' && handleJoin()}
                  disabled={pageState === 'joining'}
                  autoFocus
                />
              </div>
              <Button
                className="w-full h-11 gap-2"
                onClick={handleJoin}
                disabled={pageState === 'joining' || !nickname.trim()}
              >
                {pageState === 'joining'
                  ? <><Loader2 className="w-4 h-4 animate-spin" />加入中…</>
                  : <><MessageCircle className="w-4 h-4" />开始聊天</>
                }
              </Button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          聊天结束后，您的临时账号将自动停用
        </p>
      </div>
    </div>
  );
}
