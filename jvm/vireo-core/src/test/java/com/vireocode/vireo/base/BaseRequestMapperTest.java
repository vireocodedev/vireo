package com.vireocode.vireo.base;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.mapstruct.Mapper;
import org.mapstruct.factory.Mappers;
import org.openapitools.jackson.nullable.JsonNullable;

class BaseRequestMapperTest {

    @Test
    void patch_PreservesOmittedFieldsAndClearsExplicitNulls() {
        PatchMapper mapper = Mappers.getMapper(PatchMapper.class);
        Ticket ticket = new Ticket();
        ticket.setId(7L);
        ticket.setName("before");

        mapper.patch(new PatchTicket(JsonNullable.undefined()), ticket);
        assertThat(ticket.getName()).isEqualTo("before");

        mapper.patch(new PatchTicket(JsonNullable.of(null)), ticket);
        assertThat(ticket.getName()).isNull();
        assertThat(ticket.getId()).isEqualTo(7L);
    }

    @Mapper(uses = JsonNullableMapper.class)
    interface PatchMapper extends BaseRequestMapper<Ticket, CreateTicket, PatchTicket, TicketResponse> { }

    record CreateTicket(String name) { }
    record PatchTicket(JsonNullable<String> name) { }
    record TicketResponse(Long id, String name) { }

    static class Ticket {
        private Long id;
        private String name;

        public Long getId() { return id; }
        public void setId(Long id) { this.id = id; }
        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
    }
}
