## Vibe
- WeChat Functionalism：以微信标志性浅灰背景 + 纯绿功能色为核心，融合 Dieter Rams 功能主义——每个视觉元素都有且只有一个用途，无装饰噪音

## Color
- Primary: #07C160
- On Primary: #FFFFFF
- Accent: #576B95
- On Accent: #FFFFFF
- Background: #EDEDED
- Foreground: #191919
- Muted: #F7F7F7
- Border: #D9D9D9
- Secondary: #07A050

## Typography
- Heading: OPPOSans (family: OPPOSans, weight: Bold, url: https://resource-static.bj.bcebos.com/fonts-skill/OPPOSans4.0.ttf)
- Body: OPPOSans (family: OPPOSans, weight: Regular, url: https://resource-static.bj.bcebos.com/fonts-skill/OPPOSans4.0.ttf)

## Visual Language
- 核心视觉签名：会话列表行左侧头像圆形裁切 + 右侧双行字重对比（昵称 font-medium / 最后消息 text-muted 细体），仿微信排版节奏
- 材质与深度：白色内容卡（bg-card）浮于浅灰页面（bg-background #EDEDED）之上，无阴影，以背景色差产生层次；顶部导航 bg-card + border-bottom
- 容器与按钮：会话气泡右侧（自己）用 Primary 绿色填充+白字，左侧（对方）用白色填充+深色字；主操作按钮实心绿；次操作 Muted 底；输入框无边框悬浮在白色 toolbar 上
- 布局节奏：三栏（导航 sidebar 64px 图标条 + 列表区 320px + 聊天主区 flex-1）；移动端折叠为单栏栈式路由；消息列表大量留白，气泡最大宽度 70%

## Animation
- 入场：会话列表项 fade-in + translateX(8px→0) stagger 40ms，duration 200ms ease-out
- 交互：气泡发送 scale(0.95→1) + opacity(0→1) 150ms；未读角标数字 scale bounce 200ms
- 过渡：页面切换 slide-left/right 250ms ease-in-out

## Forbidden
- 禁大块 Primary 绿色铺满背景或 Hero 区域
- 禁通用卡片阴影 box-shadow，层次只靠背景灰差值
- 禁 Emoji 作为功能图标，统一使用 lucide-react

## Additional Notes
- 所有用户可见文案使用中文
- 登录页：分屏布局，左侧品牌插画区（深绿渐变底+白色微信风图标），右侧纯白表单区
- 消息气泡尾巴用 CSS clip-path 或 border-trick 模拟，不用图片
- 头像统一圆形裁切，未设置头像显示昵称首字 + Primary 绿底
- 未读消息红点角标：bg-red-500 → 使用 CSS variable --badge-bg: #FA5151（微信红）
