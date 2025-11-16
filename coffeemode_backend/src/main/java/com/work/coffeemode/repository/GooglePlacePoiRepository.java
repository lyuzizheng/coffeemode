package com.work.coffeemode.repository;

import com.work.coffeemode.model.GooglePlacePOI;
import org.bson.types.ObjectId;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface GooglePlacePoiRepository extends MongoRepository<GooglePlacePOI, ObjectId> {
    Optional<GooglePlacePOI> findByPlaceId(String placeId);
}