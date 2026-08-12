import easConfig from "../eas.json";

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
  it("does not commit a backend URL or insecure flag in candidate profiles", () => {
    const preview = easConfig.build.preview as Record<string, unknown>;
    const production = easConfig.build.production as Record<string, unknown>;
    expect(preview.env).toBeUndefined();
    expect(production.env).toBeUndefined();
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
    const buildProperties = config.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === "expo-build-properties");
    expect(buildProperties[1].android.usesCleartextTraffic).toBe(true);
  });

  it("allows explicit insecure HTTP only for the local simulator profile", () => {
    const config = loadExpoConfig("simulator", "http://127.0.0.1:9090", "1");
    expect(config.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads).toBe(true);
  });
});
