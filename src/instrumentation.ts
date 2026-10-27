// Next.js calls register() once when a server starts, before it handles any
// request. It doesn't run during `next build`, so the build needs no secrets.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkEnvOnStartup } = await import("@/lib/env");
    checkEnvOnStartup();

    // Each signed-in user's own database, brought up to date like the main one.
    const { forEachTenant, migrateTenants } = await import("@/lib/tenants");
    const { logServerError } = await import("@/lib/log");
    await migrateTenants().catch((error: unknown) => logServerError("startup", error));

    // AI jobs left running by the previous process can't finish (E6-7).
    const { recoverInterruptedJobs } = await import("@/lib/jobs/runner");
    await forEachTenant("startup", () => recoverInterruptedJobs()).catch((error: unknown) => logServerError("startup", error));

    // Finished jobs, with what they were given and wrote, are deleted after a while.
    const { startJobSweep } = await import("@/lib/jobs/retention");
    startJobSweep();

    // Nightly backups at 03:00, while they're switched on (E10-7).
    const { startBackupSchedule } = await import("@/lib/backup-schedule");
    startBackupSchedule();

    // The inbox check, while a Google account is connected (E15-3).
    const { startInboxSchedule } = await import("@/lib/google/sync");
    startInboxSchedule();

    // The job agent's daily run, while it's on (E16-4).
    const { startAgentSchedule } = await import("@/lib/agent/schedule");
    startAgentSchedule();

    // Startups' daily refresh, once it was refreshed by hand and while the screen is in use (#222).
    const { startStartupsSchedule } = await import("@/lib/startups/schedule");
    startStartupsSchedule();

    // The notices below read the owner's settings (the main database).
    const { DEFAULT_TENANT, runWithTenant } = await import("@/lib/tenant");

    // DOSSIER_JOBS_SOURCE=arbeitsagentur: the log says what that choice means (#223).
    const { arbeitsagenturStartupNotice, loadJobSearchConfig } = await import("@/lib/job-search/config");
    try {
      const notice = arbeitsagenturStartupNotice(await runWithTenant(DEFAULT_TENANT, () => loadJobSearchConfig()));
      if (notice) console.log(notice);
    } catch (error) {
      logServerError("job search", error);
    }

    // DOSSIER_TELEMETRY, when set, is the usage ping's answer on record (#172).
    // Then the log says what the ping sends while it's on, or how to answer
    // while nobody has.
    const { recordEnvChoice, usagePingNotice } = await import("@/lib/usage-ping");
    const { loadSettings } = await import("@/lib/settings-data");
    try {
      // Everyone's answer on record, since the variable is the server's.
      await forEachTenant("usage ping", () => recordEnvChoice());
      const notice = usagePingNotice(await runWithTenant(DEFAULT_TENANT, () => loadSettings()));
      if (notice) console.log(notice);
    } catch (error) {
      logServerError("usage ping", error);
    }
  }
}
