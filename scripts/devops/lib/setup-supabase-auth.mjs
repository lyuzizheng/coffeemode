/**
 * Supabase Auth verification for the provisioning suite (BRAWUKA-745
 * decomposition; executable: `scripts/devops/setup-supabase.mjs`).
 *
 * One concrete operation, `verifySupabaseAuth`, owns step 6: the Auth health
 * endpoint, the settings snapshot, and a real `@supabase/supabase-js` session /
 * OAuth-redirect round trip. The failure policy is the executable's original
 * one: a `--verify-only` run reports an auth error and continues (the run is
 * inspecting, not changing, so an unreachable Auth service must not fail the
 * gate), every other run throws so the CLI exits 1.
 *
 * The `createClient` factory arrives as an argument: the executable resolves
 * `@supabase/supabase-js` from `web/package.json` and keeps that dependency
 * ownership, so this module imports nothing from the web package.
 */

/**
 * Skip, or verify, Supabase Auth for the resolved config.
 *
 * @param {{ createClient: Function, config: object, log: { info: Function, step: Function, success: Function, warn: Function, error: Function, dim: Function } }} deps
 * @returns {Promise<void>}
 */
export async function verifySupabaseAuth({ createClient, config, log }) {
  if (config.skipAuth) {
    log.info("Supabase Auth check skipped via --skip-auth.");
    return;
  }
  if (!config.supabaseUrl) return;

  log.step(6, "Verifying Supabase Auth Health & OAuth Connectivity");
  const activeKey = config.serviceRoleKey || config.anonKey;

  try {
    // 1. Health check
    log.info(`Probing Supabase Auth health endpoint: ${config.supabaseUrl}/auth/v1/health`);
    const healthRes = await fetch(`${config.supabaseUrl}/auth/v1/health`, {
      headers: activeKey ? { apikey: activeKey } : {},
    });
    if (!healthRes.ok) {
      throw new Error(`Auth health check returned HTTP ${healthRes.status}: ${healthRes.statusText}`);
    }
    const healthData = await healthRes.json();
    log.success(`Auth Service is HEALTHY: ${healthData.description || "GoTrue"} (v${healthData.version || "unknown"})`);

    // 2. Settings check
    if (activeKey) {
      log.info(`Querying Auth settings endpoint: ${config.supabaseUrl}/auth/v1/settings`);
      const settingsRes = await fetch(`${config.supabaseUrl}/auth/v1/settings`, {
        headers: { apikey: activeKey },
      });
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        log.success("Auth settings retrieved successfully.");
        log.dim(`External Providers: Google=${Boolean(settings.external?.google)}, Apple=${Boolean(settings.external?.apple)}, Email=${Boolean(settings.external?.email)}`);
        log.dim(`Signups: ${settings.disable_signup ? "DISABLED" : "ENABLED"}`);
      }
    }

    // 3. Supabase JS Client integration test
    if (config.anonKey) {
      log.info("Testing @supabase/supabase-js client session & OAuth redirect generation...");
      const supabase = createClient(config.supabaseUrl, config.anonKey);

      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) {
        throw sessionErr;
      }
      log.success(`Client getSession() succeeded without error (current session: ${sessionData.session ? "active" : "null"}).`);

      const testRedirectUrl = "https://cafemood.app/auth/callback";
      const { data: oauthData, error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: testRedirectUrl },
      });

      if (oauthErr) {
        log.warn(`signInWithOAuth notice: ${oauthErr.message}`);
      } else if (oauthData?.url) {
        log.success("OAuth authorization URL generation verified successfully.");
        log.dim(`Generated URL: ${oauthData.url.slice(0, 70)}...`);
      }
    }
  } catch (authErr) {
    log.error(`Supabase Auth verification error: ${authErr.message}`);
    if (!config.verifyOnly) {
      throw authErr;
    }
  }
}
