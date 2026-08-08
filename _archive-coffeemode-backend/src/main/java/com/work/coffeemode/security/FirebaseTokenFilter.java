package com.work.coffeemode.security;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseAuthException;
import com.google.firebase.auth.FirebaseToken;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.ArrayList; // Using empty authorities for now

@Component
public class FirebaseTokenFilter extends OncePerRequestFilter {

    private static final Logger logger = LoggerFactory.getLogger(FirebaseTokenFilter.class);
    private static final String HEADER_NAME = "Authorization";
    private static final String TOKEN_PREFIX = "Bearer ";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {

        String idToken = extractToken(request);

        if (idToken != null) {
            try {
                FirebaseToken decodedToken = FirebaseAuth.getInstance().verifyIdToken(idToken);
                String uid = decodedToken.getUid();

                // Here you could fetch user details from your database (e.g., MongoDB) using
                // the UID
                // to get roles/authorities.
                // For now, we create a simple Authentication object with the UID as principal
                // and empty authorities.

                // You might want to create a custom UserDetails object holding the Firebase UID
                // and other info.
                // Example: UserDetails userDetails = new FirebaseUserDetails(uid,
                // fetchedAuthorities);

                UsernamePasswordAuthenticationToken authentication = new UsernamePasswordAuthenticationToken(
                        uid, // Use UID as principal, or a custom UserDetails object
                        null, // No credentials needed for token-based auth
                        new ArrayList<>() // Replace with actual authorities if fetched
                );
                authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));

                // Set authentication in SecurityContext
                SecurityContextHolder.getContext().setAuthentication(authentication);
                logger.debug("Firebase token verified successfully for UID: {}", uid);

            } catch (FirebaseAuthException e) {
                // Token verification failed (invalid, expired, etc.)
                logger.warn("Firebase token verification failed: {}", e.getMessage());
                SecurityContextHolder.clearContext(); // Ensure context is cleared on failure
                // Optionally, you could set an error attribute on the request or directly
                // modify the response,
                // but typically letting Spring Security's ExceptionTranslationFilter handle it
                // is preferred.
                // response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                // response.getWriter().write("Authentication Error: " + e.getMessage());
                // return; // Stop filter chain if directly handling response
            } catch (Exception e) {
                // Catch other potential errors during verification
                logger.error("Unexpected error during Firebase token verification", e);
                SecurityContextHolder.clearContext();
            }
        } else {
            logger.trace("No Firebase token found in request headers.");
        }

        // Continue the filter chain
        filterChain.doFilter(request, response);
    }

    private String extractToken(HttpServletRequest request) {
        String bearerToken = request.getHeader(HEADER_NAME);
        if (bearerToken != null && bearerToken.startsWith(TOKEN_PREFIX)) {
            return bearerToken.substring(TOKEN_PREFIX.length());
        }
        return null;
    }
}