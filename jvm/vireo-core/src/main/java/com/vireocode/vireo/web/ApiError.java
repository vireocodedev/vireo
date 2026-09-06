package com.vireocode.vireo.web;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

@Schema(name = "ApiError", description = "API error response")
public record ApiError(
        @Schema(description = "HTTP status code", example = "400", requiredMode = Schema.RequiredMode.REQUIRED) int status,
        @Schema(description = "Stable machine-readable error code", example = "VALIDATION_FAILED", requiredMode = Schema.RequiredMode.REQUIRED) String code,
        @Schema(description = "Error message", example = "Bad request", requiredMode = Schema.RequiredMode.REQUIRED) String message,
        @Schema(description = "Additional error details (e.g., validation field errors)", nullable = true)
        Map<String, String> errors,
        @Schema(description = "Timestamp of error", example = "2026-06-25T12:34:56Z", requiredMode = Schema.RequiredMode.REQUIRED) Instant timestamp
) {
    public ApiError {
        code = requireCode(code);
        message = Objects.requireNonNull(message, "message must not be null");
        timestamp = Objects.requireNonNull(timestamp, "timestamp must not be null");
        errors = errors == null ? null : Collections.unmodifiableMap(new LinkedHashMap<>(errors));
    }

    /**
     * Source- and binary-compatible constructor for callers compiled against
     * the pre-code wire model. New code should supply an explicit code.
     */
    public ApiError(int status, String message, Map<String, String> errors, Instant timestamp) {
        this(status, "REQUEST_FAILED", message, errors, timestamp);
    }

    private static String requireCode(String code) {
        if (code == null || !code.matches("[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*")) {
            throw new IllegalArgumentException("code must be uppercase snake case");
        }
        return code;
    }
}
