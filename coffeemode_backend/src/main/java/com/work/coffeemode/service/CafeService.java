package com.work.coffeemode.service;

import com.work.coffeemode.model.Cafe;
import java.util.List;
import java.util.Optional;

public interface CafeService {
    Cafe createCafe(Cafe cafe);
    List<Cafe> getAllCafes();
    Optional<Cafe> getCafeById(String id);
    Cafe updateCafe(String id, Cafe cafe) throws Exception;
    void deleteCafe(String id);
}