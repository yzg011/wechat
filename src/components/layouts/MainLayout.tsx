import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { MessageCircle, Users, User, LogOut, Menu, ImageIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { updateLastSeen } from '@/services/api';
import ConversationsPage from '@/pages/ConversationsPage';
import ContactsPage from '@/pages/ContactsPage';
import ChatPage from '@/pages/ChatPage';
import ProfilePage from '@/pages/ProfilePage';
import MomentsPage from '@/pages/MomentsPage';

const NAV_ITEMS = [
  { icon: MessageCircle, label: '聊天', path: '/chat' },
  { icon: Users, label: '联系人', path: '/contacts' },
  { icon: ImageIcon, label: '朋友圈', path: '/moments' },
  { icon: User, label: '我', path: '/profile' },
];

function NavItem({ icon: Icon, label, path, active, onClick }: { icon: any; label: string; path: string; active: boolean; onClick?: () => void }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => { navigate(path); onClick?.(); }}
      className={`flex flex-col items-center gap-1 py-3 px-2 w-full rounded-lg transition-colors ${
        active ? 'bg-sidebar-accent text-white' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-white'
      }`}
    >
      <Icon className="w-5 h-5" />
      <span className="text-[10px]">{label}</span>
    </button>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { profile, signOut } = useAuth();
  const location = useLocation();

  const handleSignOut = async () => {
    await signOut();
    toast.success('已退出登录');
  };

  return (
    <div className="flex flex-col h-full bg-sidebar py-3 px-2 gap-1">
      {/* 用户头像 */}
      <div className="flex flex-col items-center pb-3 mb-2 border-b border-sidebar-border">
        <Avatar className="w-9 h-9">
          <AvatarImage src={profile?.avatar_url ?? ''} alt={profile?.nickname} />
          <AvatarFallback className="bg-primary text-primary-foreground text-sm">
            {(profile?.nickname || profile?.username || '?').charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </div>

      {/* 导航项 */}
      <div className="flex flex-col gap-1 flex-1">
        {NAV_ITEMS.map(item => (
          <NavItem
            key={item.path}
            icon={item.icon}
            label={item.label}
            path={item.path}
            active={location.pathname.startsWith(item.path)}
            onClick={onNavigate}
          />
        ))}
      </div>

      {/* 退出 */}
      <button
        onClick={handleSignOut}
        className="flex flex-col items-center gap-1 py-3 px-2 w-full rounded-lg text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-white transition-colors"
      >
        <LogOut className="w-5 h-5" />
        <span className="text-[10px]">退出</span>
      </button>
    </div>
  );
}

export default function MainLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();

  // 心跳：每30秒更新在线状态
  useEffect(() => {
    if (!user) return;
    updateLastSeen(user.id);
    const timer = setInterval(() => updateLastSeen(user.id), 30_000);
    return () => clearInterval(timer);
  }, [user]);

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* 桌面端侧边导航 */}
      <aside className="hidden md:flex flex-col w-16 shrink-0 h-screen sticky top-0">
        <Sidebar />
      </aside>

      {/* 移动端导航 */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden fixed top-3 left-3 z-40 bg-card shadow-sm"
          >
            <Menu className="w-5 h-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-20 p-0 bg-sidebar border-sidebar-border [&>button]:hidden">
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* 主内容区 */}
      <div className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
        <Routes>
          <Route path="chat" element={<ConversationsPage />} />
          <Route path="chat/:conversationId" element={<ChatPage />} />
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="moments" element={<MomentsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="chat" replace />} />
        </Routes>
      </div>
    </div>
  );
}
