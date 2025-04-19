package com.work.coffeemode.service;


import com.work.coffeemode.dto.*;

public interface UserService {
    /**
     * Creates a new user.
     *
     * @param request Protobuf message containing user details
     * @return Response containing the created user information
     */
    CreateUserResponse createUser(CreateUserRequest request);

    /**
     * Retrieves a user by ID.
     *
     * @param request Protobuf message containing the user ID
     * @return Response containing the user information if found
     */
    GetUserResponse getUser(GetUserRequest request);

    /**
     * Lists users with pagination.
     *
     * @param request Protobuf message containing pagination parameters
     * @return Response containing the list of users for the requested page
     */
    ListUsersResponse listUsers(ListUsersRequest request);
}
