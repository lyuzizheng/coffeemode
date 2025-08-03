package com.work.coffeemode.exception;

/**
 * Exception thrown when feature ID cannot be extracted from a Google Maps URL.
 * This is typically a client-side issue where the URL doesn't contain
 * the expected feature ID pattern or the URL structure is unexpected.
 */
public class FeatureIdExtractionException extends RuntimeException implements ClientException {

    private static final Integer CODE = 4001;
    private static final String DEFAULT_MESSAGE = "Could not extract feature ID from Google Maps URL";

    public FeatureIdExtractionException() {
        super(DEFAULT_MESSAGE);
    }

    public FeatureIdExtractionException(String message) {
        super(message);
    }

    public FeatureIdExtractionException(String message, Throwable cause) {
        super(message, cause);
    }

    public FeatureIdExtractionException(Throwable cause) {
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
