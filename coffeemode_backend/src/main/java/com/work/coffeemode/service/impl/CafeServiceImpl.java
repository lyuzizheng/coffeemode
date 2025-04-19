package com.work.coffeemode.service.impl;

    import com.work.coffeemode.model.Cafe;
    import com.work.coffeemode.repository.CafeRepository;
    import com.work.coffeemode.service.CafeService;
    import org.springframework.beans.factory.annotation.Autowired;
    import org.springframework.stereotype.Service;
    import java.util.List;
    import java.util.Optional;

    @Service
    public class CafeServiceImpl implements CafeService {

        @Autowired
        private CafeRepository cafeRepository;

        @Override
        public Cafe createCafe(Cafe cafe) {
            return cafeRepository.save(cafe);
        }

        @Override
        public List<Cafe> getAllCafes() {
            return cafeRepository.findAll();
        }

        @Override
        public Optional<Cafe> getCafeById(String id) {
            return cafeRepository.findById(id);
        }

        @Override
        public Cafe updateCafe(String id, Cafe cafeDetails) throws Exception {
            Cafe cafe = cafeRepository.findById(id)
                .orElseThrow(() -> new Exception("Cafe not found"));

            cafe.setName(cafeDetails.getName());
            cafe.setLocation(cafeDetails.getLocation());
            cafe.setFeatures(cafeDetails.getFeatures());
            cafe.setAverageRating(cafeDetails.getAverageRating());
            cafe.setTotalReviews(cafeDetails.getTotalReviews());
            cafe.setImages(cafeDetails.getImages());
            cafe.setWebsite(cafeDetails.getWebsite());
            cafe.setOpeningHours(cafeDetails.getOpeningHours());

            return cafeRepository.save(cafe);
        }

        @Override
        public void deleteCafe(String id) {
            cafeRepository.deleteById(id);
        }
    }