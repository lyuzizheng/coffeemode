package com.work.coffeemode.service;

import com.work.coffeemode.client.GooglePlacesClient;
import com.work.coffeemode.dto.googlemaps.ResolvePlaceResponse;
import com.work.coffeemode.model.Cafe;
import com.work.coffeemode.model.GooglePlacePOI;
import com.work.coffeemode.repository.CafeRepository;
import com.work.coffeemode.repository.GooglePlacePoiRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.mongodb.core.geo.GeoJsonPoint;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Slf4j
@Service
@RequiredArgsConstructor
public class GooglePlacesService {

    private final GooglePlacesClient placesClient;
    private final GooglePlacePoiRepository poiRepository;
    private final CafeRepository cafeRepository;

    public ResolvePlaceResponse resolvePlaceFromMetadata(String title, String description, String url) {
        String query = buildQuery(title, description);
        log.info("Resolving placeId via text query: {}", query);

        String placeId = placesClient.findPlaceIdFromText(query);
        if (placeId == null) {
            throw new RuntimeException("No place candidates found for query: " + query);
        }

        // 优先从缓存（GooglePlacePOI）读取详情
        Optional<GooglePlacePOI> cached = poiRepository.findByPlaceId(placeId);
        GooglePlacePOI poi;
        boolean skippedDetails;
        if (cached.isPresent()) {
            poi = cached.get();
            skippedDetails = true;
            log.info("Found cached place details for placeId={}", placeId);
        } else {
            Map<String, Object> detailsResp = placesClient.getPlaceDetails(placeId);
            poi = mapDetailsToPoi(detailsResp, placeId);
            poi.setCreatedAt(LocalDateTime.now());
            poi.setUpdatedAt(LocalDateTime.now());
            poi = poiRepository.save(poi);
            skippedDetails = false;
            log.info("Stored place details cache for placeId={}", placeId);
        }

        // 基于 placeId 检查是否已有 Cafe；若不存在则从 POI 创建
        Optional<Cafe> cafeOpt = cafeRepository.findByExternalReferencesGooglePlace(placeId);
        Cafe cafe;
        if (cafeOpt.isPresent()) {
            cafe = cafeOpt.get();
        } else {
            cafe = mapPoiToCafe(poi);
            cafe = cafeRepository.save(cafe);
            log.info("Created cafe from cached place details. cafeId={}, placeId={}", cafe.getStringId(), placeId);
        }

        return ResolvePlaceResponse.builder()
                .placeId(placeId)
                .skippedDetails(skippedDetails)
                .cafe(cafe)
                .build();
    }

    private String buildQuery(String title, String description) {
        String t = title == null ? "" : title.trim();
        String d = description == null ? "" : description.trim();
        String q = (t + " " + d).trim();
        if (!q.toLowerCase().contains("cafe") && !q.contains("咖啡")) {
            q = (q + " cafe").trim();
        }
        return q;
    }

    private GooglePlacePOI mapDetailsToPoi(Map<String, Object> resp, String placeId) {
        Map<String, Object> result = (Map<String, Object>) resp.getOrDefault("result", new HashMap<>());
        String name = asString(result.get("name"));
        String address = asString(result.get("formatted_address"));
        String website = asString(result.get("website"));
        String phone = asString(result.get("formatted_phone_number"));

        // geometry
        GeoJsonPoint point = null;
        Map<String, Object> geometry = (Map<String, Object>) result.get("geometry");
        if (geometry != null) {
            Map<String, Object> location = (Map<String, Object>) geometry.get("location");
            if (location != null) {
                Double lat = asDouble(location.get("lat"));
                Double lng = asDouble(location.get("lng"));
                if (lat != null && lng != null) {
                    point = new GeoJsonPoint(lng, lat);
                }
            }
        }

        Map<String, String> openingHours = null;
        Map<String, Object> oh = (Map<String, Object>) result.get("opening_hours");
        if (oh != null) {
            List<String> weekdayText = (List<String>) oh.get("weekday_text");
            if (weekdayText != null && !weekdayText.isEmpty()) {
                openingHours = new HashMap<>();
                for (String line : weekdayText) {
                    int idx = line.indexOf(": ");
                    if (idx > 0) {
                        String day = line.substring(0, idx).trim();
                        String hours = line.substring(idx + 2).trim();
                        openingHours.put(day, hours);
                    }
                }
            }
        }

        Double rating = asDouble(result.get("rating"));
        Integer userRatingsTotal = asInt(result.get("user_ratings_total"));

        return GooglePlacePOI.builder()
                .placeId(placeId)
                .name(name)
                .formattedAddress(address)
                .location(point)
                .website(website)
                .formattedPhoneNumber(phone)
                .openingHours(openingHours)
                .rating(rating)
                .userRatingsTotal(userRatingsTotal)
                .rawDetails(result)
                .build();
    }

    private Cafe mapPoiToCafe(GooglePlacePOI poi) {
        Cafe.ExternalReferences refs = Cafe.ExternalReferences.builder()
                .googlePlace(poi.getPlaceId())
                .redbookId(null)
                .build();

        return Cafe.builder()
                .name(poi.getName())
                .location(poi.getLocation())
                .address(poi.getFormattedAddress())
                .features(null)
                .averageRating(poi.getRating() != null ? poi.getRating() : 0.0)
                .totalReviews(poi.getUserRatingsTotal() != null ? poi.getUserRatingsTotal() : 0)
                .images(null)
                .website(poi.getWebsite())
                .openingHours(poi.getOpeningHours())
                .externalReferences(refs)
                .build();
    }

    private String asString(Object o) { return o == null ? null : o.toString(); }
    private Double asDouble(Object o) { try { return o == null ? null : Double.valueOf(o.toString()); } catch (Exception e) { return null; } }
    private Integer asInt(Object o) { try { return o == null ? null : Integer.valueOf(o.toString()); } catch (Exception e) { return null; } }
}