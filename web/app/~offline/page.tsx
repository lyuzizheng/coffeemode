export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold text-foreground">You&apos;re offline</h1>
      <p className="mt-3 text-muted">
        CoffeeMode needs a connection to load fresh cafe data. Some previously
        viewed pages may still work.
      </p>
    </main>
  );
}
