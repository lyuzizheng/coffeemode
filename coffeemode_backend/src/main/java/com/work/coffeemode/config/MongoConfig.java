package com.work.coffeemode.config;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.index.GeoSpatialIndexType;
import org.springframework.data.mongodb.core.index.GeospatialIndex;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;

@Configuration
public class MongoConfig {

    @Autowired
    private MongoTemplate mongoTemplate;

    @Bean
    CommandLineRunner commandLineRunner(MongoTemplate mongoTemplate) {
        return strings -> {
            mongoTemplate.indexOps("cafes")
                    .ensureIndex(new GeospatialIndex("location")
                            .typed(GeoSpatialIndexType.GEO_2DSPHERE));
        };
    }
}