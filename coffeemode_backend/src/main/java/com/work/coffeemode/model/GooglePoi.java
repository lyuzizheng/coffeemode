package com.work.coffeemode.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
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

import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "google_poi")
public class GooglePoi {

    @Id
    private ObjectId id;
    
    private String name;
    private String placeId;
    private String address;
    
    // GeoJsonPoint stores location as [longitude, latitude] - MongoDB's preferred format
    @GeoSpatialIndexed(type = GeoSpatialIndexType.GEO_2DSPHERE)
    private GeoJsonPoint location;
    
    private String originalSharingUrl;
    private String resolvedFullUrl;
    private String googleMapsUrl;
    
    // Additional place information
    private String phoneNumber;
    private String website;
    private String category;
    private Double rating;
    private Integer reviewCount;
    
    // Metadata
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

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
}
