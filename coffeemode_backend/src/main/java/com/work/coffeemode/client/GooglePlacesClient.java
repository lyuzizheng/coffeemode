package com.work.coffeemode.client;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.maps.places.v1.GetPlaceRequest;
import com.google.maps.places.v1.Place;
import com.google.maps.places.v1.PlaceName;
import com.google.maps.places.v1.PlacesClient;
import com.google.maps.places.v1.SearchTextRequest;
import com.google.maps.places.v1.SearchTextResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;

@Slf4j
@Component
@RequiredArgsConstructor
public class GooglePlacesClient {

    private final PlacesClient placesClient;

    public String findPlaceIdFromText(String query) {
        // Build Text Search (New) request using SDK
        SearchTextRequest request = SearchTextRequest.newBuilder()
                .setTextQuery(query)
                .build();

        SearchTextResponse response = placesClient.searchText(request);
        if (response.getPlacesCount() == 0) {
            log.warn("Text search returned no places for query: {}", query);
            return null;
        }
        Place first = response.getPlaces(0);
        String id = first.getId();
        log.info("Found placeId via SDK text search: {}", id);
        return id;
    }

    public Map<String, Object> getPlaceDetails(String placeId) {
        // Build GetPlace request using SDK
        GetPlaceRequest request = GetPlaceRequest.newBuilder()
                .setName(PlaceName.of(placeId).toString())
                .build();

        Place place = placesClient.getPlace(request);

        // Convert typed Place protobuf message to a JSON-backed Map and wrap under
        // 'result'
        try {
            String json = com.google.protobuf.util.JsonFormat.printer()
                    .includingDefaultValueFields()
                    .print(place);
            ObjectMapper mapper = new ObjectMapper();
            Map<String, Object> resultMap = mapper.readValue(json, new TypeReference<Map<String, Object>>() {
            });
            Map<String, Object> wrapper = new HashMap<>();
            wrapper.put("result", resultMap);
            return wrapper;
        } catch (Exception e) {
            log.error("Failed to convert Place to Map", e);
            return new HashMap<>();
        }
    }
}