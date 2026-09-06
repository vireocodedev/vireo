package com.vireocode.vireo.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;

class ApiErrorTest {

    @Test
    void copiesErrorDetailsAndPreservesTheirOrder() {
        Map<String, String> details = new LinkedHashMap<>();
        details.put("first", "one");
        details.put("second", "two");

        ApiError error = new ApiError(400, "Bad request", details, Instant.EPOCH);
        details.clear();

        assertThat(error.errors()).containsExactly(
                Map.entry("first", "one"),
                Map.entry("second", "two"));
        assertThatThrownBy(() -> error.errors().put("third", "three"))
                .isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    void retainsTheLegacyConstructorAndExposesTheGenericStableCode() {
        ApiError legacy = new ApiError(400, "Bad request", null, Instant.EPOCH);
        ApiError canonical = new ApiError(400, "VALIDATION_FAILED", "Bad request", null, Instant.EPOCH);

        assertThat(legacy.code()).isEqualTo("REQUEST_FAILED");
        assertThat(canonical.code()).isEqualTo("VALIDATION_FAILED");
        assertThatThrownBy(() -> new ApiError(400, "not-valid", "Bad request", null, Instant.EPOCH))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
