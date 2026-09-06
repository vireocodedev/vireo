/**
 * Replaceable session-authentication contracts and the default database user model.
 *
 * <p>
 * Supported consumer APIs are the immutable HTTP request and response records,
 * {@link com.vireocode.vireo.auth.StarterAuthProperties},
 * {@link com.vireocode.vireo.auth.StarterHttpSecurityCustomizer},
 * {@link com.vireocode.vireo.auth.StarterSessionSecurity}, and—only
 * when deliberately using the default database store—
 * {@link com.vireocode.vireo.auth.StarterUser} with
 * {@link com.vireocode.vireo.auth.StarterUserRepository}. Controllers and the
 * database {@code UserDetailsService} remain implementation details.
 */
package com.vireocode.vireo.auth;
