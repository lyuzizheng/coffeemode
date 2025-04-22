package com.work.coffeemode.repository;

import com.work.coffeemode.model.Cafe;
import org.bson.types.ObjectId;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.data.mongodb.repository.Query;
import org.springframework.stereotype.Repository;
import org.springframework.data.geo.Distance;
import org.springframework.data.geo.Point;

import java.util.List;
import java.util.Optional;

@Repository
public interface CafeRepository extends MongoRepository<Cafe, ObjectId> {

    Optional<Cafe> findById(ObjectId id);

    List<Cafe> findByName(String name);

    @Query("{'location.address': {$regex: ?0, $options: 'i'}}")
    List<Cafe> findByLocationAddress(String address);

    // Find Cafes near a given point within a certain distance
    List<Cafe> findByLocationNear(Point point, Distance distance);

    // Find Cafes within a given distance in kilometers
    @Query("{'location': {$nearSphere: {$geometry: {type: 'Point', coordinates: [?0, ?1]}, $maxDistance: ?2}}}")
    List<Cafe> findByLocationNearSphere(double longitude, double latitude, double maxDistanceInMeters);

    // Find Cafes by category near a point
    List<Cafe> findByCategoryAndLocationNear(String category, Point point, Distance distance);


    List<Cafe> findByAverageRatingGreaterThanEqual(double rating);

    List<Cafe> findByFeaturesWifiSpeedMbpsGreaterThan(int speed);

    @Query("{'features.quietnessLevel': ?0}")
    List<Cafe> findByQuietnessLevel(String level);
}