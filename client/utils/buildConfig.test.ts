import easConfig from "../eas.json";
import { readFileSync } from "node:fs";
import path from "node:path";

const originalEnvironment = { ...process.env };

function loadExpoConfig(profile: string, baseUrl: string, allowInsecure = "0") {
  jest.resetModules();
  process.env.EAS_BUILD_PROFILE = profile;
  process.env.EXPO_PUBLIC_BACKEND_BASE_URL = baseUrl;
  process.env.EXPO_PUBLIC_ALLOW_INSECURE_HTTP = allowInsecure;
  const createConfig = require("../app.config") as (context: { config: Record<string, unknown> }) => any;
  return createConfig({ config: {} });
}

afterEach(() => {
  process.env = { ...originalEnvironment };
  jest.resetModules();
});

describe("candidate build transport policy", () => {
  it("declares and configures microphone access for native voice recording", () => {
    const config = loadExpoConfig("preview", "https://api.example.test");
    expect(config.android.permissions).toContain("android.permission.RECORD_AUDIO");
    const avPlugin = config.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === "expo-av");
    expect(avPlugin?.[1]?.microphonePermission).toMatch(/麦克风/);
  });

  it("does not commit a backend URL or insecure flag in candidate profiles", () => {
    const preview = easConfig.build.preview as Record<string, unknown>;
    const production = easConfig.build.production as Record<string, unknown>;
    expect(preview.env).toBeUndefined();
    expect(production.env).toBeUndefined();
  });

  it.each(["china", "global"])("builds the %s deployment profile without server secrets", (deploymentProfile) => {
    for (const suffix of ["preview", "production"] as const) {
      const build = easConfig.build[`${deploymentProfile}-${suffix}` as keyof typeof easConfig.build] as { env?: Record<string, string> };
      expect(build.env).toEqual({ EXPO_PUBLIC_DEPLOYMENT_PROFILE: deploymentProfile });
      expect(build.env?.EXPO_PUBLIC_BACKEND_BASE_URL).toBeUndefined();
    }
    process.env.EXPO_PUBLIC_DEPLOYMENT_PROFILE = deploymentProfile;
    const config = loadExpoConfig(`${deploymentProfile}-preview`, "https://api.example.test");
    expect(config.extra.deploymentProfile).toBe(deploymentProfile);
    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(serialized).not.toContain("ALIYUN_ACCESS_KEY_SECRET");
    expect(serialized).not.toContain("JWT_SECRET");
  });

  it("rejects an unknown deployment profile", () => {
    process.env.EXPO_PUBLIC_DEPLOYMENT_PROFILE = "mars";
    expect(() => loadExpoConfig("preview", "https://api.example.test")).toThrow(/must be china or global/);
  });

  it.each(["preview", "production"])("requires HTTPS for the %s profile", (profile) => {
    expect(() => loadExpoConfig(profile, "http://api.example.test", "1")).toThrow(/require an HTTPS/);
    const config = loadExpoConfig(profile, "https://api.example.test", "1");
    expect(config.ios.infoPlist.NSAppTransportSecurity).toBeUndefined();
    const buildProperties = config.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === "expo-build-properties");
    expect(buildProperties[1].android.usesCleartextTraffic).toBe(false);
  });

  it("allows explicit insecure HTTP for the controlled internal packaging profile", () => {
    const httpPreview = easConfig.build["preview-http"] as { env?: Record<string, string> };
    expect(httpPreview.env?.EXPO_PUBLIC_ALLOW_INSECURE_HTTP).toBe("1");
    expect(httpPreview.env?.EXPO_PUBLIC_BACKEND_BASE_URL).toMatch(/^http:\/\//);

    const config = loadExpoConfig(
      "preview-http",
      httpPreview.env!.EXPO_PUBLIC_BACKEND_BASE_URL,
      httpPreview.env!.EXPO_PUBLIC_ALLOW_INSECURE_HTTP,
    );
    expect(config.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads).toBe(true);
    expect(config.name).toContain("HTTP测试");
    expect(config.android.package).toBe("com.dietdigidose.app.previewhttp");
    expect(config.ios.bundleIdentifier).toBe("com.dietdigidose.app.previewhttp");
    expect(config.extra.buildFlavor).toBe("preview-http");
    const buildProperties = config.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === "expo-build-properties");
    expect(buildProperties[1].android.usesCleartextTraffic).toBe(true);
  });

  it.each(["preview", "candidate", "production"])("keeps the formal package identity for %s", (profile) => {
    const config = loadExpoConfig(profile, "https://api.example.test");
    expect(config.name).toBe("食光烙记");
    expect(config.android.package).toBe("com.dietdigidose.app");
    expect(config.extra.buildFlavor).toBe("standard");
  });

  it("allows explicit insecure HTTP only for the local simulator profile", () => {
    const config = loadExpoConfig("simulator", "http://127.0.0.1:9090", "1");
    expect(config.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads).toBe(true);
  });

  it("verifies main ancestry before signing and isolates HTTP preview signing", () => {
    const workflow = readFileSync(path.resolve(__dirname, "../../.github/workflows/android-apk.yml"), "utf8");
    expect(workflow.indexOf("git merge-base --is-ancestor")).toBeGreaterThan(0);
    expect(workflow.indexOf("git merge-base --is-ancestor")).toBeLessThan(workflow.indexOf("Restore release keystore"));
    expect(workflow).toContain("Verified source revision $GITHUB_SHA is reachable from origin/main");
    expect(workflow).toContain("Generate isolated preview signing key");
    expect(workflow).toContain("com.dietdigidose.app.previewhttp");
    expect(workflow).toContain("if: env.EAS_BUILD_PROFILE != 'preview-http'");
  });
});
