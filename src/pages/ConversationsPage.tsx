import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import { getUnreadCount, isOnline, createInviteLink, getMyInviteLinks, revokeInviteLink } from '@/services/api';
import type { Conversation, Message, Profile, Group, InviteLink } from '@/types/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { MessageCircle, Link2, Copy, X, Plus, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';

/** 获取会话的最后一条对当前用户可见的消息摘要 */
async function getLastVisibleMessage(
  convId: string, userId: string
): Promise<{ content: string; created_at: string | null }> {
  // 先拿该用户在本会话中已删除的消息 ID
  const { data: deletions } = await supabase
    .from('message_deletions')
    .select('message_id, messages!inner(conversation_id)')
    .eq('user_id', userId)
    .eq('messages.conversation_id', convId);
  const deletedIds = new Set<string>((deletions ?? []).map((d: any) => d.message_id));

  // 取最近几条消息，跳过已删除的
  const { data: msgs } = await supabase
    .from('messages')
    .select('id, content, message_type, created_at, is_recalled')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: false })
    .limit(10);

  const visible = (msgs ?? []).find((m: any) => !deletedIds.has(m.id));
  if (!visible) return { content: '暂无消息', created_at: null };
  const v = visible as any;
  const content = v.is_recalled ? '[已撤回]' : v.message_type === 'image' ? '[图片]' : (v.content || '暂无消息');
  return { content, created_at: v.created_at };
}

interface ConvItem {
  id: string;
  type: 'private' | 'group';
  name: string;
  avatarUrl: string | null;
  lastMessage: string;
  lastTime: string | null;
  unread: number;
  otherUserId?: string;
  otherLastSeen?: string | null;
}

export default function ConversationsPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<ConvItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 邀请链接管理
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([]);
  const [creatingLink, setCreatingLink] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadInviteLinks = useCallback(async () => {
    if (!user) return;
    const links = await getMyInviteLinks(user.id);
    setInviteLinks(links);
  }, [user]);

  const handleCreateLink = async () => {
    if (!user) return;
    setCreatingLink(true);
    const { data, error } = await createInviteLink(user.id);
    setCreatingLink(false);
    if (error || !data) { toast.error('创建失败，请重试'); return; }
    setInviteLinks(prev => [data, ...prev]);
    toast.success('邀请链接已生成');
  };

  const handleCopy = (link: InviteLink) => {
    const url = `${window.location.origin}/invite/${link.token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(link.id);
      toast.success('链接已复制');
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleRevoke = async (link: InviteLink) => {
    const { error } = await revokeInviteLink(link.id);
    if (error) { toast.error('撤销失败'); return; }
    setInviteLinks(prev => prev.map(l => l.id === link.id ? { ...l, status: 'revoked' as const } : l));
    toast.success('邀请链接已撤销');
  };

  const handleOpenInvite = () => {
    setInviteOpen(true);
    loadInviteLinks();
  };

  const loadConversations = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // 获取私聊会话（通过participants）
      const { data: participantRows } = await supabase
        .from('conversation_participants')
        .select('conversation_id, conversations!inner(id, type, group_id, updated_at)')
        .eq('user_id', user.id)
        .eq('conversations.type', 'private')
        .order('conversations(updated_at)', { ascending: false })
        .limit(50);

      // 获取群聊会话（通过group_members）
      const { data: groupMemberRows } = await supabase
        .from('group_members')
        .select('group_id, groups(id, name, avatar_url)')
        .eq('user_id', user.id)
        .limit(50);

      const convItems: ConvItem[] = [];

      // 处理私聊
      if (Array.isArray(participantRows)) {
        for (const row of participantRows as any[]) {
          const convId = row.conversation_id;
          // 找对方
          const { data: otherParticipant } = await supabase
            .from('conversation_participants')
            .select('user_id, profiles!conversation_participants_user_id_fkey(id,nickname,avatar_url,username,last_seen_at)')
            .eq('conversation_id', convId)
            .neq('user_id', user.id)
            .maybeSingle();

          const otherProfile = (otherParticipant as any)?.profiles;
          // 获取最后一条对当前用户可见的消息
          const { content: lastMsgContent, created_at: lastMsgTime } =
            await getLastVisibleMessage(convId, user.id);

          const unread = await getUnreadCount(convId, user.id);

          convItems.push({
            id: convId,
            type: 'private',
            name: otherProfile?.nickname || otherProfile?.username || '未知用户',
            avatarUrl: otherProfile?.avatar_url || null,
            lastMessage: lastMsgContent,
            lastTime: lastMsgTime,
            unread,
            otherUserId: otherProfile?.id,
            otherLastSeen: otherProfile?.last_seen_at || null,
          });
        }
      }

      // 处理群聊
      if (Array.isArray(groupMemberRows)) {
        for (const row of groupMemberRows as any[]) {
          const group = (row as any).groups;
          if (!group) continue;
          // 找对应的群聊 conversation
          const { data: convData } = await supabase
            .from('conversations')
            .select('id, updated_at')
            .eq('type', 'group')
            .eq('group_id', group.id)
            .maybeSingle();

          if (!convData) continue;
          // 获取最后一条对当前用户可见的消息
          const { content: lastMsgContent, created_at: lastMsgTime } =
            await getLastVisibleMessage((convData as any).id, user.id);

          const unread = await getUnreadCount((convData as any).id, user.id);

          convItems.push({
            id: (convData as any).id,
            type: 'group',
            name: group.name,
            avatarUrl: group.avatar_url || null,
            lastMessage: lastMsgContent,
            lastTime: lastMsgTime || (convData as any).updated_at,
            unread,
          });
        }
      }

      // 按最后消息时间排序
      convItems.sort((a, b) => {
        if (!a.lastTime) return 1;
        if (!b.lastTime) return -1;
        return new Date(b.lastTime).getTime() - new Date(a.lastTime).getTime();
      });

      setItems(convItems);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // 监听新消息，实时更新
  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel('conv-list-updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        loadConversations();
      })
      // 监听本用户 last_read_at 变更，及时清除已读角标
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'conversation_participants',
        filter: `user_id=eq.${user.id}`,
      }, () => {
        loadConversations();
      })
      // 监听群聊写入（UPSERT 为 INSERT）
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'conversation_participants',
        filter: `user_id=eq.${user.id}`,
      }, () => {
        loadConversations();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, loadConversations]);

  const handleClick = (item: ConvItem) => {
    navigate(`/chat/${item.id}`);
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 顶部标题 */}
      <div className="bg-card border-b border-border px-4 py-3 pl-16 md:pl-4 flex items-center justify-between">
        <h1 className="text-base font-semibold text-foreground">消息</h1>
        <Button variant="ghost" size="icon" className="w-8 h-8" onClick={handleOpenInvite} title="邀请链接">
          <Link2 className="w-4 h-4" />
        </Button>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex flex-col gap-0">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 bg-card border-b border-border">
                <Skeleton className="w-12 h-12 rounded-full shrink-0" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <MessageCircle className="w-14 h-14 opacity-30" />
            <p className="text-sm">暂无会话，去联系人页添加好友开始聊天吧</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {items.map(item => (
              <button
                key={item.id}
                onClick={() => handleClick(item)}
                className="flex items-center gap-3 px-4 py-3 bg-card border-b border-border hover:bg-muted transition-colors text-left w-full"
              >
                {/* 头像 */}
                <div className="relative shrink-0">
                  <Avatar className="w-12 h-12">
                    <AvatarImage src={item.avatarUrl ?? ''} alt={item.name} />
                    <AvatarFallback className="bg-primary text-primary-foreground font-medium">
                      {item.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  {item.type === 'private' && (
                    <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-card ${isOnline(item.otherLastSeen ?? null) ? 'bg-green-500' : 'bg-gray-400'}`} />
                  )}
                  {item.type === 'group' && (
                    <span className="absolute -bottom-0.5 -right-0.5 bg-accent text-white text-[8px] rounded px-0.5">群</span>
                  )}
                </div>

                {/* 内容 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm text-foreground truncate">{item.name}</span>
                    {item.lastTime && (
                      <span className="text-xs text-muted-foreground shrink-0 ml-2">
                        {formatDistanceToNow(new Date(item.lastTime), { locale: zhCN, addSuffix: false })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <p className="text-xs text-muted-foreground truncate flex-1 min-w-0">{item.lastMessage}</p>
                    {item.unread > 0 && (
                      <span className="unread-badge ml-2 shrink-0">{item.unread > 99 ? '99+' : item.unread}</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 邀请链接管理弹窗 */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="w-4 h-4" />临时聊天邀请
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-1">
            分享链接给对方，对方点击后输入昵称即可与您聊天，无需注册账号。
          </p>

          {/* 创建按钮 */}
          <Button className="w-full gap-2" onClick={handleCreateLink} disabled={creatingLink}>
            <Plus className="w-4 h-4" />
            {creatingLink ? '生成中…' : '生成新邀请链接'}
          </Button>

          {/* 链接列表 */}
          {inviteLinks.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {inviteLinks.map(link => {
                const url = `${window.location.origin}/invite/${link.token}`;
                const isActive = link.status === 'active';
                return (
                  <div
                    key={link.id}
                    className={`rounded-lg border p-3 text-xs ${isActive ? 'border-border bg-muted/40' : 'border-border/50 bg-muted/20 opacity-60'}`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}>
                        {isActive ? '有效' : '已撤销'}
                      </span>
                      <span className="text-muted-foreground">
                        {formatDistanceToNow(new Date(link.created_at), { locale: zhCN, addSuffix: true })}创建
                      </span>
                    </div>
                    <p className="text-muted-foreground truncate font-mono mb-2">{url}</p>
                    <div className="flex gap-2">
                      {isActive && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 text-xs gap-1 flex-1"
                            onClick={() => handleCopy(link)}
                          >
                            {copiedId === link.id
                              ? <><CheckCheck className="w-3 h-3" />已复制</>
                              : <><Copy className="w-3 h-3" />复制链接</>
                            }
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                            onClick={() => handleRevoke(link)}
                          >
                            <X className="w-3 h-3" />撤销
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {inviteLinks.length === 0 && !creatingLink && (
            <p className="text-center text-sm text-muted-foreground py-2">暂无邀请链接，点击上方按钮创建</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
