import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { updateUserLocation, findNearbyUsers, getFriends, isOnline, getOrCreatePrivateConversation } from '@/services/api';
import type { NearbyUser } from '@/services/api';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { MapPin, RefreshCw, Navigation, MessageCircle, Loader2, Users, UserCheck } from 'lucide-react';

type PageState = 'idle' | 'locating' | 'loading' | 'done' | 'denied';
type TabType = 'stranger' | 'friend';

interface TaggedUser extends NearbyUser { isFriend: boolean; }

export default function NearbyPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [pageState, setPageState] = useState<PageState>('idle');
  const [nearby, setNearby] = useState<TaggedUser[]>([]);
  const [radius, setRadius] = useState('5');
  const [chatLoading, setChatLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('stranger');

  const fetchNearby = useCallback(async (lat: number, lng: number, r: number) => {
    if (!user) return;
    setPageState('loading');
    // 先更新自己的位置，同时拉取附近用户和好友列表
    const [, users, friends] = await Promise.all([
      updateUserLocation(user.id, lat, lng),
      findNearbyUsers(lat, lng, r),
      getFriends(user.id),
    ]);
    const friendIds = new Set(friends.map(f => f.id));
    setNearby(users.map(u => ({ ...u, isFriend: friendIds.has(u.id) })));
    setPageState('done');
  }, [user]);

  const requestLocation = useCallback(async (r?: number) => {
    const km = r ?? Number(radius);
    setPageState('locating');
    if (!navigator.geolocation) {
      toast.error('您的浏览器不支持定位功能');
      setPageState('idle');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => fetchNearby(pos.coords.latitude, pos.coords.longitude, km),
      err => {
        console.error('geolocation error', err);
        toast.error('获取位置失败，请检查浏览器定位权限');
        setPageState('denied');
      },
      { timeout: 10_000, maximumAge: 60_000 }
    );
  }, [radius, fetchNearby]);

  // 进页面自动触发定位
  useEffect(() => {
    requestLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRadiusChange = (val: string) => {
    setRadius(val);
    requestLocation(Number(val));
  };

  const handleChat = async (targetId: string) => {
    if (!user) return;
    setChatLoading(targetId);
    const convId = await getOrCreatePrivateConversation(targetId);
    setChatLoading(null);
    if (!convId) { toast.error('发起聊天失败'); return; }
    navigate(`/chat/${convId}`);
  };

  const formatDistance = (km: number) => {
    if (km < 1) return `${Math.round(km * 1000)} 米`;
    return `${km.toFixed(1)} 公里`;
  };

  const strangers = nearby.filter(u => !u.isFriend);
  const friends = nearby.filter(u => u.isFriend);
  const listToShow = activeTab === 'stranger' ? strangers : friends;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 顶部栏 */}
      <div className="bg-card border-b border-border px-4 py-3 pl-16 md:pl-4 flex items-center justify-between gap-3 shrink-0">
        <h1 className="text-base font-semibold text-foreground">附近的人</h1>
        <div className="flex items-center gap-2 shrink-0">
          <Select value={radius} onValueChange={handleRadiusChange} disabled={pageState === 'locating' || pageState === 'loading'}>
            <SelectTrigger className="h-8 text-xs w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 公里内</SelectItem>
              <SelectItem value="3">3 公里内</SelectItem>
              <SelectItem value="5">5 公里内</SelectItem>
              <SelectItem value="10">10 公里内</SelectItem>
              <SelectItem value="50">50 公里内</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="w-8 h-8 shrink-0"
            onClick={() => requestLocation()}
            disabled={pageState === 'locating' || pageState === 'loading'}
            title="刷新"
          >
            <RefreshCw className={`w-4 h-4 ${(pageState === 'locating' || pageState === 'loading') ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="bg-card border-b border-border px-4 flex gap-0 shrink-0">
        <button
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'stranger'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('stranger')}
        >
          <Users className="w-4 h-4" />
          陌生人
          {pageState === 'done' && (
            <span className="ml-1 text-xs bg-muted rounded-full px-1.5 py-0.5 text-muted-foreground">{strangers.length}</span>
          )}
        </button>
        <button
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'friend'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('friend')}
        >
          <UserCheck className="w-4 h-4" />
          好友
          {pageState === 'done' && (
            <span className="ml-1 text-xs bg-muted rounded-full px-1.5 py-0.5 text-muted-foreground">{friends.length}</span>
          )}
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto min-h-0">

        {/* 定位中 / 加载中骨架 */}
        {(pageState === 'locating' || pageState === 'loading') && (
          <div className="flex flex-col gap-0">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 bg-card border-b border-border">
                <Skeleton className="w-12 h-12 rounded-full shrink-0" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="w-14 h-8 rounded-md shrink-0" />
              </div>
            ))}
          </div>
        )}

        {/* 需要权限 */}
        {pageState === 'denied' && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground px-8 text-center">
            <Navigation className="w-14 h-14 opacity-30" />
            <p className="text-sm font-medium text-foreground">无法获取位置</p>
            <p className="text-xs">请在浏览器设置中允许访问位置信息，然后点击刷新按钮重试。</p>
            <Button variant="secondary" className="gap-2" onClick={() => requestLocation()}>
              <RefreshCw className="w-4 h-4" />重试
            </Button>
          </div>
        )}

        {/* 列表为空 */}
        {pageState === 'done' && listToShow.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            {activeTab === 'stranger'
              ? <Users className="w-14 h-14 opacity-30" />
              : <UserCheck className="w-14 h-14 opacity-30" />
            }
            <p className="text-sm">
              {activeTab === 'stranger'
                ? `${radius} 公里内暂无陌生人`
                : `${radius} 公里内暂无好友`
              }
            </p>
            {activeTab === 'stranger' && <p className="text-xs">试试扩大搜索范围？</p>}
          </div>
        )}

        {/* 用户列表 */}
        {pageState === 'done' && listToShow.length > 0 && (
          <div className="flex flex-col">
            {/* 范围提示 */}
            <div className="px-4 py-2 bg-muted/40 border-b border-border">
              <p className="text-xs text-muted-foreground">
                <MapPin className="w-3 h-3 inline-block mr-1 -mt-0.5" />
                {radius} 公里内
                {activeTab === 'stranger' ? `陌生人 ${strangers.length} 人` : `好友 ${friends.length} 人`}
              </p>
            </div>

            {listToShow.map(person => (
              <div
                key={person.id}
                className="flex items-center gap-3 px-4 py-3 bg-card border-b border-border"
              >
                {/* 头像 */}
                <div className="relative shrink-0">
                  <Avatar className="w-12 h-12">
                    <AvatarImage src={person.avatar_url ?? ''} alt={person.nickname} />
                    <AvatarFallback className="bg-primary text-primary-foreground font-medium">
                      {person.nickname.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-card ${isOnline(person.last_seen_at) ? 'bg-green-500' : 'bg-gray-400'}`} />
                </div>

                {/* 信息 */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-foreground truncate">{person.nickname}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {person.bio || `@${person.username}`}
                  </p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3 text-primary shrink-0" />
                    <span className="text-xs text-primary font-medium">{formatDistance(person.distance_km)}</span>
                  </div>
                </div>

                {/* 操作按钮 */}
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 text-xs gap-1.5 shrink-0"
                  onClick={() => handleChat(person.id)}
                  disabled={chatLoading === person.id}
                >
                  {chatLoading === person.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <MessageCircle className="w-3.5 h-3.5" />
                  }
                  {person.isFriend ? '发消息' : '打招呼'}
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* 初始状态 */}
        {pageState === 'idle' && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
            <MapPin className="w-14 h-14 opacity-30" />
            <Button className="gap-2" onClick={() => requestLocation()}>
              <Navigation className="w-4 h-4" />开启定位查看附近
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
