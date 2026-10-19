import path from "node:path";

import { vi } from "vitest";

// Database tests run as one user, the owner, whose data is in the test
// database itself (DATABASE_URL's) and whose files are in DOSSIER_DATA_DIR,
// unless a test names another with runWithTenant(). In the app, code without
// a signed-in user throws instead (see src/lib/tenant.ts).
vi.mock("@/lib/tenant", async (importOriginal) => {
  const tenant = await importOriginal<typeof import("@/lib/tenant")>();
  const { env } = await import("@/lib/env");
  const currentTenant = () => {
    try {
      return tenant.currentTenant();
    } catch {
      return tenant.DEFAULT_TENANT;
    }
  };
  return {
    ...tenant,
    currentTenant,
    dataDir: () => {
      const id = currentTenant();
      return id === tenant.DEFAULT_TENANT ? env.DOSSIER_DATA_DIR : path.join(env.DOSSIER_DATA_DIR, "users", id);
    },
  };
});
