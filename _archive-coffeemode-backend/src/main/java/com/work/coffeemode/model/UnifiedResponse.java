package com.work.coffeemode.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UnifiedResponse<T> {

    private Integer code;
    private String message;
    private T data;

    /**
     * Success response with data.
     */
    public static <T> UnifiedResponse<T> success(T data) {
        return new UnifiedResponse<>(200, "Success", data);
    }

    /**
     * Success response without data.
     */
    public static <T> UnifiedResponse<T> success() {
        return new UnifiedResponse<>(200, "Success", null);
    }

    /**
     * Error response.
     */
    public static <T> UnifiedResponse<T> error(Integer code, String message) {
        return new UnifiedResponse<>(code, message, null);
    }
}