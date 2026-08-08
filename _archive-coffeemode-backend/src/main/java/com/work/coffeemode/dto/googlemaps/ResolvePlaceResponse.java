package com.work.coffeemode.dto.googlemaps;

import com.work.coffeemode.model.Cafe;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ResolvePlaceResponse {
    private String placeId;
    private boolean skippedDetails; // 如果数据库已有该 placeId，则为 true
    private Cafe cafe;              // 已存在或新创建的咖啡店记录
}