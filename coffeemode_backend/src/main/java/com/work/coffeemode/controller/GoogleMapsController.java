package com.work.coffeemode.controller;

import com.work.coffeemode.dto.googlemaps.ResolveGoogleMapsRequest;
import com.work.coffeemode.dto.googlemaps.ResolveGoogleMapsResponse;
import com.work.coffeemode.model.UnifiedResponse;
import com.work.coffeemode.service.GoogleMapsService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@Slf4j
@RestController
@RequestMapping("/api/google-maps")
@RequiredArgsConstructor
public class GoogleMapsController {

    private final GoogleMapsService googleMapsService;

    @PostMapping("/resolve")
    public ResponseEntity<UnifiedResponse<ResolveGoogleMapsResponse>> resolveGoogleMapsLink(
            @RequestBody ResolveGoogleMapsRequest request) {
        
        log.info("Received request to resolve Google Maps URL: {}", request.getSharingUrl());
        
        try {
            ResolveGoogleMapsResponse response = googleMapsService.resolveGoogleMapsLink(request.getSharingUrl());
            
            UnifiedResponse<ResolveGoogleMapsResponse> unifiedResponse = UnifiedResponse.<ResolveGoogleMapsResponse>builder()
                    .code(200)
                    .message("Google Maps link resolved successfully")
                    .data(response)
                    .build();
            
            return ResponseEntity.ok(unifiedResponse);
            
        } catch (Exception e) {
            log.error("Error resolving Google Maps link: {}", request.getSharingUrl(), e);
            
            UnifiedResponse<ResolveGoogleMapsResponse> errorResponse = UnifiedResponse.<ResolveGoogleMapsResponse>builder()
                    .code(500)
                    .message("Failed to resolve Google Maps link: " + e.getMessage())
                    .data(null)
                    .build();
            
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(errorResponse);
        }
    }
}
