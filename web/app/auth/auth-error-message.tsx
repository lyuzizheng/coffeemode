"use client";

interface AuthErrorMessageProps {
  error?: string;
}

export function AuthErrorMessage({ error }: AuthErrorMessageProps) {
  if (!error) return null;

  return (
    <p
      className="mt-2 text-center text-xs text-danger"
      role="alert"
      aria-live="polite"
    >
      {error}
    </p>
  );
}
