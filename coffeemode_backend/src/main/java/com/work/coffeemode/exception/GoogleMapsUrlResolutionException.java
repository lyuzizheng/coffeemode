package com.work.coffeemode.exception;

/**
 * Exception thrown when Google Maps URL resolution fails.
 * This is typically a server-side issue related to network connectivity,
 * external service availability, or URL parsing failures.
 */
public class GoogleMapsUrlResolutionException extends RuntimeException implements ServerException {

    private static final Integer CODE = 5001;
    private static final String DEFAULT_MESSAGE = "Failed to resolve Google Maps URL";

    public GoogleMapsUrlResolutionException() {
        super(DEFAULT_MESSAGE);
    }

    public GoogleMapsUrlResolutionException(String message) {
        super(message);
    }

    public GoogleMapsUrlResolutionException(String message, Throwable cause) {
        super(message, cause);
    }

    public GoogleMapsUrlResolutionException(Throwable cause) {
        super(DEFAULT_MESSAGE, cause);
    }

    @Override
    public Integer getCode() {
        return CODE; // Google Maps URL resolution service failure
    }

    @Override
    public String getMessage() {
        return super.getMessage() != null ? super.getMessage() : DEFAULT_MESSAGE;
    }
}
