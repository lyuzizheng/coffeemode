package com.work.coffeemode.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.web.SecurityFilterChain;

/**
 * Spring Security configuration.
 * 
 * This class configures Spring Security settings for the application, defining
 * authorization rules, CSRF protection, and other security-related settings.
 * 
 * In this demonstration setup, security is minimally configured to allow all API requests.
 * For a production environment, you would:
 * 1. Configure proper authentication (OAuth2, JWT, etc.)
 * 2. Set appropriate authorization rules
 * 3. Enable CSRF protection for browser clients
 * 4. Configure proper CORS settings
 * 5. Add additional security headers
 */
@Configuration      // Marks this class as a Spring configuration
@EnableWebSecurity  // Enables Spring Security's web security support
public class SecurityConfiguration {

    /**
     * Configures the security filter chain.
     * 
     * This defines how incoming requests should be secured:
     * - Which endpoints are protected
     * - Authentication requirements
     * - CSRF protection
     * 
     * @param http HttpSecurity object to configure
     * @return The built SecurityFilterChain
     * @throws Exception if an error occurs during configuration
     */
    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        return http
                .csrf(AbstractHttpConfigurer::disable)  // Disable CSRF for API endpoints
                // Note: In production REST APIs with proper session handling,
                // you would typically enable CSRF protection
                
                .authorizeHttpRequests(auth -> auth
                        // Allow unrestricted access to all API endpoints
                        // In production, you would restrict access based on roles/permissions
                        .requestMatchers("/","/api/**").permitAll()
                        
                        // Require authentication for all other endpoints
                        .anyRequest().authenticated()
                )
                .build();
    }
}
