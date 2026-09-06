package com.vireocode.docs.auth;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.ldap.core.support.BaseLdapPathContextSource;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.config.ldap.LdapBindAuthenticationManagerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.ldap.DefaultLdapUsernameToDnMapper;
import org.springframework.security.ldap.userdetails.LdapUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;

import tools.jackson.databind.ObjectMapper;
import com.vireocode.vireo.auth.StarterSessionSecurity;
import com.vireocode.vireo.web.ApiError;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Compile-checked examples of replacing Vireo's default database user model and
 * adding a narrowly scoped stateless API-key chain.
 */
@Configuration(proxyBeanMethods = false)
public class ExternalIdentitySecurityConfigurationExample {

    @Bean
    UserDetailsService ldapUserDetailsService(BaseLdapPathContextSource contextSource) {
        LdapUserDetailsManager users = new LdapUserDetailsManager(contextSource);
        users.setUsernameMapper(new DefaultLdapUsernameToDnMapper("ou=people", "uid"));
        users.setGroupSearchBase("ou=groups");
        return users;
    }

    @Bean
    AuthenticationManager ldapAuthenticationManager(BaseLdapPathContextSource contextSource) {
        LdapBindAuthenticationManagerFactory factory = new LdapBindAuthenticationManagerFactory(contextSource);
        factory.setUserDnPatterns("uid={0},ou=people");
        return factory.createAuthenticationManager();
    }

    @Bean
    @Order(1)
    SecurityFilterChain externalApiKeyChain(HttpSecurity http, ExternalApiKeyAuthenticator apiKeys,
            ObjectMapper objectMapper, Clock clock) throws Exception {
        return http
                .securityMatcher("/api/external/**")
                // This chain is header-only, stateless (no session cookie), and path-scoped,
                // so disabling CSRF here carries no risk; it is intentional, not an oversight.
                .csrf(AbstractHttpConfigurer::disable) // lgtm[java/spring-disabled-csrf-protection]
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(authorize -> authorize.anyRequest().authenticated())
                .addFilterBefore(new ExternalApiKeyAuthenticationFilter(apiKeys, objectMapper, clock),
                        UsernamePasswordAuthenticationFilter.class)
                .build();
    }

    /** Uses the public helper after this application's external chain disables the default one. */
    @Bean
    @Order(2)
    SecurityFilterChain browserSessionChain(HttpSecurity http, StarterSessionSecurity sessionSecurity)
            throws Exception {
        return sessionSecurity.build(http);
    }

    private static void writeError(ObjectMapper objectMapper, HttpServletResponse response, int status,
            String message, Clock clock) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        objectMapper.writeValue(response.getWriter(),
                new ApiError(status, "UNAUTHORIZED", message, null, Instant.now(clock)));
    }

    /**
     * Application-owned key lookup: store only a hash, compare in constant time,
     * enforce expiry and revocation, and reveal plaintext only at issuance.
     */
    @FunctionalInterface
    public interface ExternalApiKeyAuthenticator {

        Authentication authenticate(String apiKey);
    }

    static final class ExternalApiKeyAuthenticationFilter extends OncePerRequestFilter {

        private static final String API_KEY_HEADER = "X-Api-Key";

        private final ExternalApiKeyAuthenticator apiKeys;
        private final ObjectMapper objectMapper;
        private final Clock clock;

        ExternalApiKeyAuthenticationFilter(ExternalApiKeyAuthenticator apiKeys, ObjectMapper objectMapper,
                Clock clock) {
            this.apiKeys = apiKeys;
            this.objectMapper = objectMapper;
            this.clock = clock;
        }

        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                FilterChain filterChain) throws ServletException, IOException {
            String apiKey = request.getHeader(API_KEY_HEADER);
            if (apiKey == null || apiKey.isBlank()) {
                writeError(objectMapper, response, HttpServletResponse.SC_UNAUTHORIZED, "Unauthorized", clock);
                return;
            }

            Authentication authentication;
            try {
                authentication = apiKeys.authenticate(apiKey);
                if (authentication == null || !authentication.isAuthenticated())
                    throw new BadCredentialsException("Invalid API key");
            } catch (AuthenticationException exception) {
                writeError(objectMapper, response, HttpServletResponse.SC_UNAUTHORIZED, "Unauthorized", clock);
                return;
            }

            SecurityContext context = SecurityContextHolder.createEmptyContext();
            context.setAuthentication(authentication);
            SecurityContextHolder.setContext(context);
            try {
                filterChain.doFilter(request, response);
            } finally {
                SecurityContextHolder.clearContext();
            }
        }
    }
}
