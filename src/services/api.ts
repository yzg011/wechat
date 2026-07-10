import { supabase } from '@/db/supabase';
import type { Profile, Friendship, Group, GroupMember, Conversation, Message, Moment, MomentLike, MomentComment } from '@/types/types';

// ==================== 用户/Profile ====================
export async function searchUsers(query: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .or(`username.ilike.%${query}%,nickname.ilike.%${query}%`)
    .order('nickname', { ascending: true })
    .limit(20);
  if (error) { console.error('searchUsers error', error); return []; }
  return Array.isArray(data) ? data : [];
}

export async function getProfile(id: string): Promise<Profile | null> {
  const { data } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
  return data;
}

export async function updateProfile(id: string, updates: Partial<Pick<Profile, 'nickname' | 'avatar_url' | 'bio'>>): Promise<{ error: Error | null }> {
  const { error } = await supabase.from('profiles').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id);
  return { error: error as Error | null };
}

// ==================== 好友关系 ====================
export async function getFriends(userId: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('friendships')
    .select('requester_id, addressee_id, requester:profiles!friendships_requester_id_fkey(*), addressee:profiles!friendships_addressee_id_fkey(*)')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .order('created_at', { ascending: false });
  if (error) { console.error('getFriends error', error); return []; }
  if (!Array.isArray(data)) return [];
  return data.map((f: any) => (f.requester_id === userId ? f.addressee : f.requester)).filter(Boolean);
}

export async function getPendingRequests(userId: string): Promise<Friendship[]> {
  const { data, error } = await supabase
    .from('friendships')
    .select('*, requester:profiles!friendships_requester_id_fkey(*)')
    .eq('addressee_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) { console.error('getPendingRequests error', error); return []; }
  return Array.isArray(data) ? data : [];
}

export async function getSentRequests(userId: string): Promise<Friendship[]> {
  const { data } = await supabase
    .from('friendships')
    .select('*, addressee:profiles!friendships_addressee_id_fkey(*)')
    .eq('requester_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(50);
  return Array.isArray(data) ? data : [];
}

export async function sendFriendRequest(requesterId: string, addresseeId: string): Promise<{ error: Error | null }> {
  const { error } = await supabase.from('friendships').insert({ requester_id: requesterId, addressee_id: addresseeId });
  return { error: error as Error | null };
}

export async function respondFriendRequest(friendshipId: string, status: 'accepted' | 'rejected'): Promise<{ error: Error | null }> {
  const { error } = await supabase.from('friendships').update({ status, updated_at: new Date().toISOString() }).eq('id', friendshipId);
  return { error: error as Error | null };
}

export async function checkFriendship(uid1: string, uid2: string): Promise<'none' | 'pending_sent' | 'pending_received' | 'accepted'> {
  const { data } = await supabase
    .from('friendships')
    .select('*')
    .or(`and(requester_id.eq.${uid1},addressee_id.eq.${uid2}),and(requester_id.eq.${uid2},addressee_id.eq.${uid1})`)
    .maybeSingle();
  if (!data) return 'none';
  if (data.status === 'accepted') return 'accepted';
  if (data.status === 'pending') return data.requester_id === uid1 ? 'pending_sent' : 'pending_received';
  return 'none';
}

// ==================== 群组 ====================
export async function createGroup(name: string, ownerIid: string, memberIds: string[]): Promise<{ data: Group | null; conversationId: string | null; error: Error | null }> {
  const { data: group, error } = await supabase
    .from('groups')
    .insert({ name, owner_id: ownerIid })
    .select()
    .maybeSingle();
  if (error || !group) return { data: null, conversationId: null, error: error as Error };
  const members = [ownerIid, ...memberIds.filter(id => id !== ownerIid)].map(uid => ({ group_id: group.id, user_id: uid }));
  await supabase.from('group_members').insert(members);
  // 创建群聊会话并返回 ID
  const { data: conv } = await supabase
    .from('conversations')
    .insert({ type: 'group', group_id: group.id })
    .select('id')
    .maybeSingle();
  return { data: group, conversationId: (conv as any)?.id ?? null, error: null };
}

export async function getOrCreateGroupConversation(groupId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_or_create_group_conversation', { p_group_id: groupId });
  if (error) { console.error('getOrCreateGroupConversation error', error); return null; }
  return data as string;
}

export async function deleteMessage(msgId: string): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from('messages')
    .delete()
    .eq('id', msgId);
  return { error: error as Error | null };
}

/** 对他人消息"仅对我删除"：写入 message_deletions */
export async function hideMessageForMe(userId: string, msgId: string): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from('message_deletions')
    .insert({ user_id: userId, message_id: msgId });
  return { error: error as Error | null };
}

/** 加载该用户已删除的消息 ID 集合 */
export async function getMyDeletedMessageIds(userId: string, convId: string): Promise<Set<string>> {
  // 通过 messages 表过滤出属于该会话的 deletion 记录
  const { data } = await supabase
    .from('message_deletions')
    .select('message_id, messages!inner(conversation_id)')
    .eq('user_id', userId)
    .eq('messages.conversation_id', convId);
  const ids = new Set<string>();
  (data ?? []).forEach((row: any) => ids.add(row.message_id));
  return ids;
}

/** 删除好友关系并同时清除两人之间的私聊会话（调用 SECURITY DEFINER RPC） */
export async function unfriendAndDeleteConversation(
  _myId: string, otherId: string, _conversationId?: string
): Promise<{ error: Error | null }> {
  const { error } = await supabase.rpc('unfriend_and_delete_conversation', { other_user_id: otherId });
  return { error: error as Error | null };
}

export async function blockUser(blockerId: string, blockedId: string): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from('blocked_users')
    .insert({ blocker_id: blockerId, blocked_id: blockedId });
  return { error: error as Error | null };
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from('blocked_users')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId);
  return { error: error as Error | null };
}

export interface BlockedUserEntry {
  id: string;
  blocked_id: string;
  created_at: string;
  profile: { id: string; nickname: string; username: string; avatar_url: string | null };
}

export async function getBlockedUsers(myId: string): Promise<BlockedUserEntry[]> {
  const { data, error } = await supabase
    .from('blocked_users')
    .select('id, blocked_id, created_at, profile:profiles!blocked_users_blocked_id_fkey(id, nickname, username, avatar_url)')
    .eq('blocker_id', myId)
    .order('created_at', { ascending: false });
  if (error) { console.error('getBlockedUsers error', error); return []; }
  return (data ?? []) as unknown as BlockedUserEntry[];
}

export async function clearConversationMessages(convId: string): Promise<{ error: Error | null }> {
  const { error } = await supabase.rpc('clear_conversation_messages', { p_conv_id: convId });
  return { error: error as Error | null };
}

export async function deleteFriendship(myId: string, otherId: string): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from('friendships')
    .delete()
    .or(`and(requester_id.eq.${myId},addressee_id.eq.${otherId}),and(requester_id.eq.${otherId},addressee_id.eq.${myId})`);
  return { error: error as Error | null };
}

export async function leaveGroup(groupId: string, userId: string): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId);
  return { error: error as Error | null };
}

export async function deleteGroup(groupId: string): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from('groups')
    .delete()
    .eq('id', groupId);
  return { error: error as Error | null };
}

export async function getMyGroups(userId: string): Promise<Group[]> {
  const { data, error } = await supabase
    .from('group_members')
    .select('group_id, groups(*, conversations(id))')
    .eq('user_id', userId)
    .order('joined_at', { ascending: false })
    .limit(100);
  if (error) { console.error('getMyGroups error', error); return []; }
  if (!Array.isArray(data)) return [];
  return data.map((d: any) => {
    const g = d.groups;
    if (!g) return null;
    const convId = Array.isArray(g.conversations) ? g.conversations[0]?.id : g.conversations?.id;
    return { ...g, conversation_id: convId ?? null } as Group;
  }).filter(Boolean) as Group[];
}

export async function getGroupMembers(groupId: string): Promise<GroupMember[]> {
  const { data } = await supabase
    .from('group_members')
    .select('*, profile:profiles!group_members_user_id_fkey(*)')
    .eq('group_id', groupId)
    .order('joined_at', { ascending: true })
    .limit(200);
  return Array.isArray(data) ? data : [];
}

export async function addGroupMember(groupId: string, userId: string): Promise<{ error: Error | null }> {
  const { error } = await supabase.from('group_members').insert({ group_id: groupId, user_id: userId });
  return { error: error as Error | null };
}

export async function removeGroupMember(groupId: string, userId: string): Promise<{ error: Error | null }> {
  const { error } = await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', userId);
  return { error: error as Error | null };
}

// ==================== 会话 ====================
export async function getConversations(userId: string): Promise<Conversation[]> {
  // 私聊会话
  const { data: privConvs } = await supabase
    .from('conversation_participants')
    .select('conversation_id, last_read_at, conversations!inner(id, type, group_id, created_at, updated_at)')
    .eq('user_id', userId)
    .eq('conversations.type', 'private')
    .order('conversations(updated_at)', { ascending: false })
    .limit(50);

  // 群聊会话
  const { data: grpConvs } = await supabase
    .from('conversations')
    .select('*, groups!inner(id, name, avatar_url, owner_id)')
    .eq('type', 'group')
    .order('updated_at', { ascending: false })
    .limit(50);

  const privIds = Array.isArray(privConvs) ? privConvs.map((p: any) => p.conversation_id) : [];
  const grpData = Array.isArray(grpConvs) ? grpConvs.filter((g: any) => {
    // 只返回用户是成员的群聊会话（由RLS保证，这里直接用）
    return true;
  }) : [];

  return [...privIds.map((id: string) => ({ id, type: 'private' as const, group_id: null, created_at: '', updated_at: '' })),
          ...grpData.map((g: any) => ({ id: g.id, type: 'group' as const, group_id: g.group_id, group: g.groups, created_at: g.created_at, updated_at: g.updated_at }))];
}

export async function getOrCreatePrivateConversation(otherUserId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_or_create_private_conversation', { other_user_id: otherUserId });
  if (error) { console.error('getOrCreatePrivateConversation error', error); return null; }
  return data as string;
}

export async function getConversationDetails(convId: string, userId: string): Promise<Conversation | null> {
  const { data } = await supabase
    .from('conversations')
    .select('*, conversation_participants(*, profile:profiles!conversation_participants_user_id_fkey(*)), groups(*)')
    .eq('id', convId)
    .maybeSingle();
  if (!data) return null;
  const conv = data as any;
  let otherUser: Profile | undefined;
  if (conv.type === 'private' && Array.isArray(conv.conversation_participants)) {
    const other = conv.conversation_participants.find((p: any) => p.user_id !== userId);
    otherUser = other?.profile;
  }
  // Supabase 返回的关联字段名是 "groups"（表名），统一重命名为 "group" 供前端使用
  const { groups, ...rest } = conv;
  return { ...rest, group: groups ?? undefined, other_user: otherUser };
}

export async function markConversationRead(convId: string, userId: string): Promise<void> {
  // UPSERT：若群聊成员尚无 conversation_participants 行则先创建再更新
  await supabase
    .from('conversation_participants')
    .upsert(
      { conversation_id: convId, user_id: userId, last_read_at: new Date().toISOString() },
      { onConflict: 'conversation_id,user_id' }
    );
}

export async function getUnreadCount(convId: string, userId: string): Promise<number> {
  const { data: participant } = await supabase
    .from('conversation_participants')
    .select('last_read_at')
    .eq('conversation_id', convId)
    .eq('user_id', userId)
    .maybeSingle();
  const lastRead = (participant as any)?.last_read_at;
  let query = supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', convId)
    .neq('sender_id', userId);
  if (lastRead) query = query.gt('created_at', lastRead);
  const { count } = await query;
  return count ?? 0;
}

// ==================== 消息 ====================
export async function getMessages(convId: string, limit = 50, before?: string): Promise<Message[]> {
  let query = supabase
    .from('messages')
    .select('*, sender:profiles!messages_sender_id_fkey(id,username,nickname,avatar_url)')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) { console.error('getMessages error', error); return []; }
  return Array.isArray(data) ? data.reverse() : [];
}

export async function sendMessage(convId: string, senderId: string, content: string, type: 'text' | 'image' | 'emoji' = 'text', imageUrl?: string): Promise<{ data: Message | null; error: Error | null }> {
  const payload: any = {
    conversation_id: convId,
    sender_id: senderId,
    message_type: type,
    is_read: false,
  };
  if (type === 'text' || type === 'emoji') payload.content = content;
  if (type === 'image') { payload.image_url = imageUrl; payload.content = '[图片]'; }
  const { data, error } = await supabase.from('messages').insert(payload).select('*, sender:profiles!messages_sender_id_fkey(id,username,nickname,avatar_url)').maybeSingle();
  // 更新会话时间
  if (!error) await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId);
  return { data: data as Message | null, error: error as Error | null };
}

export async function markMessagesRead(convId: string, receiverId: string): Promise<void> {
  await supabase.from('messages').update({ is_read: true }).eq('conversation_id', convId).neq('sender_id', receiverId).eq('is_read', false);
}

// ==================== 在线状态 ====================
export function isOnline(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false;
  return new Date().getTime() - new Date(lastSeenAt).getTime() < 5 * 60 * 1000;
}

export async function updateLastSeen(userId: string): Promise<void> {
  await supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', userId);
}

// ==================== 消息撤回 ====================
export async function recallMessage(messageId: string): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from('messages')
    .update({ is_recalled: true, recalled_at: new Date().toISOString(), content: '[已撤回]' })
    .eq('id', messageId);
  return { error: error as Error | null };
}

// ==================== 群组公告 ====================
export async function updateGroupAnnouncement(groupId: string, announcement: string): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from('groups')
    .update({ announcement, updated_at: new Date().toISOString() })
    .eq('id', groupId);
  return { error: error as Error | null };
}

// ==================== 朋友圈 ====================
export async function getMoments(limit = 30): Promise<Moment[]> {
  const { data, error } = await supabase
    .from('moments')
    .select(`*, author:profiles!moments_user_id_fkey(id,username,nickname,avatar_url),
      likes:moment_likes(id,user_id,created_at,user:profiles!moment_likes_user_id_fkey(id,nickname,avatar_url)),
      comments:moment_comments(id,user_id,content,created_at,user:profiles!moment_comments_user_id_fkey(id,nickname,avatar_url))`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('getMoments error', error); return []; }
  const { data: authData } = await supabase.auth.getUser();
  const me = authData?.user?.id;
  return (Array.isArray(data) ? data : []).map((m: any) => ({
    ...m,
    likes_count: m.likes?.length ?? 0,
    comments_count: m.comments?.length ?? 0,
    liked_by_me: me ? (m.likes ?? []).some((l: any) => l.user_id === me) : false,
  }));
}

export async function createMoment(userId: string, content: string, imageUrls: string[]): Promise<{ error: Error | null }> {
  const { error } = await supabase.from('moments').insert({ user_id: userId, content, image_urls: imageUrls });
  return { error: error as Error | null };
}

export async function deleteMoment(momentId: string): Promise<{ error: Error | null }> {
  const { error } = await supabase.from('moments').delete().eq('id', momentId);
  return { error: error as Error | null };
}

export async function toggleLike(momentId: string, userId: string, liked: boolean): Promise<{ error: Error | null }> {
  if (liked) {
    const { error } = await supabase.from('moment_likes').delete().eq('moment_id', momentId).eq('user_id', userId);
    return { error: error as Error | null };
  } else {
    const { error } = await supabase.from('moment_likes').insert({ moment_id: momentId, user_id: userId });
    return { error: error as Error | null };
  }
}

export async function addComment(momentId: string, userId: string, content: string): Promise<{ error: Error | null }> {
  const { error } = await supabase.from('moment_comments').insert({ moment_id: momentId, user_id: userId, content });
  return { error: error as Error | null };
}

export async function deleteComment(commentId: string): Promise<{ error: Error | null }> {
  const { error } = await supabase.from('moment_comments').delete().eq('id', commentId);
  return { error: error as Error | null };
}

export async function uploadMomentImage(userId: string, file: File, onProgress?: (p: number) => void): Promise<{ url: string | null; error: Error | null }> {
  onProgress?.(10);
  const compressed = await compressImage(file).catch(() => file);
  onProgress?.(40);
  const ext = compressed.type === 'image/webp' ? 'webp' : file.name.split('.').pop() || 'jpg';
  const path = `${userId}/moment_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const { data, error } = await supabase.storage.from('chat-images').upload(path, compressed, { contentType: compressed.type, upsert: false });
  if (error) return { url: null, error: error as Error };
  onProgress?.(90);
  const { data: urlData } = supabase.storage.from('chat-images').getPublicUrl(data.path);
  onProgress?.(100);
  return { url: urlData.publicUrl, error: null };
}
async function compressImage(file: File, maxSizeMB = 1): Promise<File> {
  if (file.size <= maxSizeMB * 1024 * 1024) return file;
  const { default: imageCompression } = await import('browser-image-compression');
  return imageCompression(file, { maxSizeMB, maxWidthOrHeight: 1080, useWebWorker: true, fileType: 'image/webp', initialQuality: 0.8 });
}

export async function uploadAvatar(userId: string, file: File, onProgress?: (p: number) => void): Promise<{ url: string | null; error: Error | null }> {
  onProgress?.(10);
  const compressed = await compressImage(file).catch(() => file);
  onProgress?.(40);
  const ext = compressed.type === 'image/webp' ? 'webp' : file.name.split('.').pop() || 'jpg';
  const path = `${userId}/avatar_${Date.now()}.${ext}`;
  const { data, error } = await supabase.storage.from('avatars').upload(path, compressed, { contentType: compressed.type, upsert: true });
  if (error) return { url: null, error: error as Error };
  onProgress?.(90);
  const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(data.path);
  onProgress?.(100);
  return { url: urlData.publicUrl, error: null };
}

export async function uploadChatImage(userId: string, file: File, onProgress?: (p: number) => void): Promise<{ url: string | null; error: Error | null }> {
  onProgress?.(10);
  const compressed = await compressImage(file).catch(() => file);
  onProgress?.(40);
  const ext = compressed.type === 'image/webp' ? 'webp' : file.name.split('.').pop() || 'jpg';
  const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const { data, error } = await supabase.storage.from('chat-images').upload(path, compressed, { contentType: compressed.type });
  if (error) return { url: null, error: error as Error };
  onProgress?.(90);
  const { data: urlData } = supabase.storage.from('chat-images').getPublicUrl(data.path);
  onProgress?.(100);
  return { url: urlData.publicUrl, error: null };
}

// ==================== 邀请链接 ====================
export async function createInviteLink(userId: string): Promise<{ data: import('@/types/types').InviteLink | null; error: Error | null }> {
  const { data, error } = await supabase
    .from('invite_links')
    .insert({ created_by: userId })
    .select()
    .single();
  if (error) return { data: null, error: error as Error };
  return { data, error: null };
}

export async function getMyInviteLinks(userId: string): Promise<import('@/types/types').InviteLink[]> {
  const { data } = await supabase
    .from('invite_links')
    .select('*')
    .eq('created_by', userId)
    .order('created_at', { ascending: false });
  return (data ?? []) as import('@/types/types').InviteLink[];
}

export async function revokeInviteLink(id: string): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from('invite_links')
    .update({ status: 'revoked' })
    .eq('id', id);
  return { error: error as Error | null };
}

export async function getInviteLinkByToken(token: string): Promise<import('@/types/types').InviteLink | null> {
  const { data } = await supabase
    .from('invite_links')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  return data as import('@/types/types').InviteLink | null;
}

export async function joinViaInvite(token: string, nickname: string): Promise<{ conversationId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('join_via_invite', { p_token: token, p_nickname: nickname });
  if (error) return { conversationId: null, error: error.message };
  const result = data as { conversation_id?: string; error?: string; success?: boolean };
  if (result.error) return { conversationId: null, error: result.error };
  return { conversationId: result.conversation_id ?? null, error: null };
}

// ==================== 附近的人 ====================
export async function updateUserLocation(userId: string, lat: number, lng: number): Promise<void> {
  await supabase
    .from('profiles')
    .update({ latitude: lat, longitude: lng, location_updated_at: new Date().toISOString() })
    .eq('id', userId);
}

export interface NearbyUser {
  id: string;
  username: string;
  nickname: string;
  avatar_url: string | null;
  bio: string;
  last_seen_at: string | null;
  distance_km: number;
}

export async function findNearbyUsers(lat: number, lng: number, radiusKm = 5): Promise<NearbyUser[]> {
  const { data, error } = await supabase.rpc('find_nearby_users', {
    p_lat: lat,
    p_lng: lng,
    p_radius_km: radiusKm,
    p_limit: 50,
  });
  if (error) { console.error('find_nearby_users error', error); return []; }
  return (data ?? []) as NearbyUser[];
}

// ==================== 心有灵犀 ====================
export interface TelepathyResult {
  status: 'matched' | 'waiting' | 'error';
  conversation_id?: string;
  match_count?: number;
  message?: string;
}
export interface TelepathyStatus {
  keyword: string;
  status: 'matched' | 'waiting';
  conversation_id: string | null;
  created_at: string;
}

export async function submitTelepathyKeyword(keyword: string): Promise<TelepathyResult> {
  const { data, error } = await supabase.rpc('submit_telepathy_keyword', { p_keyword: keyword });
  if (error) return { status: 'error', message: error.message };
  return data as TelepathyResult;
}

export async function getMyTelepathyStatus(): Promise<TelepathyStatus | null> {
  const { data, error } = await supabase.rpc('get_my_telepathy_status');
  if (error || !data) return null;
  return data as TelepathyStatus;
}
