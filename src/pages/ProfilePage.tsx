import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { updateProfile, uploadAvatar } from '@/services/api';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { Camera, Save, LogOut, User } from 'lucide-react';

export default function ProfilePage() {
  const { user, profile, signOut, refreshProfile } = useAuth();
  const [nickname, setNickname] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

          <Button variant="secondary" className="w-full h-11 gap-2 mt-2" onClick={handleSignOut}>
            <LogOut className="w-4 h-4" />
            退出登录
          </Button>
        </div>
      </div>
    </div>
  );
}
