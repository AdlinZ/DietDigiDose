import { AuthSessionCoordinator } from "./authSessionCoordinator";

describe("auth session mutation ordering", () => {
  it("does not let stale logout cleanup delete a newer login", async () => {
    const coordinator = new AuthSessionCoordinator();
    let storedToken: string | null = null;
    const originalGeneration = await coordinator.authenticate(async () => {
      storedToken = "old-token";
    });
    let releaseCleanup!: () => void;
    const cleanupStarted = new Promise<void>((resolve) => { releaseCleanup = resolve; });

    const staleLogout = (async () => {
      await cleanupStarted;
      return coordinator.clearIfCurrent(originalGeneration, async () => {
        storedToken = null;
      });
    })();
    await coordinator.authenticate(async () => {
      storedToken = "new-token";
    });
    releaseCleanup();

    await expect(staleLogout).resolves.toBe(false);
    expect(storedToken).toBe("new-token");
  });

  it("serializes a requested logout before a later login", async () => {
    const coordinator = new AuthSessionCoordinator();
    let storedToken: string | null = null;
    const generation = await coordinator.authenticate(async () => { storedToken = "old-token"; });
    const logout = coordinator.clearIfCurrent(generation, async () => { storedToken = null; });
    const login = coordinator.authenticate(async () => { storedToken = "new-token"; });

    await Promise.all([logout, login]);
    expect(storedToken).toBe("new-token");
  });
});
