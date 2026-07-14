import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Sparkles, Clock, Users, ArrowRight, Loader2 } from 'lucide-react';
import { submitTelepathyKeyword, getMyTelepathyStatus } from '@/services/api';
import type { TelepathyStatus } from '@/services/api';

const WINDOW_MS = 5 * 60 * 1000; // 5分钟配对窗口

/** 距锚定时间剩余秒数（≤0 表示已过期） */
function secsLeft(createdAt: string): number {
  return Math.ceil((new Date(createdAt).getTime() + WINDOW_MS - Date.now()) / 1000);
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function TelepathyDialog({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<'input' | 'waiting' | 'matched'>('input');
  const [status, setStatus] = useState<TelepathyStatus | null>(null);
  const [matchCount, setMatchCount] = useState(0);
  // 等待阶段倒计时（秒）
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const reset = useCallback(() => {
    clearTimer();
    setKeyword('');
    setPhase('input');
    setStatus(null);
    setMatchCount(0);
    setCountdown(0);
  }, []);

  /** 启动等待倒计时，到期后自动回到输入阶段 */
  const startCountdown = useCallback((createdAt: string) => {
    clearTimer();
    const tick = () => {
      const secs = secsLeft(createdAt);
      if (secs <= 0) { reset(); return; }
      setCountdown(secs);
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
  }, [reset]);

  // 打开时先检查是否已有等待中/配对成功的词条
  useEffect(() => {
    if (!open) return;
    getMyTelepathyStatus().then(s => {
      if (!s) { setPhase('input'); return; }

      // 判断本场次是否仍在5分钟窗口内
      const withinWindow = secsLeft(s.created_at) > 0;

      if (!withinWindow) {
        // 窗口已过期（无论配对成功与否）→ 允许输入新词语
        setPhase('input');
        return;
      }

      setStatus(s);
      if (s.status === 'matched') {
        setMatchCount(s.match_count ?? 0);
        setPhase('matched');
        startCountdown(s.created_at); // 配对成功也用同一窗口倒计时
      } else {
        setPhase('waiting');
        startCountdown(s.created_at);
      }
    });
  }, [open, startCountdown]);

  // 弹窗关闭时清除计时器
  useEffect(() => { if (!open) clearTimer(); }, [open]);

  // 轮询：waiting 阶段自动切换到 matched；matched 阶段实时刷新人数
  useEffect(() => {
    if (!open || (phase !== 'waiting' && phase !== 'matched')) return;

    const poll = setInterval(async () => {
      const s = await getMyTelepathyStatus();
      if (!s) return;
      if (secsLeft(s.created_at) <= 0) return; // 倒计时到期由 countdown timer 处理

      if (s.status === 'matched') {
        // 更新人数（waiting 和 matched 均刷新）
        if (s.match_count != null) setMatchCount(s.match_count);
        // waiting → matched：切换界面并更新 status
        if (phase === 'waiting') {
          setStatus(s);
          setPhase('matched');
          // 倒计时已在运行，锚定时间相同（自己就是第一人），无需重启
        } else {
          // matched 阶段同步 conversation_id（群聊人数增加后可能变化）
          setStatus(prev => prev ? { ...prev, conversation_id: s.conversation_id ?? prev.conversation_id } : prev);
        }
      }
    }, 3000);

    return () => clearInterval(poll);
  }, [open, phase]);

  const handleSubmit = async () => {
    const kw = keyword.trim();
    if (!kw) { toast.error('请输入词语'); return; }
    if (kw.length > 30) { toast.error('词语最多30字'); return; }
    setSubmitting(true);
    const result = await submitTelepathyKeyword(kw);
    setSubmitting(false);

    if (result.status === 'error') {
      toast.error(result.message || '提交失败');
      return;
    }
    if (result.status === 'waiting') {
      const now = new Date().toISOString();
      setStatus({ keyword: kw, status: 'waiting', conversation_id: null, created_at: now });
      setPhase('waiting');
      startCountdown(now);
      toast.success('词语已提交，等待与你有缘的人…');
    } else if (result.status === 'matched') {
      setMatchCount(result.match_count ?? 2);
      // 用服务端返回的锚定时间（最早提交者的 created_at），确保所有人倒计时一致
      const anchor = result.created_at ?? new Date().toISOString();
      setStatus({ keyword: kw, status: 'matched', conversation_id: result.conversation_id ?? null, created_at: anchor });
      setPhase('matched');
      startCountdown(anchor);
    }
  };

  const handleEnterChat = () => {
    if (status?.conversation_id) {
      navigate(`/chat/${status.conversation_id}`);
      onOpenChange(false);
      reset();
    }
  };

  const handleClose = (val: boolean) => {
    if (!val) reset();
    onOpenChange(val);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            心有灵犀
          </DialogTitle>
        </DialogHeader>

        {phase === 'input' && (
          <div className="space-y-5 pt-1">
            <p className="text-sm text-muted-foreground leading-relaxed">
              输入一个词语，5分钟内若有陌生人输入了相同的词语，你们将自动配对聊天。
              两人配对成私聊，三人及以上组成群聊。
            </p>
            <div className="space-y-3">
              <Input
                placeholder="输入你的词语（最多30字）"
                value={keyword}
                maxLength={30}
                onChange={e => setKeyword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !submitting && handleSubmit()}
                className="text-center text-base"
              />
              <Button className="w-full gap-2" onClick={handleSubmit} disabled={submitting || !keyword.trim()}>
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                提交词语
              </Button>
            </div>
          </div>
        )}

        {phase === 'waiting' && (
          <div className="space-y-5 pt-1 text-center">
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Clock className="w-8 h-8 text-primary animate-pulse" />
              </div>
              <div>
                <p className="font-medium text-base">等待配对中…</p>
                <p className="text-sm text-muted-foreground mt-1">
                  你的词语：<span className="font-semibold text-foreground">「{status?.keyword}」</span>
                </p>
                <p className="text-sm tabular-nums font-medium text-primary mt-2">
                  剩余&nbsp;{Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
                </p>
                <p className="text-xs text-muted-foreground mt-1">超时未配对将自动回到输入页</p>
              </div>
            </div>
            <Button variant="outline" className="w-full" onClick={reset}>
              重新输入
            </Button>
          </div>
        )}

        {phase === 'matched' && (
          <div className="space-y-5 pt-1 text-center">
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Users className="w-8 h-8 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-base text-primary">配对成功！</p>
                <p className="text-sm text-muted-foreground mt-1">
                  词语：<span className="font-semibold text-foreground">「{status?.keyword}」</span>
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  共 <span className="font-semibold text-foreground animate-pulse">{matchCount}</span> 人输入了相同的词语
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {matchCount >= 3 ? '已为你们创建群聊，窗口内仍可加入' : '已为你们创建私聊'}
                </p>
                <p className="text-sm tabular-nums font-medium text-primary mt-2">
                  窗口剩余&nbsp;{Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">倒计时结束前均可加入</p>
              </div>
            </div>
            <Button className="w-full gap-2" onClick={handleEnterChat}>
              进入聊天 <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
