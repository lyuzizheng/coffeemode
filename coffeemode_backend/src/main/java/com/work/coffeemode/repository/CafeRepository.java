package com.work.coffeemode.repository;

import com.work.coffeemode.model.Cafe;
import org.bson.types.ObjectId;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.data.mongodb.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface CafeRepository extends MongoRepository<Cafe, String> {

    Optional<Cafe> findById(ObjectId id);

    List<Cafe> findByName(String name);

    @Query("{'location.address': {$regex: ?0, $options: 'i'}}")
    List<Cafe> findByLocationAddress(String address);

    List<Cafe> findByAverageRatingGreaterThanEqual(double rating);

    List<Cafe> findByFeaturesWifiSpeedMbpsGreaterThan(int speed);

    @Query("{'features.quietnessLevel': ?0}")
    List<Cafe> findByQuietnessLevel(String level);
}