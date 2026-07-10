import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Sparkles, Clock, Users, ArrowRight, Loader2 } from 'lucide-react';
import { submitTelepathyKeyword, getMyTelepathyStatus } from '@/services/api';
import type { TelepathyStatus } from '@/services/api';

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

  // 打开时先检查是否已有等待中/配对成功的词条
  useEffect(() => {
    if (!open) return;
    getMyTelepathyStatus().then(s => {
      if (!s) { setPhase('input'); return; }
      setStatus(s);
      if (s.status === 'matched') {
        setMatchCount(s.match_count ?? 0);
        setPhase('matched');
      } else {
        setPhase('waiting');
      }
    });
  }, [open]);

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
      setStatus({ keyword: kw, status: 'waiting', conversation_id: null, created_at: new Date().toISOString() });
      setPhase('waiting');
      toast.success('词语已提交，等待与你有缘的人…');
    } else if (result.status === 'matched') {
      setMatchCount(result.match_count ?? 2);
      setStatus({ keyword: kw, status: 'matched', conversation_id: result.conversation_id ?? null, created_at: new Date().toISOString() });
      setPhase('matched');
    }
  };

  const handleEnterChat = () => {
    if (status?.conversation_id) {
      navigate(`/chat/${status.conversation_id}`);
      onOpenChange(false);
      reset();
    }
  };

  const reset = () => {
    setKeyword('');
    setPhase('input');
    setStatus(null);
    setMatchCount(0);
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
                <p className="text-xs text-muted-foreground mt-2">有效期5分钟，与你有缘的人出现时将自动配对</p>
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
                  共 <span className="font-semibold text-foreground">{matchCount}</span> 人输入了相同的词语
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {matchCount >= 3 ? '已为你们创建群聊' : '已为你们创建私聊'}
                </p>
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
