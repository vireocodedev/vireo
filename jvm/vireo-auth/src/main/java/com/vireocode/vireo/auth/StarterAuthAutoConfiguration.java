package com.vireocode.vireo.auth;

import java.time.Clock;
import java.util.List;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.session.ChangeSessionIdAuthenticationStrategy;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;

import io.swagger.v3.oas.annotations.enums.SecuritySchemeIn;
import io.swagger.v3.oas.annotations.enums.SecuritySchemeType;
import io.swagger.v3.oas.annotations.security.SecurityScheme;

import tools.jackson.databind.ObjectMapper;
import com.vireocode.vireo.flyway.StarterFlywayModule;

/**
 * Wires the starter's default authentication stack from the dependency alone.
 *
 * <p>
 * This module is a default, not a mandate. The roadmap's three replacement
 * seams are all here and all work the same way — declare your own bean and the
 * library's backs off:
 *
 * <ul>
 * <li><b>user store</b> — a {@link UserDetailsService} bean replaces
 * {@link DatabaseUserDetailsService}, so a consumer on LDAP or an external IdP
 * keeps the rest of the stack;</li>
 * <li><b>security chain</b> — a {@link SecurityFilterChain} bean replaces the
 * default chain outright. {@link StarterSessionSecurity} lets applications
 * retain the standard browser chain while adding narrower chains, and
 * {@link StarterHttpSecurityCustomizer} covers the far more common case of
 * wanting to add one rule rather than all of them;</li>
 * <li><b>role model</b> — no role is named in code. Roles became strings in the
 * enum-opening work, and the only role this module still cares about is the one
 * guarding the API docs, which is a property.</li>
 * </ul>
 */
@AutoConfiguration
@EnableConfigurationProperties(StarterAuthProperties.class)
@SecurityScheme(name = "cookieAuth", type = SecuritySchemeType.APIKEY, in = SecuritySchemeIn.COOKIE,
        paramName = "JSESSIONID")
public class StarterAuthAutoConfiguration {

    /**
     * Migrates first of all the modules. Three other modules put foreign keys
     * into {@code app_user}, so the table has to exist before they run.
     */
    @Bean
    StarterFlywayModule authFlywayModule() {
        return new StarterFlywayModule("auth", 10);
    }

    @Bean
    @ConditionalOnMissingBean(UserDetailsService.class)
    DatabaseUserDetailsService starterUserDetailsService(StarterUserRepository userRepository) {
        return new DatabaseUserDetailsService(userRepository);
    }

    @Bean
    @ConditionalOnMissingBean
    @ConditionalOnProperty(prefix = "vireo.starter.auth", name = "endpoints-enabled", matchIfMissing = true)
    AuthController starterAuthController(AuthenticationManager authenticationManager,
            SessionAuthenticationStrategy sessionAuthenticationStrategy) {
        return new AuthController(authenticationManager, sessionAuthenticationStrategy);
    }

    @Bean
    @ConditionalOnMissingBean
    @ConditionalOnBean(name = "starterUserDetailsService")
    @ConditionalOnProperty(prefix = "vireo.starter.auth", name = {
            "endpoints-enabled", "account-endpoints-enabled" }, matchIfMissing = true)
    AccountController starterAccountController(StarterUserRepository userRepository, PasswordEncoder passwordEncoder) {
        return new AccountController(userRepository, passwordEncoder);
    }

    @Bean
    @ConditionalOnMissingBean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    @ConditionalOnMissingBean
    AuthenticationManager authenticationManager(AuthenticationConfiguration authenticationConfiguration)
            throws Exception {
        return authenticationConfiguration.getAuthenticationManager();
    }

    /** Applies Spring Security's session-fixation protection to manual JSON login. */
    @Bean
    @ConditionalOnMissingBean
    SessionAuthenticationStrategy starterSessionAuthenticationStrategy() {
        return new ChangeSessionIdAuthenticationStrategy();
    }

    /**
     * Available even when an application contributes one or more security
     * chains and the library's default chain therefore backs off.
     */
    @Bean
    StarterSessionSecurity starterSessionSecurity(StarterAuthProperties properties, ObjectMapper objectMapper,
            List<StarterHttpSecurityCustomizer> customizers, Clock clock) {
        return new StarterSessionSecurity(properties, objectMapper, customizers, clock);
    }

    /**
     * The default chain: session cookies, CSRF tokens a single-page application
     * can read, JSON error bodies instead of a redirect to a login form.
     *
     * <p>
     * The only rule that used to be application-specific was the role guarding
     * the API documentation, which was a hard-coded {@code SUPERADMIN}. Naming a
     * role in a library contradicts the open role model, so it is now
     * {@code vireo.starter.auth.docs-role} and defaults to requiring nothing more
     * than authentication.
     */
    @Bean
    @ConditionalOnMissingBean(SecurityFilterChain.class)
    SecurityFilterChain starterSecurityFilterChain(HttpSecurity http, StarterSessionSecurity sessionSecurity)
            throws Exception {
        return sessionSecurity.build(http);
    }
}
