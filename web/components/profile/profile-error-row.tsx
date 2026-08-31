"use client";

import { Button } from "@heroui/react";

export function ErrorRow({
  errorText,
  retryText,
  onRetry,
}: {
  errorText: string;
  retryText: string;
  onRetry: () => void;
}) {
  return (
    <div className="p-4 bg-surface border border-border rounded-xl flex items-center justify-between text-sm text-muted">
      <div className="flex items-center gap-2 text-warning">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 1.5L14.5 13.5H1.5L8 1.5Z" />
          <path d="M8 6V9" />
          <circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
        </svg>
        <span className="text-foreground">{errorText}</span>
      </div>
      <Button size="sm" variant="outline" onPress={onRetry}>
        {retryText}
      </Button>
    </div>
  );
}
