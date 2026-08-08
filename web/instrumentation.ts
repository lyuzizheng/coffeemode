export async function register(): Promise<void> {
  if (typeof process === "undefined" || process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { registerPoolShutdownHandlers } = await import("@/lib/db/postgres");
  registerPoolShutdownHandlers();
}
