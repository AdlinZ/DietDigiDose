import { ExpoConfig, ConfigContext } from 'expo/config';

const appName = process.env.EXPO_PUBLIC_APP_NAME || 'DietDigiDose';
const appSlug = process.env.EXPO_PUBLIC_APP_SLUG || 'dietdigidose';
const androidPackage = process.env.EXPO_PUBLIC_ANDROID_PACKAGE || 'com.dietdigidose.app';
const allowInsecureHttp = process.env.EXPO_PUBLIC_ALLOW_INSECURE_HTTP === '1';

export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    "name": appName,
    "slug": appSlug,
    "version": "1.0.2",
    "orientation": "portrait",
    "icon": "./assets/images/adaptive-icon-safe.png",
    "scheme": "dietdigidose",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "extra": {
      ...config.extra,
      "eas": {
        ...config.extra?.eas,
        "projectId": "c89b45c8-5a27-4f6f-af05-4b656f534994"
      }
    },
    "ios": {
      ...config.ios,
      "supportsTablet": true,
      ...(allowInsecureHttp ? {
        "infoPlist": {
          ...config.ios?.infoPlist,
          "NSAppTransportSecurity": {
            ...(config.ios?.infoPlist?.NSAppTransportSecurity as Record<string, unknown> | undefined),
            "NSAllowsArbitraryLoads": true
          }
        }
      } : {})
    },
    "android": {
      ...config.android,
      "icon": "./assets/images/adaptive-icon-safe.png",
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/adaptive-icon-foreground.png",
        "backgroundColor": "#ffffff"
      },
      "package": androidPackage,
      "versionCode": 3
    },
    "web": {
      "bundler": "metro",
      "output": "single",
      "favicon": "./assets/images/favicon.png"
    },
    "plugins": [
      process.env.EXPO_PUBLIC_BACKEND_BASE_URL ? [
        "expo-router",
        {
          "origin": process.env.EXPO_PUBLIC_BACKEND_BASE_URL
        }
      ] : 'expo-router',
      [
        "expo-splash-screen",
        {
          "image": "./assets/images/splash-icon-safe.png",
          "imageWidth": 200,
          "resizeMode": "contain",
          "backgroundColor": "#ffffff"
        }
      ],
      [
        "expo-image-picker",
        {
          "photosPermission": `允许新项目访问您的相册，以便您上传或保存图片。`,
          "cameraPermission": `允许新项目使用您的相机，以便您直接拍摄照片上传。`,
          "microphonePermission": `允许新项目访问您的麦克风，以便您拍摄带有声音的视频。`
        }
      ],
      [
        "expo-location",
        {
          "locationWhenInUsePermission": `新项目需要访问您的位置以提供周边服务及导航功能。`
        }
      ],
      [
        "expo-camera",
        {
          "cameraPermission": `新项目需要访问相机以拍摄照片和视频。`,
          "microphonePermission": `新项目需要访问麦克风以录制视频声音。`,
          "recordAudioAndroid": true
        }
      ],
      [
        "expo-notifications",
        {
          "icon": "./assets/images/adaptive-icon-safe.png",
          "color": "#2D6A4F"
        }
      ],
      [
        "expo-build-properties",
        {
          "android": {
            "usesCleartextTraffic": allowInsecureHttp
          }
        }
      ]
    ],
    "experiments": {
      "typedRoutes": true
    }
  }
}
