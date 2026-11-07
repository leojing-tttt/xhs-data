# 手机控制台

浏览器里看、点一台插在当前电脑上的 Android。别的电脑打开这个网页并登录即可，手机不用插在那台电脑上。

画面和触控走上游 [scrcpy](https://github.com/Genymobile/scrcpy) **5.0.1**（Genymobile）。仓库里的 `vendor/scrcpy-server-v5.0.1` 是官方发布的服务端，没有改过。

SHA-256：`764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536`

客户端和这个服务端必须是同一版本。不要换成别的 scrcpy，也不要换 ws-scrcpy 或 STF。

## 这一版做什么

- 登录页。密码不对就停在登录页，不会发会话 cookie。
- 登录后用 HttpOnly、SameSite=Lax 的 cookie。只有登录的人能看设备、开画面。
- 设备列表：序列号、型号、状态。一台都没有时，页面会告诉你插上手机并允许 USB 调试。
- 打开一台在线手机：看画面，点按，按住拖动作为滑动，以及返回、主页、电源。也可以发一段文字。
- 画面是手机上的 H.264。浏览器使用 WebCodecs 解码，请用桌面版 Chrome 或 Edge。
- 任务。登录后点顶部「任务」。目前只有「小红书搜索」：填关键词和条数，选一台空闲手机，提交。

## 任务

一台手机同时只跑一个任务。状态是排队、执行中、成功、失败。失败停住，页面上写明原因，不会自动重试。

结果记在这台机器的 `phone-console/data/tasks.json`。表上是笔记标题、笔记链接、作者姓名、发布时间、点赞数，以及拿到多少条。画面上没有的字段留空。「大家都在搜」「购物狂欢」这类不是笔记的行不会进入结果。点开一条任务的「结果」后，条数旁边可以「导出 Excel」，一行一条笔记。这一版不把结果上传到外部数据库。

执行时用 adb 打开选定手机上的小红书搜索，只读取这个 App 自己已经返回的搜索结果。笔记链接用响应里的笔记 id 拼成 `https://www.xiaohongshu.com/explore/{id}`。标题、作者、点赞、发布时间以响应里有的为准，没有就留空。正文这一版不取。不另发详情请求，不逐条打开笔记，不伪造签名。完全读不到搜索响应时，才改用屏幕上的文字，并在任务原因里写明。能往下翻就翻到条数上限或没有更多。

## 这一版不做什么

- 抖音、微信、企业微信。任务种类以后可以加，这一版只有小红书搜索
- 多台手机同时点击
- 公司用户中心。账号在本机 `config/users.json`，以后只替换登录
- 声音、剪贴板、传文件、安装应用
- 无线调试的配对。已经用 `adb connect` 连上的手机会出现在列表里
- 多台节点。服务只看得到跑它的那台电脑上的 adb
- 没有真机时假装有画面

## 要装什么

- Node.js 20 或更新。不需要 `npm install`，也没有第三方依赖
- adb（Android platform-tools）
- 不需要再安装 scrcpy 命令，也不需要 ffmpeg

手机要打开开发者选项和 USB 调试。弹出授权时点允许。

## 在 macOS 上跑

```bash
brew install android-platform-tools
cd phone-console
node server/index.js
```

浏览器打开 <http://127.0.0.1:8787>。

本机占位账号：

- 账号 `leijing`
- 密码 `leijing-local`

这是写在配置文件里的口令，不是用户中心的账号。接入用户中心之前请换掉。

先在这台 Mac 上确认手机能被 adb 看见：

```bash
adb devices -l
```

状态应是 `device`。是 `unauthorized` 时，在手机上点允许。

## 以后在 Linux 节点上跑

手机插在节点上，或者无线 adb 已经连到节点。其他人的电脑只打开网页。

```bash
sudo apt-get update
sudo apt-get install -y adb
cd phone-console
node server/index.js
```

有的发行版包名是 `android-tools-adb` 或 `android-sdk-platform-tools`。也可以把 Google platform-tools 解压后，把其中的 `adb` 放到 `PATH`。

服务默认监听 `0.0.0.0:8787`。同一网络里打开 `http://<节点IP>:8787`。防火墙要放行 8787。

Linux 上如果列表里是「无权限」，先让这台机器自己的 `adb devices` 变成 `device`（常见是给当前用户配 udev 规则）。手机上的授权框要点允许。

## 换掉占位密码

```bash
node scripts/hash-password.js leijing '新密码' 雷靖
```

把打印出来的 JSON 放进 `config/users.json` 的 `users`，然后重启。密码只以 scrypt 哈希保存。

会话密钥在第一次启动时写到 `config/session-secret`。不要提交这个文件。也可以自己设 `SESSION_SECRET`。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `PORT` | 端口，默认 `8787` |
| `HOST` | 监听地址，默认 `0.0.0.0` |
| `ADB` | adb 可执行文件 |
| `SESSION_SECRET` | 会话签名。不设就用 `config/session-secret` |
| `SCRCPY_SERVER` | 另指定一个 scrcpy 服务端文件。传给手机的版本号仍是 `5.0.1` |

## 测试

没有手机。设备列表用 `test/fixtures/` 里的 adb 输出。

```bash
cd phone-console
node --test
```

## 接到真机和用户中心之前还缺什么

- 这一版没有在真机上看过画面。WebCodecs 解不开某台手机的码流时，下一版再加 ffmpeg 转 JPEG。现在没有这条退路。
- 用户中心还没接。要接的时候换 `server/auth.js` 里的账号校验，设备列表和 scrcpy 会话可以不动。
- 没有 HTTPS、开机自启，也没有写好的 Linux udev 规则。
- 同时只开一路画面。第二个人打开同一路会被拒绝。
