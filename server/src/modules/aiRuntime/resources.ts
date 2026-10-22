import { z } from "zod";
import type { AIProviderConfig } from "./types.js";

export const RESOURCE_SETTING_KEY = "AI_RESOURCE_CONFIG_V1";
export const capabilities = ["chat", "vision", "asr"] as const;
export const serviceIds = ["chat", "vision", "asr", "supervisor", "nutrition", "recipe", "operations"] as const;
export type ServiceId = typeof serviceIds[number];
const capabilitySchema = z.enum(capabilities);
const idSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const modelSchema = z.string().trim().min(1).max(200);
const endpointSchema = z.url().refine(value => {
  const url = new URL(value);
  return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
}, "端点必须是无凭据和查询参数的 HTTP(S) 地址");
const connectionFields = {
  id: idSchema, name: z.string().trim().min(1).max(100),
  kind: z.literal("connection"), protocol: z.literal("openai-compatible"),
  baseUrl: endpointSchema,
  models: z.array(z.object({ id: modelSchema, capabilities: z.array(capabilitySchema).min(1) }).strict()).min(1).max(100),
};
const legacyResourceSchema = z.object({
  id: idSchema, name: z.string(), kind: z.literal("legacy"), scope: capabilitySchema,
}).strict();
const storedResourceSchema = z.union([
  legacyResourceSchema,
  z.object({ ...connectionFields, apiKey: z.string().max(4096) }).strict(),
]);
const credentialSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("keep") }).strict(),
  z.object({ action: z.literal("clear") }).strict(),
  z.object({ action: z.literal("replace"), value: z.string().trim().min(1).max(4096) }).strict(),
]);
const editableResourceSchema = z.union([
  legacyResourceSchema,
  z.object({ ...connectionFields, credential: credentialSchema.optional() }).strict(),
]);
const targetSchema = z.object({ resourceId: idSchema, model: modelSchema.optional() }).strict();
const bindingSchema = z.union([
  z.object({ inherit: z.literal(true) }).strict(), targetSchema,
]);
const documentFields = {
  schemaVersion: z.literal(1), revision: z.number().int().nonnegative(),
  defaults: z.object({ chat: targetSchema, vision: targetSchema, asr: targetSchema }).strict(),
  services: z.object({ chat: bindingSchema, vision: bindingSchema, asr: bindingSchema,
    supervisor: bindingSchema, nutrition: bindingSchema, recipe: bindingSchema, operations: bindingSchema }).strict(),
};
export const resourceDocumentSchema = z.object({ ...documentFields, resources: z.array(storedResourceSchema).max(100) }).strict();
export const resourceUpdateSchema = z.object({ ...documentFields, resources: z.array(editableResourceSchema).max(100) }).strict();
export type ResourceDocument = z.infer<typeof resourceDocumentSchema>;
export type ResourceUpdate = z.infer<typeof resourceUpdateSchema>;
export const serviceCatalog = serviceIds.map(id => ({
  id, capability: capabilities.includes(id as typeof capabilities[number]) ? id : "chat",
  input: id === "vision" ? "image-and-prompt" : id === "asr" ? "audio" : "messages",
  output: id === "asr" ? "transcript" : "chat-completion",
}));

// References deliberately retain legacy field-level/environment fallback, including future old-UI edits.
export function legacyResourceDocument(): ResourceDocument {
  return {
    schemaVersion: 1, revision: 0,
    resources: capabilities.map(scope => ({ id: `legacy-${scope}`, name: `Legacy ${scope}`, kind: "legacy", scope })),
    defaults: { chat: { resourceId: "legacy-chat" }, vision: { resourceId: "legacy-vision" }, asr: { resourceId: "legacy-asr" } },
    services: { chat: { inherit: true }, vision: { inherit: true }, asr: { inherit: true }, supervisor: { inherit: true },
      nutrition: { inherit: true }, recipe: { inherit: true }, operations: { inherit: true } },
  };
}

export function resolveResourceService(document: ResourceDocument, service: ServiceId,
  legacy: Record<typeof capabilities[number], AIProviderConfig>, values: Record<string, string>): AIProviderConfig & { source: string; resourceId: string } {
  const capability = capabilities.includes(service as typeof capabilities[number]) ? service as typeof capabilities[number] : "chat";
  const binding = document.services[service];
  if ("inherit" in binding && capability === "chat" && service !== "chat") {
    const parent = resolveResourceService(document, "chat", legacy, values);
    const model = values[`AI_${service.toUpperCase()}_MODEL`]?.trim() || parent.model;
    const resource = document.resources.find(item => item.id === parent.resourceId);
    if (resource?.kind === "connection" && !resource.models.some(item => item.id === model && item.capabilities.includes("chat"))) {
      throw new Error("继承的角色模型与资源能力不兼容，请显式绑定角色服务");
    }
    return { ...parent, model, source: `service:chat${model !== parent.model ? "+legacy-role-model" : ""}` };
  }
  const target = "inherit" in binding ? document.defaults[capability] : binding;
  const resource = document.resources.find(item => item.id === target.resourceId);
  if (!resource) throw new Error("业务服务引用的资源不存在");
  const source = "inherit" in binding ? `default:${capability}` : `service:${service}`;
  if (resource.kind === "legacy") {
    if (resource.scope !== capability) throw new Error("资源能力与业务服务不兼容");
    return { ...legacy[resource.scope], ...(target.model ? { model: target.model } : {}), source, resourceId: resource.id };
  }
  const model = resource.models.find(item => item.id === target.model);
  if (!model || !model.capabilities.includes(capability)) throw new Error("模型能力与业务服务不兼容");
  return { apiKey: resource.apiKey, baseUrl: resource.baseUrl.replace(/\/$/, ""), model: model.id, source, resourceId: resource.id };
}

export function validateResourceDocument(document: ResourceDocument) {
  if (new Set(document.resources.map(item => item.id)).size !== document.resources.length) throw new Error("资源标识重复");
  for (const resource of document.resources) {
    if (resource.kind === "connection" && new Set(resource.models.map(item => item.id)).size !== resource.models.length) throw new Error("模型标识重复");
  }
  const dummy = { apiKey: "", baseUrl: "https://legacy.invalid", model: "legacy" };
  const legacy = { chat: dummy, vision: dummy, asr: dummy };
  // Validate defaults even when every service has an override.
  for (const capability of capabilities) resolveResourceService({ ...document, services: { ...document.services, [capability]: { inherit: true } } }, capability, legacy, {});
  for (const service of serviceIds) resolveResourceService(document, service, legacy, {});
}

export function applyResourceUpdate(input: ResourceUpdate, previous: ResourceDocument): ResourceDocument {
  const resources = input.resources.map(resource => {
    if (resource.kind === "legacy") return resource;
    const { credential, ...fields } = resource;
    const old = previous.resources.find(item => item.id === resource.id);
    const apiKey = credential?.action === "replace" ? credential.value : credential?.action === "clear" ? ""
      : old?.kind === "connection" ? old.apiKey : "";
    return { ...fields, apiKey };
  });
  const document = resourceDocumentSchema.parse({ ...input, resources, revision: previous.revision + 1 });
  validateResourceDocument(document);
  return document;
}

export function publicResourceDocument(document: ResourceDocument) {
  return { ...document, resources: document.resources.map(resource => {
    if (resource.kind === "legacy") return resource;
    const { apiKey, ...fields } = resource;
    return { ...fields, hasApiKey: !!apiKey, maskedKey: apiKey ? "********" : "", verification: "unverified" as const };
  }) };
}
