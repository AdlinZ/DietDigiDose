import { useCallback, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { inventoryApi, kitchenwareApi, recipesApi } from "@/services/api";
import type { ApiFetch } from "@/services/api/client";
import { getUserStorageKey } from "@/utils/userStorage";
import type { InventoryItem, KitchenwareCatalogItem, KitchenwareItem, Recipe } from "./types";

type InventorySection = "inventory" | "recipes" | "kitchenware";

const OFFLINE_RECIPES_CACHE_KEY = "offline_cache_recipes";
const OFFLINE_INVENTORY_CACHE_KEY = "offline_cache_inventory";

export function useInventoryData(authFetch: ApiFetch, isAuthenticated: boolean, userId?: number | null) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [kitchenware, setKitchenware] = useState<KitchenwareItem[]>([]);
  const [kitchenwareCatalog, setKitchenwareCatalog] = useState<KitchenwareCatalogItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingRecipes, setLoadingRecipes] = useState(false);
  const [loadingKitchenware, setLoadingKitchenware] = useState(true);
  const [sectionErrors, setSectionErrors] = useState<Partial<Record<InventorySection, string>>>({});
  const inventoryCacheKey = getUserStorageKey(OFFLINE_INVENTORY_CACHE_KEY, userId);

  const refresh = useCallback(async () => {
    try {
      setLoadingRecipes(true);
      const data = (await recipesApi.listPage<Recipe>("?pageSize=100")).items;
      const validRecipes = Array.isArray(data) ? data : [];
      setRecipes(validRecipes);
      setSectionErrors((current) => ({ ...current, recipes: undefined }));
      void AsyncStorage.setItem(OFFLINE_RECIPES_CACHE_KEY, JSON.stringify(validRecipes));
    } catch (error) {
      console.error("Fetch recipes error:", error);
      try {
        const cached = await AsyncStorage.getItem(OFFLINE_RECIPES_CACHE_KEY);
        if (cached) {
          setRecipes(JSON.parse(cached));
          setSectionErrors((current) => ({ ...current, recipes: "离线模式 · 已载入本地历史食谱缓存" }));
        } else {
          setSectionErrors((current) => ({ ...current, recipes: "菜谱暂时无法加载，库存功能仍可使用" }));
        }
      } catch {
        setSectionErrors((current) => ({ ...current, recipes: "菜谱暂时无法加载，库存功能仍可使用" }));
      }
    } finally {
      setLoadingRecipes(false);
    }

    if (!isAuthenticated) {
      setItems([]);
      setKitchenware([]);
      setKitchenwareCatalog([]);
      setLoadingItems(false);
      setLoadingKitchenware(false);
      setSectionErrors((current) => ({ ...current, inventory: undefined, kitchenware: undefined }));
      return;
    }

    setLoadingItems(true);
    setLoadingKitchenware(true);
    const [inventoryResult, kitchenwareResult, catalogResult] = await Promise.allSettled([
      inventoryApi.list(authFetch),
      kitchenwareApi.list<KitchenwareItem>(authFetch),
      kitchenwareApi.catalog<KitchenwareCatalogItem>(authFetch),
    ]);

    if (inventoryResult.status === "fulfilled") {
      const validItems = Array.isArray(inventoryResult.value) ? inventoryResult.value : [];
      setItems(validItems);
      setSectionErrors((current) => ({ ...current, inventory: undefined }));
      if (inventoryCacheKey) void AsyncStorage.setItem(inventoryCacheKey, JSON.stringify(validItems));
    } else {
      console.error("Fetch inventory error:", inventoryResult.reason);
      try {
        const cached = inventoryCacheKey ? await AsyncStorage.getItem(inventoryCacheKey) : null;
        if (cached) {
          setItems(JSON.parse(cached));
          setSectionErrors((current) => ({ ...current, inventory: "离线模式 · 已载入本地食材快照" }));
        } else {
          setSectionErrors((current) => ({ ...current, inventory: "库存暂时无法加载，菜谱与厨具仍可使用" }));
        }
      } catch {
        setSectionErrors((current) => ({ ...current, inventory: "库存暂时无法加载，菜谱与厨具仍可使用" }));
      }
    }

    if (kitchenwareResult.status === "fulfilled") {
      setKitchenware(Array.isArray(kitchenwareResult.value) ? kitchenwareResult.value : []);
    }
    if (catalogResult.status === "fulfilled") {
      setKitchenwareCatalog(Array.isArray(catalogResult.value) ? catalogResult.value : []);
    }
    if (kitchenwareResult.status === "rejected" || catalogResult.status === "rejected") {
      const error = kitchenwareResult.status === "rejected"
        ? kitchenwareResult.reason
        : catalogResult.status === "rejected"
          ? catalogResult.reason
          : undefined;
      console.error("Fetch kitchenware error:", error);
      setSectionErrors((current) => ({ ...current, kitchenware: "部分厨具数据暂时无法加载，其他功能仍可使用" }));
    } else {
      setSectionErrors((current) => ({ ...current, kitchenware: undefined }));
    }
    setLoadingItems(false);
    setLoadingKitchenware(false);
  }, [authFetch, inventoryCacheKey, isAuthenticated]);

  return {
    items,
    setItems,
    recipes,
    kitchenware,
    kitchenwareCatalog,
    loadingItems,
    loadingRecipes,
    loadingKitchenware,
    sectionErrors,
    refresh,
  };
}
