package com.work.coffeemode.dto.user;

import com.work.coffeemode.model.User;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ListUsersResponse {
    private List<User> users;
    private int totalCount;
    private int page;
    private int totalPages;
}