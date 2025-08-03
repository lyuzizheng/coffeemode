package com.work.coffeemode.controller;

import com.work.coffeemode.dto.cafe.SearchNearbyRequest;
import com.work.coffeemode.dto.cafe.CreateCafeRequest;
import com.work.coffeemode.exception.CafeNotFoundException;
import com.work.coffeemode.model.Cafe;
import com.work.coffeemode.service.CafeService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.data.mongodb.core.geo.GeoJsonPoint;
import java.util.List;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/cafes")
public class CafeController {

    @Autowired
    private CafeService cafeService;

    @PostMapping
    public ResponseEntity<Map<String, Object>> createCafe(@Valid @RequestBody CreateCafeRequest request) {
        GeoJsonPoint geoJsonPoint = new GeoJsonPoint(
                request.getLocation().getCoordinates()[0], // longitude
                request.getLocation().getCoordinates()[1] // latitude
        );

        Cafe.Features features = null;
        if (request.getFeatures() != null) {
            features = Cafe.Features.builder()
                    .wifiAvailable(request.getFeatures().getWifiAvailable())
                    .outletsAvailable(request.getFeatures().getOutletsAvailable())
                    .quietnessLevel(request.getFeatures().getQuietnessLevel())
                    .temperature(request.getFeatures().getTemperature())
                    .build();
        }

        Cafe.ExternalReferences externalReferences = null;
        if (request.getExternalReferences() != null) {
            externalReferences = Cafe.ExternalReferences.builder()
                    .googlePlace(request.getExternalReferences().getGooglePlace())
                    .redbookLinks(request.getExternalReferences().getRedbookLinks())
                    .build();
        }

        Cafe cafe = Cafe.builder()
                .name(request.getName())
                .location(geoJsonPoint)
                .address(request.getAddress())
                .features(features)
                .images(request.getImages())
                .website(request.getWebsite())
                .openingHours(request.getOpeningHours())
                .externalReferences(externalReferences)
                .averageRating(0.0)
                .totalReviews(0)
                .build();

        Cafe savedCafe = cafeService.createCafe(cafe);

        Map<String, Object> response = new HashMap<>();
        response.put("code", 201);
        response.put("message", "Cafe created successfully");
        response.put("data", savedCafe);

        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @GetMapping("/nearby")
    public List<Cafe> findNearbyCafes(
            @Valid @RequestBody SearchNearbyRequest request) {
        return cafeService.findNearbyCafes(
                request.getLongitude(),
                request.getLatitude(),
                request.getRadiusInKm());
    }

    @GetMapping
    public List<Cafe> getAllCafes() {
        return cafeService.getAllCafes();
    }

    @GetMapping("/{id}")
    public Cafe getCafeById(@PathVariable String id){
        return cafeService.getCafeById(id);
    }

    @PutMapping("/{id}")
    public Cafe updateCafe(@PathVariable String id, @RequestBody Cafe cafe) {
        return cafeService.updateCafe(id, cafe);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteCafe(@PathVariable String id){
        cafeService.deleteCafe(id);
        return ResponseEntity.ok().build();
    }
}