package com.work.coffeemode.model;

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
    private Features features;
    private double averageRating;
    private int totalReviews;
    private List<String> images;
    private String website;
    private Map<String, String> openingHours;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Location {
        private String address;
        private double lat;
        private double lng;
    }

    public void setLocationFromCoordinates(double lat, double lng) {
        this.location = new GeoJsonPoint(lng, lat);  // Note: GeoJsonPoint constructor is (longitude, latitude)
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Features {
        private int wifiSpeedMbps;
        private boolean outletsAvailable;
        private String quietnessLevel;
        private int seatingCapacity;
    }
}