package com.work.coffeemode.service;

import com.work.coffeemode.dto.googlemaps.ResolveGoogleMapsResponse;
import com.work.coffeemode.model.GooglePoi;
import com.work.coffeemode.repository.GooglePoiRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.mongodb.core.geo.GeoJsonPoint;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Slf4j
@Service
@RequiredArgsConstructor
public class GoogleMapsService {

    private final GooglePoiRepository googlePoiRepository;
    private final RestTemplate restTemplate;

    public ResolveGoogleMapsResponse resolveGoogleMapsLink(String sharingUrl) {
        log.info("Resolving Google Maps sharing URL: {}", sharingUrl);

        // Check if we already have this URL in our database
        Optional<GooglePoi> existingPoi = googlePoiRepository.findByOriginalSharingUrl(sharingUrl);
        if (existingPoi.isPresent()) {
            log.info("Found existing POI for URL: {}", sharingUrl);
            return convertToResponse(existingPoi.get());
        }

        try {
            // Follow redirects to get the full Google Maps URL
            String resolvedUrl = followRedirects(sharingUrl);
            log.info("Resolved URL: {}", resolvedUrl);

            // Check if we already have this resolved URL
            Optional<GooglePoi> existingResolvedPoi = googlePoiRepository.findByResolvedFullUrl(resolvedUrl);
            if (existingResolvedPoi.isPresent()) {
                log.info("Found existing POI for resolved URL: {}", resolvedUrl);
                return convertToResponse(existingResolvedPoi.get());
            }

            // Parse the resolved URL to extract place information
            GooglePoi googlePoi = parseGoogleMapsUrl(resolvedUrl, sharingUrl);
            
            // Save to database
            GooglePoi savedPoi = googlePoiRepository.save(googlePoi);
            log.info("Saved new POI with ID: {}", savedPoi.getStringId());

            return convertToResponse(savedPoi);

        } catch (Exception e) {
            log.error("Error resolving Google Maps URL: {}", sharingUrl, e);
            throw new RuntimeException("Failed to resolve Google Maps URL: " + e.getMessage(), e);
        }
    }

    private String followRedirects(String url) {
        try {
            // Use HEAD request to follow redirects without downloading content
            ResponseEntity<String> response = restTemplate.exchange(
                URI.create(url),
                HttpMethod.HEAD,
                null,
                String.class
            );

            // Get the final URL after all redirects
            URI finalUri = response.getHeaders().getLocation();
            if (finalUri != null) {
                return finalUri.toString();
            }

            // If no Location header, try GET request
            ResponseEntity<String> getResponse = restTemplate.getForEntity(url, String.class);
            return getResponse.getHeaders().getLocation() != null ? 
                getResponse.getHeaders().getLocation().toString() : url;

        } catch (Exception e) {
            log.warn("Failed to follow redirects for URL: {}, using original URL", url, e);
            return url;
        }
    }

    private GooglePoi parseGoogleMapsUrl(String resolvedUrl, String originalUrl) {
        log.info("Parsing Google Maps URL: {}", resolvedUrl);

        GooglePoi.GooglePoiBuilder builder = GooglePoi.builder()
                .originalSharingUrl(originalUrl)
                .resolvedFullUrl(resolvedUrl)
                .googleMapsUrl(resolvedUrl)
                .createdAt(LocalDateTime.now())
                .updatedAt(LocalDateTime.now());

        try {
            // Decode URL to handle encoded characters
            String decodedUrl = URLDecoder.decode(resolvedUrl, StandardCharsets.UTF_8);
            
            // Extract place name from URL path
            String placeName = extractPlaceName(decodedUrl);
            if (placeName != null) {
                builder.name(placeName);
            }

            // Extract coordinates from URL parameters
            Double[] coordinates = extractCoordinates(decodedUrl);
            if (coordinates != null && coordinates.length == 2) {
                // MongoDB GeoJsonPoint expects [longitude, latitude]
                builder.location(new GeoJsonPoint(coordinates[1], coordinates[0]));
            }

            // Extract place ID if available
            String placeId = extractPlaceId(decodedUrl);
            if (placeId != null) {
                builder.placeId(placeId);
            }

            // Extract additional parameters
            extractAdditionalInfo(decodedUrl, builder);

        } catch (Exception e) {
            log.warn("Error parsing Google Maps URL: {}", resolvedUrl, e);
        }

        return builder.build();
    }

    private String extractPlaceName(String url) {
        // Pattern to extract place name from URL path like /place/Place+Name/
        Pattern placePattern = Pattern.compile("/place/([^/@]+)");
        Matcher matcher = placePattern.matcher(url);
        
        if (matcher.find()) {
            String placeName = matcher.group(1);
            // Replace + with spaces and decode URL encoding
            return placeName.replace("+", " ").replace("%20", " ");
        }
        
        return null;
    }

    private Double[] extractCoordinates(String url) {
        // Pattern to extract coordinates like @1.2769969,103.8369899,17z
        Pattern coordPattern = Pattern.compile("@(-?\\d+\\.\\d+),(-?\\d+\\.\\d+)");
        Matcher matcher = coordPattern.matcher(url);
        
        if (matcher.find()) {
            try {
                double latitude = Double.parseDouble(matcher.group(1));
                double longitude = Double.parseDouble(matcher.group(2));
                return new Double[]{latitude, longitude};
            } catch (NumberFormatException e) {
                log.warn("Failed to parse coordinates from URL: {}", url, e);
            }
        }
        
        return null;
    }

    private String extractPlaceId(String url) {
        // Pattern to extract place ID like !1s0x31da196ef0f8f641:0x1dd15592bb6ae1ae
        Pattern placeIdPattern = Pattern.compile("!1s([^!]+)");
        Matcher matcher = placeIdPattern.matcher(url);
        
        if (matcher.find()) {
            return matcher.group(1);
        }
        
        return null;
    }

    private void extractAdditionalInfo(String url, GooglePoi.GooglePoiBuilder builder) {
        // This method can be extended to extract more information from the URL
        // For now, we'll set some basic defaults
        
        // Try to determine category from URL patterns
        if (url.toLowerCase().contains("cafe") || url.toLowerCase().contains("coffee")) {
            builder.category("Cafe");
        } else if (url.toLowerCase().contains("restaurant")) {
            builder.category("Restaurant");
        } else if (url.toLowerCase().contains("hotel")) {
            builder.category("Hotel");
        } else {
            builder.category("Place");
        }
    }

    private ResolveGoogleMapsResponse convertToResponse(GooglePoi googlePoi) {
        Double latitude = null;
        Double longitude = null;
        
        if (googlePoi.getLocation() != null) {
            latitude = googlePoi.getLocation().getY(); // latitude
            longitude = googlePoi.getLocation().getX(); // longitude
        }

        return ResolveGoogleMapsResponse.builder()
                .id(googlePoi.getStringId())
                .name(googlePoi.getName())
                .placeId(googlePoi.getPlaceId())
                .address(googlePoi.getAddress())
                .latitude(latitude)
                .longitude(longitude)
                .originalSharingUrl(googlePoi.getOriginalSharingUrl())
                .resolvedFullUrl(googlePoi.getResolvedFullUrl())
                .googleMapsUrl(googlePoi.getGoogleMapsUrl())
                .phoneNumber(googlePoi.getPhoneNumber())
                .website(googlePoi.getWebsite())
                .category(googlePoi.getCategory())
                .rating(googlePoi.getRating())
                .reviewCount(googlePoi.getReviewCount())
                .createdAt(googlePoi.getCreatedAt() != null ? googlePoi.getCreatedAt().toString() : null)
                .updatedAt(googlePoi.getUpdatedAt() != null ? googlePoi.getUpdatedAt().toString() : null)
                .build();
    }
}
