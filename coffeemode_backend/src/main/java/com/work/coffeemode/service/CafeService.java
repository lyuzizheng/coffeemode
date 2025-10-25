package com.work.coffeemode.service;

import com.work.coffeemode.model.Cafe;
import java.util.List;
import java.util.Map;
import java.util.Optional;

public interface CafeService {
    Cafe createCafe(Cafe cafe);

    List<Cafe> findNearbyCafes(double longitude, double latitude, double radiusInKm);

    List<Cafe> getAllCafes();

    Cafe getCafeById(String id);

    Cafe updateCafe(String id, Cafe cafe);

    void deleteCafe(String id);
}