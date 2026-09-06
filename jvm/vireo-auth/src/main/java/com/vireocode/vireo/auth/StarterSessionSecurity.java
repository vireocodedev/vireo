package com.vireocode.vireo.auth;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.function.Supplier;

import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.www.BasicAuthenticationFilter;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.csrf.CsrfTokenRequestHandler;
import org.springframework.security.web.csrf.XorCsrfTokenRequestAttributeHandler;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import tools.jackson.databind.ObjectMapper;
import com.vireocode.vireo.web.ApiError;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Builds Vireo's standard browser session-security chain for applications that
 * also declare narrower security chains.
 *
 * <p>
 * The auto-configured default chain uses this helper. An application that adds
 * any {@link SecurityFilterChain} can inject this helper and delegate its
 * browser chain to {@link #build(HttpSecurity)}, while retaining ownership of
 * chain ordering and matchers.
 *
 * <p>
 * Build exactly one browser chain with this helper. It is the final catch-all
 * chain, so every earlier chain must have a narrower matcher.
 */
public final class StarterSessionSecurity {

    private final StarterAuthProperties properties;
    private final ObjectMapper objectMapper;
    private final List<StarterHttpSecurityCustomizer> customizers;
    private final Clock clock;

    StarterSessionSecurity(StarterAuthProperties properties, ObjectMapper objectMapper,
            List<StarterHttpSecurityCustomizer> customizers, Clock clock) {
        this.properties = properties;
        this.objectMapper = objectMapper;
        this.customizers = List.copyOf(customizers);
        this.clock = clock;
    }

    /**
     * Applies Vireo's session, CSRF, JSON-failure, endpoint, documentation, and
     * application-customizer policy to the supplied browser chain and finalizes
     * the supplied {@code HttpSecurity}. Do not configure it after this call.
     */
    public SecurityFilterChain build(HttpSecurity http) throws Exception {
        String[] docsMatchers = properties.getDocsMatchers().toArray(String[]::new);

        for (StarterHttpSecurityCustomizer customizer : customizers) {
            customizer.customize(http);
        }

        http
                .authorizeHttpRequests(auth -> {
                    auth.requestMatchers(properties.getLoginPath()).permitAll();
                    if (docsMatchers.length > 0) {
                        if (StringUtils.hasText(properties.getDocsRole())) {
                            auth.requestMatchers(docsMatchers).hasRole(properties.getDocsRole());
                        } else {
                            auth.requestMatchers(docsMatchers).authenticated();
                        }
                    }
                    auth.requestMatchers(properties.getApiPathPattern()).authenticated();
                    auth.anyRequest().permitAll();
                })
                .httpBasic(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .exceptionHandling(exceptionHandling -> exceptionHandling
                        .authenticationEntryPoint((request, response, authException) -> writeError(response,
                                HttpServletResponse.SC_UNAUTHORIZED, "UNAUTHORIZED", "Unauthorized"))
                        .accessDeniedHandler((request, response, accessDeniedException) -> writeError(response,
                                HttpServletResponse.SC_FORBIDDEN, "FORBIDDEN", "Forbidden")))
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
                .csrf(csrf -> {
                    csrf.csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                            .csrfTokenRequestHandler(new SpaCsrfTokenRequestHandler())
                            .ignoringRequestMatchers(properties.getLoginPath(), properties.getLogoutPath());
                    if (docsMatchers.length > 0) {
                        csrf.ignoringRequestMatchers(docsMatchers);
                    }
                })
                .addFilterAfter(new CsrfCookieFilter(), BasicAuthenticationFilter.class);

        return http.build();
    }

    private void writeError(HttpServletResponse response, int status, String code, String message) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        objectMapper.writeValue(response.getWriter(), new ApiError(status, code, message, null, Instant.now(clock)));
    }

    private static final class SpaCsrfTokenRequestHandler extends CsrfTokenRequestAttributeHandler {

        private final CsrfTokenRequestHandler delegate = new XorCsrfTokenRequestAttributeHandler();

        @Override
        public void handle(HttpServletRequest request, HttpServletResponse response, Supplier<CsrfToken> csrfToken) {
            delegate.handle(request, response, csrfToken);
        }

        @Override
        public String resolveCsrfTokenValue(HttpServletRequest request, CsrfToken csrfToken) {
            if (StringUtils.hasText(request.getHeader(csrfToken.getHeaderName()))) {
                return super.resolveCsrfTokenValue(request, csrfToken);
            }
            return delegate.resolveCsrfTokenValue(request, csrfToken);
        }
    }

    private static final class CsrfCookieFilter extends OncePerRequestFilter {

        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                FilterChain filterChain) throws ServletException, IOException {
            CsrfToken csrfToken = (CsrfToken) request.getAttribute(CsrfToken.class.getName());
            if (csrfToken != null) {
                csrfToken.getToken();
            }
            filterChain.doFilter(request, response);
        }
    }
}
