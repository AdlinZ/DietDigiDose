import { useCallback, useRef, useState } from "react";
import { communityApi, dietApi, healthApi, inventoryApi, recipesApi, type ApiFetch } from "@/services/api";
import { getInventoryStatus } from "@/utils/inventory";
import type { DietRecord, HealthLog, InventoryItem, Post, Recipe } from "./types";
import { recordCacheRender } from "@/services/api/cache";

export function useHomeData(authFetch: ApiFetch, isAuthenticated: boolean, today: string) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [expiringItems, setExpiringItems] = useState<InventoryItem[]>([]);
  const [todayRecords, setTodayRecords] = useState<DietRecord[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [healthLogs, setHealthLogs] = useState<HealthLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasRenderedData = useRef(false);

  const refresh = useCallback(async () => {
    const renderStartedAt = Date.now();
    setLoading(true);
    setError(null);
    const results = await Promise.allSettled([
      recipesApi.listPage("?pageSize=30"),
      communityApi.postPage("?pageSize=5").then((page) => page.items),
      isAuthenticated ? inventoryApi.list(authFetch) : Promise.resolve([]),
      isAuthenticated ? dietApi.list(authFetch, today) : Promise.resolve([]),
      isAuthenticated ? healthApi.list(authFetch) : Promise.resolve([]),
    ]);
    const [recipesResult, postsResult, inventoryResult, dietResult, healthResult] = results;
    const failedSections: string[] = [];

    if (recipesResult.status === "fulfilled") {
      const page = recipesResult.value as { items?: Recipe[]; nextCursor?: string | null };
      const nextRecipes = Array.isArray(page.items) ? page.items : [];
      setRecipes(nextRecipes);
      void recipesApi.prefetchCovers(nextRecipes);
      if (page.nextCursor) {
        void recipesApi.prefetchPage(`?pageSize=30&cursor=${encodeURIComponent(page.nextCursor)}`).catch(() => undefined);
      }
    } else failedSections.push("菜谱");
    if (postsResult.status === "fulfilled") {
      setPosts(Array.isArray(postsResult.value) ? postsResult.value as Post[] : []);
    } else failedSections.push("社区");

    if (isAuthenticated) {
      if (inventoryResult.status === "fulfilled") {
        const allInventory = Array.isArray(inventoryResult.value) ? inventoryResult.value as InventoryItem[] : [];
        setInventoryItems(allInventory);
        setExpiringItems(allInventory.filter((item) => getInventoryStatus(item).freshness === "expiring"));
      } else failedSections.push("库存");
      if (dietResult.status === "fulfilled") {
        setTodayRecords(Array.isArray(dietResult.value) ? dietResult.value as DietRecord[] : []);
      } else failedSections.push("饮食记录");
      if (healthResult.status === "fulfilled") {
        setHealthLogs(Array.isArray(healthResult.value) ? healthResult.value as HealthLog[] : []);
      } else failedSections.push("健康数据");
    } else {
      setInventoryItems([]);
      setTodayRecords([]);
      setHealthLogs([]);
      setExpiringItems([]);
    }

    if (failedSections.length > 0) {
      console.warn("Home partial fetch failure", failedSections);
      setError(`${failedSections.join("、")}暂时无法加载，其他内容仍可使用`);
    }
    setLoading(false);
    recordCacheRender(Date.now() - renderStartedAt, hasRenderedData.current);
    hasRenderedData.current = true;
  }, [authFetch, isAuthenticated, today]);

  return { recipes, inventoryItems, expiringItems, todayRecords, posts, healthLogs, loading, error, refresh };
}
