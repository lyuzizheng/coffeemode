package com.work.coffeemode.service.impl;

import com.work.coffeemode.exception.CafeNotFoundException;
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
    public Cafe getCafeById(String id) {

        ObjectId objectId = new ObjectId(id);
        var cafe = cafeRepository.findById(objectId);
        if (cafe.isEmpty()) {
            throw new CafeNotFoundException();
        }
        return cafe.get();
    }

    @Override
    public Cafe updateCafe(String id, Cafe cafeDetails) {
        ObjectId objectId = new ObjectId(id);
        Cafe cafe = cafeRepository.findById(objectId)
                .orElseThrow(() -> new CafeNotFoundException());

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