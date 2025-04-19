/// <reference types="@cloudflare/workers-types" />
import { jwtVerify } from 'jose';

/**
 * Cloudflare Worker for Coffeemode Image Management
 * Handles both secure image upload and retrieval via API endpoints.
 */

// --- Common Interfaces ---

interface ApiResponse<T> {
	code: number;
	message: string;
	data: T | null;
}

interface UploadResponseData {
	imageUrl: string;
	imageUuid: string;
	imageType: string;
}

interface JwtPayload {
	sub?: string;
	userId?: string;
	exp?: number;
	[key: string]: any;
}

interface TokenVerificationResult {
	valid: boolean;
	userId?: string;
	[key: string]: any;
}

// Define a minimal interface for Rate Limiter Binding
interface SimpleRateLimiter {
	limit(options: { key: string | ArrayBuffer }): Promise<{ success: boolean }>;
}

interface Env {
	MY_BUCKET: R2Bucket;
	JWT_SECRET: string;
	// Add Rate Limiter bindings using the minimal interface
	UPLOAD_RATE_LIMITER: SimpleRateLimiter;
	READ_RATE_LIMITER: SimpleRateLimiter;
	// Add any other environment variables here
}

// --- Main Fetch Handler (Router) ---

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		const method = request.method;

		try {
			// Route requests based on method and path
			if (method === 'POST' && path === '/v1/images/upload') {
				return await handleImageUpload(request, env, ctx);
			} else if (method === 'GET' && path.startsWith('/v1/images/')) {
                // Extract path after /v1/images/
                const imagePath = path.substring('/v1/images/'.length);
				return await handleImageRetrieval(request, env, ctx, imagePath);
			} else {
				// Handle other paths or methods
                if (method === 'GET' && path === '/') {
                    return new Response('Coffeemode Image Worker API is running.', { status: 200 });
                }
				return createErrorResponse(404, 'Not Found: Invalid API endpoint or method');
			}
		} catch (error) {
			console.error('Error processing request:', error);
            let errorMessage = 'Unknown error';
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'string') {
                errorMessage = error;
            }
			return createErrorResponse(
				500,
				`Internal Server Error: ${errorMessage}`
			);
		}
	},
} satisfies ExportedHandler<Env>;

// --- API Handlers ---

/**
 * Handles image upload requests (POST /v1/images/upload)
 * Based on upload_image.ts logic
 */
async function handleImageUpload(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // ** NOTE: Rate limiting moved after token verification to use User ID **

	// 1. Check and verify Bearer token
	const authHeader = request.headers.get('Authorization');
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return createErrorResponse(401, 'Unauthorized: Missing or invalid token');
	}

	const token = authHeader.split(' ')[1];
	const decodedToken = await verifyToken(token, env);

	if (!decodedToken || !decodedToken.valid) {
        // Optionally include reason in the response for debugging
		return createErrorResponse(401, `Unauthorized: Token invalid or expired. Reason: ${decodedToken?.reason || 'Unknown'}`);
	}

	// 2. Extract user_id from token
	const userId = decodedToken.userId;
	if (!userId) {
		return createErrorResponse(401, 'Unauthorized: Token missing user ID');
	}

    // ** Rate Limiting (applied *after* getting userId) **
    const { success } = await env.UPLOAD_RATE_LIMITER.limit({ key: userId });
    if (!success) {
        return createErrorResponse(429, "Too Many Upload Requests for this user");
    }
    // ** End Rate Limiting **

	// 3 & 5. Retrieve the image UUID from the request query parameters
	const url = new URL(request.url);
	const imageUuid = url.searchParams.get('image_uuid');

	if (!imageUuid || !isValidUUID(imageUuid)) {
		return createErrorResponse(400, 'Bad Request: Missing or invalid image UUID parameter');
	}

	// 4. Process the image from the request body
	const contentType = request.headers.get('Content-Type') || '';

	let imageData: ArrayBuffer;
	let imageType = url.searchParams.get('type') || 'original'; // Expect 'original' or 'snippet'

	// Validate image type parameter
	if (imageType !== 'original' && imageType !== 'compressed' && imageType !== 'thumbnail') {
		console.warn(`Invalid image type '${imageType}' provided, defaulting to 'original'.`);
        imageType = 'original';
	}

	// Handle multipart form data
	if (contentType.includes('multipart/form-data')) {
		const formData = await request.formData();
		const imageFile = formData.get('image'); // Assuming the file input name is 'image'

        // Type assertion to handle FormData value type and check if it's a File
		if (!imageFile || !(typeof imageFile === 'object' && imageFile !== null && 'arrayBuffer' in imageFile && 'name' in imageFile)) {
			return createErrorResponse(400, 'Bad Request: No valid image file found in form data (expected field name "image")');
		}
        const file = imageFile as File; // Assert as File after check

		// Ensure it's a WebP image
		if (!file.type.includes('webp')) {
			return createErrorResponse(400, `Bad Request: Image must be WebP format, received ${file.type}`);
		}

		imageData = await file.arrayBuffer();
	}
	// Handle direct image upload (binary payload)
	else if (contentType.includes('image/webp')) {
		imageData = await request.arrayBuffer();
        if (imageData.byteLength === 0) {
             return createErrorResponse(400, 'Bad Request: Empty image payload received');
        }
	}
	// Invalid content type
	else {
		return createErrorResponse(400, `Bad Request: Invalid Content-Type. Expected 'multipart/form-data' or 'image/webp', received '${contentType}'`);
	}

	// 6. Determine folder path based on type (original/snippet)
	const folderPath = `${imageType}/${imageUuid}.webp`; // R2 key

	// 7. Save to R2 with user ID in metadata
	try {
		await env.MY_BUCKET.put(folderPath, imageData, {
			httpMetadata: {
				contentType: 'image/webp',
			},
			customMetadata: {
				userId: userId,
				uploadDate: new Date().toISOString(),
				imageType: imageType,
			},
		});
	} catch (e) {
		console.error(`Failed to put object to R2: ${e}`);
        let errorMessage = 'Unknown R2 error';
        if (e instanceof Error) {
            errorMessage = e.message;
        } else if (typeof e === 'string') {
            errorMessage = e;
        }
		return createErrorResponse(500, `Failed to store image in R2: ${errorMessage}`);
	}


	// Return success response
	return createSuccessResponse({
		imageUrl: `/v1/images/${folderPath}`, // Provide the NEW retrieval URL format
		imageUuid: imageUuid,
		imageType: imageType,
	});
}

/**
 * Handles image retrieval requests (GET /v1/images/*)
 * Based on read_image.ts logic
 */
async function handleImageRetrieval(request: Request, env: Env, ctx: ExecutionContext, imagePath: string): Promise<Response> {
    // ** Rate Limiting **
    const ipAddress = request.headers.get("cf-connecting-ip") || "unknown-ip";
    const { success } = await env.READ_RATE_LIMITER.limit({ key: ipAddress });
    if (!success) {
        return createErrorResponse(429, "Too Many Read Requests");
    }
    // ** End Rate Limiting **
    if (!imagePath) {
        return createErrorResponse(400, "Bad Request: Image path is missing");
    }

		// 1. Check and verify Bearer token
		const authHeader = request.headers.get('Authorization');
		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			return createErrorResponse(401, 'Unauthorized: Missing or invalid token');
		}

		const token = authHeader.split(' ')[1];
		const decodedToken = await verifyToken(token, env);

		if (!decodedToken || !decodedToken.valid) {
					// Optionally include reason in the response for debugging
			return createErrorResponse(401, `Unauthorized: Token invalid or expired. Reason: ${decodedToken?.reason || 'Unknown'}`);
		}

		// Check cache first
		const cacheUrl = new URL(request.url);
			// Normalize URL for caching if needed, e.g., remove query params unless they vary the response
		const cacheKey = new Request(cacheUrl.toString(), request);
		const cache = caches.default;
		let response = await cache.match(cacheKey);

		// If cached, return immediately
		if (response) {
					// Optionally add a header to indicate cache hit
					// response.headers.set('X-Cache-Status', 'HIT');
			return response;
		}

		// Retrieve image from R2 using the extracted imagePath
		const object = await env.MY_BUCKET.get(imagePath);

		if (object === null) {
					console.log(`Image not found in R2: ${imagePath}`);
			return createErrorResponse(404, `Image not found at path: ${imagePath}`);
		}

		// Prepare response with appropriate headers
		const headers = new Headers();
		object.writeHttpMetadata(headers); // Copies R2 metadata (ContentType, CacheControl etc.) to headers
			headers.set('etag', object.httpEtag); // R2 etag is httpEtag

			// Override or set default Cache-Control if not set in R2 metadata
			if (!headers.has('Cache-Control')) {
				headers.set('Cache-Control', 'max-age=86400'); // Default: Cache for 1 day
			}

		// Add security headers
		headers.set('Content-Security-Policy', "default-src 'self'; object-src 'none'"); // Disallow plugin content
		headers.set('X-Content-Type-Options', 'nosniff');
			headers.set('X-Frame-Options', 'DENY'); // Prevent embedding in frames

		// Create response
		response = new Response(object.body, {
			headers: headers,
					status: 200
		});

		// Cache the response in Cloudflare CDN cache unconditionally
		ctx.waitUntil(cache.put(cacheKey, response.clone()));

		return response;
}

// --- Helper Functions ---

/**
 * Creates a standardized success JSON response
 */
function createSuccessResponse<T>(data: T, statusCode: number = 200): Response {
	const response: ApiResponse<T> = {
		code: statusCode,
		message: 'Operation successful', // More specific messages can be set in handlers
		data: data,
	};
    // Customize message based on type T or statusCode if needed
    if (statusCode === 201) response.message = "Resource created successfully";


	return new Response(JSON.stringify(response), {
		status: statusCode,
		headers: {
			'Content-Type': 'application/json',
		},
	});
}

/**
 * Creates a standardized error JSON response
 * (Using the more flexible version from read_image.ts)
 */
function createErrorResponse(statusCode: number, message: string, additionalHeaders: Record<string, string> = {}): Response {
	const response: ApiResponse<null> = {
		code: statusCode,
		message: message,
		data: null,
	};

	const headers = {
		'Content-Type': 'application/json',
		...additionalHeaders,
	};

	return new Response(JSON.stringify(response), {
		status: statusCode,
		headers: headers,
	});
}

/**
 * Verify and decode JWT token using the 'jose' library for proper validation.
 * Validates signature, expiration, and optionally issuer/audience.
 */
async function verifyToken(token: string, env: Env): Promise<TokenVerificationResult> {
	try {
		const jwtSecret = env.JWT_SECRET;
		if (!jwtSecret) {
			console.error('FATAL: JWT_SECRET environment variable not set!');
			return { valid: false, reason: 'Server configuration error' };
		}

		// Encode the secret string into a Uint8Array for Web Crypto API
		const secretKey = new TextEncoder().encode(jwtSecret);

		// Verify the JWT using the Uint8Array key.
		const { payload } = await jwtVerify(token, secretKey, {
			// algorithms: ['HS256'], // Recommended: Specify expected algorithm
		});

		if (!payload.user_id) {
			return { valid: false, reason: 'Token missing user ID' };
		}

		// Token is valid if jwtVerify doesn't throw
		return {
			valid: true,
			userId: payload.user_id as string | undefined, // Prefer 'sub' claim for user ID
			...payload, // Include the entire payload if needed
		};

	} catch (error: any) {
		let reason = 'Token verification failed';
		if (error.code === 'ERR_JWT_EXPIRED') {
			reason = 'Token expired';
			console.log('Token verification failed: Expired');
		} else if (error.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
			reason = 'Invalid signature';
			console.error('Token verification failed: Invalid signature');
		} else if (error.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
            reason = `Claim validation failed: ${error.claim} - ${error.reason}`;
            console.error(`Token verification failed: Claim validation issue - ${error.claim} - ${error.reason}`);
        } else {
			console.error('Token verification error:', error);
		}
		return { valid: false, reason };
	}
}

/**
 * Validate UUID format (basic check)
 */
function isValidUUID(uuid: string): boolean {
	// Basic UUID v4 format regex
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	return uuidRegex.test(uuid);
}
