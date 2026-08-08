package com.work.coffeemode.config;

import com.work.coffeemode.security.FirebaseTokenFilter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity(securedEnabled = true, jsr250Enabled = true) // Enable method-level security
public class SecurityConfig {

    private final FirebaseTokenFilter firebaseTokenFilter;

    public SecurityConfig(FirebaseTokenFilter firebaseTokenFilter) {
        this.firebaseTokenFilter = firebaseTokenFilter;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                // Disable CSRF protection - common for stateless APIs
                .csrf(AbstractHttpConfigurer::disable)
                // Disable standard form login
                .formLogin(AbstractHttpConfigurer::disable)
                // Disable standard http basic
                .httpBasic(AbstractHttpConfigurer::disable)
                // Set session management to stateless - essential for token-based auth
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                // Define authorization rules
                .authorizeHttpRequests(authz -> authz
                        // Temporarily permit all requests
                        .anyRequest().permitAll()
                // Original configuration (commented out):
                // // Allow access to public endpoints (e.g., health checks, potentially swagger
                // UI)
                // // Add any other public paths here
                // .requestMatchers("/public/**", "/actuator/**", "/error").permitAll()
                // // Allow access to swagger-ui
                // .requestMatchers("/swagger-ui/**", "/v3/api-docs/**").permitAll()
                // // Require authentication for all other requests
                // .anyRequest().authenticated()
                )
                // Add the FirebaseTokenFilter before the standard
                // UsernamePasswordAuthenticationFilter
                .addFilterBefore(firebaseTokenFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    // Optional: Define beans for PasswordEncoder if needed elsewhere (not directly
    // for Firebase auth)
    // @Bean
    // public PasswordEncoder passwordEncoder() {
    // return new BCryptPasswordEncoder();
    // }

    // Optional: Define AuthenticationManager bean if using standard Spring Security
    // auth providers elsewhere
    // @Bean
    // public AuthenticationManager
    // authenticationManager(AuthenticationConfiguration
    // authenticationConfiguration) throws Exception {
    // return authenticationConfiguration.getAuthenticationManager();
    // }
}