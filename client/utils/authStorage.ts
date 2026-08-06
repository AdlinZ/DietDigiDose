import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const TOKEN_KEY = "@auth_token";
export const AUTH_USER_KEY = "@auth_user";

export async function getStoredToken() {
  if (Platform.OS === "web") {
    const sessionToken = globalThis.sessionStorage?.getItem(TOKEN_KEY) || null;
    if (sessionToken) return sessionToken;
    const legacyToken = await AsyncStorage.getItem(TOKEN_KEY);
    if (legacyToken) globalThis.sessionStorage?.setItem(TOKEN_KEY, legacyToken);
    await AsyncStorage.removeItem(TOKEN_KEY);
    return legacyToken;
  }
  const secureToken = await SecureStore.getItemAsync(TOKEN_KEY);
  if (secureToken) return secureToken;

  const legacyToken = await AsyncStorage.getItem(TOKEN_KEY);
  if (legacyToken) {
    await SecureStore.setItemAsync(TOKEN_KEY, legacyToken);
    await AsyncStorage.removeItem(TOKEN_KEY);
  }
  return legacyToken;
}

export async function setStoredToken(token: string) {
  if (Platform.OS === "web") {
    globalThis.sessionStorage?.setItem(TOKEN_KEY, token);
    await AsyncStorage.removeItem(TOKEN_KEY);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await AsyncStorage.removeItem(TOKEN_KEY);
}

export async function removeStoredToken() {
  if (Platform.OS === "web") {
    globalThis.sessionStorage?.removeItem(TOKEN_KEY);
    await AsyncStorage.removeItem(TOKEN_KEY);
    return;
  }
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    AsyncStorage.removeItem(TOKEN_KEY),
  ]);
}
