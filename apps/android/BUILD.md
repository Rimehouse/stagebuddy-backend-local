# StageBuddy — Android 打包指南

## 环境要求
- Android Studio Hedgehog（2024.1+）
- Android SDK 34+（Android Studio 会自动提示安装）

## 打包步骤

### 方法一：Android Studio（推荐）

1. 打开 Android Studio → Open → 选择本项目的 `android/` 文件夹
2. 等待 Gradle sync 完成（首次约 3-5 分钟）
3. 菜单：**Build → Build Bundle(s) / APK(s) → Build APK(s)**
4. APK 路径：`android/app/build/outputs/apk/debug/app-debug.apk`

### 方法二：命令行

```bash
# 确保已安装 Android Studio 且配置好 ANDROID_HOME
cd android
./gradlew assembleDebug

# APK 输出在：
# android/app/build/outputs/apk/debug/app-debug.apk
```

### 生成正式签名 APK（发布用）

```bash
cd android
./gradlew assembleRelease
```

> 正式发布需要在 `android/app/build.gradle` 的 `signingConfigs` 中配置 keystore。

## 安装到手机

```bash
# USB 连接手机，开启开发者模式 + USB 调试
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

## 如果更新了前端代码

```bash
npm run build          # 重新构建 web 资产
npx cap sync android   # 同步到 Android 项目
# 然后在 Android Studio 重新 Build APK
```
