package com.work.coffeemode.dto.googlemaps;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ResolvePlaceRequest {
    private String title;
    private String description;
    private String url; // 可选：前端传入的原始链接，用于记录
}