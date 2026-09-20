# 江苏省高校教师资格岗前培训刷题 PWA

## 直接使用（推荐）
本项目是纯静态网页，可部署到 GitHub Pages、Cloudflare Pages、Netlify 等 HTTPS 静态网站。

### GitHub Pages
1. 新建一个 GitHub 仓库，例如 `js-teacher-quiz`。
2. 把本压缩包内的所有文件上传到仓库根目录。
3. GitHub 仓库进入 Settings → Pages。
4. Source 选择 “Deploy from a branch”，Branch 选择 `main` / `(root)`。
5. 保存后等待页面给出 `https://你的用户名.github.io/js-teacher-quiz/`。
6. iPhone / iPad 用 Safari 打开该网址 → 分享 → 添加到主屏幕。

## 离线
首次在线打开后，Service Worker 会缓存题库和程序。之后从主屏幕图标进入，网络断开时仍可刷题。

## 本机数据
默认使用浏览器 localStorage 保存：作答记录、错题、收藏、掌握度、学习统计、每日学习记录等。

## 三端云同步（可选）
1. 创建 Supabase 项目。
2. 在 SQL Editor 运行 `supabase_schema.sql`。
3. 在刷题 App → “我的” → “Supabase 三端同步”中填写 Project URL、Anon public key、邮箱和密码。
4. 注册/登录后，可手动“上传进度”“下载进度”。

说明：题库中单选、多选原文主要是“题干 + 标准答案”，没有完整 A/B/C/D 原始选项。程序保留标准答案，并从同科目答案池生成干扰项。干扰项不是题库原文。

## 文件
- index.html：入口
- styles.css：iPhone / iPad / Mac 响应式界面
- questions.js：1100 道结构化题库
- app.js：刷题逻辑
- manifest.json：PWA 配置
- sw.js：离线缓存
- icons/：主屏幕图标
- supabase_schema.sql：可选云同步数据库表与 RLS
