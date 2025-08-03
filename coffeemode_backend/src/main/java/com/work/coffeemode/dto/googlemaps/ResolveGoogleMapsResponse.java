package com.work.coffeemode.dto.googlemaps;

import com.work.coffeemode.model.Cafe;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ResolveGoogleMapsResponse {
    
    // Optional: If the resolved place already exists in our cafe database
    private Cafe cafe;
    
    // Optional: The resolved Google Maps data
    private GoogleMapsData googleMapsData;
    
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class GoogleMapsData {
        private String id;
        private String name;
        private String featureId;  // Changed from placeId to featureId for accuracy
        private String address;
        private Double latitude;
        private Double longitude;
        private String originalSharingUrl;
        private String resolvedFullUrl;
        private String googleMapsUrl;
        private String phoneNumber;
        private String website;
        private String category;
        private Double rating;
        private Integer reviewCount;
        private String createdAt;
        private String updatedAt;
    }
}
