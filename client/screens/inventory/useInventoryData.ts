import { useCallback, useState } from "react";

import { inventoryApi, kitchenwareApi, recipesApi } from "@/services/api";
import type { ApiFetch } from "@/services/api/client";
import type { InventoryItem, KitchenwareCatalogItem, KitchenwareItem, Recipe } from "./types";

type InventorySection = "inventory" | "recipes" | "kitchenware";

export function useInventoryData(authFetch: ApiFetch, isAuthenticated: boolean) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [kitchenware, setKitchenware] = useState<KitchenwareItem[]>([]);
  const [kitchenwareCatalog, setKitchenwareCatalog] = useState<KitchenwareCatalogItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingRecipes, setLoadingRecipes] = useState(false);
  const [loadingKitchenware, setLoadingKitchenware] = useState(true);
  const [sectionErrors, setSectionErrors] = useState<Partial<Record<InventorySection, string>>>({});

  const refresh = useCallback(async () => {
    try {
      setLoadingRecipes(true);
      const data = (await recipesApi.listPage<Recipe>("?pageSize=100")).items;
      setRecipes(Array.isArray(data) ? data : []);
      setSectionErrors((current) => ({ ...current, recipes: undefined }));
    } catch (error) {
      console.error("Fetch recipes error:", error);
      setSectionErrors((current) => ({ ...current, recipes: "菜谱暂时无法加载，库存功能仍可使用" }));
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
      setItems(Array.isArray(inventoryResult.value) ? inventoryResult.value : []);
      setSectionErrors((current) => ({ ...current, inventory: undefined }));
    } else {
      console.error("Fetch inventory error:", inventoryResult.reason);
      setSectionErrors((current) => ({ ...current, inventory: "库存暂时无法加载，菜谱与厨具仍可使用" }));
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
  }, [authFetch, isAuthenticated]);

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
