import { createHmac } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../../config/security.js";
import { describeStoredMediaUrls } from "../../services/mediaStorage.js";
import { AuthAccountError } from "./errors.js";
import type { AuthAccountRepository } from "./repository.js";
import type { ProfileInput, Row } from "./types.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^1[3-9]\d{9}$/;

function parseIdentifier(value: unknown) {
  const identifier = String(value || "").trim().toLowerCase();
  if (emailPattern.test(identifier)) return { raw: identifier, value: { email: identifier, phone: null } };
  if (phonePattern.test(identifier)) return { raw: identifier, value: { email: null, phone: identifier } };
  return { raw: identifier, value: null };
}

function token(userId: number, sessionVersion: number) {
  return jwt.sign({ userId, sessionVersion: Math.max(1, Number(sessionVersion) || 1) }, JWT_SECRET, { expiresIn: "30d" });
}

function actorHash(userId: number) {
  return createHmac("sha256", JWT_SECRET).update(`user:${userId}`).digest("hex");
}

function booleanNumber(value: unknown) { return value === true ? 1 : value === false ? 0 : value; }
function legacyUser(row: Row) {
  const copy = { ...row };
  for (const key of ["must_change_password", "is_disabled", "is_verified_expert"]) {
    if (key in copy) copy[key] = booleanNumber(copy[key]);
  }
  return copy;
}

export class AuthAccountService {
  private readonly repository: AuthAccountRepository;
  private readonly processCleanup: (jobId: number) => Promise<unknown>;

  constructor(repository: AuthAccountRepository, processCleanup: (jobId: number) => Promise<unknown> = async () => undefined) {
    this.repository = repository;
    this.processCleanup = processCleanup;
  }

  async register(identifier: unknown, username: string, password: string) {
    const parsed = parseIdentifier(identifier);
    if (!parsed.value) throw new AuthAccountError(400, "请输入有效的邮箱或手机号", "INVALID_IDENTIFIER");
    if (parsed.value.phone) throw new AuthAccountError(400, "手机号注册必须先完成短信验证", "PHONE_VERIFICATION_REQUIRED");
    const result = await this.repository.createUser({ ...parsed.value, username, passwordHash: await bcrypt.hash(password, 10) });
    if (result.status === "identifier_exists") throw new AuthAccountError(409, "该邮箱或手机号已注册", "IDENTIFIER_EXISTS");
    if (result.status === "username_exists") throw new AuthAccountError(409, "该用户名已被使用", "USERNAME_EXISTS");
    await this.repository.recordFunnelEvent(Number(result.user.id), "account_registered");
    return { token: token(Number(result.user.id), result.sessionVersion), user: legacyUser(result.user) };
  }

  async login(identifier: unknown, password: unknown, clientIp: string, userAgent?: string) {
    const parsed = parseIdentifier(identifier); const adminUsername = parsed.raw === "admin" ? parsed.raw : null;
    if ((!parsed.value && !adminUsername) || !password) {
      throw new AuthAccountError(400, "请输入管理员账号，或注册时的邮箱/手机号", "INVALID_IDENTIFIER", true);
    }
    const user = await this.repository.findLoginUser(parsed.value, adminUsername);
    if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
      throw new AuthAccountError(401, "账号、邮箱、手机号或密码错误", "INVALID_CREDENTIALS", true);
    }
    if (user.is_disabled === 1 || user.is_disabled === true) {
      throw new AuthAccountError(403, "账号已被停用", "ACCOUNT_DISABLED");
    }
    const nowIso = new Date().toISOString();
    const sessionVersion = await this.repository.recordSuccessfulLogin(user.id, nowIso, clientIp);
    if (user.role !== "admin") await this.repository.recordFunnelEvent(user.id, "login_succeeded");
    if (user.role === "admin") await this.repository.recordAdminAudit({ adminUserId: user.id, action: "auth.login",
      resourceType: "session", resourceId: user.id, summary: "管理员登录成功", ipAddress: clientIp, userAgent });
    const { password_hash: _passwordHash, session_version: _sessionVersion, ...userInfo } = user;
    return { rawIdentifier: parsed.raw, token: token(user.id, sessionVersion),
      user: legacyUser({ ...userInfo, last_login_at: nowIso, last_login_ip: clientIp }) };
  }

  async me(userId: number) {
    const user = await this.repository.getMe(userId);
    if (!user) throw new AuthAccountError(404, "用户不存在", "USER_NOT_FOUND");
    return legacyUser(user);
  }

  async changePassword(userId: number, currentPassword: unknown, newPassword: unknown, ipAddress?: string, userAgent?: string) {
    if (!currentPassword || !newPassword) throw new AuthAccountError(400, "当前密码和新密码不能为空");
    if (typeof newPassword !== "string" || newPassword.length < 6) throw new AuthAccountError(400, "新密码长度不能少于 6 位");
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) throw new AuthAccountError(400, "新密码必须同时包含字母和数字");
    const user = await this.repository.getCredentials(userId);
    if (!user || !bcrypt.compareSync(String(currentPassword), user.password_hash)) throw new AuthAccountError(400, "当前密码不正确");
    if (bcrypt.compareSync(newPassword, user.password_hash)) throw new AuthAccountError(400, "新密码不能与当前密码相同");
    const changed = await this.repository.changePassword(userId, bcrypt.hashSync(newPassword, bcrypt.genSaltSync(12)));
    if (!changed) throw new AuthAccountError(400, "当前密码不正确");
    if (user.role === "admin") await this.repository.recordAdminAudit({ adminUserId: userId, action: "auth.password.change",
      resourceType: "user", resourceId: userId, summary: `管理员 ${user.username || "admin"} 修改密码`, ipAddress, userAgent });
    return { success: true, message: "密码修改成功" };
  }

  async updateProfile(userId: number, input: ProfileInput) {
    const result = await this.repository.updateProfile(userId, input);
    if (result.status === "username_exists") throw new AuthAccountError(409, "该用户名已被使用", "USERNAME_EXISTS");
    return legacyUser(result.user);
  }

  async exportAiData(userId: number) {
    return { exported_at: new Date().toISOString(), ...await this.repository.exportAiData(userId) };
  }

  async deleteAiData(userId: number) { return { success: true, deleted: await this.repository.deleteAiData(userId) }; }

  async deleteAccount(userId: number, password: string) {
    const user = await this.repository.getCredentials(userId);
    if (!user) throw new AuthAccountError(404, "用户不存在", "USER_NOT_FOUND");
    if (user.role === "admin") throw new AuthAccountError(403, "管理员账号不能通过客户端注销", "ADMIN_ACCOUNT_DELETE_FORBIDDEN");
    if (!bcrypt.compareSync(password, user.password_hash)) throw new AuthAccountError(400, "当前密码不正确", "INVALID_PASSWORD");
    const urls = await this.repository.accountMediaUrls(userId);
    const uniqueUrls = [...new Set(urls.filter(Boolean))];
    const result = await this.repository.deleteAccount(userId, actorHash(userId), uniqueUrls, describeStoredMediaUrls(userId, uniqueUrls));
    if (!result.deleted) throw new AuthAccountError(404, "用户不存在", "USER_NOT_FOUND");
    if (result.cleanupJobId) {
      try { await this.processCleanup(result.cleanupJobId); }
      catch (error) { console.error(`Media cleanup job ${result.cleanupJobId} will be retried:`, error); }
    }
    return { success: true, message: "账号及关联数据已永久删除" };
  }
}
