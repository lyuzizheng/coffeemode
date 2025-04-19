package com.work.coffeemode.config;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.io.InputStream;

@Configuration
public class FirebaseConfig {

    private static final Logger logger = LoggerFactory.getLogger(FirebaseConfig.class);

    @PostConstruct
    public void initialize() {
        try {
            // IMPORTANT: Replace "classpath:serviceAccountKey.json" with the actual path to
            // your service account key.
            // Consider loading this path from application properties or environment
            // variables.
            InputStream serviceAccount = new ClassPathResource("serviceAccountKey.json").getInputStream();

            FirebaseOptions options = FirebaseOptions.builder()
                    .setCredentials(GoogleCredentials.fromStream(serviceAccount))
                    // Optionally set your database URL if using Firebase Realtime Database or
                    // Firestore
                    // .setDatabaseUrl("https://<DATABASE_NAME>.firebaseio.com")
                    .build();

            if (FirebaseApp.getApps().isEmpty()) { // Check if already initialized
                FirebaseApp.initializeApp(options);
                logger.info("Firebase Admin SDK initialized successfully.");
            } else {
                logger.info("Firebase Admin SDK already initialized.");
            }
        } catch (IOException e) {
            logger.error("Error initializing Firebase Admin SDK", e);
            // Consider throwing a runtime exception or handling this critical error
            // appropriately
            // throw new RuntimeException("Could not initialize Firebase Admin SDK", e);
        }
    }
}