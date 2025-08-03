package com.work.coffeemode.service;

import com.work.coffeemode.dto.googlemaps.ResolveGoogleMapsResponse;
import com.work.coffeemode.exception.FeatureIdExtractionException;
import com.work.coffeemode.exception.GoogleMapsUrlResolutionException;
import com.work.coffeemode.model.Cafe;
import com.work.coffeemode.model.GooglePoi;
import com.work.coffeemode.repository.CafeRepository;
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
    private final CafeRepository cafeRepository;
    private final RestTemplate restTemplate;

    public ResolveGoogleMapsResponse resolveGoogleMapsLink(String sharingUrl) {
        log.info("Resolving Google Maps sharing URL: {}", sharingUrl);

        try {
            // Always resolve the full URL first
            String resolvedUrl = followRedirects(sharingUrl);
            log.info("Resolved URL: {}", resolvedUrl);

            // Extract feature ID from the resolved URL
            String featureId = extractFeatureId(resolvedUrl);
            if (featureId == null) {
                log.warn("Could not extract feature ID from resolved URL: {}", resolvedUrl);
                throw new FeatureIdExtractionException(
                    "Could not extract feature ID from Google Maps URL: " + resolvedUrl);
            }
            log.info("Extracted feature ID: {}", featureId);

            // First, check if a cafe already exists with this feature ID
            Optional<Cafe> existingCafe = cafeRepository.findByExternalReferencesGooglePlace(featureId);
            if (existingCafe.isPresent()) {
                log.info("Found existing cafe for feature ID: {}", featureId);
                // Create a minimal GooglePoi for response structure
                GooglePoi tempPoi = createTempPoiFromUrl(resolvedUrl, sharingUrl, featureId);
                return convertToResponseWithExistingCafe(existingCafe.get(), tempPoi);
            }

            // If no cafe found, check if we already have this POI by feature ID
            Optional<GooglePoi> existingPoi = googlePoiRepository.findByFeatureId(featureId);
            if (existingPoi.isPresent()) {
                log.info("Found existing POI for feature ID: {}", featureId);
                return convertToResponse(existingPoi.get());
            }

            // Parse the resolved URL to extract place information
            GooglePoi googlePoi = parseGoogleMapsUrl(resolvedUrl, sharingUrl);
            
            // Save to database
            GooglePoi savedPoi = googlePoiRepository.save(googlePoi);
            log.info("Saved new POI with ID: {} and feature ID: {}", savedPoi.getStringId(), featureId);

            return convertToResponse(savedPoi);

        } catch (FeatureIdExtractionException e) {
            // Re-throw feature ID extraction exceptions as-is
            throw e;
        } catch (Exception e) {
            log.error("Error resolving Google Maps URL: {}", sharingUrl, e);
            throw new GoogleMapsUrlResolutionException(
                "Failed to resolve Google Maps URL: " + e.getMessage(), e);
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

            // Extract feature ID if available
            String featureId = extractFeatureId(decodedUrl);
            if (featureId != null) {
                builder.featureId(featureId);
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

    private String extractFeatureId(String url) {
        // Pattern to extract feature ID like !1s0x31da196ef0f8f641:0x1dd15592bb6ae1ae
        Pattern featureIdPattern = Pattern.compile("!1s([^!]+)");
        Matcher matcher = featureIdPattern.matcher(url);
        
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
        // Check if a cafe already exists with this feature ID
        Cafe existingCafe = null;
        if (googlePoi.getFeatureId() != null) {
            existingCafe = cafeRepository.findByExternalReferencesGooglePlace(googlePoi.getFeatureId())
                    .orElse(null);
        }
        
        // Create Google Maps data sub-object
        Double latitude = null;
        Double longitude = null;
        
        if (googlePoi.getLocation() != null) {
            latitude = googlePoi.getLocation().getY(); // latitude
            longitude = googlePoi.getLocation().getX(); // longitude
        }

        ResolveGoogleMapsResponse.GoogleMapsData googleMapsData = ResolveGoogleMapsResponse.GoogleMapsData.builder()
                .id(googlePoi.getStringId())
                .name(googlePoi.getName())
                .featureId(googlePoi.getFeatureId())
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

        // Build the response with both optional fields
        return ResolveGoogleMapsResponse.builder()
                .cafe(existingCafe)  // Will be null if no cafe exists
                .googleMapsData(googleMapsData)
                .build();
    }

    private GooglePoi createTempPoiFromUrl(String resolvedUrl, String sharingUrl, String featureId) {
        // Create a temporary GooglePoi with basic information for response structure
        // This is used when we find an existing cafe but need GoogleMapsData for the response
        return GooglePoi.builder()
                .featureId(featureId)
                .originalSharingUrl(sharingUrl)
                .resolvedFullUrl(resolvedUrl)
                .googleMapsUrl(resolvedUrl)
                .createdAt(LocalDateTime.now())
                .updatedAt(LocalDateTime.now())
                .build();
    }

    private ResolveGoogleMapsResponse convertToResponseWithExistingCafe(Cafe existingCafe, GooglePoi tempPoi) {
        // When we have an existing cafe, we still want to provide the Google Maps data
        // but we don't need to parse the full URL since we already have the cafe
        
        ResolveGoogleMapsResponse.GoogleMapsData googleMapsData = ResolveGoogleMapsResponse.GoogleMapsData.builder()
                .featureId(tempPoi.getFeatureId())
                .originalSharingUrl(tempPoi.getOriginalSharingUrl())
                .resolvedFullUrl(tempPoi.getResolvedFullUrl())
                .googleMapsUrl(tempPoi.getGoogleMapsUrl())
                .createdAt(tempPoi.getCreatedAt() != null ? tempPoi.getCreatedAt().toString() : null)
                .updatedAt(tempPoi.getUpdatedAt() != null ? tempPoi.getUpdatedAt().toString() : null)
                .build();

        return ResolveGoogleMapsResponse.builder()
                .cafe(existingCafe)
                .googleMapsData(googleMapsData)
                .build();
    }
}
