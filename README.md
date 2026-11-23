# DSH Code Bridge

在 VS Code、Rider 或 Android Studio 中选中代码，右键 **ask for dsh**，把代码快照作为可预览、编辑、删除的小附件加入当前 DSH 对话。代码不会自动发送，原有问题、图片和其他附件会保留。

这是独立的 `dsh-code-bridge` **0.3.0**，适配 **DSH 0.2.1-rc.2**，可与 Unreal Bridge 同时安装，不需要运行 Unreal Editor。源码来自 `ddd104/dsh-unreal-bridge` 的代码编辑器功能。

## 安装 DSH 接收端

打开 DSH **插件 → 添加插件**，输入仓库地址：

```text
https://github.com/ddd104/dsh-code-bridge
```

本文中的 `./` 表示克隆后的仓库根目录，命令默认在该目录执行。从本地安装时，将仓库根目录 `./` 或已生成的 `./dist/code-editors/dsh-code-bridge-0.3.0.tgz` 的实际完整路径填入安装框。

仓库含已构建的 `./lib/` 和插件声明，安装接收端时不需要 Node.js 或执行构建脚本。安装后完整退出 DSH（包括托盘）再重新打开；还需安装对应编辑器扩展才能添加代码选区。GitHub 安装使用远端已推送的版本。

## 一键安装两端

从源码安装，双击根目录的 [install.bat](./install.bat)。需要 Node.js 22+、npm 和已经启动过的 DSH。脚本安装开发依赖，构建发行包，然后安装 DSH 接收端和检测到的编辑器扩展。

使用已经生成的发行包时，把 `./dist/code-editors/` 下的安装包、`release.json`、`install.bat`、`install-code-editors.ps1`、`resolve-dsh-cli.ps1` 放在同一目录，双击其中的 `install.bat`。发行安装不需要系统 Node.js、npm、JDK 或 IDE SDK。

| 组件 | 支持要求 | 安装方式 |
| --- | --- | --- |
| DSH | 0.2.1-rc.2，已初始化的 desktop 配置 | 官方 DSH CLI 安装 `.tgz`，安装前备份配置 |
| VS Code | 1.95+，`code.cmd` 可用 | 安装 `.vsix`；也可通过扩展菜单“从 VSIX 安装” |
| Rider | 2026.1+，平台 261+ | ZIP 安装到当前用户配置的 `plugins/ask-for-dsh` |
| Android Studio | 平台 253+ | ZIP 安装到当前用户配置的 `plugins/ask-for-dsh` |

缺少安装包、编辑器命令或受支持配置时，自动检测的编辑器会明确显示 **SKIPPED**。DSH 缺失或指定的配置不正确会停止安装；显式指定 Rider/Android Studio 配置时，对应安装包也必须存在。脚本先检查所有目标，再安装。现有 JetBrains 插件会完整移入备份目录，新插件安装失败时尝试恢复，避免旧 JAR 残留。

安装前保存工作并关闭要更新的 JetBrains IDE；安装后重启 DSH 和相关 IDE。VS Code 必要时执行 Developer: Reload Window。脚本不会结束应用或自动发送消息。

### 常用选项

以下命令在仓库根目录执行；如果已进入发行目录 `./dist/code-editors/`，改用该目录下的 `./install-code-editors.ps1` 及相同选项：

```powershell
# 使用已生成的包，只安装 DSH 和 VS Code
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -NoBuild -SkipRider -SkipAndroidStudio

# 只安装 DSH
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -NoBuild -SkipVSCode -SkipRider -SkipAndroidStudio

# 检查已有发行包的安装计划，不安装或构建
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -NoBuild -WhatIf
```

可用 `-SkipDsh`、`-SkipVSCode`、`-SkipRider`、`-SkipAndroidStudio` 单独跳过组件。`-Profile` 选择 DSH 配置，默认 `desktop`；`-DshCli` 指定 `dsh.cmd`，`-VSCodeCli` 指定 `code.cmd`，`-RiderConfig`、`-AndroidStudioConfig` 指定 IDE **用户配置目录**（不是程序安装目录）。发行安装器另支持 `-PackageDirectory`。

DSH 配置备份在对应 profile 的 `.plugin-manager/dsh-code-bridge-backups/`；安装包按 SHA256 保存在 `.plugin-manager/dsh-code-bridge-archives/`。JetBrains 旧插件保存在用户配置的 `dsh-code-bridge-backups/`。安装失败时保留备份供恢复，不覆盖日常配置为默认值。

## 使用

1. 在 DSH 打开要讨论的对话。
2. 在本机文件中选中代码，右键 **ask for dsh**。
3. 确认代码附件已加入当前会话，补充问题后手动发送。
4. 悬停附件预览，点击固定预览，可编辑、保存或删除附件。

支持未保存的文件内容、多选区和跨文件多次添加；附件编辑只修改本次上下文，不修改源文件。普通框选不会同步。每次最多 32 个选区、128 Ki UTF-16 单元；不支持没有路径的新建文件及 SSH/WSL/远程工作区。完整行为见 [使用说明](./docs/code-editors.md)。

## 开发和打包

```powershell
npm ci
npm run check
npm run package:editors
```

`check` 构建插件，运行代码功能与安装器测试，验证可安装入口。`package:editors` 生成 DSH 和 VS Code 包；自动检测兼容的 Rider/Android Studio SDK，有条件时构建 ZIP，缺少时记录在 `release.json` 的 `skipped` 中。`npm run package:dsh` 只生成接收端交付；`npm run package:editors -- --require-all` 要求四端全部构建成功。

JetBrains 构建需要 JDK 21 和对应版本的 IDE SDK，可通过 `RIDER_HOME`、`ANDROID_STUDIO_HOME` 指定程序安装目录。VSIX 使用固定的 `@vscode/vsce@3.6.2`，首次需要联网下载。不会自动下载或升级完整 IDE。

本仓库保留 `./editors/` 结构，根目录提供独立依赖、构建产物、安装入口及发行工具。迁移范围与已完成的检查见[迁移与验证记录](./docs/migration.md)。
