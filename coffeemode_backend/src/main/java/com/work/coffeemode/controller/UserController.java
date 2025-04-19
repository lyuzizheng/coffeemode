package com.work.coffeemode.controller;


import com.work.coffeemode.dto.*;
import com.work.coffeemode.service.UserService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * REST Controller for handling user-related operations.
 * <p>
 * This controller exposes endpoints for creating, retrieving, and listing users.
 * It uses Protocol Buffers (protobuf) for request and response objects.
 * <p>
 * Base path: /api/users
 */
@RestController               // Marks this class as a REST controller
@RequestMapping("/api/users") // Sets the base URL path for all endpoints in this controller
@RequiredArgsConstructor      // Lombok annotation to generate a constructor for final fields
public class UserController {

    private final UserService userService; // Dependency injection of the UserService

    /**
     * Creates a new user.
     * <p>
     * POST /api/users
     *
     * @param request Protobuf object containing user details to create
     * @return ResponseEntity containing the created user's details
     */
    @PostMapping
    public ResponseEntity<CreateUserResponse> createUser(@RequestBody CreateUserRequest request) {
        return ResponseEntity.ok(userService.createUser(request));
    }

    /**
     * Retrieves a user by ID.
     * <p>
     * GET /api/users/{id}
     *
     * @param request The request object containing the user ID
     * @return ResponseEntity containing the user's details if found
     */
    @GetMapping("/{id}")
    public ResponseEntity<GetUserResponse> getUser(@ModelAttribute GetUserRequest request) {
        return ResponseEntity.ok(userService.getUser(request));
    }

    /**
     * Lists users with pagination.
     * <p>
     * GET /api/users?page=0&size=10
     *
     * @param request The pagination parameters
     * @return ResponseEntity containing paginated list of users
     */
    @GetMapping
    public ResponseEntity<ListUsersResponse> listUsers(@ModelAttribute ListUsersRequest request) {
        return ResponseEntity.ok(userService.listUsers(request));
    }
}
