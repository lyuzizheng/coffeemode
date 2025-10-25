package com.work.coffeemode.controller;

import com.work.coffeemode.dto.googlemaps.ResolvePlaceRequest;
import com.work.coffeemode.dto.googlemaps.ResolvePlaceResponse;
import com.work.coffeemode.model.UnifiedResponse;
import com.work.coffeemode.service.GooglePlacesService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@Slf4j
@RestController
@RequestMapping("/api/google-maps")
@RequiredArgsConstructor
public class GoogleMapsController {

    private final GooglePlacesService googlePlacesService;

    @PostMapping("/resolve")
    public ResponseEntity<UnifiedResponse<ResolvePlaceResponse>> resolveGoogleMapsLink(
            @RequestBody ResolvePlaceRequest request) {

        log.info("Received request to resolve place by metadata: title='{}' description='{}'", request.getTitle(),
                request.getDescription());

        ResolvePlaceResponse response = googlePlacesService.resolvePlaceFromMetadata(request.getTitle(),
                request.getDescription(), request.getUrl());

        UnifiedResponse<ResolvePlaceResponse> unifiedResponse = UnifiedResponse.<ResolvePlaceResponse>builder()
                .code(200)
                .message(response.isSkippedDetails() ? "Place exists; skipped details fetch"
                        : "Place resolved and details stored")
                .data(response)
                .build();

        return ResponseEntity.ok(unifiedResponse);
    }
}
