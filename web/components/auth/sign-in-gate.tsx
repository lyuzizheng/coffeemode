"use client";

import { SignInButton } from "./sign-in-button";

interface SignInGateProps {
  /** Caller-owned copy — the namespace that knows the user's context. */
  message: string;
  /** Safe return path after the OAuth callback (e.g. a resume deep link). */
  next?: string;
}

/**
 * Recovery surface for a request rejected with 401: wherever a session can
 * expire mid-flow (BRAWUKA-124, BRAWUKA-212), the user gets the same gate
 * instead of a retry affordance that can never succeed.
 */
export function SignInGate({ message, next }: SignInGateProps) {
  return (
    <div className="rounded-md border border-separator bg-surface-secondary p-4 text-center">
      <p className="mb-3 text-sm">{message}</p>
      <div className="flex flex-col gap-2">
        <SignInButton provider="apple" variant="primary" next={next} />
        <SignInButton provider="google" variant="outline" next={next} />
      </div>
    </div>
  );
}
