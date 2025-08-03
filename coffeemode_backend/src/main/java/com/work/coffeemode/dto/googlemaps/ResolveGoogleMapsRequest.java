package com.work.coffeemode.dto.googlemaps;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ResolveGoogleMapsRequest {
    
    private String sharingUrl;
}
