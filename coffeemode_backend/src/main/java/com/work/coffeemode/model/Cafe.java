package com.work.coffeemode.model;

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
import org.springframework.data.mongodb.core.geo.GeoJsonPoint;

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


    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Features {
        private Boolean wifiAvailable;
        private Boolean outletsAvailable;
        private String quietnessLevel;  // "quiet", "moderate", "noisy"
        private String temperature;      // "cold", "just right", "warm"
    }
}