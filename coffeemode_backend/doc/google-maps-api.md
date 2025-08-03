# Google Maps Link Resolver API

## Overview
The Google Maps Link Resolver API allows you to resolve Google Maps sharing links and extract place information, storing the data in a MongoDB collection called `google_poi`.

## Endpoint

### POST /api/google-maps/resolve

Resolves a Google Maps sharing link and extracts place information.

#### Request Body
```json
{
  "sharingUrl": "https://maps.app.goo.gl/Bxt92w1d2xX19dBT6"
}
```

#### Response
```json
{
  "code": 200,
  "message": "Google Maps link resolved successfully",
  "data": {
    "id": "507f1f77bcf86cd799439011",
    "name": "Kith Café Spottiswoode",
    "placeId": "0x31da196ef0f8f641:0x1dd15592bb6ae1ae",
    "address": null,
    "latitude": 1.2769969,
    "longitude": 103.8369899,
    "originalSharingUrl": "https://maps.app.goo.gl/Bxt92w1d2xX19dBT6",
    "resolvedFullUrl": "https://www.google.com/maps/place/Kith+Caf%C3%A9+Spottiswoode/@1.2769969,103.8369899,17z/data=!3m1!4b1!4m6!3m5!1s0x31da196ef0f8f641:0x1dd15592bb6ae1ae!8m2!3d1.2769969!4d103.8369899!16s%2Fg%2F11f5bnn7zd?entry=ttu&g_ep=EgoyMDI1MDczMC4wIKXMDSoASAFQAw%3D%3D",
    "googleMapsUrl": "https://www.google.com/maps/place/Kith+Caf%C3%A9+Spottiswoode/@1.2769969,103.8369899,17z/data=!3m1!4b1!4m6!3m5!1s0x31da196ef0f8f641:0x1dd15592bb6ae1ae!8m2!3d1.2769969!4d103.8369899!16s%2Fg%2F11f5bnn7zd?entry=ttu&g_ep=EgoyMDI1MDczMC4wIKXMDSoASAFQAw%3D%3D",
    "phoneNumber": null,
    "website": null,
    "category": "Cafe",
    "rating": null,
    "reviewCount": null,
    "createdAt": "2025-08-03T15:57:26",
    "updatedAt": "2025-08-03T15:57:26"
  }
}
```

#### Error Response
```json
{
  "code": 500,
  "message": "Failed to resolve Google Maps link: <error details>",
  "data": null
}
```

## Features

### URL Resolution
- Follows HTTP redirects from sharing URLs to full Google Maps URLs
- Handles various Google Maps sharing link formats
- Caches resolved URLs to avoid duplicate processing

### Data Extraction
The API extracts the following information from Google Maps URLs:
- **Place Name**: Extracted from URL path (e.g., "Kith Café Spottiswoode")
- **Coordinates**: Latitude and longitude from URL parameters
- **Place ID**: Google's unique place identifier
- **Category**: Inferred from place name or URL patterns

### Data Storage
- Stores extracted data in MongoDB `google_poi` collection
- Prevents duplicate entries by checking existing URLs
- Includes metadata like creation and update timestamps
- Uses GeoJSON format for location data (compatible with MongoDB geospatial queries)

## Database Schema

### GooglePoi Collection
```javascript
{
  "_id": ObjectId,
  "name": String,
  "placeId": String,
  "address": String,
  "location": {
    "type": "Point",
    "coordinates": [longitude, latitude]  // GeoJSON format
  },
  "originalSharingUrl": String,
  "resolvedFullUrl": String,
  "googleMapsUrl": String,
  "phoneNumber": String,
  "website": String,
  "category": String,
  "rating": Double,
  "reviewCount": Integer,
  "createdAt": ISODate,
  "updatedAt": ISODate
}
```

## Usage Examples

### Example 1: Basic Cafe Link
```bash
curl -X POST http://localhost:8080/api/google-maps/resolve \
  -H "Content-Type: application/json" \
  -d '{
    "sharingUrl": "https://maps.app.goo.gl/Bxt92w1d2xX19dBT6"
  }'
```

### Example 2: Link with Query Parameters
```bash
curl -X POST http://localhost:8080/api/google-maps/resolve \
  -H "Content-Type: application/json" \
  -d '{
    "sharingUrl": "https://maps.app.goo.gl/HgqXSokN4cox929o8?g_st=ipc"
  }'
```

## Implementation Details

### Components Created
1. **GooglePoi Model**: MongoDB entity for storing place data
2. **GoogleMapsService**: Core business logic for URL resolution and parsing
3. **GoogleMapsController**: REST API endpoint handler
4. **GooglePoiRepository**: MongoDB repository interface
5. **DTOs**: Request/response data transfer objects
6. **RestTemplateConfig**: HTTP client configuration

### Key Features
- **Duplicate Prevention**: Checks for existing URLs before processing
- **Error Handling**: Comprehensive error handling with meaningful messages
- **Logging**: Detailed logging for debugging and monitoring
- **Geospatial Support**: MongoDB GeoJSON format for location queries
- **Extensible**: Easy to add more data extraction patterns

## Notes
- The API currently extracts basic information from URL patterns
- More advanced features (like fetching additional place details from Google Places API) can be added in the future
- The service handles various Google Maps URL formats and edge cases
- All coordinates are stored in GeoJSON format for MongoDB geospatial operations
