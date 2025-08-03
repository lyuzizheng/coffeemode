# Coffee Mode Backend - Project Notes

## 1. Project Overview

**Coffee Mode Backend** provides the RESTful API services for the Coffee Mode frontend application. It handles business logic, data persistence, and user management integration.

**Core Responsibilities:**

* Expose API endpoints for managing locations (cafes, libraries, etc.), including details like amenities (Wi-Fi, power outlets), operating hours, and coordinates.
* Handle user-generated content: reviews, ratings, photos, check-ins.
* Manage user profile data (name, preferences) linked to an external authentication provider (Firebase Auth).
* Implement authentication and authorization to secure API endpoints.
* Interact with the database (MongoDB) for data storage and retrieval.
* Potentially utilize caching (Redis) for performance optimization.

**Architecture:** Standard Spring Boot layered architecture (Controller -> Service -> Repository).

## 2. Technology Stack

* **Language:** Java 21
* **Framework:** Spring Boot 3.x
  * Spring Web (for REST APIs)
  * Spring Data MongoDB (for MongoDB interaction)
  * Spring Data Redis (for Redis interaction - caching, etc.)
  * Spring Security (for authentication and authorization)
* **Authentication:** Firebase Admin SDK (for verifying Firebase ID Tokens)
* **Database:** MongoDB
* **Caching:** Redis (Optional, dependency included)
* **Build Tool:** Gradle
* **Utilities:**
  * Lombok (for reducing boilerplate code)
  * Jackson Datatype Protobuf (if Protobuf is used for DTOs)

## 3. Project Structure

```
coffeemode_backend/
├── build.gradle             # Gradle build script with dependencies
├── gradlew                  # Gradle wrapper script (Unix)
├── gradlew.bat              # Gradle wrapper script (Windows)
├── settings.gradle          # Gradle settings
├── src/
│   ├── main/
│   │   ├── java/
│   │   │   └── com/work/coffeemode/
│   │   │       ├── config/          # Spring configuration (SecurityConfig, FirebaseConfig, etc.)
│   │   │       ├── controller/      # REST API controllers (handling HTTP requests)
│   │   │       ├── dto/             # Data Transfer Objects (for API request/response bodies)
│   │   │       ├── exception/       # Custom exception classes and handlers
│   │   │       ├── model/ (or domain/) # Data models/entities (mapping to MongoDB documents)
│   │   │       ├── repository/      # Spring Data repositories (database interaction interfaces)
│   │   │       ├── security/        # Security-related components (FirebaseTokenFilter)
│   │   │       ├── service/         # Business logic implementation
│   │   │       └── CoffeeModeApplication.java # Main Spring Boot application class
│   │   └── resources/
│   │       ├── application.properties # Main application configuration (DB connections, ports, etc.)
│   │       ├── static/          # Static assets (if serving any directly)
│   │       ├── templates/       # Server-side templates (if using Thymeleaf, etc.)
│   │       └── serviceAccountKey.json # Firebase Admin SDK service account key (NEEDS TO BE ADDED)
│   └── test/
│       └── java/                  # Unit and integration tests
└── doc/                         # API documentation (e.g., OpenAPI/Swagger specs)
    └── _/                       # Placeholder/location for documentation files
```

*(Note: Package structure like `controller`, `service`, `repository`, `model`, `dto` is conventional but might evolve.)*

## 4. Getting Started

1. **Clone the repository:**

    ```bash
    git clone <repository-url>
    cd coffeemode_backend
    ```

2. **Prerequisites:**
    * JDK 21 installed.
    * Gradle installed (or use the provided wrapper `./gradlew`).
    * Access to a MongoDB instance.
    * Access to a Redis instance (optional, if utilized).
    * Firebase Project and Service Account Key.
3. **Configuration:**
    * **Firebase:** Obtain your `serviceAccountKey.json` file from your Firebase project settings (Project settings > Service accounts > Generate new private key). Place this file in the `src/main/resources/` directory. **Do not commit this file to version control.**
    * **Application Properties:** Configure database connection details (MongoDB URI, Redis host/port if used), server port, and any other necessary settings in `src/main/resources/application.properties` (or `application.yml`). You might use Spring profiles (`application-dev.properties`, `application-prod.properties`) for different environments.
        *Example `application.properties` entries:*

        ```properties
        # Server
        server.port=8080

        # MongoDB
        spring.data.mongodb.uri=mongodb://localhost:27017/coffeemode

        # Redis (if used)
        # spring.data.redis.host=localhost
        # spring.data.redis.port=6379

        # Firebase (Configured via FirebaseConfig.java using serviceAccountKey.json)
        ```

4. **Build the project:**

    ```bash
    ./gradlew build
    # or on Windows: gradlew build
    ```

5. **Run the application:**

    ```bash
    ./gradlew bootRun
    # or on Windows: gradlew bootRun
    ```

    The application should start, typically on port 8080.

## 5. Development Scripts (Gradle)

* `./gradlew bootRun`: Run the application locally.
* `./gradlew build`: Compile code, run tests, and build the executable JAR/WAR.
* `./gradlew test`: Run unit and integration tests.
* `./gradlew clean`: Delete the `build` directory.
* `./gradlew dependencies`: Display project dependencies.

## 6. Core Architectural Concepts

* **RESTful API:** Exposes resources via standard HTTP methods (GET, POST, PUT, DELETE).
* **Layered Architecture:**
  * `Controller`: Handles HTTP requests/responses, basic input validation, delegates to Service.
  * `Service`: Contains core business logic, orchestrates repository calls, handles transactions.
  * `Repository`: Interfaces for data access using Spring Data MongoDB.
  * `Model/Domain`: Represents data structures (mapped to MongoDB documents).
  * `DTO`: Data Transfer Objects used for API contracts to decouple internal models from external representation.
* **Stateless Authentication:** Uses Firebase ID Tokens (JWT) passed in the `Authorization: Bearer <token>` header. The `FirebaseTokenFilter` validates these tokens on secured endpoints. No server-side session management for authentication.
* **Dependency Injection:** Leverages Spring's DI container (`@Autowired`, constructor injection).
* **Configuration Management:** Uses Spring Boot's externalized configuration (`application.properties`, environment variables, profiles).

## 7. API Documentation

* API endpoint specifications, request/response formats, and examples **must** be documented.
* The designated location for API documentation is the `coffeemode_backend/doc/` directory. Consider using OpenAPI (Swagger) specifications. Add new endpoints or changes there.

## 8. Database Schema (MongoDB)

Key collections anticipated:

1. **`users` Collection:**
    * `_id`: MongoDB ObjectId (Primary Key)
    * `firebaseUid`: String (Indexed, **Crucial link** to Firebase Auth user)
    * `email`: String (Indexed, Synced from Firebase)
    * `name`: String (Synced from Firebase or user-provided)
    * `roles`: List<String> (e.g., ["USER", "ADMIN"] for authorization)
    * `createdAt`: ISODate
    * `updatedAt`: ISODate
    * `profilePictureUrl`: String (Optional)
    * *... other application-specific fields (preferences, etc.)*

2. **`locations` Collection:**
    * `_id`: MongoDB ObjectId (Primary Key)
    * `name`: String
    * `address`: String
    * `coordinates`: GeoJSON Point (e.g., `{ type: "Point", coordinates: [longitude, latitude] }`) (Indexed for geospatial queries)
    * `type`: String (e.g., "Cafe", "Library", "Coworking")
    * `amenities`: Object (e.g., `{ wifiQuality: "GOOD", powerOutlets: "PLENTY", noiseLevel: "MODERATE" }`)
    * `operatingHours`: Object/String
    * `photos`: List<String> (URLs or references)
    * `averageRating`: Number
    * `addedBy`: String (Reference to User's `firebaseUid` or `_id`)
    * `createdAt`: ISODate
    * `updatedAt`: ISODate
    * *... other details (price range, specific notes)*

3. **`reviews` Collection:**
    * `_id`: MongoDB ObjectId
    * `locationId`: ObjectId (Reference to `locations._id`)
    * `userId`: String (Reference to User's `firebaseUid` or `_id`)
    * `rating`: Number (Overall rating)
    * `amenityRatings`: Object (Specific ratings for wifi, plugs, etc.)
    * `comment`: String
    * `createdAt`: ISODate
    * `updatedAt`: ISODate

*(Schema details are preliminary and will evolve.)*

## 9. Authentication & Authorization

* **Authentication:** Handled by `FirebaseTokenFilter`. It intercepts requests, extracts the `Bearer` token from the `Authorization` header, and verifies it using `FirebaseAuth.verifyIdToken()`. If valid, it populates the Spring Security context with the user's `firebaseUid` (currently as the principal).
* **Authorization:** Configured in `SecurityConfig.java`.
  * Currently set to `permitAll()` for development ease.
  * **Future:** Will restrict endpoints based on authentication status and potentially user roles fetched from the `users` collection in MongoDB. Method-level security (`@PreAuthorize`, `@Secured`) can be used in services or controllers.
* **User Sync:** A dedicated endpoint (e.g., `/api/users/sync` or `/api/users/me`) is needed for the frontend to call after a *successful Firebase login*. This endpoint should:
    1. Verify the ID token (already done by the filter).
    2. Extract the `firebaseUid`.
    3. Check if a user with this `firebaseUid` exists in the MongoDB `users` collection.
    4. If not, create a new user record using information from the token (UID, email) and default roles.
    5. If exists, potentially update fields like `lastLoginAt`.

## 10. Environment Configuration

* Primary configuration: `src/main/resources/application.properties`.
* Spring Profiles: Use `application-{profile}.properties` (e.g., `application-dev.properties`, `application-prod.properties`) for environment-specific overrides. Activate profiles via `SPRING_PROFILES_ACTIVE` environment variable or JVM argument (`-Dspring.profiles.active=dev`).
* Sensitive Data: Avoid hardcoding secrets. Use environment variables or a dedicated secrets management solution. The `serviceAccountKey.json` is critical and should be handled securely.

## 11. Testing

* **Unit Tests:** Use JUnit 5, Mockito, and Spring Boot's testing utilities (`@WebMvcTest`, `@DataMongoTest`) to test individual components (controllers, services, repositories) in isolation.
* **Integration Tests:** Use `@SpringBootTest` to test interactions between different layers or the full application context. Testcontainers can be used for testing against real MongoDB/Redis instances.
* **Location:** Tests reside in `src/test/java`.

## 12. Notes for AI Assistance

When assisting with development on this backend:

1. **Auth Flow:** Remember the Firebase ID Token verification flow using `FirebaseTokenFilter` and `SecurityConfig`. Secured endpoints require a valid `Authorization: Bearer <token>`.
2. **`firebaseUid` Link:** The `firebaseUid` field in the MongoDB `users` collection is the critical link to the authenticated user from Firebase. Use this UID to fetch user-specific data.
3. **Layered Architecture:** Adhere to the Controller-Service-Repository pattern. Business logic belongs in Services, DB interaction in Repositories, HTTP handling in Controllers.
4. **MongoDB:** Assume MongoDB is the primary database. Use Spring Data MongoDB conventions (`MongoRepository`). Refer to the anticipated schema in Section 8.
5. **Lombok:** Utilize Lombok annotations (`@Data`, `@Service`, `@RestController`, `@RequiredArgsConstructor`, etc.) to reduce boilerplate.
6. **DTOs:** Use Data Transfer Objects for API request/response bodies to decouple the API contract from internal domain models.
7. **API Documentation:** Remember to instruct the user or update the documentation in `coffeemode_backend/doc/` when adding or modifying API endpoints.
8. **Configuration:** Be mindful of configuration in `application.properties` and the secure handling of `serviceAccountKey.json`.
9. **Error Handling:** Implement clear and consistent error handling, potentially using global exception handlers (`@ControllerAdvice`).
