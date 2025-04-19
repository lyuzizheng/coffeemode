package com.work.coffeemode.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.bson.types.ObjectId;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

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
    private Location location;
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