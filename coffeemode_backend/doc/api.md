# CoffeeMode API Documentation

## API Response Format

All API responses follow a standard format:

```json
{
  "code": 200,
  "message": "Success",
  "data": { ... }
}
```

Where:

- `code`: Biz Define Error Code
- `message`: Human-readable message about the operation result
- `data`: Response payload, or `null` in case of errors

## Error Handling

When an error occurs, the response will have:

- An appropriate HTTP status code
- A descriptive error message
- `null` data

Example error response:

```json
{
  "code": 10001,
  "message": "Cafe not found",
  "data": null
}
```

## Authentication

*Note: Authentication to be implemented in future versions.*

## Cafes API

### Get Cafe by ID

Retrieves detailed information about a specific cafe.

**Endpoint:** `GET /api/cafes/{id}`

**Path Parameters:**

- `id` (string, required): The unique identifier of the cafe

**Response:**

```json
{
  "code": 200,
  "message": "Success",
  "data": {
    "id": "12345",
    "name": "Coffee Haven",
    "location": {
      "address": "123 Orchard Road, Singapore",
      "lat": 1.3521,
      "lng": 103.8198
    },
    "features": {
      "wifiSpeedMbps": 100,
      "outletsAvailable": true,
      "quietnessLevel": "moderate",
      "seatingCapacity": 50
    },
    "averageRating": 4.5,
    "totalReviews": 15,
    "thumbnails": ["https://example.com/cafe/thumb1.jpg", "https://example.com/cafe/thumb2.jpg"],
    "images": ["https://example.com/cafe/img1.jpg", "https://example.com/cafe/img2.jpg"],
    "website": "https://coffeehaven.com",
    "openingHours": {
      "monday": "08:00-20:00",
      "tuesday": "08:00-20:00",
      "wednesday": "08:00-20:00",
      "thursday": "08:00-20:00",
      "friday": "08:00-22:00",
      "saturday": "09:00-22:00",
      "sunday": "09:00-18:00"
    }
  }
}
```

### List All Cafes

Retrieves a list of all cafes.

**Endpoint:** `GET /api/cafes`

**Query Parameters:**

- `page` (number, optional): Page number for pagination (default: 0)
- `size` (number, optional): Number of items per page (default: 20)

**Response:**

Similar to the nearby cafes response, but with pagination information.

### Create a New Cafe

Adds a new cafe to the database.

**Endpoint:** `POST /api/cafes`

**Request Body:**

Required fields are marked with `*`

```json
{
  "name": "New Cafe",                   // * Required: Cafe name
  "location": {                         // * Required: Location object
    "type": "Point",                   // * Required: Must be "Point" for GeoJSON
    "coordinates": [103.8500, 1.3000] // * Required: [longitude, latitude]
  },
  "address": "789 Bugis Street",      // * Required: Physical address
  "features": {                         // Optional: Features object
    "wifi_available": true,
    "outlets_available": true,
    "quietness_level": "moderate",     // "quiet"|"moderate"|"noisy"
    "temperature": "cold"              // "cold"|"just right"|"warm"
  },
  "images": [                          // Optional: Array of image URLs
    {
      "url": "image1.jpg",
      "caption": "Main view"
    }
  ],
  "website": "https://newcafe.com",    // Optional: Website URL
  "openingHours": {                    // Optional: Operating hours
    "monday": "08:00-20:00",
    "tuesday": "08:00-20:00"
  }
}
```


### Get Nearby Cafes

Retrieves cafes near a specified geographical location.

**Endpoint:** `GET /api/cafes/nearby`

**Request Body:**

```json
{
    "longitude": 103.8500,    // Required: Longitude coordinate
    "latitude": 1.3000,       // Required: Latitude coordinate
    "radiusInKm": 1.0        // Optional: Search radius in kilometers (default: 1.0)
}
```

**Response:**

```json
{
  "code": 200,
  "message": "Success",
  "data": [
    {
      "id": "12345",
      "name": "Coffee Haven",
      "location": {
        "type": "Point",
        "coordinates": [103.8500, 1.3000]
      },
      "address": "123 Orchard Road, Singapore",
      "features": {
        "wifiAvailable": true,
        "outletsAvailable": true,
        "quietnessLevel": "moderate",
        "temperature": "just right"
      },
      "images": [
        {
          "url": "image1.jpg",
          "caption": "Main view"
        }
      ],
      "website": "https://coffeehaven.com",
      "openingHours": {
        "monday": "08:00-20:00",
        "tuesday": "08:00-20:00"
      }
    }
  ]
}
```
### Update a Cafe

Updates an existing cafe.

**Endpoint:** `PUT /api/cafes/{id}`

**Path Parameters:**

- `id` (string, required): The unique identifier of the cafe

**Request Body:**
Same format as cafe creation, with updated fields.

**Response:**

```json
{
  "code": 200,
  "message": "Cafe updated successfully",
  "data": {
    "id": "12345",
    "name": "Updated Coffee Haven",
    ...
  }
}
```

### Delete a Cafe

Removes a cafe from the database.

**Endpoint:** `DELETE /api/cafes/{id}`

**Path Parameters:**

- `id` (string, required): The unique identifier of the cafe

**Response:**

```json
{
  "code": 200,
  "message": "Cafe deleted successfully",
  "data": null
}
```

## Future API Endpoints

The following endpoints are planned for future implementation:

1. User authentication and profile management
2. Cafe reviews and ratings
3. User check-ins
4. Image upload for cafes
5. Advanced filtering (by amenities, ratings, etc.)
