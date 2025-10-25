package com.work.coffeemode.config;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.index.GeoSpatialIndexType;
import org.springframework.data.mongodb.core.index.GeospatialIndex;
import org.springframework.data.mongodb.core.index.Index;
import org.springframework.data.domain.Sort;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;

@Configuration
public class MongoConfig {

    @Autowired
    private MongoTemplate mongoTemplate;

    @Bean
    CommandLineRunner commandLineRunner(MongoTemplate mongoTemplate) {
        return strings -> {
            // cafes: 2dsphere for nearby queries
            mongoTemplate.indexOps("cafes")
                    .ensureIndex(new GeospatialIndex("location")
                            .typed(GeoSpatialIndexType.GEO_2DSPHERE));

            // cafes: unique index on externalReferences.googlePlace (one cafe per placeId)
            mongoTemplate.indexOps("cafes")
                    .ensureIndex(new Index().on("externalReferences.googlePlace", Sort.Direction.ASC).unique());

            // google_place_poi: unique index on placeId for cache lookup
            mongoTemplate.indexOps("google_place_poi")
                    .ensureIndex(new Index().on("placeId", Sort.Direction.ASC).unique());

            // google_place_poi: 2dsphere index for spatial queries (if any)
            mongoTemplate.indexOps("google_place_poi")
                    .ensureIndex(new GeospatialIndex("location")
                            .typed(GeoSpatialIndexType.GEO_2DSPHERE));
        };
    }
}