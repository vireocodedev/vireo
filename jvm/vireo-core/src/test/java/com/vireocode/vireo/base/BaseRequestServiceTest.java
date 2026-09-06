package com.vireocode.vireo.base;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;

import com.vireocode.vireo.spi.HistoryEventsRecorder;
import com.vireocode.vireo.spi.OfflineChangeBroadcaster;
import com.vireocode.vireo.spi.OfflineRevisionTracker;

import jakarta.persistence.Id;

class BaseRequestServiceTest {

    enum TicketHistoryType implements HistoryEntityType {
        TICKET
    }

    @Test
    void create_UsesOnlyTheCreateModelAndPublishesTheSharedLifecycle() {
        SearchableRepository<Ticket, Long> repository = repository();
        BaseRequestMapper<Ticket, CreateTicket, PatchTicket, TicketResponse> mapper = mapper();
        TicketService service = new TicketService(repository, mapper);
        HistoryEventsRecorder history = mock(HistoryEventsRecorder.class);
        OfflineRevisionTracker revisions = mock(OfflineRevisionTracker.class);
        OfflineChangeBroadcaster broadcaster = mock(OfflineChangeBroadcaster.class);
        service.setHistoryRecorder(history);
        service.setOfflineRevisionTracker(revisions);
        service.setOfflineChangeBroadcaster(broadcaster);

        CreateTicket request = new CreateTicket("new", 41L);
        Ticket domain = ticket(7L, "new");
        TicketResponse response = new TicketResponse(7L, "new", "team-41");
        when(mapper.toDomain(request)).thenReturn(domain);
        when(repository.saveAndFlush(domain)).thenReturn(domain);
        when(mapper.toResponse(domain)).thenReturn(response);
        when(revisions.bump("ticket")).thenReturn(4L);

        assertEquals(response, service.create(request));
        assertEquals(41L, service.createdTeamId);
        verify(history).recordCreate(TicketHistoryType.TICKET, "7", response);
        verify(broadcaster).publishCreateEvent("Ticket", response, 4L);
    }

    @Test
    void patch_UsesThePatchMapperAndRelationHookWithoutWritingResponseFields() {
        SearchableRepository<Ticket, Long> repository = repository();
        BaseRequestMapper<Ticket, CreateTicket, PatchTicket, TicketResponse> mapper = mapper();
        TicketService service = new TicketService(repository, mapper);
        service.setHistoryRecorder(mock(HistoryEventsRecorder.class));
        Ticket existing = ticket(7L, "before");
        TicketResponse previous = new TicketResponse(7L, "before", "team-1");
        TicketResponse response = new TicketResponse(7L, "after", "team-2");
        PatchTicket request = new PatchTicket("after", 2L);
        when(repository.findById(7L)).thenReturn(Optional.of(existing));
        when(repository.saveAndFlush(existing)).thenReturn(existing);
        when(mapper.toResponse(existing)).thenReturn(previous, response);

        assertEquals(response, service.patch(7L, request));
        verify(mapper).patch(request, existing);
        assertEquals(2L, service.patchedTeamId);
    }

    @Test
    void constructor_RejectsPublicLifecycleOverrides() {
        IllegalStateException exception = assertThrows(IllegalStateException.class,
                () -> new CrudOverrideService(repository(), mapper()));

        assertTrue(exception.getMessage().contains("Do not override BaseRequestService CRUD entry points"));
    }

    @Test
    void constructor_RejectsLifecycleOverrideDeclaredOnAnIntermediateSuperclass() {
        IllegalStateException exception = assertThrows(IllegalStateException.class,
                () -> new InheritedCrudOverrideService(repository(), mapper()));

        assertTrue(exception.getMessage().contains("Do not override BaseRequestService CRUD entry points"));
    }

    @Test
    void findAll_UsesAnOverriddenNotDeletedSpecification() {
        SearchableRepository<Ticket, Long> repository = repository();
        ScopedTicketService service = new ScopedTicketService(repository, mapper());
        when(repository.findAll(any(Specification.class), any(Pageable.class))).thenReturn(new PageImpl<>(List.of()));

        service.findAll(new com.vireocode.vireo.web.SearchablePageable(Pageable.unpaged(), null));

        assertTrue(service.notDeletedSpecificationCalled);
    }

    @Test
    void create_UsesAnOverriddenExtractIdForHistory() {
        SearchableRepository<Ticket, Long> repository = repository();
        BaseRequestMapper<Ticket, CreateTicket, PatchTicket, TicketResponse> mapper = mapper();
        CustomIdTicketService service = new CustomIdTicketService(repository, mapper);
        HistoryEventsRecorder history = mock(HistoryEventsRecorder.class);
        service.setHistoryRecorder(history);
        Ticket ticket = ticket(7L, "new");
        TicketResponse response = new TicketResponse(7L, "new", "team");
        when(mapper.toDomain(any())).thenReturn(ticket);
        when(repository.saveAndFlush(ticket)).thenReturn(ticket);
        when(mapper.toResponse(ticket)).thenReturn(response);

        service.create(new CreateTicket("new", 1L));

        verify(history).recordCreate(TicketHistoryType.TICKET, "external-7", response);
    }

    @SuppressWarnings("unchecked")
    private static SearchableRepository<Ticket, Long> repository() {
        return mock(SearchableRepository.class);
    }

    @SuppressWarnings("unchecked")
    private static BaseRequestMapper<Ticket, CreateTicket, PatchTicket, TicketResponse> mapper() {
        return mock(BaseRequestMapper.class);
    }

    private static Ticket ticket(Long id, String name) {
        Ticket ticket = new Ticket();
        ticket.id = id;
        ticket.name = name;
        return ticket;
    }

    record CreateTicket(String name, Long teamId) { }
    record PatchTicket(String name, Long teamId) { }
    record TicketResponse(Long id, String name, String teamName) { }

    static class Ticket extends BaseEntity {
        @Id
        private Long id;
        private String name;
    }

    static class TicketService extends BaseRequestService<Long, Ticket, CreateTicket, PatchTicket, TicketResponse> {
        Long createdTeamId;
        Long patchedTeamId;

        TicketService(SearchableRepository<Ticket, Long> repository,
                BaseRequestMapper<Ticket, CreateTicket, PatchTicket, TicketResponse> mapper) {
            super(repository, mapper, EntityConfig.builder().history(TicketHistoryType.TICKET)
                    .localSearchableFields(java.util.List.of("name")).build());
        }

        @Override
        protected void applyCreateRelations(Ticket domain, CreateTicket request) {
            createdTeamId = request.teamId();
        }

        @Override
        protected void applyPatchRelations(Ticket domain, PatchTicket request) {
            patchedTeamId = request.teamId();
        }
    }

    static class CrudOverrideService extends TicketService {
        CrudOverrideService(SearchableRepository<Ticket, Long> repository,
                BaseRequestMapper<Ticket, CreateTicket, PatchTicket, TicketResponse> mapper) {
            super(repository, mapper);
        }

        @Override
        public TicketResponse patch(Long id, PatchTicket request) {
            return null;
        }
    }

    static class IntermediateCrudOverrideService extends TicketService {
        IntermediateCrudOverrideService(SearchableRepository<Ticket, Long> repository,
                BaseRequestMapper<Ticket, CreateTicket, PatchTicket, TicketResponse> mapper) {
            super(repository, mapper);
        }

        @Override
        public TicketResponse patch(Long id, PatchTicket request) {
            return null;
        }
    }

    static class InheritedCrudOverrideService extends IntermediateCrudOverrideService {
        InheritedCrudOverrideService(SearchableRepository<Ticket, Long> repository,
                BaseRequestMapper<Ticket, CreateTicket, PatchTicket, TicketResponse> mapper) {
            super(repository, mapper);
        }
    }

    static class ScopedTicketService extends TicketService {
        boolean notDeletedSpecificationCalled;

        ScopedTicketService(SearchableRepository<Ticket, Long> repository,
                BaseRequestMapper<Ticket, CreateTicket, PatchTicket, TicketResponse> mapper) {
            super(repository, mapper);
        }

        @Override
        protected Specification<Ticket> notDeletedSpecification() {
            notDeletedSpecificationCalled = true;
            return super.notDeletedSpecification();
        }
    }

    static class CustomIdTicketService extends TicketService {
        CustomIdTicketService(SearchableRepository<Ticket, Long> repository,
                BaseRequestMapper<Ticket, CreateTicket, PatchTicket, TicketResponse> mapper) {
            super(repository, mapper);
        }

        @Override
        protected String extractId(Ticket domain) {
            return "external-" + domain.id;
        }
    }
}
