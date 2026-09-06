package com.vireocode.docs.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import tools.jackson.databind.ObjectMapper;

class ExternalIdentitySecurityConfigurationExampleTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Clock clock = Clock.fixed(Instant.parse("2026-09-06T00:00:00Z"), ZoneOffset.UTC);

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void missingAndInvalidKeysReturnTheSameSafeJsonError() throws Exception {
        var missingResponse = invoke(apiKey -> {
            throw new AssertionError("missing keys must not reach the authenticator");
        }, null);
        var invalidResponse = invoke(apiKey -> {
            throw new BadCredentialsException("secret diagnostic");
        }, "invalid");

        assertThat(missingResponse.getStatus()).isEqualTo(401);
        assertThat(invalidResponse.getStatus()).isEqualTo(401);
        assertThat(missingResponse.getContentAsString()).isEqualTo(invalidResponse.getContentAsString());
        assertThat(invalidResponse.getContentAsString()).contains("\"code\":\"UNAUTHORIZED\"");
        assertThat(invalidResponse.getContentAsString()).doesNotContain("secret diagnostic", "invalid");
    }

    @Test
    void validKeyAuthenticatesOnlyForTheDownstreamCallAndDoesNotRewriteItsFailures() throws Exception {
        var authentication = UsernamePasswordAuthenticationToken.authenticated("integration", "", List.of());
        var filter = filter(apiKey -> authentication);
        var request = request("valid");
        var response = new MockHttpServletResponse();
        var reached = new AtomicBoolean();

        filter.doFilter(request, response, (downstreamRequest, downstreamResponse) -> {
            reached.set(true);
            assertThat(SecurityContextHolder.getContext().getAuthentication()).isSameAs(authentication);
        });

        assertThat(reached).isTrue();
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();

        assertThatThrownBy(() -> filter.doFilter(request("valid"), new MockHttpServletResponse(),
                (downstreamRequest, downstreamResponse) -> {
                    throw new BadCredentialsException("downstream failure");
                }))
                .isInstanceOf(BadCredentialsException.class)
                .hasMessage("downstream failure");
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    private MockHttpServletResponse invoke(
            ExternalIdentitySecurityConfigurationExample.ExternalApiKeyAuthenticator authenticator,
            String apiKey) throws Exception {
        var response = new MockHttpServletResponse();
        filter(authenticator).doFilter(request(apiKey), response, (request, downstreamResponse) -> {
            throw new AssertionError("invalid requests must not reach the downstream chain");
        });
        return response;
    }

    private ExternalIdentitySecurityConfigurationExample.ExternalApiKeyAuthenticationFilter filter(
            ExternalIdentitySecurityConfigurationExample.ExternalApiKeyAuthenticator authenticator) {
        return new ExternalIdentitySecurityConfigurationExample.ExternalApiKeyAuthenticationFilter(
                authenticator, objectMapper, clock);
    }

    private MockHttpServletRequest request(String apiKey) {
        var request = new MockHttpServletRequest("GET", "/api/external/items");
        if (apiKey != null)
            request.addHeader("X-Api-Key", apiKey);
        return request;
    }
}
