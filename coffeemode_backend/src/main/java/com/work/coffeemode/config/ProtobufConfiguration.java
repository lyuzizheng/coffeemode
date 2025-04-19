package com.work.coffeemode.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hubspot.jackson.datatype.protobuf.ProtobufModule;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import org.springframework.http.converter.protobuf.ProtobufHttpMessageConverter;

/**
 * Configuration for Protocol Buffers (protobuf) integration with Spring.
 * 
 * This configuration enables Spring to:
 * 1. Convert between HTTP requests/responses and protobuf objects
 * 2. Serialize/deserialize protobuf objects to/from JSON
 * 
 * Protocol Buffers Setup in a Spring Boot project:
 * 
 * 1. Add dependencies to build.gradle:
 * 2. Create protobuf definition files in src/main/proto/
 * 3. Run `./gradlew generateProto` to generate Java classes
 * 4. Use the generated classes in your Spring application
 */
@Configuration // Marks this class as a Spring configuration
public class ProtobufConfiguration {

    /**
     * Creates a ProtobufHttpMessageConverter bean.
     * 
     * This converter enables Spring to convert between HTTP messages and 
     * Protocol Buffer objects automatically. It allows:
     * - Accepting protobuf encoded request bodies
     * - Returning protobuf objects directly from controller methods
     * 
     * @return A ProtobufHttpMessageConverter instance
     */
    @Bean
    public ProtobufHttpMessageConverter protobufHttpMessageConverter() {
        return new ProtobufHttpMessageConverter();
    }
    
    /**
     * Configures Jackson to work with Protocol Buffer objects.
     * 
     * This enables serialization/deserialization of protobuf objects to/from JSON,
     * which is useful when your API needs to support both JSON and protobuf formats.
     * 
     * @param builder The Jackson object mapper builder
     * @return Configured ObjectMapper with protobuf support
     */
    @Bean
    public ObjectMapper objectMapper(Jackson2ObjectMapperBuilder builder) {
        ObjectMapper objectMapper = builder.build();
        objectMapper.registerModule(new ProtobufModule());
        return objectMapper;
    }
}
