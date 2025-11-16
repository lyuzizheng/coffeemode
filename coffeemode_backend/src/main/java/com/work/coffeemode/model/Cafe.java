package com.work.coffeemode.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.work.coffeemode.dto.cafe.ImageDTO;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.bson.types.ObjectId;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.index.GeoSpatialIndexed;
import org.springframework.data.mongodb.core.index.GeoSpatialIndexType;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.geo.GeoJsonPoint;

import java.time.Duration;
import java.util.List;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "cafes")
public class Cafe {

    @Id
    private ObjectId id;
    private String name;
    // GeoJsonPoint stores location as [longitude, latitude] - MongoDB's preferred format
    @GeoSpatialIndexed(type = GeoSpatialIndexType.GEO_2DSPHERE)
    private GeoJsonPoint location;
    private String address;
    private Features features;
    private double averageRating;
    private int totalReviews;
    private List<ImageDTO> images;
    private String website;
    private Map<String, String> openingHours;
    private ExternalReferences externalReferences;

    // Custom getter for JSON serialization
    @JsonProperty("id")
    public String getStringId() {
        return id != null ? id.toString() : null;
    }

    // Ignore the ObjectId when serializing to JSON
    @JsonIgnore
    public ObjectId getId() {
        return id;
    }
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Features {
        private Boolean wifiAvailable;
        private Boolean outletsAvailable;
        private String quietnessLevel;  // "quiet", "moderate", "noisy"
        private String temperature;      // "cold", "just right", "warm"
        private Boolean unlimitedDuration;
        private Duration limitDuration;
        private Double googleRating;

    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ExternalReferences {
        @Indexed
        private String googlePlace;   // Google Place ID

        @Indexed
        private String redbookId;     // RedNote POI ID
    }
}