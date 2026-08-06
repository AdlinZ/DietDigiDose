import { APP_BUILD_TIME, APP_VERSION } from "@/utils/appVersion";
import { publicFetch, requestJson } from "./client";

export type VersionInfo = {
  serverVersion: string;
  serverBuildTime: string;
  clientVersion: string | null;
  clientBuildTime: string | null;
};

export const systemApi = {
  version: () => requestJson<VersionInfo>(publicFetch, "/api/v1/version", {
    headers: {
      "x-client-version": APP_VERSION,
      "x-client-build-time": APP_BUILD_TIME,
    },
  }),
};
