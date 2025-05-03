package com.work.coffeemode.aop;

import com.work.coffeemode.exception.ClientException;
import com.work.coffeemode.exception.ServerException;
import com.work.coffeemode.model.UnifiedResponse;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Pointcut;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;

@Aspect
@Component
@Slf4j
public class UnifiedResponseAspect {

    // Define the pointcut to target all public methods in the controller package
    @Pointcut("execution(public * com.work.coffeemode.controller..*(..))")
    public void controllerMethods() {
    }

    @Around("controllerMethods()")
    public ResponseEntity<UnifiedResponse<?>> wrapResponse(ProceedingJoinPoint joinPoint) {
        try {
            Object result = joinPoint.proceed();

            // 1. Handle explicitly returned ResponseEntity (e.g., for 201 Created, custom
            // headers)
            if (result instanceof ResponseEntity) {
                // Pass through pre-constructed ResponseEntity
                // Note: We assume it contains the appropriate body structure if needed, or is
                // like ResponseEntity.ok().build()
                @SuppressWarnings("unchecked") // Suppress warning for cast, assuming intended usage
                ResponseEntity<UnifiedResponse<?>> typedResult = (ResponseEntity<UnifiedResponse<?>>) result;
                return typedResult;
            }

            // 2. For ALL other return types (data, null, void), wrap in standard success
            // response
            UnifiedResponse<?> responseBody = UnifiedResponse.success(result);
            return new ResponseEntity<>(responseBody, HttpStatus.OK);

        } catch (Throwable throwable) {
            log.error("Exception caught in controller method {}: {}", joinPoint.getSignature().toShortString(),
                    throwable.getMessage(), throwable);

            UnifiedResponse<?> errorBody;
            HttpStatus status;

            if (throwable instanceof ClientException clientException) {
                log.warn("ClientException caught: {} - Code: {}", clientException.getMessage(),
                        clientException.getCode());
                errorBody = UnifiedResponse.error(clientException.getCode(), clientException.getMessage());
                status = HttpStatus.BAD_REQUEST;
            } else if (throwable instanceof ServerException serverException) {
                log.error("ServerException caught: {} - Code: {}", serverException.getMessage(),
                        serverException.getCode(), throwable);
                errorBody = UnifiedResponse.error(serverException.getCode(), serverException.getMessage());
                status = HttpStatus.INTERNAL_SERVER_ERROR;
            } else {
                log.error("Non-custom Throwable caught: {}", throwable.getMessage(), throwable);
                errorBody = UnifiedResponse.error(500, "Internal Server Error");
                status = HttpStatus.INTERNAL_SERVER_ERROR;
            }
            return new ResponseEntity<>(errorBody, status);
        }
    }
}