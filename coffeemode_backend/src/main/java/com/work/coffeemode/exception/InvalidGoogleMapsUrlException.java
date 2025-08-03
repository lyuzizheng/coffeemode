package com.work.coffeemode.exception;

/**
 * Exception thrown when a Google Maps URL is invalid or cannot be parsed.
 * This is typically a client-side issue where the provided URL format
 * is incorrect or doesn't contain the required information.
 */
public class InvalidGoogleMapsUrlException extends RuntimeException implements ClientException {

    private static final Integer CODE = 4002;
    private static final String DEFAULT_MESSAGE = "Invalid Google Maps URL format";

    public InvalidGoogleMapsUrlException() {
        super(DEFAULT_MESSAGE);
    }

    public InvalidGoogleMapsUrlException(String message) {
        super(message);
    }

    public InvalidGoogleMapsUrlException(String message, Throwable cause) {
        super(message, cause);
    }

    public InvalidGoogleMapsUrlException(Throwable cause) {
        super(DEFAULT_MESSAGE, cause);
    }

    @Override
    public Integer getCode() {
        return CODE;
    }

    @Override
    public String getMessage() {
        return super.getMessage() != null ? super.getMessage() : DEFAULT_MESSAGE;
    }
}
