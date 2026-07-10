import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  getFriends, getPendingRequests, searchUsers,
  sendFriendRequest, respondFriendRequest, checkFriendship,
  getOrCreatePrivateConversation, getOrCreateGroupConversation,
  getMyGroups, createGroup, unfriendAndDeleteConversation, leaveGroup, deleteGroup
} from '@/services/api';
import type { Profile, Friendship, Group } from '@/types/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { UserPlus, Search, Users, Check, X, ChevronRight, MoreVertical, Trash2, LogOut, MessageCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function ContactsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [friends, setFriends] = useState<Profile[]>([]);
  const [requests, setRequests] = useState<Friendship[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  // 搜索
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<{ profile: Profile; relation: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // 创建群组
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [creatingGroup, setCreatingGroup] = useState(false);

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'friend'; id: string; name: string } | { type: 'group'; id: string; name: string; isOwner: boolean } | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [f, r, g] = await Promise.all([
      getFriends(user.id),
      getPendingRequests(user.id),
      getMyGroups(user.id),
    ]);
    setFriends(Array.isArray(f) ? f : []);
    setRequests(Array.isArray(r) ? r : []);
    setGroups(Array.isArray(g) ? g : []);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = async () => {
    if (!searchQ.trim() || !user) return;
    setSearching(true);
    const results = await searchUsers(searchQ.trim());
    const filtered = results.filter(p => p.id !== user.id);
    const withRelation = await Promise.all(
      filtered.map(async p => ({ profile: p, relation: await checkFriendship(user.id, p.id) }))
    );
    setSearchResults(withRelation);
    setSearching(false);
  };

  const handleAddFriend = async (addresseeId: string) => {
    if (!user) return;
    const { error } = await sendFriendRequest(user.id, addresseeId);
    if (error) { toast.error('发送失败：' + error.message); return; }
    toast.success('好友请求已发送');
    setSearchResults(prev => prev.map(r => r.profile.id === addresseeId ? { ...r, relation: 'pending_sent' } : r));
  };

  const handleRespond = async (id: string, status: 'accepted' | 'rejected') => {
    const { error } = await respondFriendRequest(id, status);
    if (error) { toast.error('操作失败'); return; }
    toast.success(status === 'accepted' ? '已同意好友请求' : '已拒绝好友请求');
    load();
  };

  const handleChat = async (friendId: string) => {
    const convId = await getOrCreatePrivateConversation(friendId);
    if (convId) navigate(`/chat/${convId}`);
    else toast.error('无法打开聊天，请重试');
  };

  const handleGroupChat = async (g: Group) => {
    const convId = g.conversation_id ?? await getOrCreateGroupConversation(g.id);
    if (convId) navigate(`/chat/${convId}`);
    else toast.error('找不到群聊会话，请重试');
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) { toast.error('请输入群组名称'); return; }
    if (selectedFriends.length === 0) { toast.error('请至少选择一位好友'); return; }
    if (!user) return;
    setCreatingGroup(true);
    const { conversationId, error } = await createGroup(groupName.trim(), user.id, selectedFriends);
    setCreatingGroup(false);
    if (error) { toast.error('创建失败：' + error.message); return; }
    toast.success('群组创建成功');
    setCreateGroupOpen(false);
    setGroupName('');
    setSelectedFriends([]);
    load();
    if (conversationId) navigate(`/chat/${conversationId}`);
    else toast.info('群组已创建，请在群组列表中点击进入聊天');
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !user) return;
    if (deleteTarget.type === 'friend') {
      const { error } = await unfriendAndDeleteConversation(user.id, deleteTarget.id);
      if (error) { toast.error('删除失败：' + error.message); }
      else { toast.success(`已删除好友 ${deleteTarget.name}`); load(); }
    } else {
      if (deleteTarget.isOwner) {
        const { error } = await deleteGroup(deleteTarget.id);
        if (error) { toast.error('解散失败：' + error.message); }
        else { toast.success(`群组「${deleteTarget.name}」已解散`); load(); }
      } else {
        const { error } = await leaveGroup(deleteTarget.id, user.id);
        if (error) { toast.error('退出失败：' + error.message); }
        else { toast.success(`已退出群组「${deleteTarget.name}」`); load(); }
      }
    }
    setDeleteTarget(null);
  };

  const relationLabel: Record<string, string> = {
    'none': '添加好友',
    'pending_sent': '已发送',
    'pending_received': '待接受',
    'accepted': '已是好友',
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 顶部 */}
      <div className="bg-card border-b border-border px-4 py-3 pl-16 md:pl-4 flex items-center justify-between">
        <h1 className="text-base font-semibold text-foreground">联系人</h1>
        <div className="flex gap-2">
          {/* 搜索好友 */}
          <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="w-8 h-8"><UserPlus className="w-4 h-4" /></Button>
            </DialogTrigger>
            <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
              <DialogHeader><DialogTitle>添加好友</DialogTitle></DialogHeader>
              <div className="flex gap-2 mt-2">
                <Input placeholder="搜索用户名或昵称" value={searchQ} onChange={e => setSearchQ(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()} className="flex-1" />
                <Button onClick={handleSearch} disabled={searching}><Search className="w-4 h-4" /></Button>
              </div>
              <div className="mt-3 space-y-2 max-h-72 overflow-y-auto">
                {searchResults.map(({ profile: p, relation }) => (
                  <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted">
                    <Avatar className="w-10 h-10 shrink-0">
                      <AvatarImage src={p.avatar_url ?? ''} alt={p.nickname} />
                      <AvatarFallback className="bg-primary text-primary-foreground">{p.nickname.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{p.nickname}</p>
                      <p className="text-xs text-muted-foreground">@{p.username}</p>
                    </div>
                    <Button size="sm" variant={relation === 'none' ? 'default' : 'secondary'}
                      disabled={relation !== 'none'}
                      onClick={() => relation === 'none' && handleAddFriend(p.id)}>
                      {relationLabel[relation]}
                    </Button>
                  </div>
                ))}
                {searchResults.length === 0 && searchQ && !searching && (
                  <p className="text-sm text-muted-foreground text-center py-4">未找到该用户</p>
                )}
              </div>
            </DialogContent>
          </Dialog>

          {/* 创建群组 */}
          <Dialog open={createGroupOpen} onOpenChange={setCreateGroupOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="w-8 h-8"><Users className="w-4 h-4" /></Button>
            </DialogTrigger>
            <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
              <DialogHeader><DialogTitle>创建群组</DialogTitle></DialogHeader>
              <Input placeholder="群组名称" value={groupName} onChange={e => setGroupName(e.target.value)} className="mt-2" />
              <p className="text-sm text-muted-foreground mt-3 mb-2">选择好友（至少1位）</p>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {friends.map(f => (
                  <label key={f.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted cursor-pointer">
                    <input type="checkbox" className="accent-primary w-4 h-4"
                      checked={selectedFriends.includes(f.id)}
                      onChange={e => setSelectedFriends(prev => e.target.checked ? [...prev, f.id] : prev.filter(id => id !== f.id))} />
                    <Avatar className="w-8 h-8 shrink-0">
                      <AvatarImage src={f.avatar_url ?? ''} alt={f.nickname} />
                      <AvatarFallback className="bg-primary text-primary-foreground text-xs">{f.nickname.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{f.nickname}</span>
                  </label>
                ))}
              </div>
              <Button className="mt-4 w-full" onClick={handleCreateGroup} disabled={creatingGroup}>
                {creatingGroup ? '创建中…' : '创建群组'}
              </Button>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* 标签页 */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-background">
        <Tabs defaultValue="friends" className="h-full">
          <TabsList className="w-full rounded-none border-b border-border bg-card h-10 shrink-0">
            <TabsTrigger value="friends" className="flex-1 text-sm">
              好友 {friends.length > 0 && <span className="ml-1 text-muted-foreground">({friends.length})</span>}
            </TabsTrigger>
            <TabsTrigger value="requests" className="flex-1 text-sm">
              好友请求 {requests.length > 0 && <span className="ml-1 unread-badge">{requests.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="groups" className="flex-1 text-sm">
              群组 {groups.length > 0 && <span className="ml-1 text-muted-foreground">({groups.length})</span>}
            </TabsTrigger>
          </TabsList>

          {/* 好友列表 */}
          <TabsContent value="friends" className="mt-0">
            {loading ? (
              <div className="p-4 space-y-3">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
              </div>
            ) : friends.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <UserPlus className="w-12 h-12 opacity-30" />
                <p className="text-sm">还没有好友，点击右上角添加</p>
              </div>
            ) : (
              <div className="flex flex-col">
                {friends.map(f => (
                  <div key={f.id} className="flex items-center gap-3 px-4 py-3 bg-card border-b border-border hover:bg-muted transition-colors">
                    <div className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer" onClick={() => handleChat(f.id)}>
                      <Avatar className="w-11 h-11 shrink-0">
                        <AvatarImage src={f.avatar_url ?? ''} alt={f.nickname} />
                        <AvatarFallback className="bg-primary text-primary-foreground">{f.nickname.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{f.nickname}</p>
                        <p className="text-xs text-muted-foreground">@{f.username}</p>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="w-8 h-8 shrink-0" onClick={e => e.stopPropagation()}>
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleChat(f.id)}>
                          <MessageCircle className="w-4 h-4 mr-2" />发消息
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteTarget({ type: 'friend', id: f.id, name: f.nickname })}>
                          <Trash2 className="w-4 h-4 mr-2" />删除好友
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* 好友请求 */}
          <TabsContent value="requests" className="mt-0">
            {requests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <Check className="w-12 h-12 opacity-30" />
                <p className="text-sm">暂无好友请求</p>
              </div>
            ) : (
              <div className="flex flex-col">
                {requests.map(req => {
                  const requester = (req as any).requester as Profile;
                  return (
                    <div key={req.id} className="flex items-center gap-3 px-4 py-3 bg-card border-b border-border">
                      <Avatar className="w-11 h-11 shrink-0">
                        <AvatarImage src={requester?.avatar_url ?? ''} alt={requester?.nickname} />
                        <AvatarFallback className="bg-primary text-primary-foreground">{requester?.nickname?.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{requester?.nickname}</p>
                        <p className="text-xs text-muted-foreground">@{requester?.username}</p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" onClick={() => handleRespond(req.id, 'accepted')}>
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => handleRespond(req.id, 'rejected')}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* 群组 */}
          <TabsContent value="groups" className="mt-0">
            {groups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <Users className="w-12 h-12 opacity-30" />
                <p className="text-sm">暂无群组，点击右上角创建</p>
              </div>
            ) : (
              <div className="flex flex-col">
                {groups.map(g => {
                  const isOwner = g.owner_id === user?.id;
                  return (
                    <div key={g.id} className="flex items-center gap-3 px-4 py-3 bg-card border-b border-border hover:bg-muted transition-colors">
                      <div className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer" onClick={() => handleGroupChat(g)}>
                        <Avatar className="w-11 h-11 shrink-0">
                          <AvatarImage src={g.avatar_url ?? ''} alt={g.name} />
                          <AvatarFallback className="bg-accent text-accent-foreground">{g.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{g.name}</p>
                          <p className="text-xs text-muted-foreground">{isOwner ? '群主' : '成员'}</p>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="w-8 h-8 shrink-0" onClick={e => e.stopPropagation()}>
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleGroupChat(g)}>
                            <MessageCircle className="w-4 h-4 mr-2" />进入群聊
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget({ type: 'group', id: g.id, name: g.name, isOwner })}>
                            {isOwner
                              ? <><Trash2 className="w-4 h-4 mr-2" />解散群组</>
                              : <><LogOut className="w-4 h-4 mr-2" />退出群组</>}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* 删除/退出确认弹窗 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.type === 'friend' ? '删除好友' :
                deleteTarget?.type === 'group' && deleteTarget.isOwner ? '解散群组' : '退出群组'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === 'friend'
                ? `确定要删除好友「${deleteTarget.name}」吗？删除后需重新发送好友请求。`
                : deleteTarget?.type === 'group' && deleteTarget?.isOwner
                  ? `确定要解散群组「${deleteTarget.name}」吗？此操作不可恢复，所有聊天记录将被清除。`
                  : `确定要退出群组「${deleteTarget?.name}」吗？`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleConfirmDelete}>
              确定
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
