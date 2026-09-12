import { interventionCardSchema, interventionPreferencesUpdateSchema, type InterventionPreferencesUpdate } from "@dietdigidose/contracts";
import { publicFetch, requestJson } from "./client";
const path = "/api/v1/notifications/intervention-preferences";
export const interventionApi = {
  card: (token: string,id: string) => requestJson(publicFetch,`/api/v1/notifications/interventions/${encodeURIComponent(id)}`,{ headers: { Authorization: `Bearer ${token}` } },interventionCardSchema),
  preferences: (token: string) => requestJson(publicFetch,path,{ headers: { Authorization: `Bearer ${token}` } },interventionPreferencesUpdateSchema),
  savePreferences: (token: string,input: InterventionPreferencesUpdate) => requestJson(publicFetch,path,{
    method: "PUT",headers: { Authorization: `Bearer ${token}` },body: JSON.stringify(interventionPreferencesUpdateSchema.parse(input)),
  },interventionPreferencesUpdateSchema),
};
