package com.work.coffeemode.exception;

/**
 * Interface for exceptions originating from server-side errors (e.g., internal
 * errors, service unavailability).
 * Typically corresponds to HTTP 5xx status codes.
 * Concrete implementations must provide specific codes and messages.
 */
public interface ServerException {
    Integer getCode();

    String getMessage();
}