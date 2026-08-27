import { useCallback, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { inventoryApi, kitchenwareApi, recipesApi } from "@/services/api";
import type { ApiFetch } from "@/services/api/client";
import { getUserStorageKey } from "@/utils/userStorage";
import { appendUniqueItemsByKey } from "@/utils/pagination";
import type { InventoryItem, KitchenwareCatalogItem, KitchenwareItem, Recipe } from "./types";

type InventorySection = "inventory" | "recipes" | "kitchenware";

const OFFLINE_RECIPES_CACHE_KEY = "offline_cache_recipes";
const OFFLINE_INVENTORY_CACHE_KEY = "offline_cache_inventory";
const RECIPE_PAGE_SIZE = 24;

export interface RecipeCatalogQuery {
  category?: string;
  search?: string;
  maxCookTime?: number;
}

function isDefaultRecipeQuery(query: RecipeCatalogQuery) {
  return !query.category && !query.search && !query.maxCookTime;
}

export function buildRecipePageQuery(query: RecipeCatalogQuery, cursor?: string | null) {
  const params = new URLSearchParams({ pageSize: String(RECIPE_PAGE_SIZE) });
  if (query.category) params.set("category", query.category);
  if (query.search) params.set("search", query.search);
  if (query.maxCookTime) params.set("maxCookTime", String(query.maxCookTime));
  if (cursor) params.set("cursor", cursor);
  return `?${params.toString()}`;
}

export function useInventoryData(authFetch: ApiFetch, isAuthenticated: boolean, userId?: number | null) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeTotal, setRecipeTotal] = useState(0);
  const [recipeNextCursor, setRecipeNextCursor] = useState<string | null>(null);
  const [kitchenware, setKitchenware] = useState<KitchenwareItem[]>([]);
  const [kitchenwareCatalog, setKitchenwareCatalog] = useState<KitchenwareCatalogItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingRecipes, setLoadingRecipes] = useState(false);
  const [loadingMoreRecipes, setLoadingMoreRecipes] = useState(false);
  const [loadingKitchenware, setLoadingKitchenware] = useState(true);
  const [sectionErrors, setSectionErrors] = useState<Partial<Record<InventorySection, string>>>({});
  const inventoryCacheKey = getUserStorageKey(OFFLINE_INVENTORY_CACHE_KEY, userId);
  const recipesRef = useRef<Recipe[]>([]);
  const recipeQueryRef = useRef<RecipeCatalogQuery>({});
  const recipeNextCursorRef = useRef<string | null>(null);
  const recipeGenerationRef = useRef(0);
  const loadingMoreRecipesRef = useRef(false);

  const reloadRecipes = useCallback(async (query: RecipeCatalogQuery = recipeQueryRef.current) => {
    const normalizedQuery = {
      category: query.category?.trim() || undefined,
      search: query.search?.trim() || undefined,
      maxCookTime: query.maxCookTime && query.maxCookTime > 0 ? query.maxCookTime : undefined,
    };
    recipeQueryRef.current = normalizedQuery;
    const generation = recipeGenerationRef.current + 1;
    recipeGenerationRef.current = generation;
    recipeNextCursorRef.current = null;
    setRecipeNextCursor(null);
    loadingMoreRecipesRef.current = false;
    setLoadingMoreRecipes(false);
    setLoadingRecipes(true);
    try {
      const page = await recipesApi.listPage<Recipe>(buildRecipePageQuery(normalizedQuery));
      if (recipeGenerationRef.current !== generation) return;
      const validRecipes = Array.isArray(page.items) ? page.items : [];
      recipesRef.current = validRecipes;
      setRecipes(validRecipes);
      setRecipeTotal(Number.isFinite(Number(page.total)) ? Math.max(0, Number(page.total)) : validRecipes.length);
      recipeNextCursorRef.current = page.nextCursor || null;
      setRecipeNextCursor(page.nextCursor || null);
      setSectionErrors((current) => ({ ...current, recipes: undefined }));
      if (isDefaultRecipeQuery(normalizedQuery)) {
        void AsyncStorage.setItem(OFFLINE_RECIPES_CACHE_KEY, JSON.stringify(validRecipes));
      }
    } catch (error) {
      if (recipeGenerationRef.current !== generation) return;
      console.error("Fetch recipes error:", error);
      if (isDefaultRecipeQuery(normalizedQuery)) {
        try {
          const cached = await AsyncStorage.getItem(OFFLINE_RECIPES_CACHE_KEY);
          if (cached) {
            const cachedRecipes = JSON.parse(cached) as Recipe[];
            recipesRef.current = Array.isArray(cachedRecipes) ? cachedRecipes : [];
            setRecipes(recipesRef.current);
            setRecipeTotal(recipesRef.current.length);
            setSectionErrors((current) => ({ ...current, recipes: "离线模式 · 已载入本地历史食谱缓存" }));
            return;
          }
        } catch {
          // Fall through to the regular unavailable state.
        }
      }
      recipesRef.current = [];
      setRecipes([]);
      setRecipeTotal(0);
      setSectionErrors((current) => ({ ...current, recipes: "菜谱暂时无法加载，库存功能仍可使用" }));
    } finally {
      if (recipeGenerationRef.current === generation) setLoadingRecipes(false);
    }
  }, []);

  const loadMoreRecipes = useCallback(async () => {
    const cursor = recipeNextCursorRef.current;
    if (!cursor || loadingMoreRecipesRef.current) return;
    const generation = recipeGenerationRef.current;
    loadingMoreRecipesRef.current = true;
    setLoadingMoreRecipes(true);
    try {
      const page = await recipesApi.listPage<Recipe>(buildRecipePageQuery(recipeQueryRef.current, cursor));
      if (recipeGenerationRef.current !== generation) return;
      const incoming = Array.isArray(page.items) ? page.items : [];
      const mergedRecipes = appendUniqueItemsByKey(recipesRef.current, incoming, (recipe) => recipe.id);
      recipesRef.current = mergedRecipes;
      setRecipes(mergedRecipes);
      setRecipeTotal((current) => Number.isFinite(Number(page.total))
        ? Math.max(0, Number(page.total))
        : Math.max(current, mergedRecipes.length));
      recipeNextCursorRef.current = page.nextCursor || null;
      setRecipeNextCursor(page.nextCursor || null);
      setSectionErrors((current) => ({ ...current, recipes: undefined }));
      if (isDefaultRecipeQuery(recipeQueryRef.current)) {
        void AsyncStorage.setItem(OFFLINE_RECIPES_CACHE_KEY, JSON.stringify(mergedRecipes));
      }
    } catch (error) {
      if (recipeGenerationRef.current === generation) {
        console.error("Fetch more recipes error:", error);
        setSectionErrors((current) => ({ ...current, recipes: "后续菜谱加载失败，点击可重试" }));
      }
    } finally {
      if (recipeGenerationRef.current === generation) {
        loadingMoreRecipesRef.current = false;
        setLoadingMoreRecipes(false);
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    void reloadRecipes(recipeQueryRef.current);

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
  }, [authFetch, inventoryCacheKey, isAuthenticated, reloadRecipes]);

  return {
    items,
    setItems,
    recipes,
    recipeTotal,
    hasMoreRecipes: recipeNextCursor !== null,
    kitchenware,
    kitchenwareCatalog,
    loadingItems,
    loadingRecipes,
    loadingMoreRecipes,
    loadingKitchenware,
    sectionErrors,
    refresh,
    reloadRecipes,
    loadMoreRecipes,
  };
}
