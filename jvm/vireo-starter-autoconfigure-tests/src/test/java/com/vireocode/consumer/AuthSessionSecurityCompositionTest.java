package com.vireocode.consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import tools.jackson.databind.ObjectMapper;
import com.vireocode.vireo.auth.LoginRequest;
import com.vireocode.vireo.auth.StarterHttpSecurityCustomizer;
import com.vireocode.vireo.auth.StarterSessionSecurity;

@SpringBootTest(classes = { ConsumerApplication.class, AuthSessionSecurityCompositionTest.Configuration.class })
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AuthSessionSecurityCompositionTest {

    @Autowired
    private ApplicationContext context;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void helperRemainsAvailableWhileTheDefaultChainBacksOff() {
        assertThat(context.getBean(StarterSessionSecurity.class)).isNotNull();
        assertThat(context.containsBean("starterSecurityFilterChain")).isFalse();
        assertThat(context.getBeansOfType(SecurityFilterChain.class))
                .containsKeys("externalApiChain", "browserSessionChain")
                .hasSize(2);
    }

    @Test
    void externalChainIsNarrowStatelessAndIgnoresBrowserCustomizers() throws Exception {
        mockMvc.perform(get("/api/external/ping"))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist(HttpHeaders.SET_COOKIE));

        mockMvc.perform(get("/api/external/customizer"))
                .andExpect(status().isForbidden());
    }

    @Test
    void browserChainKeepsJsonUnauthorizedCsrfAndBrowserOnlyCustomizerRules() throws Exception {
        mockMvc.perform(get("/api/browser/protected"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"))
                .andExpect(jsonPath("$.message").value("Unauthorized"));

        mockMvc.perform(post("/api/browser/protected").with(user("browser").roles("USER")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.status").value(403))
                .andExpect(jsonPath("$.code").value("FORBIDDEN"))
                .andExpect(jsonPath("$.message").value("Forbidden"));

        mockMvc.perform(post("/api/browser/protected").with(user("browser").roles("USER")).with(csrf()))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/browser/customizer"))
                .andExpect(status().isOk());
    }

    @Test
    void browserLoginAndPublicFallbackKeepTheirDefaultPolicy() throws Exception {
        String body = objectMapper.writeValueAsString(new LoginRequest("demo", "demo123"));

        mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("demo"));

        mockMvc.perform(get("/public-fallback"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scope").value("public"));
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class Configuration {

        @Bean
        @Order(1)
        SecurityFilterChain externalApiChain(HttpSecurity http) throws Exception {
            return http
                    .securityMatcher("/api/external/**")
                    .csrf(AbstractHttpConfigurer::disable)
                    .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                    .authorizeHttpRequests(authorize -> authorize
                            .requestMatchers("/api/external/ping").permitAll()
                            .anyRequest().denyAll())
                    .build();
        }

        @Bean
        @Order(2)
        SecurityFilterChain browserSessionChain(HttpSecurity http, StarterSessionSecurity sessionSecurity)
                throws Exception {
            return sessionSecurity.build(http);
        }

        @Bean
        StarterHttpSecurityCustomizer browserOnlyCustomizer() {
            return http -> http.authorizeHttpRequests(authorize -> authorize
                    .requestMatchers("/api/browser/customizer", "/api/external/customizer").permitAll());
        }

        @Bean
        CompositionController compositionController() {
            return new CompositionController();
        }
    }

    @RestController
    static class CompositionController {

        @GetMapping("/api/external/ping")
        Map<String, String> externalPing() {
            return Map.of("scope", "external");
        }

        @GetMapping("/api/external/customizer")
        Map<String, String> externalCustomizer() {
            return Map.of("scope", "external");
        }

        @GetMapping("/api/browser/protected")
        Map<String, String> browserProtected() {
            return Map.of("scope", "browser");
        }

        @PostMapping("/api/browser/protected")
        Map<String, String> changeBrowserState() {
            return Map.of("scope", "browser");
        }

        @GetMapping("/api/browser/customizer")
        Map<String, String> browserCustomizer() {
            return Map.of("scope", "browser");
        }

        @GetMapping("/public-fallback")
        Map<String, String> publicFallback() {
            return Map.of("scope", "public");
        }
    }
}
