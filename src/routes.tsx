// Routes for the application - MainLayout handles all authenticated sub-routes
import { lazy, Suspense } from 'react';
import type { ReactNode } from 'react';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const MainLayout = lazy(() => import('./components/layouts/MainLayout'));
const InvitePage = lazy(() => import('./pages/InvitePage'));

export interface RouteConfig {
  name: string;
  path: string;
  element: ReactNode;
  visible?: boolean;
  public?: boolean;
}

const Loading = () => (
  <div className="flex items-center justify-center min-h-screen bg-background">
    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
  </div>
);

const wrap = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

export const routes: RouteConfig[] = [
  { name: '登录', path: '/login', element: wrap(<LoginPage />), public: true },
  { name: '邀请加入', path: '/invite/:token', element: wrap(<InvitePage />), public: true },
  { name: '主界面', path: '/*', element: wrap(<MainLayout />), public: false },
];
