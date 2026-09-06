package com.vireocode.vireo.web;

import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.validation.BindException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import org.springframework.web.server.ResponseStatusException;

import com.vireocode.vireo.config.StarterCoreProperties;

import jakarta.validation.ConstraintViolationException;
import lombok.extern.slf4j.Slf4j;

/** Produces the shared {@link ApiError} wire contract for common HTTP failures. */
@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    private final StarterCoreProperties properties;
    private final Clock clock;

    public GlobalExceptionHandler(StarterCoreProperties properties, Clock clock) {
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiError handleMethodArgumentNotValid(MethodArgumentNotValidException ex) {
        Map<String, String> fieldErrors = new LinkedHashMap<>();
        ex.getBindingResult().getFieldErrors().forEach(error ->
                fieldErrors.merge(error.getField(), safeMessage(error.getDefaultMessage()), this::mergeMessages));
        return validationFailed(fieldErrors);
    }

    @ExceptionHandler(BindException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiError handleBindException(BindException ex) {
        Map<String, String> fieldErrors = new LinkedHashMap<>();
        ex.getBindingResult().getFieldErrors().forEach(error ->
                fieldErrors.merge(error.getField(), safeMessage(error.getDefaultMessage()), this::mergeMessages));
        return validationFailed(fieldErrors);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiError handleConstraintViolation(ConstraintViolationException ex) {
        Map<String, String> violations = new LinkedHashMap<>();
        ex.getConstraintViolations().forEach(violation -> violations.merge(
                violation.getPropertyPath().toString(), safeMessage(violation.getMessage()), this::mergeMessages));
        return validationFailed(violations);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiError handleHttpMessageNotReadable(HttpMessageNotReadableException ex) {
        return error(HttpStatus.BAD_REQUEST, "MALFORMED_REQUEST", "Bad request",
                Map.of("request", "Request body is malformed or has an invalid value"));
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiError handleMethodArgumentTypeMismatch(MethodArgumentTypeMismatchException ex) {
        return invalidRequest(Map.of(ex.getName(), "must have a valid value"));
    }

    @ExceptionHandler(HandlerMethodValidationException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiError handleHandlerMethodValidation(HandlerMethodValidationException ex) {
        return invalidRequest(Map.of("request", "Request parameters are invalid"));
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiError handleMissingServletRequestParameter(MissingServletRequestParameterException ex) {
        return invalidRequest(Map.of(ex.getParameterName(), "is required"));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiError handleIllegalArgument(IllegalArgumentException ex) {
        return invalidRequest(Map.of("request", "Request contains an invalid value"));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    ApiError handleNoResourceFound(NoResourceFoundException ex) {
        return error(HttpStatus.NOT_FOUND, "NOT_FOUND", "Not found", null);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    @ResponseStatus(HttpStatus.METHOD_NOT_ALLOWED)
    ApiError handleMethodNotSupported(HttpRequestMethodNotSupportedException ex) {
        return error(HttpStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED", "Method not allowed", null);
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    @ResponseStatus(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
    ApiError handleMediaTypeNotSupported(HttpMediaTypeNotSupportedException ex) {
        return error(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_MEDIA_TYPE", "Unsupported media type", null);
    }

    @ExceptionHandler({ DataIntegrityViolationException.class, ObjectOptimisticLockingFailureException.class })
    @ResponseStatus(HttpStatus.CONFLICT)
    ApiError handlePersistenceConflict(Exception ex) {
        return error(HttpStatus.CONFLICT, "CONFLICT", "Conflict", null);
    }

    @ExceptionHandler(AuthenticationException.class)
    @ResponseStatus(HttpStatus.UNAUTHORIZED)
    ApiError handleAuthentication(AuthenticationException ex) {
        return error(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Unauthorized", null);
    }

    @ExceptionHandler(AccessDeniedException.class)
    @ResponseStatus(HttpStatus.FORBIDDEN)
    ApiError handleAccessDenied(AccessDeniedException ex) {
        return error(HttpStatus.FORBIDDEN, "FORBIDDEN", "Forbidden", null);
    }

    @ExceptionHandler(ApplicationException.class)
    ResponseEntity<ApiError> handleApplicationException(ApplicationException ex) {
        return ResponseEntity.status(ex.getStatusCode())
                .body(new ApiError(ex.getStatusCode().value(), ex.getCode(), ex.getReason(), null, now()));
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<ApiError> handleResponseStatusException(ResponseStatusException ex) {
        HttpStatusCode status = ex.getStatusCode();
        HttpStatus knownStatus = HttpStatus.resolve(status.value());
        String message = ex.getReason() != null
                ? ex.getReason()
                : knownStatus != null ? knownStatus.getReasonPhrase() : "Request failed";
        return ResponseEntity.status(status).body(new ApiError(status.value(), "REQUEST_FAILED", message, null, now()));
    }

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    ApiError handleGenericException(Exception ex) {
        log.error("Unhandled request failure", ex);
        Map<String, String> details = properties.isExposeInternalErrorDetails() ? buildInternalErrors(ex) : null;
        return error(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Internal server error", details);
    }

    private ApiError validationFailed(Map<String, String> errors) {
        return error(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Bad request", errors);
    }

    private ApiError invalidRequest(Map<String, String> errors) {
        return error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Bad request", errors);
    }

    private ApiError error(HttpStatus status, String code, String message, Map<String, String> errors) {
        return new ApiError(status.value(), code, message, errors, now());
    }

    private Instant now() {
        return Instant.now(clock);
    }

    private String safeMessage(String message) {
        return message == null || message.isBlank() ? "is invalid" : message;
    }

    private String mergeMessages(String first, String second) {
        return first.equals(second) ? first : first + "; " + second;
    }

    private Map<String, String> buildInternalErrors(Exception ex) {
        Throwable rootCause = getRootCause(ex);
        Map<String, String> errors = new LinkedHashMap<>();
        errors.put("exception", ex.getClass().getName());
        errors.put("message", ex.getMessage() != null ? ex.getMessage() : "");
        if (rootCause != ex) {
            errors.put("rootException", rootCause.getClass().getName());
            errors.put("rootMessage", rootCause.getMessage() != null ? rootCause.getMessage() : "");
        }
        return errors;
    }

    private Throwable getRootCause(Throwable throwable) {
        Throwable current = throwable;
        while (current.getCause() != null) {
            current = current.getCause();
        }
        return current;
    }
}
