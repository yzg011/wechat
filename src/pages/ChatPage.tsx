import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import {
  getMessages, sendMessage, markMessagesRead, markConversationRead,
  getConversationDetails, getGroupMembers, addGroupMember, removeGroupMember,
  uploadChatImage, getFriends, recallMessage, updateGroupAnnouncement, isOnline
} from '@/services/api';
import type { Message, Conversation, GroupMember, Profile } from '@/types/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import {
  ArrowLeft, Send, Image as ImageIcon, Smile, Users, UserPlus,
  Check, CheckCheck, RotateCcw, Megaphone, Pencil
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
  // 对方在线状态（私聊用）
  const [otherOnline, setOtherOnline] = useState(false);

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
    }
  }, [conversationId, user]);

  const loadMessages = useCallback(async () => {
    if (!conversationId || !user) return;
    const msgs = await getMessages(conversationId, 50);
    setMessages(msgs);
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

  const handleRecall = async (msg: Message) => {
    if (msg.sender_id !== user?.id) return;
    const age = new Date().getTime() - new Date(msg.created_at).getTime();
    if (age > 2 * 60 * 1000) { toast.error('超过2分钟，无法撤回'); return; }
    const { error } = await recallMessage(msg.id);
    if (error) toast.error('撤回失败：' + error.message);
    else setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, is_recalled: true, content: '[已撤回]' } : m));
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
      </div>

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
              <div className={`flex items-end gap-2 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
                {!isMine && (
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
                <div className={`flex flex-col max-w-[70%] ${isMine ? 'items-end' : 'items-start'}`}>
                  {!isMine && conv?.type === 'group' && (
                    <span className="text-xs text-muted-foreground mb-1 ml-1">
                      {(msg.sender as any)?.nickname || (msg.sender as any)?.username}
                    </span>
                  )}
                  {msg.is_recalled ? (
                    <div className="px-3 py-1.5 rounded-xl bg-muted text-muted-foreground text-xs italic">已撤回</div>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <div className={`px-3 py-2 text-sm cursor-pointer select-text ${isMine ? 'bubble-right' : 'bubble-left'}`}>
                          {msg.message_type === 'image'
                            ? <img src={msg.image_url ?? ''} alt="图片" className="max-w-[200px] max-h-[200px] rounded-lg object-cover" />
                            : <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
                        </div>
                      </DropdownMenuTrigger>
                      {canRecall && (
                        <DropdownMenuContent align={isMine ? 'end' : 'start'}>
                          <DropdownMenuItem onClick={() => handleRecall(msg)}>
                            <RotateCcw className="w-4 h-4 mr-2" />撤回消息
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      )}
                    </DropdownMenu>
                  )}
                  {isMine && !msg.is_recalled && conv?.type === 'private' && (
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
          <Textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="发送消息…"
            className="flex-1 min-h-[40px] max-h-32 resize-none text-sm border-0 bg-muted focus-visible:ring-0 rounded-xl px-3 py-2"
            rows={1} />
          <Button onClick={handleSend} disabled={sending || !input.trim()} size="icon" className="h-9 w-9 rounded-full shrink-0">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* 群公告编辑弹窗已内联到群组详情 Sheet 中 */}
    </div>
  );
}

