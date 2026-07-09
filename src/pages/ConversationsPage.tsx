import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import { getUnreadCount, isOnline } from '@/services/api';
import type { Conversation, Message, Profile, Group } from '@/types/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { MessageCircle } from 'lucide-react';

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
          // 获取最后一条消息
          const { data: lastMsg } = await supabase
            .from('messages')
            .select('content, message_type, created_at, is_recalled')
            .eq('conversation_id', convId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          const unread = await getUnreadCount(convId, user.id);

          convItems.push({
            id: convId,
            type: 'private',
            name: otherProfile?.nickname || otherProfile?.username || '未知用户',
            avatarUrl: otherProfile?.avatar_url || null,
            lastMessage: (lastMsg as any)?.is_recalled ? '[已撤回]' : (lastMsg as any)?.message_type === 'image' ? '[图片]' : ((lastMsg as any)?.content || '暂无消息'),
            lastTime: (lastMsg as any)?.created_at || null,
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
          const { data: lastMsg } = await supabase
            .from('messages')
            .select('content, message_type, created_at')
            .eq('conversation_id', (convData as any).id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          const unread = await getUnreadCount((convData as any).id, user.id);

          convItems.push({
            id: (convData as any).id,
            type: 'group',
            name: group.name,
            avatarUrl: group.avatar_url || null,
            lastMessage: (lastMsg as any)?.is_recalled ? '[已撤回]' : (lastMsg as any)?.message_type === 'image' ? '[图片]' : ((lastMsg as any)?.content || '暂无消息'),
            lastTime: (lastMsg as any)?.created_at || (convData as any).updated_at,
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
    const channel = supabase.channel('conv-list-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
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
      <div className="bg-card border-b border-border px-4 py-3 pl-16 md:pl-4">
        <h1 className="text-base font-semibold text-foreground">消息</h1>
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
    </div>
  );
}
