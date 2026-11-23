# Ask for DSH：从代码编辑器添加选区

VS Code、Rider 和 Android Studio 中选中代码，右键点击 **ask for dsh**，自动将文件位置和当时的代码快照作为小附件块加入当前 DSH 对话。加入成功后，在 DSH 补充要求并发送。普通框选不会同步，也不会调用模型。

这是独立的 `dsh-code-bridge` 插件，可与 `dsh-unreal-bridge` 同时安装，不要求 Unreal Editor 运行，不修改 DSH 核心。

## 安装

交付目录为 `dist/code-editors/`，本次实际生成的组件以 `release.json` 为准。完整安装方法见[仓库首页](../README.md)。可生成：

- `dsh-code-bridge-0.3.0.tgz`：DSH 接收插件，针对 DSH 0.2.1-rc.2。
- `ask-for-dsh-vscode-0.3.0.vsix`：VS Code 1.95+ 扩展。
- `ask-for-dsh-rider-0.3.0.zip`：Rider 2026.1+ 插件，需要平台 261+ SDK 才能构建。
- `ask-for-dsh-android-studio-0.3.0.zip`：Android Studio 插件，需要平台 253+ SDK 才能构建。
- `install.bat`、`install-code-editors.ps1` 和 `resolve-dsh-cli.ps1`：Windows 安装入口，配合 `release.json` 使用。

在该交付目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install-code-editors.ps1
```

脚本先检查目标和安装包，备份 DSH 配置后通过官方插件命令安装；安装 VSIX，将 Rider 和 Android Studio 插件放进当前用户配置目录。它不会结束任何应用。自动选择 `%APPDATA%\JetBrains\Rider*` 和 `%APPDATA%\Google\AndroidStudio*` 下最新的受支持正式版配置，也可传入 `-RiderConfig`、`-AndroidStudioConfig`。缺少包或受支持的编辑器时明确跳过；显式指定配置但缺包时会停止。可用 `-SkipDsh`、`-SkipVSCode`、`-SkipRider`、`-SkipAndroidStudio` 跳过相应一端，`-WhatIf` 只检查计划。

手动安装 VS Code：扩展视图 → 更多 → 从 VSIX 安装。手动安装 Rider / Android Studio：Settings → Plugins → 齿轮 → Install Plugin from Disk，选择对应编辑器的 ZIP。Android Studio 需要配套升级 DSH 接收插件到 0.3.0；旧接收端无法识别 Android Studio 来源。

仅安装 Android Studio 和 DSH 两端，可运行 `powershell -ExecutionPolicy Bypass -File .\install-code-editors.ps1 -SkipVSCode -SkipRider`。

保存工作后重启 DSH 及安装了插件的 Rider / Android Studio。VS Code 如未显示新菜单，执行 Developer: Reload Window。

## 使用

1. 在 DSH 打开当前要讨论的对话，接收功能始终开启，无需开关或配置。
2. 在 VS Code、Rider 或 Android Studio 的本机文件中选中代码，右键 → **ask for dsh**。
3. 代码自动加入当前 DSH 会话，不弹出目标选择器，也不记忆旧会话。
4. 输入框中只显示带文件名和行号的小代码附件块，不展开整段代码。原来输入的问题会保留。
5. 悬停附件可预览代码，点击附件可固定预览。预览中可 **编辑**、**保存** 或 **删除**；Tab 可聚焦附件，Enter 打开，Esc 关闭。
6. 补充问题后自行发送，代码附件和问题一起进入模型上下文。普通框选不会同步，插件不会自动发送。

可以连续添加不同文件，支持未保存的编辑器内容和多选区。每次点击产生独立快照；之后继续修改源文件不会悄悄更改已附加的代码。编辑附件只修改本次上下文，不修改源文件；模型会收到“附件已编辑”的说明，行列仍标识原始选区。

附件使用 DSH 原生结构化引用，随草稿保存和切换会话；发送成功后随原生输入清空，发送失败按 DSH 原生恢复流程保留。删除附件后，该代码不会随消息发送。输入框中的图片、其他文件引用和已有问题继续保留。升级前已经粘贴成普通文本的旧草稿保持原样。

如果同时存在多个 DSH 窗口，自动选择最近激活的对话窗口，不弹出选择器。编辑器发起一次投递后固定其目标；投递中切换会话会拒绝该次投递，不把代码转发到另一个会话。

## 范围与失败提示

- 支持 Kotlin、Java、XML、Gradle、C++、C#、AngelScript 等本机文本文件，不依赖语言服务器。多光标/矩形选区按编辑器返回的多个范围处理。
- 行列从 1 开始，列以 UTF-16 计数，终点不包含在选区内；终点位于下一行第 1 列时，该行并未被选中。
- 每次最多 32 个选区、128 Ki UTF-16 单元，HTTP 请求上限 512 KiB。超限提示缩小选区，不静默截断。
- 未保存的新建无路径文件、SSH/WSL/远程工作区暂不支持。
- 接收中切换 DSH 对话时，待处理片段会被拒绝；目标失联后不转发到其他对话。
- DSH 正处于发送或输入命令期间，会等待草稿可编辑。两分钟内未加入则过期。提示“已排队”不是已加入的确认，请检查目标对话，避免重复点击。
- 接收队列仅存于 DSH 进程，重启不会恢复未处理片段；已加入的内容通过 DSH 原生草稿持久化保留。确认回执使用请求编号防止网络重试重复添加；进程崩溃发生在草稿/回执写入之间时仍应人工核对。

## 开发与验证

在仓库根目录执行：

```powershell
npm run test:editors
npm run package:editors
```

打包 DSH / VS Code 需要 Node.js 22+ 和 npm；JetBrains ZIP 还需要 PowerShell、JDK 21，以及本机 Rider 2026.1+ 或 Android Studio（平台 253+）的 SDK JAR。可设置 `RIDER_HOME`、`ANDROID_STUDIO_HOME` 指定安装目录；缺少兼容 SDK 时默认跳过该组件并记录原因，`--require-all` 要求全部成功。VSIX 使用固定版本 `@vscode/vsce@3.6.2` 打包，首次需联网下载。两个 JetBrains 插件共用 `editors/jetbrains/` 下的选区采集和传输代码，分别使用对应 IDE 安装目录中的 JDK/SDK 编译，不下载完整 SDK；独立的插件描述限定各自支持的产品。可分别运行 `scripts/build-rider.ps1` 或 `scripts/build-android-studio.ps1`。

DSH 插件通过公开的 Session Slot、Typert Remote、输入引用事件和 input trigger codec 接入。快照完整保存在原生引用数据中，提交时由 codec 展开；没有修改 DSH 核心或替换发送逻辑。预览挂载在 composer overlay，只监听自己来源的原生引用块。编辑器通过本机 `127.0.0.1` 随机端口连接；每个 DSH 宿主有独立令牌，发现文件保存在 Windows `%LOCALAPPDATA%\DSHCodeBridge\instances`。服务拒绝浏览器 Origin 和无令牌请求。令牌不进入模型或项目配置。
