package com.work.coffeemode.service.impl;

import com.work.coffeemode.dto.*;
import com.work.coffeemode.model.User;
import com.work.coffeemode.service.UserService;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Implementation of the UserService interface.
 * <p>
 * This service provides functionality for user management operations:
 * - Creating users
 * - Retrieving users by ID
 * - Listing users with pagination
 * <p>
 * Note: This implementation uses an in-memory store for demonstration purposes.
 * In a production environment, you would typically use a database.
 */
@Service // Marks this class as a Spring service bean
public class UserServiceImpl implements UserService {

    // In-memory store for demonstration purposes
    private final Map<Integer, User> users = new HashMap<>();

    // Counter for generating unique user IDs
    private final AtomicInteger idCounter = new AtomicInteger(1);

    /**
     * Creates a new user from the provided request data.
     *
     * @param request Protobuf message containing user details
     * @return CreateUserResponse containing the created user
     */
    @Override
    public CreateUserResponse createUser(CreateUserRequest request) {
        // Generate a new unique user ID
        int userId = idCounter.getAndIncrement();
        LocalDateTime now = LocalDateTime.now();

        // Build a new User protobuf object with data from the request
        User user = User.builder()
                .id(userId)
                .name(request.getName())
                .email(request.getEmail())
                .role(request.getRole())
                .createdAt(LocalDateTime.parse(now.toString()))
                .updatedAt(LocalDateTime.parse(now.toString()))
                .build();

        // Store the user in our in-memory map
        users.put(userId, user);

        // Build and return the response
        return CreateUserResponse.builder()
                .user(user)
                .success(true)
                .message("User created successfully")
                .build();
    }

    /**
     * Retrieves a user by ID.
     *
     * @param request Protobuf message containing the user ID to retrieve
     * @return GetUserResponse containing the user if found
     */
    @Override
    public GetUserResponse getUser(GetUserRequest request) {
        // Look up the user in our in-memory store
        User user = users.get(request.getId());

        // If the user doesn't exist, return a "not found" response
        if (user == null) {
            return GetUserResponse.builder()
                    .found(false)
                    .build();
        }

        // Return the user in the response
        return GetUserResponse.builder()
                .user(user)
                .found(true)
                .build();
    }

    /**
     * Lists users with pagination support.
     *
     * @param request Protobuf message containing pagination parameters
     * @return UserListResponse containing the paginated list of users
     */
    @Override
    public ListUsersResponse listUsers(ListUsersRequest request) {
        int page = request.getPage();
        int pageSize = request.getPageSize();

        // Get all users from our in-memory store
        List<User> allUsers = new ArrayList<>(users.values());
        int totalCount = allUsers.size();

        // Calculate total pages
        int totalPages = (int) Math.ceil((double) totalCount / pageSize);

        // Calculate the start and end indices for the requested page
        int start = page * pageSize;
        int end = Math.min(start + pageSize, totalCount);

        // Get the subset of users for the requested page
        List<User> pageUsers = (start < totalCount) ? allUsers.subList(start, end) : new ArrayList<>();

        // Build and return the response with the paginated users
        return ListUsersResponse.builder()
                .users(pageUsers)
                .totalCount(totalCount)
                .page(page)
                .totalPages(totalPages)
                .build();
    }
}
