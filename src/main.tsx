import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AppWrapper } from "./components/common/PageMeta.tsx";
import "./index.css";

Sentry.init({
  dsn: import.meta.env['VITE_SENTRY_DSN'] as string | undefined,
  environment: import.meta.env.MODE,
});

// 锁定视口高度 CSS 变量，防止手机键盘收起时页面跳动
// 只在首次加载和横竖屏切换时更新，不响应键盘引发的 resize
function setAppHeight() {
  document.documentElement.style.setProperty('--app-h', `${window.innerHeight}px`);
}
setAppHeight();
window.addEventListener('orientationchange', () => {
  // 横竖屏切换时等动画结束后再更新
  setTimeout(setAppHeight, 300);
});

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={<p>应用发生错误，请刷新页面重试</p>}>
    <AppWrapper>
      <App />
    </AppWrapper>
  </Sentry.ErrorBoundary>
);
