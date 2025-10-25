package com.work.coffeemode.config;

import com.google.api.gax.core.NoCredentialsProvider;
import com.google.api.gax.rpc.FixedHeaderProvider;
import com.google.api.gax.rpc.HeaderProvider;
import com.google.maps.places.v1.PlacesClient;
import com.google.maps.places.v1.PlacesSettings;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

@Configuration
public class GooglePlacesSdkConfig {

    @Value("${GOOGLE_MAPS_API_KEY:${google.maps.api.key:}}")
    private String googleApiKey;

    @Bean
    public PlacesClient placesClient() throws IOException {
        if (googleApiKey == null || googleApiKey.isBlank()) {
            throw new RuntimeException(
                    "Google Maps API key is not configured (env GOOGLE_MAPS_API_KEY or property google.maps.api.key)");
        }

        Map<String, String> headers = new HashMap<>();
        headers.put("x-goog-api-key", googleApiKey);
        // NOTE: For now request all fields to simplify integration; tighten this later
        // per-request
        headers.put("x-goog-fieldmask", "*");
        HeaderProvider headerProvider = FixedHeaderProvider.create(headers);

        PlacesSettings settings = PlacesSettings.newBuilder()
                .setHeaderProvider(headerProvider)
                // Use API key auth; disable ADC credentials
                .setCredentialsProvider(NoCredentialsProvider.create())
                .build();

        return PlacesClient.create(settings);
    }
}