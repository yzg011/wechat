import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import {
  getMessages, sendMessage, markMessagesRead, markConversationRead,
  getConversationDetails, getGroupMembers, addGroupMember, removeGroupMember,
  uploadChatImage, getFriends, recallMessage, updateGroupAnnouncement, isOnline,
  blockUser, clearConversationMessages, deleteMessage, hideMessageForMe,
  getMyDeletedMessageIds, unfriendAndDeleteConversation,
  checkFriendship, sendFriendRequest,
} from '@/services/api';
import type { Message, Conversation, GroupMember, Profile } from '@/types/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import {
  ArrowLeft, Send, Image as ImageIcon, Smile, Users, UserPlus,
  Check, CheckCheck, RotateCcw, Megaphone, Pencil, MoreVertical,
  Trash2, Ban, UserMinus, CheckSquare,
} from 'lucide-react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

// 表情列表
const EMOJIS = ['😀','😂','🥰','😎','🤔','😅','🙏','👍','❤️','🎉','🔥','💯','😭','🤣','😊','😍','😘','🤗','😏','😒','😞','😤','😠','🥳','😴','🤤','🤑','😜','🤪','😋','😚','😙','🥲','☺️','😌','😔','🤫','🤭','🫡','🤠','🥸','😈','👻','💀','☠️','🤡','👏','🙌','🤝','💪','✌️'];

function EmojiPicker({ onSelect }: { onSelect: (e: string) => void }) {
  return (
    <div className="grid grid-cols-8 gap-1 p-2 bg-card border border-border rounded-xl shadow-card w-72 max-h-48 overflow-y-auto">
      {EMOJIS.map(e => (
        <button key={e} onClick={() => onSelect(e)}
          className="text-xl p-1 hover:bg-muted rounded transition-colors leading-none">{e}</button>
      ))}
    </div>
  );
}

// 在线状态圆点
function OnlineDot({ online }: { online: boolean }) {
  return (
    <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-card ${online ? 'bg-green-500' : 'bg-gray-400'}`} />
  );
}

// 群公告编辑组件（独立 state，避免父组件 state 残留）
function AnnouncementEditor({
  groupId, initial, isOwner,
  onSaved,
}: { groupId: string; initial: string; isOwner: boolean; onSaved: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await updateGroupAnnouncement(groupId, text);
    setSaving(false);
    if (error) { toast.error('保存失败'); return; }
    toast.success('群公告已更新');
    onSaved(text);
    setEditing(false);
  };

  return (
    <div className="mt-4 bg-muted rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1">
        <Megaphone className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="text-xs font-medium text-foreground">群公告</span>
        {isOwner && !editing && (
          <button
            onClick={() => { setText(initial); setEditing(true); }}
            className="ml-auto text-muted-foreground hover:text-primary p-1 rounded"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2 mt-1">
          <Textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="输入群公告内容…"
            rows={3}
            maxLength={200}
            className="resize-none text-xs"
          />
          <p className="text-[10px] text-muted-foreground text-right">{text.length}/200</p>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" size="sm" className="h-7 text-xs" onClick={() => setEditing(false)}>取消</Button>
            <Button size="sm" className="h-7 text-xs" disabled={saving} onClick={handleSave}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap">
          {initial || '暂无群公告'}
        </p>
      )}
    </div>
  );
}

export default function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showEmoji, setShowEmoji] = useState(false);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [friends, setFriends] = useState<Profile[]>([]);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [otherOnline, setOtherOnline] = useState(false);
  // 私聊菜单确认弹窗
  type ConfirmAction = 'clear' | 'block' | 'unfriend' | null;
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  // 多选删除
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 陌生人提示横幅
  const [showStrangerBanner, setShowStrangerBanner] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  const loadConv = useCallback(async () => {
    if (!conversationId || !user) return;
    const convData = await getConversationDetails(conversationId, user.id);
    setConv(convData);
    if (convData?.type === 'group' && convData.group_id) {
      const m = await getGroupMembers(convData.group_id);
      setMembers(m);
    }
    if (convData?.type === 'private' && convData.other_user) {
      setOtherOnline(isOnline((convData.other_user as any).last_seen_at));
      // 判断是否为陌生人（非好友且非临时邀请账号）
      const otherUsername: string = (convData.other_user as any).username ?? '';
      const isGuest = otherUsername.startsWith('guest_');
      if (!isGuest) {
        const status = await checkFriendship(user.id, (convData.other_user as any).id);
        setShowStrangerBanner(status === 'none');
      }
    }
  }, [conversationId, user]);

  const loadMessages = useCallback(async () => {
    if (!conversationId || !user) return;
    const [msgs, deletedIds] = await Promise.all([
      getMessages(conversationId, 50),
      getMyDeletedMessageIds(user.id, conversationId),
    ]);
    setMessages(deletedIds.size ? msgs.filter(m => !deletedIds.has(m.id)) : msgs);
    await markConversationRead(conversationId, user.id);
    await markMessagesRead(conversationId, user.id);
  }, [conversationId, user]);

  useEffect(() => { loadConv(); loadMessages(); }, [loadConv, loadMessages]);
  useEffect(() => { scrollToBottom(); }, [messages]);

  // 实时订阅新消息 & 撤回更新
  useEffect(() => {
    if (!conversationId || !user) return;
    const channel = supabase.channel(`chat-${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, async (payload) => {
        const newMsg = payload.new as Message;
        const { data: senderData } = await supabase
          .from('profiles').select('id,username,nickname,avatar_url,last_seen_at').eq('id', newMsg.sender_id).maybeSingle();
        const enriched = { ...newMsg, sender: senderData as Profile };
        setMessages(prev => prev.some(m => m.id === enriched.id) ? prev : [...prev, enriched]);
        if (newMsg.sender_id !== user.id) {
          await markConversationRead(conversationId, user.id);
          await markMessagesRead(conversationId, user.id);
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, (payload) => {
        setMessages(prev => prev.map(m => m.id === (payload.new as Message).id ? { ...m, ...(payload.new as Message) } : m));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversationId, user]);

  // 定时刷新对方在线状态
  useEffect(() => {
    if (!conv || conv.type !== 'private' || !conv.other_user) return;
    const refresh = () => setOtherOnline(isOnline((conv.other_user as any).last_seen_at));
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [conv]);

  const handleSend = async () => {
    if (!input.trim() || !conversationId || !user) return;
    const text = input.trim();
    setInput('');
    setSending(true);
    const optimistic: Message = {
      id: `opt-${Date.now()}`, conversation_id: conversationId,
      sender_id: user.id, content: text, message_type: 'text',
      image_url: null, is_read: false, is_recalled: false, recalled_at: null,
      created_at: new Date().toISOString(), sender: profile as Profile,
    };
    setMessages(prev => [...prev, optimistic]);
    const { error } = await sendMessage(conversationId, user.id, text, 'text');
    setSending(false);
    if (error) {
      toast.error('消息发送失败，请重试');
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
    } else {
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !conversationId || !user) return;
    if (!['image/jpeg','image/png','image/gif','image/webp','image/avif'].includes(file.type)) {
      toast.error('不支持的图片格式'); return;
    }
    setUploadProgress(5);
    const { url, error } = await uploadChatImage(user.id, file, p => setUploadProgress(p));
    if (error || !url) { toast.error('图片上传失败'); setUploadProgress(0); return; }
    setUploadProgress(0);
    const { error: msgErr } = await sendMessage(conversationId, user.id, '[图片]', 'image', url);
    if (msgErr) toast.error('图片发送失败');
    e.target.value = '';
  };

  // 私聊菜单操作
  const handleConfirmAction = async () => {
    if (!conversationId || !user) return;
    const otherId = (conv?.other_user as any)?.id as string | undefined;

    if (confirmAction === 'clear') {
      const { error } = await clearConversationMessages(conversationId);
      if (error) { toast.error('清除失败'); return; }
      setMessages([]);
      toast.success('聊天记录已清除');
    } else if (confirmAction === 'block' && otherId) {
      const { error } = await blockUser(user.id, otherId);
      if (error) { toast.error('拉黑失败'); return; }
      toast.success('已将对方拉黑');
      navigate('/chat');
    } else if (confirmAction === 'unfriend' && otherId) {
      const { error } = await unfriendAndDeleteConversation(user.id, otherId, conversationId);
      if (error) { toast.error('删除好友失败'); return; }
      toast.success('已删除好友');
      navigate('/chat');
    }
    setConfirmAction(null);
  };

  /** 陌生人横幅：加为好友 */
  const handleAddFriend = async () => {
    if (!user) return;
    const otherId = (conv?.other_user as any)?.id as string;
    const { error } = await sendFriendRequest(user.id, otherId);
    if (error) { toast.error('发送失败：' + error.message); return; }
    toast.success('好友请求已发送');
    setShowStrangerBanner(false);
  };

  /** 陌生人横幅：拉黑 */
  const handleBannerBlock = async () => {
    if (!user) return;
    const otherId = (conv?.other_user as any)?.id as string;
    const { error } = await blockUser(user.id, otherId);
    if (error) { toast.error('拉黑失败'); return; }
    toast.success('已将对方拉黑');
    navigate('/chat');
  };

  const handleRecall = async (msg: Message) => {
    if (msg.sender_id !== user?.id) return;
    const age = new Date().getTime() - new Date(msg.created_at).getTime();
    if (age > 2 * 60 * 1000) { toast.error('超过2分钟，无法撤回'); return; }
    const { error } = await recallMessage(msg.id);
    if (error) toast.error('撤回失败：' + error.message);
    else setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, is_recalled: true, content: '[已撤回]' } : m));
  };

  const handleDeleteMessage = async (msg: Message) => {
    if (!user) return;
    // 先乐观删除，确保 UI 立即响应
    setMessages(prev => prev.filter(m => m.id !== msg.id));
    if (msg.id.startsWith('opt-')) return; // 乐观消息还未落库，无需处理

    if (msg.sender_id === user.id) {
      // 自己的消息：从 DB 删除（RLS: sender_id = uid()）
      const { error } = await deleteMessage(msg.id);
      if (error) {
        toast.error('删除失败');
        setMessages(prev => {
          const idx = prev.findIndex(m => new Date(m.created_at) > new Date(msg.created_at));
          const next = [...prev];
          if (idx === -1) next.push(msg); else next.splice(idx, 0, msg);
          return next;
        });
      }
    } else {
      // 他人消息：仅对自己隐藏，写入 message_deletions
      const { error } = await hideMessageForMe(user.id, msg.id);
      if (error) {
        toast.error('删除失败');
        setMessages(prev => {
          const idx = prev.findIndex(m => new Date(m.created_at) > new Date(msg.created_at));
          const next = [...prev];
          if (idx === -1) next.push(msg); else next.splice(idx, 0, msg);
          return next;
        });
      }
    }
  };

  /** 批量删除已选中消息 */
  const handleBatchDelete = async () => {
    if (!user || selectedIds.size === 0) return;
    const toDelete = messages.filter(m => selectedIds.has(m.id));
    // 乐观删除
    setMessages(prev => prev.filter(m => !selectedIds.has(m.id)));
    setSelectMode(false);
    setSelectedIds(new Set());

    await Promise.all(toDelete.map(async msg => {
      if (msg.id.startsWith('opt-')) return;
      if (msg.sender_id === user.id) {
        await deleteMessage(msg.id);
      } else {
        await hideMessageForMe(user.id, msg.id);
      }
    }));
  };

  const toggleSelect = (msgId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId); else next.add(msgId);
      return next;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const chatName = conv?.type === 'group'
    ? conv.group?.name || '群聊'
    : (conv?.other_user as any)?.nickname || (conv?.other_user as any)?.username || '聊天';
  const chatAvatar = conv?.type === 'group' ? conv.group?.avatar_url || null : (conv?.other_user as any)?.avatar_url || null;
  const isGroupOwner = conv?.type === 'group' && conv.group?.owner_id === user?.id;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 顶部栏 */}
      <div className="bg-card border-b border-border px-3 py-2 pl-14 md:pl-3 flex items-center gap-3 shrink-0">
        {selectMode ? (
          <>
            <button onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }} className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <span className="flex-1 text-sm font-medium">已选 {selectedIds.size} 条</span>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive gap-1"
              disabled={selectedIds.size === 0}
              onClick={handleBatchDelete}
            >
              <Trash2 className="w-4 h-4" />删除
            </Button>
          </>
        ) : (
          <>
            <button onClick={() => navigate(-1)} className="md:hidden text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="relative shrink-0">
              <Avatar className="w-8 h-8">
                <AvatarImage src={chatAvatar ?? ''} alt={chatName} />
                <AvatarFallback className={`text-sm ${conv?.type === 'group' ? 'bg-accent text-accent-foreground' : 'bg-primary text-primary-foreground'}`}>
                  {chatName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {conv?.type === 'private' && <OnlineDot online={otherOnline} />}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-medium text-sm truncate">{chatName}</h2>
              {conv?.type === 'private' && (
                <p className="text-xs text-muted-foreground">{otherOnline ? '在线' : '离线'}</p>
              )}
              {conv?.type === 'group' && <p className="text-xs text-muted-foreground">{members.length} 名成员</p>}
            </div>

            {/* 多选按钮 */}
            <Button variant="ghost" size="icon" className="w-8 h-8 shrink-0" onClick={() => setSelectMode(true)}>
              <CheckSquare className="w-4 h-4" />
            </Button>

            {/* 私聊三点菜单 */}
            {conv?.type === 'private' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="w-8 h-8 shrink-0">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={() => setConfirmAction('clear')} className="gap-2 text-muted-foreground">
                    <Trash2 className="w-4 h-4" />清除聊天记录
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setConfirmAction('block')} className="gap-2 text-destructive focus:text-destructive">
                    <Ban className="w-4 h-4" />拉黑
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setConfirmAction('unfriend')} className="gap-2 text-destructive focus:text-destructive">
                    <UserMinus className="w-4 h-4" />删除好友
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* 群组管理面板 */}
            {conv?.type === 'group' && (
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="w-8 h-8 shrink-0">
                <Users className="w-4 h-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 [&>button]:hidden">
              <SheetHeader><SheetTitle>群组详情</SheetTitle></SheetHeader>

              {/* 群公告区域 */}
              {conv.group_id && (
                <AnnouncementEditor
                  groupId={conv.group_id}
                  initial={(conv.group as any)?.announcement || ''}
                  isOwner={isGroupOwner}
                  onSaved={v => setConv(prev => prev ? { ...prev, group: prev.group ? { ...prev.group, announcement: v } : prev.group } : prev)}
                />
              )}

              {/* 成员列表 */}
              <p className="text-xs font-medium text-muted-foreground mt-4 mb-2">群成员 ({members.length})</p>
              <div className="space-y-1 overflow-y-auto flex-1 max-h-64">
                {members.map(m => (
                  <div key={m.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted">
                    <div className="relative shrink-0">
                      <Avatar className="w-8 h-8">
                        <AvatarImage src={(m as any).profile?.avatar_url ?? ''} />
                        <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                          {((m as any).profile?.nickname || '?').charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <OnlineDot online={isOnline((m as any).profile?.last_seen_at)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{(m as any).profile?.nickname || (m as any).profile?.username}</p>
                      {m.user_id === conv.group?.owner_id && <span className="text-xs text-primary">群主</span>}
                    </div>
                    {conv.group?.owner_id === user?.id && m.user_id !== user?.id && (
                      <button onClick={async () => {
                        const { error } = await removeGroupMember(conv.group_id!, m.user_id);
                        if (!error) { const updated = await getGroupMembers(conv.group_id!); setMembers(updated); }
                      }} className="text-destructive hover:bg-destructive/10 rounded p-1 text-xs">移除</button>
                    )}
                  </div>
                ))}
              </div>

              {/* 添加成员 */}
              <Dialog open={addMemberOpen} onOpenChange={async (o) => {
                setAddMemberOpen(o);
                if (o && user) { const f = await getFriends(user.id); setFriends(Array.isArray(f) ? f : []); }
              }}>
                <DialogTrigger asChild>
                  <Button variant="secondary" className="mt-4 w-full gap-2">
                    <UserPlus className="w-4 h-4" />添加成员
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
                  <DialogHeader><DialogTitle>添加群成员</DialogTitle></DialogHeader>
                  <div className="space-y-2 max-h-72 overflow-y-auto mt-2">
                    {friends.filter(f => !members.some(m => m.user_id === f.id)).map(f => (
                      <div key={f.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted">
                        <Avatar className="w-8 h-8 shrink-0">
                          <AvatarImage src={f.avatar_url ?? ''} />
                          <AvatarFallback className="bg-primary text-primary-foreground text-xs">{f.nickname.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <span className="flex-1 text-sm truncate">{f.nickname}</span>
                        <Button size="sm" onClick={async () => {
                          await addGroupMember(conv.group_id!, f.id);
                          const updated = await getGroupMembers(conv.group_id!);
                          setMembers(updated);
                          setAddMemberOpen(false);
                        }}>添加</Button>
                      </div>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>
            </SheetContent>
          </Sheet>
        )}
          </>
        )}
      </div>

      {/* 陌生人提示横幅 */}
      {showStrangerBanner && conv?.type === 'private' && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2.5 flex items-center gap-3 shrink-0">
          <p className="flex-1 text-xs text-amber-800 dark:text-amber-300 min-w-0">
            你们还不是好友，请注意隐私安全
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 h-7 px-2 text-xs border border-amber-400 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
            onClick={handleAddFriend}
          >
            加好友
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 h-7 px-2 text-xs border border-destructive/50 text-destructive hover:bg-destructive/10"
            onClick={handleBannerBlock}
          >
            拉黑
          </Button>
        </div>
      )}

      {/* 群公告横幅 */}
      {conv?.type === 'group' && (conv.group as any)?.announcement && (
        <div className="bg-primary/5 border-b border-border px-4 py-1.5 flex items-start gap-2 shrink-0">
          <Megaphone className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-foreground line-clamp-2 flex-1">{(conv.group as any)?.announcement}</p>
        </div>
      )}

      {/* 消息区域 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3 bg-background">
        {messages.map((msg, idx) => {
          const isMine = msg.sender_id === user?.id;
          const prevMsg = messages[idx - 1];
          const showTime = !prevMsg || new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() > 5 * 60 * 1000;
          const canRecall = isMine && !msg.is_recalled && msg.id.startsWith('opt-') === false
            && new Date().getTime() - new Date(msg.created_at).getTime() < 2 * 60 * 1000;

          return (
            <div key={msg.id}>
              {showTime && (
                <div className="text-center text-xs text-muted-foreground my-2">
                  {format(new Date(msg.created_at), 'MM月dd日 HH:mm', { locale: zhCN })}
                </div>
              )}
              {/* 多选模式：整行可点击选中 */}
              <div
                className={`flex items-end gap-2 ${isMine ? 'flex-row-reverse' : 'flex-row'} ${selectMode ? 'cursor-pointer' : ''} ${selectMode && selectedIds.has(msg.id) ? 'bg-primary/10 rounded-lg' : ''}`}
                onClick={selectMode ? () => toggleSelect(msg.id) : undefined}
              >
                {/* 多选复选框 */}
                {selectMode && (
                  <div className={`shrink-0 mb-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${selectedIds.has(msg.id) ? 'bg-primary border-primary' : 'border-muted-foreground'}`}>
                    {selectedIds.has(msg.id) && <Check className="w-3 h-3 text-primary-foreground" />}
                  </div>
                )}
                {!isMine && !selectMode && (
                  <div className="relative shrink-0 mb-1">
                    <Avatar className="w-8 h-8">
                      <AvatarImage src={(msg.sender as any)?.avatar_url ?? ''} />
                      <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                        {((msg.sender as any)?.nickname || '?').charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <OnlineDot online={isOnline((msg.sender as any)?.last_seen_at)} />
                  </div>
                )}
                {!isMine && selectMode && (
                  <div className="relative shrink-0 mb-1">
                    <Avatar className="w-8 h-8">
                      <AvatarImage src={(msg.sender as any)?.avatar_url ?? ''} />
                      <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                        {((msg.sender as any)?.nickname || '?').charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                )}
                <div className={`flex flex-col max-w-[70%] ${isMine ? 'items-end' : 'items-start'}`}>
                  {!isMine && conv?.type === 'group' && (
                    <span className="text-xs text-muted-foreground mb-1 ml-1">
                      {(msg.sender as any)?.nickname || (msg.sender as any)?.username}
                    </span>
                  )}
                  {msg.is_recalled ? (
                    <div className="px-3 py-1.5 rounded-xl bg-muted text-muted-foreground text-xs italic">已撤回</div>
                  ) : selectMode ? (
                    /* 多选模式下气泡不触发 dropdown，直接展示 */
                    <div className={`px-3 py-2 text-sm ${isMine ? 'bubble-right' : 'bubble-left'}`}>
                      {msg.message_type === 'image'
                        ? <img src={msg.image_url ?? ''} alt="图片" className="max-w-[200px] max-h-[200px] rounded-lg object-cover" />
                        : <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
                    </div>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <div className={`px-3 py-2 text-sm cursor-pointer select-text ${isMine ? 'bubble-right' : 'bubble-left'}`}>
                          {msg.message_type === 'image'
                            ? <img src={msg.image_url ?? ''} alt="图片" className="max-w-[200px] max-h-[200px] rounded-lg object-cover" />
                            : <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
                        </div>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align={isMine ? 'end' : 'start'}>
                        {canRecall && (
                          <>
                            <DropdownMenuItem onClick={() => handleRecall(msg)}>
                              <RotateCcw className="w-4 h-4 mr-2" />撤回消息
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        )}
                        <DropdownMenuItem
                          onClick={() => handleDeleteMessage(msg)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />删除消息
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {isMine && !msg.is_recalled && conv?.type === 'private' && !selectMode && (
                    <span className="text-xs text-muted-foreground mt-0.5 flex items-center gap-0.5">
                      {msg.is_read ? <><CheckCheck className="w-3 h-3 text-primary" />已读</> : <><Check className="w-3 h-3" />未读</>}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {uploadProgress > 0 && (
        <div className="px-4 py-1 bg-card border-t border-border">
          <Progress value={uploadProgress} className="h-1" />
          <p className="text-xs text-muted-foreground mt-0.5">上传中 {uploadProgress}%</p>
        </div>
      )}

      {showEmoji && (
        <div className="px-4 pb-2 bg-card border-t border-border">
          <EmojiPicker onSelect={e => { setInput(p => p + e); setShowEmoji(false); textareaRef.current?.focus(); }} />
        </div>
      )}

      {/* 输入区域 */}
      <div className="bg-card border-t border-border px-3 py-2 shrink-0">
        <div className="flex items-end gap-2">
          <div className="flex gap-1 shrink-0 pb-1">
            <button onClick={() => setShowEmoji(v => !v)}
              className={`p-1.5 rounded-lg transition-colors ${showEmoji ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
              <Smile className="w-5 h-5" />
            </button>
            <button onClick={() => fileInputRef.current?.click()}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <ImageIcon className="w-5 h-5" />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
          </div>
          {/* text-base(16px) 阻止 iOS Safari 在聚焦时自动缩放页面 */}
          <Textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="发送消息…"
            className="flex-1 min-h-[40px] max-h-32 resize-none text-base md:text-sm border-0 bg-muted focus-visible:ring-0 rounded-xl px-3 py-2"
            rows={1} />
          <Button onClick={handleSend} disabled={sending || !input.trim()} size="icon" className="h-9 w-9 rounded-full shrink-0">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* 群公告编辑弹窗已内联到群组详情 Sheet 中 */}

      {/* 私聊操作确认弹窗 */}
      <AlertDialog open={confirmAction !== null} onOpenChange={o => { if (!o) setConfirmAction(null); }}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === 'clear' && '清除聊天记录'}
              {confirmAction === 'block' && '拉黑该用户'}
              {confirmAction === 'unfriend' && '删除好友'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === 'clear' && '此操作将永久删除本次对话的所有消息，无法恢复。'}
              {confirmAction === 'block' && '拉黑后对方将无法向您发送消息，确定继续？'}
              {confirmAction === 'unfriend' && '删除好友后需重新发送好友申请才能恢复，确定继续？'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleConfirmAction}
            >
              确定
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

