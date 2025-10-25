package com.work.coffeemode.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.bson.types.ObjectId;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.GeoSpatialIndexed;
import org.springframework.data.mongodb.core.index.GeoSpatialIndexType;
import org.springframework.data.mongodb.core.geo.GeoJsonPoint;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "google_place_poi")
public class GooglePlacePOI {

    @Id
    private ObjectId id;

    private String placeId;
    private String name;
    private String formattedAddress;

    @GeoSpatialIndexed(type = GeoSpatialIndexType.GEO_2DSPHERE)
    private GeoJsonPoint location; // [lng, lat]

    private String website;
    private String formattedPhoneNumber;

    private Map<String, String> openingHours; // weekday_text -> map

    private Double rating;
    private Integer userRatingsTotal;

    // 原始详情字段全量缓存
    private Map<String, Object> rawDetails;

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    @JsonProperty("id")
    public String getStringId() {
        return id != null ? id.toString() : null;
    }

    @JsonIgnore
    public ObjectId getId() {
        return id;
    }
}