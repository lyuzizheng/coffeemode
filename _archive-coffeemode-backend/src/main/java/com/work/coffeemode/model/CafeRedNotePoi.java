package com.work.coffeemode.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.bson.types.ObjectId;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "cafe_rednote_pois")
public class CafeRedNotePoi {
    @Id
    private ObjectId id;
    private String redbookId;
    private String name;
    private String description;
    private String address;
    private Contact contact;
    private List<MenuHighlight> menuHighlights;
    private List<String> redpostLinks;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Contact {
        private String phone;
        private String email;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class MenuHighlight {
        private String name;
        private double price;
        private String category;
    }
}
