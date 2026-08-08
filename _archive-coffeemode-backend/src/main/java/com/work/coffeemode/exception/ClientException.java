package com.work.coffeemode.exception;

/**
 * Interface for exceptions originating from client errors (e.g., bad request,
 * not found).
 * Typically corresponds to HTTP 4xx status codes.
 * Concrete implementations must provide specific codes and messages.
 */
public interface ClientException {
    Integer getCode();

    String getMessage();
}