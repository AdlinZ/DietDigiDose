import { useCallback, useState } from "react";
import { communityApi, dietApi, healthApi, inventoryApi, recipesApi, type ApiFetch } from "@/services/api";
import { getInventoryStatus } from "@/utils/inventory";
import type { DietRecord, HealthLog, InventoryItem, Post, Recipe } from "./types";

export function useHomeData(authFetch: ApiFetch, isAuthenticated: boolean, today: string) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [expiringItems, setExpiringItems] = useState<InventoryItem[]>([]);
  const [todayRecords, setTodayRecords] = useState<DietRecord[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [healthLogs, setHealthLogs] = useState<HealthLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const requests: Array<Promise<unknown>> = [recipesApi.list(), communityApi.posts()];
      if (isAuthenticated) {
        requests.push(
          inventoryApi.list(authFetch),
          dietApi.list(authFetch, today),
          healthApi.list(authFetch),
        );
      }
      const [recipesData, postsData, inventoryData, dietData, healthData] = await Promise.all(requests);
      setRecipes(Array.isArray(recipesData) ? recipesData as Recipe[] : []);
      setPosts(Array.isArray(postsData) ? postsData as Post[] : []);

      if (isAuthenticated) {
        const allInventory = Array.isArray(inventoryData) ? inventoryData as InventoryItem[] : [];
        setInventoryItems(allInventory);
        setTodayRecords(Array.isArray(dietData) ? dietData as DietRecord[] : []);
        setHealthLogs(Array.isArray(healthData) ? healthData as HealthLog[] : []);
        setExpiringItems(allInventory.filter((item) => getInventoryStatus(item).freshness === "expiring"));
      } else {
        setInventoryItems([]);
        setTodayRecords([]);
        setHealthLogs([]);
        setExpiringItems([]);
      }
    } catch (error) {
      console.error("Home fetchData error:", error);
      setError(error instanceof Error ? error.message : "首页数据加载失败");
    } finally {
      setLoading(false);
    }
  }, [authFetch, isAuthenticated, today]);

  return { recipes, inventoryItems, expiringItems, todayRecords, posts, healthLogs, loading, error, refresh };
}
