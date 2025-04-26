package com.work.coffeemode.service.impl;

import com.work.coffeemode.model.Cafe;
import com.work.coffeemode.repository.CafeRepository;
import com.work.coffeemode.service.CafeService;
import org.bson.types.ObjectId;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.Optional;
import java.util.HashMap;
import java.util.Map;

@Service
public class CafeServiceImpl implements CafeService {

    @Autowired
    private CafeRepository cafeRepository;

    @Override
    public Cafe createCafe(Cafe cafe) {
        return cafeRepository.save(cafe);
    }

    @Override
    public List<Cafe> findNearbyCafes(double longitude, double latitude, double radiusInKm) {
        // Convert kilometers to meters for MongoDB
        double radiusInMeters = radiusInKm * 1000;
        return cafeRepository.findNearbyCafes(longitude, latitude, radiusInMeters);
    }
    @Override
    public List<Cafe> getAllCafes() {
        return cafeRepository.findAll();
    }

    @Override
    public Map<String, Object> getCafeById(String id) {
        Map<String, Object> response = new HashMap<>();

        try {
            ObjectId objectId = new ObjectId(id);
            var cafe = cafeRepository.findById(objectId);

            if (cafe.isEmpty()) {
                response.put("code", 404);
                response.put("message", "Cafe not found");
                response.put("data", null);
                return response;
            }

            response.put("code", 200);
            response.put("message", "Success");
            response.put("data", cafe.get());
            return response;
        } catch (IllegalArgumentException e) {
            response.put("code", 400);
            response.put("message", "Invalid ID format");
            response.put("data", null);
            return response;
        }
    }

    @Override
    public Cafe updateCafe(String id, Cafe cafeDetails) throws Exception {
        ObjectId objectId = new ObjectId(id);
        Cafe cafe = cafeRepository.findById(objectId)
            .orElseThrow(() -> new Exception("Cafe not found"));

        cafe.setName(cafeDetails.getName());
        cafe.setLocation(cafeDetails.getLocation());
        cafe.setAddress(cafeDetails.getAddress());
        cafe.setFeatures(cafeDetails.getFeatures());
        cafe.setImages(cafeDetails.getImages());
        cafe.setWebsite(cafeDetails.getWebsite());
        cafe.setOpeningHours(cafeDetails.getOpeningHours());

        return cafeRepository.save(cafe);
    }

    @Override
    public void deleteCafe(String id) {
        ObjectId objectId = new ObjectId(id);
        cafeRepository.deleteById(objectId);
    }
}