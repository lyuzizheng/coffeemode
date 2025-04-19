package com.work.coffeemode.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ListUsersRequest {
    @Builder.Default
    private int page = 0;
    @Builder.Default
    private int pageSize = 10;
}
