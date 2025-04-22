package com.work.coffeemode.dto.cafe;

public class CreateCafeRequest {
    private String name;
    private String address;
    private String phoneNumber;
    private String website;
    private String description;

    public CreateCafeRequest(String name, String address, String phoneNumber, String website, String description) {
        this.name = name;
        this.address = address;
        this.phoneNumber = phoneNumber;
        this.website = website;
        this.description = description;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getAddress() {
        return address;
    }

    public void setAddress(String address) {
        this.address = address;
    }

    public String getPhoneNumber() {
        return phoneNumber;
    }

    public void setPhoneNumber(String phoneNumber) {
        this.phoneNumber = phoneNumber;
    }

    public String getWebsite() {
        return website;
    }

    public void setWebsite(String website) {
        this.website = website;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }
}
