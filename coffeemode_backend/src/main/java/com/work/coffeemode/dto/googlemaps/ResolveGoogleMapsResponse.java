package com.work.coffeemode.dto.googlemaps;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ResolveGoogleMapsResponse {
    
    private String id;
    private String name;
    private String placeId;
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
