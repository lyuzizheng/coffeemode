package com.work.coffeemode.dto.cafe;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;
import java.util.Objects;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CreateCafeRequest {
    @NotBlank(message = "Name is required")
    private String name;

    @NotNull(message = "Location is required")
    private Location location;

    @NotBlank(message = "Address is required")
    private String address;
    private Features features;
    private List<ImageDTO> images;
    private String website;
    private Map<String, String> openingHours;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Location {
        private final String type = "Point";

        @NotNull(message = "Coordinates are required")
        private double[] coordinates;  // [longitude, latitude]
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Features {
        private Boolean wifiAvailable;
        private Boolean outletsAvailable;
        private String quietnessLevel;  // "quiet", "moderate", "noisy"
        private String temperature;     // "cold", "just right", "warm"
    }
}