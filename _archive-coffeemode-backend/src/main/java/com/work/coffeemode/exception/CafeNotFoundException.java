package com.work.coffeemode.exception;

public class CafeNotFoundException extends RuntimeException implements ClientException {

    private static final Integer CODE = 404;
    private static final String DEFAULT_MESSAGE = "Cafe not found";

    public CafeNotFoundException() {
        super(DEFAULT_MESSAGE);
    }

    public CafeNotFoundException(String message) {
        super(message);
    }

    public CafeNotFoundException(String message, Throwable cause) {
        super(message, cause);
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