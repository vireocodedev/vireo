package com.vireocode.vireo.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class ApplicationExceptionTest {

    @Test
    void requiresAnUppercaseSnakeCaseCodeAndExplicitNonblankMessage() {
        ApplicationException exception = new ApplicationException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Bad input");

        assertThat(exception.getCode()).isEqualTo("INVALID_REQUEST");
        assertThatThrownBy(() -> new ApplicationException(HttpStatus.BAD_REQUEST, "invalid-request", "Bad input"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ApplicationException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", " "))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
