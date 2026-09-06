package com.vireocode.vireo.web;

import java.util.Objects;
import java.util.regex.Pattern;

import org.springframework.http.HttpStatusCode;
import org.springframework.web.server.ResponseStatusException;

/**
 * A safe, intentional application failure with a stable client-visible code.
 *
 * <p>The message is sent to the client, so callers must provide an explicit
 * safe message rather than passing through persistence, identity, or upstream
 * exception details.
 */
public class ApplicationException extends ResponseStatusException {
    private static final long serialVersionUID = 1L;
    private static final Pattern UPPER_SNAKE_CASE = Pattern.compile("[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*");

    private final String code;

    public ApplicationException(HttpStatusCode status, String code, String message) {
        super(Objects.requireNonNull(status, "status must not be null"), requireMessage(message));
        this.code = requireCode(code);
    }

    public String getCode() {
        return code;
    }

    private static String requireCode(String code) {
        if (code == null || !UPPER_SNAKE_CASE.matcher(code).matches()) {
            throw new IllegalArgumentException("code must be uppercase snake case");
        }
        return code;
    }

    private static String requireMessage(String message) {
        if (message == null || message.isBlank()) {
            throw new IllegalArgumentException("message must not be blank");
        }
        return message;
    }
}
