package com.work.coffeemode.controller;

import com.work.coffeemode.model.Cafe;
import com.work.coffeemode.service.CafeService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;


@RestController
@RequestMapping("/api/cafes")
public class CafeController {

    @Autowired
    private CafeService cafeService;

    @PostMapping
    public ResponseEntity<Cafe> createCafe(@RequestBody Cafe cafe) {
        return ResponseEntity.ok(cafeService.createCafe(cafe));
    }

    @GetMapping
    public ResponseEntity<List<Cafe>> getAllCafes() {
        return ResponseEntity.ok(cafeService.getAllCafes());
    }

     @GetMapping("/{id}")
     public ResponseEntity<String> getCafeById(@PathVariable String id) {
         return cafeService.getCafeById(id)
             .map(cafe -> ResponseEntity.ok("Found cafe: " + cafe.toString()))
             .orElse(ResponseEntity.notFound().build());
     }

    @PutMapping("/{id}")
    public ResponseEntity<Cafe> updateCafe(@PathVariable String id, @RequestBody Cafe cafe) throws Exception {
        return ResponseEntity.ok(cafeService.updateCafe(id, cafe));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteCafe(@PathVariable String id) {
        cafeService.deleteCafe(id);
        return ResponseEntity.ok().build();
    }
}