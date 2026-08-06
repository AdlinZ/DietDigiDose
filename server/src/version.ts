import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rootPackage = require("../../package.json") as { version: string };

export const SERVER_VERSION = process.env.SERVER_VERSION?.trim() || rootPackage.version;

// 构建产物由 build.js 注入该值；本地开发可通过环境变量覆盖。
export const SERVER_BUILD_TIME = process.env.SERVER_BUILD_TIME?.trim() || "开发模式";
