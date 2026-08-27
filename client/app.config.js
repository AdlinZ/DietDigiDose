/* global module, process, require */

const release = require('../release.json');

const appName = process.env.EXPO_PUBLIC_APP_NAME || '食光烙记';
const appSlug = process.env.EXPO_PUBLIC_APP_SLUG || 'dietdigidose';
const androidPackage = process.env.EXPO_PUBLIC_ANDROID_PACKAGE || 'com.dietdigidose.app';
const iosBundleIdentifier = process.env.EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER || 'com.dietdigidose.app';
const easBuildProfile = process.env.EAS_BUILD_PROFILE;
const insecureHttpBuildProfiles = new Set(['preview-http', 'simulator']);
const allowInsecureHttp = (!easBuildProfile || insecureHttpBuildProfiles.has(easBuildProfile))
  && process.env.EXPO_PUBLIC_ALLOW_INSECURE_HTTP === '1';
const appVersion = release.productVersion;
const buildNumber = release.buildNumber;
const easProjectId = 'c89b45c8-5a27-4f6f-af05-4b656f534994';
// Expo 会在打包时解析 app.config；未显式指定时，这里就是本次构建的时间。
const buildTime = process.env.EXPO_PUBLIC_BUILD_TIME || new Date().toISOString();

if (easBuildProfile && !allowInsecureHttp && !process.env.EXPO_PUBLIC_BACKEND_BASE_URL?.startsWith('https://')) {
  throw new Error(`${easBuildProfile} builds require an HTTPS EXPO_PUBLIC_BACKEND_BASE_URL`);
}

module.exports = ({ config }) => ({
  ...config,
  name: appName,
  slug: appSlug,
  version: appVersion,
  orientation: 'portrait',
  icon: './assets/images/adaptive-icon-safe.png',
  scheme: 'dietdigidose',
  // 由应用主题偏好决定；跟随系统时同步 Android/iOS 外观。
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  runtimeVersion: {
    policy: 'appVersion',
  },
  updates: {
    url: `https://u.expo.dev/${easProjectId}`,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
  },
  extra: {
    ...config.extra,
    appVersion,
    releaseSnapshot: release.snapshot,
    buildNumber,
    buildTime,
    eas: {
      ...config.extra?.eas,
      projectId: easProjectId,
    },
  },
  ios: {
    ...config.ios,
    bundleIdentifier: iosBundleIdentifier,
    buildNumber: String(buildNumber),
    supportsTablet: true,
    infoPlist: {
      ...config.ios?.infoPlist,
      ITSAppUsesNonExemptEncryption: false,
      ...(allowInsecureHttp ? {
        NSAppTransportSecurity: {
          ...(config.ios?.infoPlist?.NSAppTransportSecurity || {}),
          NSAllowsArbitraryLoads: true,
        },
      } : {}),
    },
  },
  android: {
    ...config.android,
    icon: './assets/images/adaptive-icon-safe.png',
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon-foreground.png',
      backgroundColor: '#ffffff',
    },
    package: androidPackage,
    versionCode: buildNumber,
    softwareKeyboardLayoutMode: 'resize',
    userInterfaceStyle: 'automatic',
    permissions: ['android.permission.RECORD_AUDIO'],
  },
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    '@siteed/audio-studio',
    process.env.EXPO_PUBLIC_BACKEND_BASE_URL ? [
      'expo-router',
      {
        origin: process.env.EXPO_PUBLIC_BACKEND_BASE_URL,
      },
    ] : 'expo-router',
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon-safe.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
        dark: {
          image: './assets/images/splash-icon-safe.png',
          backgroundColor: '#111713',
        },
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: `允许${appName}访问您的相册，以便您上传食材或餐食图片。`,
        cameraPermission: `允许${appName}使用您的相机，以便您拍摄食材或餐食图片。`,
        microphonePermission: `允许${appName}访问您的麦克风，以便您使用语音录入功能。`,
      },
    ],
    [
      'expo-av',
      {
        microphonePermission: `允许${appName}访问您的麦克风，以便您使用语音录入功能。`,
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission: `允许${appName}在使用期间访问您的位置，以提供经您主动开启的本地化服务。`,
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: `允许${appName}使用相机拍摄食材或餐食图片。`,
        microphonePermission: `允许${appName}使用麦克风进行语音录入。`,
        recordAudioAndroid: true,
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/images/adaptive-icon-safe.png',
        color: '#2D6A4F',
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: allowInsecureHttp,
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
});
