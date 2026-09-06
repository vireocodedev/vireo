package com.vireocode.vireo.base;

import org.mapstruct.BeanMapping;
import org.mapstruct.Mapping;
import org.mapstruct.MappingTarget;
import org.mapstruct.NullValuePropertyMappingStrategy;

/**
 * Maps an aggregate between its persistence model and distinct create, patch,
 * and response transport models.
 *
 * <p>The writable models deliberately do not share the response type. This
 * keeps server-owned fields out of writes and lets a PATCH model represent a
 * partial update without weakening the response contract.
 */
public interface BaseRequestMapper<DOMAIN, CREATE, PATCH, RESPONSE> {

    @Mapping(target = "id", ignore = true)
    DOMAIN toDomain(CREATE create);

    RESPONSE toResponse(DOMAIN domain);

    @BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
    @Mapping(target = "id", ignore = true)
    void patch(PATCH patch, @MappingTarget DOMAIN destination);
}
