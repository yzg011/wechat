import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { updateProfile, uploadAvatar, getBlockedUsers, unblockUser } from '@/services/api';
import type { BlockedUserEntry } from '@/services/api';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Camera, Save, LogOut, KeyRound, Eye, EyeOff, ShieldOff, Ban } from 'lucide-react';
import { supabase } from '@/db/supabase';

export default function ProfilePage() {
  const { user, profile, signOut, refreshProfile } = useAuth();
  const [nickname, setNickname] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 修改密码弹窗状态
  const [pwdOpen, setPwdOpen] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [changingPwd, setChangingPwd] = useState(false);

  // 黑名单弹窗状态
  const [blacklistOpen, setBlacklistOpen] = useState(false);
  const [blockedList, setBlockedList] = useState<BlockedUserEntry[]>([]);
  const [blacklistLoading, setBlacklistLoading] = useState(false);
  const [unblockTarget, setUnblockTarget] = useState<BlockedUserEntry | null>(null);

  const loadBlockedList = useCallback(async () => {
    if (!user) return;
    setBlacklistLoading(true);
    const list = await getBlockedUsers(user.id);
    setBlockedList(list);
    setBlacklistLoading(false);
  }, [user]);

  useEffect(() => {
    if (profile) {
      setNickname(profile.nickname || '');
      setBio(profile.bio || '');
    }
  }, [profile]);

  const handleSave = async () => {
    if (!user) return;
    if (!nickname.trim()) { toast.error('昵称不能为空'); return; }
    setSaving(true);
    const { error } = await updateProfile(user.id, { nickname: nickname.trim(), bio: bio.trim() });
    setSaving(false);
    if (error) { toast.error('保存失败：' + error.message); return; }
    await refreshProfile();
    toast.success('资料已更新');
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (!['image/jpeg','image/png','image/gif','image/webp','image/avif'].includes(file.type)) {
      toast.error('不支持的图片格式');
      return;
    }
    setUploadProgress(5);
    const { url, error } = await uploadAvatar(user.id, file, p => setUploadProgress(p));
    if (error || !url) { toast.error('头像上传失败，请重试'); setUploadProgress(0); return; }
    const { error: updateErr } = await updateProfile(user.id, { avatar_url: url });
    setUploadProgress(0);
    if (updateErr) { toast.error('保存头像失败'); return; }
    await refreshProfile();
    toast.success(`头像更新成功（${(file.size / 1024).toFixed(0)} KB）`);
    e.target.value = '';
  };

  const handleSignOut = async () => {
    await signOut();
    toast.success('已退出登录');
  };

  const handleUnblock = async () => {
    if (!user || !unblockTarget) return;
    const { error } = await unblockUser(user.id, unblockTarget.blocked_id);
    if (error) { toast.error('解除拉黑失败'); return; }
    toast.success(`已解除对 ${unblockTarget.profile.nickname} 的拉黑`);
    setUnblockTarget(null);
    setBlockedList(prev => prev.filter(b => b.id !== unblockTarget.id));
  };

  const handleChangePassword = async () => {
    if (!newPwd || !confirmPwd) { toast.error('请填写所有密码字段'); return; }
    if (newPwd.length < 6) { toast.error('新密码至少需要 6 位'); return; }
    if (newPwd !== confirmPwd) { toast.error('两次输入的新密码不一致'); return; }
    setChangingPwd(true);
    // 先用当前密码重新验证身份
    const email = user?.email;
    if (email && currentPwd) {
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password: currentPwd });
      if (signInErr) {
        setChangingPwd(false);
        toast.error('当前密码不正确');
        return;
      }
    }
    const { error } = await supabase.auth.updateUser({ password: newPwd });
    setChangingPwd(false);
    if (error) { toast.error('修改失败：' + error.message); return; }
    toast.success('密码修改成功');
    setPwdOpen(false);
    setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
  };

  if (!profile) return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 顶部 */}
      <div className="bg-card border-b border-border px-4 py-3 pl-16 md:pl-4">
        <h1 className="text-base font-semibold text-foreground">个人中心</h1>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {/* 头像区域 */}
        <div className="bg-card flex flex-col items-center py-10 border-b border-border">
          <div className="relative">
            <Avatar className="w-24 h-24">
              <AvatarImage src={profile.avatar_url ?? ''} alt={profile.nickname} />
              <AvatarFallback className="bg-primary text-primary-foreground text-3xl font-bold">
                {(profile.nickname || profile.username || '?').charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="absolute bottom-0 right-0 w-8 h-8 bg-primary text-white rounded-full flex items-center justify-center shadow hover:bg-secondary transition-colors"
            >
              <Camera className="w-4 h-4" />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          </div>

          {uploadProgress > 0 && (
            <div className="mt-3 w-40">
              <Progress value={uploadProgress} className="h-1.5" />
              <p className="text-xs text-muted-foreground text-center mt-1">上传中 {uploadProgress}%</p>
            </div>
          )}

          <p className="mt-4 text-lg font-semibold text-foreground">{profile.nickname || profile.username}</p>
          <p className="text-sm text-muted-foreground">@{profile.username}</p>
        </div>

        {/* 编辑表单 */}
        <div className="p-6 space-y-5 max-w-lg mx-auto">
          <div className="space-y-1.5">
            <Label htmlFor="edit-nickname">昵称</Label>
            <Input
              id="edit-nickname"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              placeholder="输入昵称"
              maxLength={30}
              className="h-11"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-username">用户名</Label>
            <Input
              id="edit-username"
              value={profile.username}
              disabled
              className="h-11 bg-muted text-muted-foreground"
            />
            <p className="text-xs text-muted-foreground">用户名不可修改</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-bio">个人简介</Label>
            <Textarea
              id="edit-bio"
              value={bio}
              onChange={e => setBio(e.target.value)}
              placeholder="介绍一下自己…"
              maxLength={100}
              rows={3}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground text-right">{bio.length}/100</p>
          </div>

          <Button className="w-full h-11 gap-2" onClick={handleSave} disabled={saving}>
            <Save className="w-4 h-4" />
            {saving ? '保存中…' : '保存修改'}
          </Button>

          {/* 修改密码 */}
          <Dialog open={pwdOpen} onOpenChange={o => { setPwdOpen(o); if (!o) { setCurrentPwd(''); setNewPwd(''); setConfirmPwd(''); } }}>
            <DialogTrigger asChild>
              <Button variant="secondary" className="w-full h-11 gap-2">
                <KeyRound className="w-4 h-4" />
                修改密码
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
              <DialogHeader><DialogTitle>修改登录密码</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-2">
                {/* 当前密码 */}
                <div className="space-y-1.5">
                  <Label htmlFor="pwd-current">当前密码</Label>
                  <div className="relative">
                    <Input
                      id="pwd-current"
                      type={showCurrent ? 'text' : 'password'}
                      value={currentPwd}
                      onChange={e => setCurrentPwd(e.target.value)}
                      placeholder="输入当前密码"
                      className="h-11 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrent(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                {/* 新密码 */}
                <div className="space-y-1.5">
                  <Label htmlFor="pwd-new">新密码</Label>
                  <div className="relative">
                    <Input
                      id="pwd-new"
                      type={showNew ? 'text' : 'password'}
                      value={newPwd}
                      onChange={e => setNewPwd(e.target.value)}
                      placeholder="至少 6 位"
                      className="h-11 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNew(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                {/* 确认新密码 */}
                <div className="space-y-1.5">
                  <Label htmlFor="pwd-confirm">确认新密码</Label>
                  <div className="relative">
                    <Input
                      id="pwd-confirm"
                      type={showConfirm ? 'text' : 'password'}
                      value={confirmPwd}
                      onChange={e => setConfirmPwd(e.target.value)}
                      placeholder="再次输入新密码"
                      className="h-11 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <Button className="w-full h-11" disabled={changingPwd} onClick={handleChangePassword}>
                  {changingPwd ? '修改中…' : '确认修改'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Button variant="secondary" className="w-full h-11 gap-2" onClick={handleSignOut}>
            <LogOut className="w-4 h-4" />
            退出登录
          </Button>

          {/* 黑名单管理 */}
          <Dialog open={blacklistOpen} onOpenChange={o => { setBlacklistOpen(o); if (o) loadBlockedList(); }}>
            <DialogTrigger asChild>
              <Button variant="secondary" className="w-full h-11 gap-2">
                <Ban className="w-4 h-4" />
                黑名单管理
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
              <DialogHeader><DialogTitle>黑名单</DialogTitle></DialogHeader>
              <div className="mt-2 min-h-[120px]">
                {blacklistLoading ? (
                  <div className="space-y-3">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <Skeleton className="w-10 h-10 rounded-full shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-3 w-16" />
                        </div>
                        <Skeleton className="w-16 h-8 rounded-md shrink-0" />
                      </div>
                    ))}
                  </div>
                ) : blockedList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
                    <ShieldOff className="w-10 h-10 opacity-30" />
                    <p className="text-sm">黑名单为空</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {blockedList.map(entry => (
                      <div key={entry.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted">
                        <Avatar className="w-10 h-10 shrink-0">
                          <AvatarImage src={entry.profile.avatar_url ?? ''} />
                          <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                            {entry.profile.nickname.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{entry.profile.nickname}</p>
                          <p className="text-xs text-muted-foreground truncate">@{entry.profile.username}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs shrink-0"
                          onClick={() => setUnblockTarget(entry)}
                        >
                          解除拉黑
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* 解除拉黑确认 */}
      <AlertDialog open={!!unblockTarget} onOpenChange={o => { if (!o) setUnblockTarget(null); }}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>解除拉黑</AlertDialogTitle>
            <AlertDialogDescription>
              确定解除对 <span className="font-medium text-foreground">{unblockTarget?.profile.nickname}</span> 的拉黑？解除后对方可以再次向您发送消息。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleUnblock}>确定解除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
