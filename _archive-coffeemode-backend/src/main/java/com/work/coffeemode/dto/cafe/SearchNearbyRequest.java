package com.work.coffeemode.dto.cafe;

import lombok.Data;
import jakarta.validation.constraints.NotNull;

@Data
public class SearchNearbyRequest {
    @NotNull(message = "Longitude is required")
    private Double longitude;

    @NotNull(message = "Latitude is required")
    private Double latitude;

    private Double radiusInKm = 3.0; // Default 1km radius
}