package com.work.coffeemode.repository;

import com.work.coffeemode.model.GooglePoi;
import org.bson.types.ObjectId;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface GooglePoiRepository extends MongoRepository<GooglePoi, ObjectId> {
    
    Optional<GooglePoi> findByOriginalSharingUrl(String originalSharingUrl);
    Optional<GooglePoi> findByFeatureId(String featureId);
    Optional<GooglePoi> findByResolvedFullUrl(String resolvedFullUrl);
}
