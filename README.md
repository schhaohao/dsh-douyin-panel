# dsh-douyin-panel

在 DSH Web GUI 右侧内嵌一个 iPhone 比例的竖屏抖音推荐流面板 —— vibe coding 不再无聊。

## 它是怎么工作的

抖音网页版带有 `X-Frame-Options: DENY` 和只允许自家域名的 CSP `frame-ancestors`，
浏览器里直接 `<iframe src="https://www.douyin.com">` 必然被拒。本插件由两半绕过：

默认宽度 ≈ **iframe 内容无横向滚动条的最小宽度**：镜像页内的 shim 每 700ms 实测
`scrollWidth − clientWidth` = 底部滑条精确的溢出像素并经 postMessage 上报，
面板按「现宽 + 溢出」一步加宽到刚好无条。这个通道**只加宽不收缩**——
响应式页面无法从页内量出别的真实断点宽度，反过来缩会在断点间打摆；
想回最窄状态：**双击把手归零重来**，上报在两个 tick 内把宽度重新收敛到
「正好无滑条的最小宽度」。把手自由拖拽（只守 120 下限，无上限，本轮可用空间封顶）。
镜像以 iPhone Safari UA 请求上游，抖音返回的就是竖屏移动端网页。

布局是真·**挤压关系**，不是悬浮覆盖：打开抖音时插件接管 AppFrame grid 的第三轨
（观测 frame 元素 + 代理其列宽，离开时原样奉还）——左侧栏自动收成 56px 控制栏、
**抖音栏保持自己的宽度，中间对话区对应收缩**让位，拖动把手时整个 grid 跟着
手势一起挤压，全程踩着 frame 自己的轨道曲线动画。窗口不够时的让步链：对话区
退到 240 最后底线（官方 details 守 640，这里按需求不守）→ 抖音栏才被退让
（下限 120）→ 连 120 都容不下才整体藏起（iframe 永不卸载，拉宽自动回归）。
边界是柔和阴影 + 渐变细线 + 悬浮把手，不是一根突兀的线。开合状态与自定义宽度
记忆在 localStorage。

| 半 | 文件 | 职责 |
|---|---|---|
| host 半 | `src/index.mjs` | 在 `127.0.0.1:<随机端口>` 起一个**循环回环镜像**：全量反代 `https://www.douyin.com`（以 iPhone UA，丢弃桌面 client-hints），剥掉 XFO/CSP 响应头与 CSP meta，改写 Set-Cookie（去 Domain/Secure、SameSite=None→Lax）与 Location，注入 shim（绝对地址拉回镜像源 + scrollWidth 上报）；并通过主服务器的 `GET /douyin-panel/meta` 把镜像地址告诉 GUI |
| client 半 | `src/client/index.tsx` → `lib/client.js` | 注册一个 **additive 的 `shell.overlay` 槽位条目**：右缘「抖音」竖排标签 → 点开就是上述面板（自由拖宽、双击回原始宽、刷新、外开、收起） |

iframe 指向**镜像端口而不是 GUI 的 3080**：抖音的代码因此跑在独立 origin 上，
永远摸不到 GUI 的 `/api` 桥（安全边界就是端口，不靠运气）。视频流字节仍然
直连抖音 CDN，只有页面/API 流量走本地镜像。

## 载入方式（本机已装好的状态）

- 包本体：`~/Documents/dsh/douyin-panel（或你的 fork 目录）`
- profile 链接：`~/.dsh/profiles/web/node_modules/dsh-douyin-panel` → 上面的目录
- 组合层：`~/.dsh/profiles/web/cordis.patch.yml` 里的 `insert` 行（被 `watchUserPatches` 热应用）

卸载：把 `cordis.patch.yml` 改回 `[]`（插件连同镜像端口一起热卸载），需要的话再删链接与目录。

## 首次使用

1. 刷新 GUI 页面（`http://127.0.0.1:3080`）。
2. 点右缘「抖音」标签。
3. **如果弹出滑块验证码，拖一次即可** —— 那是抖音对全新匿名会话的例行人机校验；
   通过后的凭证写进镜像源的 cookie 罐，之后长期免验证。
4. 登录/扫码链路未走通（跨 origin），匿名推荐流就是全部功能边界。

## 改代码之后

```sh
# client 半（面板 UI）改完：
npx tsdown   # 在本目录运行
```

镜像节点会轮询包 rev：**不用重启、不用刷页面**，客户端 HMR 接管热替换。

⚠️ **host 半（`src/index.mjs`）的修改需要重启 `dsh web` 进程**：cordis Loader 的
ESM 模块是进程级缓存，patch 文件只能重启 fiber，重跑的还是第一次加载的旧模块。

自律脚本：

```sh
node scripts/selftest.mjs        # host 半路由+头部+cookie桥 纯函数断言（不联外网）
node scripts/verify.mjs          # 面板几何 e2e（playwright-core + 系统 Chrome）
node scripts/probe-msg.mjs       # iframe 内容宽度上报通道探针
node scripts/routes-test.mjs     # meta+cookies 路由全生命周期（不联外网，独立起服务）
node scripts/shim-test.mjs       # shim 溢出测量通道
node scripts/standalone-mirror.mjs # 独立起镜像（调试某个上流跳转用）
node scripts/login-e2e.mjs       # 桌面页登录全链路抓斑（需要 MIRROR 环境变量）
```

## 登录：两条路，都不碰滑块

**A. 会话桥（主推，一次粘贴永久受惠）**——面板顶栏 `🔑 登录` → 按提示从
DevTools 把已登录 www.douyin.com 的 `Cookie:` 头粘过来（F12 → Network →
任一请求 → Headers → Request Headers → 那行 Cookie 右键 Copy value）→ 镜像
每次上架请求会**优先注入**这些值。从此：你的 Feed 个性化、收藏、历史、免滑块、
免扫码、免短信。存于 `~/.dsh/storages/douyin-panel.cookies.json`（0600），
面板里再点一次可清除。Cookie 过期/失效重粘一次即可。

**B. 原生登录链（扫码/短信）**——多宿主镜像把 www+passport 压进了
**同一个 origin**，Domain=.douyin.com 的跨子域 cookie 联盟在镜像里原样复活，
理论上弹窗 → 扫码 → App 确认即可完成登录。链路是通的；最后这道门仍由
抖音风控把守（冷罐可能被滑块先拦一下——过一次就）——不通就走 A，A 与 B 不冲突。

## 已知边界

- **端口是钉死的（默认 `39577`，可用 `DSH_DOUYIN_PORT` 环境变量覆盖）**：
  抖音风控按 (origin, cookie-jar) 对打分——端口一动等价于换域名+清罐，
  每次重启都被当全新设备冷扫描（滑块墙/「当前网络异常」），残留页面还指向
  死端口（看起来就是"没有网络"）。钉端口让罐和信任度跨重启存活。
- 上游以**桌面浏览器 UA + client hints 直通**（淘回来的页面是完整桌面版，
  登录/搜索/评论都在），手机观感由面板宽度视觉承担。
- SPA 里极个别跳站链接（absolute URL 到非镜像域名）会在 iframe 里失效，
  用「外开」在新标签页继续看。
