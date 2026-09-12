import { interventionPreferencesUpdateSchema, type InterventionPreferencesUpdate } from "@dietdigidose/contracts";
import { publicFetch, requestJson } from "./client";
const path = "/api/v1/notifications/intervention-preferences";
export const interventionApi = {
  preferences: (token: string) => requestJson(publicFetch,path,{ headers: { Authorization: `Bearer ${token}` } },interventionPreferencesUpdateSchema),
  savePreferences: (token: string,input: InterventionPreferencesUpdate) => requestJson(publicFetch,path,{
    method: "PUT",headers: { Authorization: `Bearer ${token}` },body: JSON.stringify(interventionPreferencesUpdateSchema.parse(input)),
  },interventionPreferencesUpdateSchema),
};
