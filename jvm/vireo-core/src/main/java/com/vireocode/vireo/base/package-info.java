/**
 * Reusable JPA CRUD mechanics for application-owned aggregates.
 *
 * <p>
 * {@link com.vireocode.vireo.base.BaseEntity} supplies auditing, keyword, and
 * soft-delete columns. A consumer pairs it with a
 * {@link com.vireocode.vireo.base.BaseMapper} or
 * {@link com.vireocode.vireo.base.BaseRequestMapper},
 * {@link com.vireocode.vireo.base.SearchableRepository}, and one
 * {@link com.vireocode.vireo.base.EntityConfig} on a
 * {@link com.vireocode.vireo.base.BaseService} or
 * {@link com.vireocode.vireo.base.BaseRequestService} subclass. Public CRUD methods
 * preserve the shared lifecycle; protected template hooks are the supported
 * customization boundary.
 */
package com.vireocode.vireo.base;
