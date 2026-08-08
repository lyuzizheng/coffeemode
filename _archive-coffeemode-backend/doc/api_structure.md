## API Response Structure

All API endpoints now return a standardized JSON response object:

```json
{
  "code": <integer>,    // HTTP status code or custom code
  "message": <string>,  // "Success" or an error message
  "data": <any|null>   // The actual response data for successful requests, null for errors
}
```

- For successful requests, `code` is typically `200` and `message` is `"Success"`.
- For errors, `code` and `message` provide details about the error. Custom exceptions implementing `com.work.coffeemode.exception.CustomException` define their specific codes and messages (e.g., `CafeNotFoundException` returns `404`). Generic server errors return `500` with the message `"Internal Server Error"`.
- The wrapping and error handling are managed by `com.work.coffeemode.aop.UnifiedResponseAspect`.
