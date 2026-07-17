import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import {
  getMoments, createMoment, deleteMoment,
  toggleLike, addComment, deleteComment, uploadMomentImage
} from '@/services/api';
import { ImagePreview } from '@/components/ui/image-preview';
import type { Moment } from '@/types/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  Heart, MessageSquare, Image as ImageIcon, Send,
  Plus, Trash2, X, Camera
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

// 图片网格（支持点击预览）
function ImageGrid({ urls, onPreview }: { urls: string[]; onPreview: (url: string) => void }) {
  if (!urls.length) return null;
  const count = urls.length;
  const gridClass = count === 1
    ? 'grid grid-cols-1'
    : count === 2
    ? 'grid grid-cols-2 gap-1'
    : 'grid grid-cols-3 gap-1';

  return (
    <div className={`mt-2 rounded-lg overflow-hidden ${gridClass} max-w-xs`}>
      {urls.slice(0, 9).map((url, i) => (
        <div
          key={i}
          className={`${count === 1 ? 'aspect-[4/3]' : 'aspect-square'} overflow-hidden bg-muted cursor-zoom-in`}
          onClick={() => onPreview(url)}
        >
          <img src={url} alt="" className="w-full h-full object-cover hover:opacity-90 transition-opacity" />
        </div>
      ))}
    </div>
  );
}

// 单条朋友圈
function MomentCard({
  moment, currentUserId,
  onLike, onComment, onDelete, onDeleteComment, onPreview,
}: {
  moment: Moment;
  currentUserId: string;
  onLike: (m: Moment) => void;
  onComment: (m: Moment, text: string) => void;
  onDelete: (m: Moment) => void;
  onDeleteComment: (momentId: string, commentId: string) => void;
  onPreview: (url: string, urls: string[]) => void;
}) {
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleComment = async () => {
    const text = commentText.trim();
    if (!text) return;
    setSubmitting(true);
    await onComment(moment, text);
    setCommentText('');
    setSubmitting(false);
    setShowCommentInput(false);
  };

  return (
    <div className="bg-card rounded-xl p-4 shadow-sm border border-border">
      {/* 头部：头像 + 名字 + 时间 */}
      <div className="flex items-start gap-3">
        <Avatar className="w-10 h-10 shrink-0">
          <AvatarImage src={moment.author?.avatar_url ?? ''} />
          <AvatarFallback className="bg-primary text-primary-foreground text-sm">
            {(moment.author?.nickname || '?').charAt(0)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className="font-medium text-sm text-foreground truncate">
              {moment.author?.nickname || moment.author?.username}
            </p>
            <div className="flex items-center gap-1 shrink-0 ml-2">
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(moment.created_at), { locale: zhCN, addSuffix: true })}
              </span>
              {moment.user_id === currentUserId && (
                <button
                  onClick={() => onDelete(moment)}
                  className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* 内容 */}
          {moment.content && (
            <p className="text-sm text-foreground mt-1 whitespace-pre-wrap break-words">{moment.content}</p>
          )}

          {/* 图片 */}
          <ImageGrid urls={moment.image_urls} onPreview={url => onPreview(url, moment.image_urls)} />

          {/* 点赞 & 评论操作栏 */}
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border">
            <button
              onClick={() => onLike(moment)}
              className={`flex items-center gap-1.5 text-xs transition-colors ${moment.liked_by_me ? 'text-red-500' : 'text-muted-foreground hover:text-red-500'}`}
            >
              <Heart className={`w-4 h-4 ${moment.liked_by_me ? 'fill-red-500' : ''}`} />
              <span>{(moment.likes_count ?? 0) > 0 ? moment.likes_count : '点赞'}</span>
            </button>
            <button
              onClick={() => { setShowCommentInput(v => !v); setTimeout(() => inputRef.current?.focus(), 50); }}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              <MessageSquare className="w-4 h-4" />
              <span>{(moment.comments_count ?? 0) > 0 ? `${moment.comments_count} 条评论` : '评论'}</span>
            </button>
          </div>

          {/* 点赞列表 */}
          {(moment.likes?.length ?? 0) > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {moment.likes!.map(l => (
                <span key={l.id} className="text-xs text-primary font-medium">
                  {(l as any).user?.nickname || '用户'}
                </span>
              ))}
              <span className="text-xs text-muted-foreground">觉得很赞</span>
            </div>
          )}

          {/* 评论列表 */}
          {(moment.comments?.length ?? 0) > 0 && (
            <div className="mt-2 bg-muted rounded-lg px-3 py-2 space-y-1.5">
              {moment.comments!.map(c => (
                <div key={c.id} className="flex items-start gap-2 group">
                  <span className="text-xs font-medium text-primary shrink-0">
                    {(c as any).user?.nickname || '用户'}：
                  </span>
                  <span className="text-xs text-foreground flex-1 break-words">{c.content}</span>
                  {(c.user_id === currentUserId || moment.user_id === currentUserId) && (
                    <button
                      onClick={() => onDeleteComment(moment.id, c.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-0.5 transition-all shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 评论输入框 */}
          {showCommentInput && (
            <div className="mt-2 flex gap-2">
              <Textarea
                ref={inputRef}
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleComment(); } }}
                placeholder="说点什么…"
                className="flex-1 min-h-[36px] max-h-20 resize-none text-xs bg-muted border-0 focus-visible:ring-1 rounded-lg px-3 py-2"
                rows={1}
              />
              <Button size="sm" onClick={handleComment} disabled={submitting || !commentText.trim()} className="shrink-0 h-9 w-9 p-0 rounded-lg">
                <Send className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MomentsPage() {
  const { user, profile } = useAuth();
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishOpen, setPublishOpen] = useState(false);
  const [postContent, setPostContent] = useState('');
  const [postImages, setPostImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Moment | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getMoments(40);
    setMoments(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // 实时订阅
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel('moments-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'moments' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'moment_likes' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'moment_comments' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, load]);

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length || !user) return;
    const remaining = 9 - postImages.length;
    const toUpload = files.slice(0, remaining);
    setUploading(true);
    const results = await Promise.all(toUpload.map(f => uploadMomentImage(user.id, f)));
    setUploading(false);
    const urls = results.filter(r => r.url).map(r => r.url!);
    setPostImages(prev => [...prev, ...urls]);
    e.target.value = '';
  };

  const handlePublish = async () => {
    if (!user) return;
    if (!postContent.trim() && postImages.length === 0) { toast.error('请输入内容或选择图片'); return; }
    setPublishing(true);
    const { error } = await createMoment(user.id, postContent.trim(), postImages);
    setPublishing(false);
    if (error) { toast.error('发布失败'); return; }
    toast.success('发布成功');
    setPublishOpen(false);
    setPostContent('');
    setPostImages([]);
    load();
  };

  const handleLike = async (moment: Moment) => {
    if (!user) return;
    const { error } = await toggleLike(moment.id, user.id, !!moment.liked_by_me);
    if (error) toast.error('操作失败');
    else load();
  };

  const handleComment = async (moment: Moment, text: string) => {
    if (!user) return;
    const { error } = await addComment(moment.id, user.id, text);
    if (error) toast.error('评论失败');
    else load();
  };

  const handleDelete = async (moment: Moment) => {
    setDeleteTarget(moment);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await deleteMoment(deleteTarget.id);
    setDeleteTarget(null);
    if (error) toast.error('删除失败');
    else { toast.success('已删除'); load(); }
  };

  const handleDeleteComment = async (momentId: string, commentId: string) => {
    const { error } = await deleteComment(commentId);
    if (error) toast.error('删除失败');
    else load();
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 顶部 */}
      <div className="bg-card border-b border-border px-4 py-3 pl-16 md:pl-4 flex items-center justify-between shrink-0">
        <h1 className="text-base font-semibold text-foreground">朋友圈</h1>
        <Button size="sm" onClick={() => setPublishOpen(true)} className="gap-1.5 h-8 text-xs">
          <Plus className="w-3.5 h-3.5" />发布动态
        </Button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex flex-col gap-3 p-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-card rounded-xl p-4 border border-border space-y-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="w-10 h-10 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-24" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
          </div>
        ) : moments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <Camera className="w-14 h-14 opacity-20" />
            <p className="text-sm">还没有动态，来发布第一条吧</p>
            <Button variant="secondary" size="sm" onClick={() => setPublishOpen(true)} className="gap-1.5">
              <Plus className="w-3.5 h-3.5" />发布动态
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-4 max-w-2xl mx-auto w-full">
            {moments.map(m => (
              <MomentCard
                key={m.id}
                moment={m}
                currentUserId={user?.id ?? ''}
                onLike={handleLike}
                onComment={handleComment}
                onDelete={handleDelete}
                onDeleteComment={handleDeleteComment}
                onPreview={(url, urls) => { setPreviewSrc(url); setPreviewImages(urls); }}
              />
            ))}
          </div>
        )}
      </div>

      {/* 发布弹窗 */}
      <Dialog open={publishOpen} onOpenChange={open => { setPublishOpen(open); if (!open) { setPostContent(''); setPostImages([]); } }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <DialogHeader>
            <DialogTitle>发布动态</DialogTitle>
          </DialogHeader>

          <div className="flex items-start gap-3 mt-1">
            <Avatar className="w-9 h-9 shrink-0 mt-0.5">
              <AvatarImage src={profile?.avatar_url ?? ''} />
              <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                {(profile?.nickname || '?').charAt(0)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <Textarea
                value={postContent}
                onChange={e => setPostContent(e.target.value)}
                placeholder="这一刻的想法…"
                rows={4}
                className="resize-none border-0 bg-muted focus-visible:ring-0 text-sm px-3 py-2 rounded-lg"
              />

              {/* 已选图片 */}
              {postImages.length > 0 && (
                <div className="mt-2 grid grid-cols-4 gap-1.5">
                  {postImages.map((url, i) => (
                    <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                      <img src={url} alt="" className="w-full h-full object-cover" />
                      <button
                        onClick={() => setPostImages(prev => prev.filter((_, idx) => idx !== i))}
                        className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center text-white hover:bg-black/80"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {postImages.length < 9 && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="aspect-square rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                    >
                      <ImageIcon className="w-5 h-5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between mt-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || postImages.length >= 9}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors disabled:opacity-40"
            >
              <ImageIcon className="w-4 h-4" />
              {uploading ? '上传中…' : `图片 (${postImages.length}/9)`}
            </button>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => { setPublishOpen(false); setPostContent(''); setPostImages([]); }}>取消</Button>
              <Button size="sm" onClick={handlePublish} disabled={publishing || uploading || (!postContent.trim() && postImages.length === 0)}>
                {publishing ? '发布中…' : '发布'}
              </Button>
            </div>
          </div>

          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImagePick} />
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
          <DialogHeader><DialogTitle>删除动态</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground mt-1">确定要删除这条动态吗？删除后不可恢复。</p>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>删除</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 图片全屏预览 */}
      <ImagePreview
        src={previewSrc}
        images={previewImages}
        onClose={() => { setPreviewSrc(null); setPreviewImages([]); }}
      />
    </div>
  );
}
