package com.work.coffeemode.config;

import com.google.api.gax.core.NoCredentialsProvider;
import com.google.api.gax.rpc.FixedHeaderProvider;
import com.google.api.gax.rpc.HeaderProvider;
import com.google.maps.places.v1.PlacesClient;
import com.google.maps.places.v1.PlacesSettings;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.annotation.Qualifier;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

@Configuration
public class GooglePlacesSdkConfig {

    @Value("${google.maps.api.key}")
    private String googleApiKey;

    private PlacesSettings buildSettingsWithHeaders(Map<String, String> headers) throws IOException {
        HeaderProvider headerProvider = FixedHeaderProvider.create(headers);
        return PlacesSettings.newBuilder()
                .setHeaderProvider(headerProvider)
                .setCredentialsProvider(NoCredentialsProvider.create())
                .build();
    }

    @Bean
    @Qualifier("placesTextClient")
    PlacesClient placesTextClient() throws IOException {
        if (googleApiKey == null || googleApiKey.isBlank()) {
            throw new RuntimeException(
                    "Google Maps API key is not configured (env GOOGLE_MAPS_API_KEY or property google.maps.api.key)");
        }
        Map<String, String> headers = new HashMap<>();
        headers.put("x-goog-api-key", googleApiKey);
        // Text Search 只返回 id：places.id
        headers.put("x-goog-fieldmask", "places.id");
        return PlacesClient.create(buildSettingsWithHeaders(headers));
    }

    @Bean
    @Qualifier("placesDetailsClient")
    PlacesClient placesDetailsClient() throws IOException {
        if (googleApiKey == null || googleApiKey.isBlank()) {
            throw new RuntimeException(
                    "Google Maps API key is not configured (env GOOGLE_MAPS_API_KEY or property google.maps.api.key)");
        }
        Map<String, String> headers = new HashMap<>();
        headers.put("x-goog-api-key", googleApiKey);
        // Place Details 返回全部字段：*
        headers.put("x-goog-fieldmask", "*");
        return PlacesClient.create(buildSettingsWithHeaders(headers));
    }
}