import Dypnsapi20170525Package, {
  CheckSmsVerifyCodeRequest,
  SendSmsVerifyCodeRequest,
} from "@alicloud/dypnsapi20170525";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import { RuntimeOptions } from "@darabonba/typescript";

// The Alibaba Cloud package is CommonJS and exposes the client as
// `module.exports.default`. Native Node ESM therefore receives the package
// namespace as the default import, while tsx may unwrap it during tests.
// Resolve both shapes so development and production runtimes behave alike.
const Dypnsapi20170525 = (
  (Dypnsapi20170525Package as unknown as { default?: typeof Dypnsapi20170525Package }).default
  || Dypnsapi20170525Package
) as typeof Dypnsapi20170525Package;

export const SMS_PROVIDER = "aliyun-pnvs";

export type SmsSendResult = {
  success: boolean;
  code: string;
  message: string;
  requestId: string | null;
  bizId: string | null;
  outId: string;
};

export type SmsVerifyResult = {
  success: boolean;
  passed: boolean;
  code: string;
  message: string;
  outId: string;
};

export type SmsProvider = {
  send(phone: string, outId: string, config: SmsServiceConfig): Promise<SmsSendResult>;
  verify(phone: string, outId: string, code: string): Promise<SmsVerifyResult>;
};

export type SmsServiceConfig = {
  enabled: boolean;
  signName: string;
  templateCode: string;
  packageTotal: number;
  packageBaselineRemaining: number;
  packageBaselineAt: string | null;
  phoneHourlyLimit: number;
  phoneDailyLimit: number;
  ipHourlyLimit: number;
  ipDailyLimit: number;
  globalDailyLimit: number;
};

function envBoolean(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function providerRuntimeOptions() {
  return new RuntimeOptions({
    autoretry: false,
    maxAttempts: 1,
    connectTimeout: 5_000,
    readTimeout: 10_000,
  });
}

export function smsCredentialsStatus() {
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID?.trim() || "";
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET?.trim() || "";
  return {
    configured: Boolean(accessKeyId && accessKeySecret),
    accessKeyIdConfigured: Boolean(accessKeyId),
    secretConfigured: Boolean(accessKeySecret),
    maskedAccessKeyId: accessKeyId ? `${accessKeyId.slice(0, 4)}********${accessKeyId.slice(-4)}` : null,
  };
}

class AliyunSmsProvider implements SmsProvider {
  private client() {
    const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID?.trim();
    const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET?.trim();
    if (!accessKeyId || !accessKeySecret) throw new Error("ALIYUN_SMS_CREDENTIALS_MISSING");
    return new Dypnsapi20170525(new $OpenApiUtil.Config({
      accessKeyId,
      accessKeySecret,
      endpoint: process.env.ALIYUN_DYPNS_ENDPOINT?.trim() || "dypnsapi.aliyuncs.com",
      regionId: process.env.ALIYUN_REGION_ID?.trim() || "cn-hangzhou",
    }));
  }

  async send(phone: string, outId: string, config: SmsServiceConfig): Promise<SmsSendResult> {
    const response = await this.client().sendSmsVerifyCodeWithOptions(new SendSmsVerifyCodeRequest({
      phoneNumber: phone,
      countryCode: "86",
      signName: config.signName,
      templateCode: config.templateCode,
      // `##code##` asks PNVS to generate and retain the verification code so
      // CheckSmsVerifyCode can validate it later without exposing it to us.
      templateParam: JSON.stringify({ code: "##code##", min: "5" }),
      codeLength: 6,
      codeType: 1,
      validTime: 300,
      interval: 60,
      duplicatePolicy: 1,
      autoRetry: 1,
      returnVerifyCode: false,
      outId,
    }), providerRuntimeOptions());
    const body = response.body;
    return {
      success: body?.success === true && body.code === "OK",
      code: body?.code || "UNKNOWN",
      message: body?.message || "",
      requestId: body?.requestId || body?.model?.requestId || null,
      bizId: body?.model?.bizId || null,
      outId: body?.model?.outId || outId,
    };
  }

  async verify(phone: string, outId: string, code: string): Promise<SmsVerifyResult> {
    const response = await this.client().checkSmsVerifyCodeWithOptions(new CheckSmsVerifyCodeRequest({
      phoneNumber: phone,
      countryCode: "86",
      outId,
      verifyCode: code,
      caseAuthPolicy: 2,
    }), providerRuntimeOptions());
    const body = response.body;
    return {
      success: body?.success === true && body.code === "OK",
      passed: body?.model?.verifyResult === "PASS",
      code: body?.code || "UNKNOWN",
      message: body?.message || "",
      outId: body?.model?.outId || outId,
    };
  }
}

let provider: SmsProvider = new AliyunSmsProvider();

export function getSmsProvider() {
  return provider;
}

export function setSmsProviderForTests(value: SmsProvider | null) {
  provider = value || new AliyunSmsProvider();
}

export function defaultSmsEnabled() {
  return envBoolean("ALIYUN_SMS_ENABLED", false);
}
