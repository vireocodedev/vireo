package com.vireocode.vireo.base;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;
import java.util.ArrayList;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;

import com.vireocode.vireo.spi.FilterSpecificationBuilder;
import com.vireocode.vireo.spi.HistoryEventsRecorder;
import com.vireocode.vireo.spi.OfflineChangeBroadcaster;
import com.vireocode.vireo.spi.OfflineRevisionTracker;
import com.vireocode.vireo.spi.QueryFilterCriteria;
import com.vireocode.vireo.observability.QueryExecutionObservationEvent;
import com.vireocode.vireo.web.SearchablePageable;

import jakarta.persistence.Id;
import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.Expression;
import jakarta.persistence.criteria.Join;
import jakarta.persistence.criteria.Path;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;

class BaseServiceTest {

    /** Stands in for an application's own audited-entity set. */
    enum TestHistoryEntityType implements HistoryEntityType {
        ITEM
    }

    @Test
    void constructor_RejectsCrudOverride() {
        IllegalStateException exception = assertThrows(IllegalStateException.class,
                () -> new CrudOverrideService(mockRepository(), mockMapper(), defaultConfig()));
        assertTrue(exception.getMessage().contains("Do not override BaseService CRUD entry points"));
    }

    @Test
    void constructor_RejectsCrudOverrideDeclaredOnAnIntermediateSuperclass() {
        IllegalStateException exception = assertThrows(IllegalStateException.class,
                () -> new InheritedCrudOverrideService(mockRepository(), mockMapper(), defaultConfig()));

        assertTrue(exception.getMessage().contains("Do not override BaseService CRUD entry points"));
    }

    @Test
    void findAll_UsesAnOverriddenNotDeletedSpecification() {
        SearchableRepository<TestEntity, Long> repository = mockRepository();
        BaseMapper<TestEntity, TestDto> mapper = mockMapper();
        ScopedService service = new ScopedService(repository, mapper, defaultConfig());
        when(repository.findAll(any(Specification.class), any(Pageable.class))).thenReturn(new PageImpl<>(List.of()));

        service.findAll(new SearchablePageable(PageRequest.of(0, 10), null));

        assertTrue(service.notDeletedSpecificationCalled);
    }

    @Test
    void create_UsesAnOverriddenExtractIdForHistory() {
        SearchableRepository<TestEntity, Long> repository = mockRepository();
        BaseMapper<TestEntity, TestDto> mapper = mockMapper();
        CustomIdService service = new CustomIdService(repository, mapper, historyConfig());
        service.historyRecorder = mock(HistoryEventsRecorder.class);
        TestEntity saved = entity(10L, "new", false);
        TestDto response = new TestDto("new");
        when(mapper.toDomain(any())).thenReturn(saved);
        when(repository.saveAndFlush(saved)).thenReturn(saved);
        when(mapper.toDto(saved)).thenReturn(response);

        service.create(new TestDto("new"));

        verify(service.historyRecorder).recordCreate(TestHistoryEntityType.ITEM, "external-10", response);
    }

    @Test
    void getById_ThrowsWhenEntityIsHiddenBySoftDelete() {
        SearchableRepository<TestEntity, Long> repository = mockRepository();
        BaseMapper<TestEntity, TestDto> mapper = mockMapper();
        TestBaseService service = new TestBaseService(repository, mapper, softDeleteConfig());

        TestEntity deleted = entity(11L, "Deleted", true);
        when(repository.findById(11L)).thenReturn(Optional.of(deleted));

        var exception = assertThrows(org.springframework.web.server.ResponseStatusException.class,
                () -> service.getById(11L));
        assertEquals(404, exception.getStatusCode().value());
    }

    @Test
    void getById_ReturnsMappedDtoWhenVisible() {
        SearchableRepository<TestEntity, Long> repository = mockRepository();
        BaseMapper<TestEntity, TestDto> mapper = mockMapper();
        TestBaseService service = new TestBaseService(repository, mapper, softDeleteConfig());

        TestEntity entity = entity(7L, "Visible", false);
        TestDto dto = new TestDto("dto");
        when(repository.findById(7L)).thenReturn(Optional.of(entity));
        when(mapper.toDto(entity)).thenReturn(dto);

        TestDto result = service.getById(7L);

        assertEquals("dto", result.name);
    }

    @Test
    void create_PublishesCreateEventWithRevisionWhenOfflineServicesPresent() {
        SearchableRepository<TestEntity, Long> repository = mockRepository();
        BaseMapper<TestEntity, TestDto> mapper = mockMapper();
        TestBaseService service = new TestBaseService(repository, mapper, defaultConfig());

        OfflineRevisionTracker versionService = mock(OfflineRevisionTracker.class);
        OfflineChangeBroadcaster heartbeatService = mock(OfflineChangeBroadcaster.class);
        service.offlineRevisionTracker = versionService;
        service.offlineChangeBroadcaster = heartbeatService;

        TestDto input = new TestDto("new item");
        TestEntity mapped = entity(1L, "new item", false);
        TestEntity saved = entity(1L, "new item", false);
        TestDto createdDto = new TestDto("created");

        when(mapper.toDomain(input)).thenReturn(mapped);
        when(repository.saveAndFlush(mapped)).thenReturn(saved);
        when(mapper.toDto(saved)).thenReturn(createdDto);
        when(versionService.bump("testEntity")).thenReturn(3L);

        TestDto result = service.create(input);

        assertEquals("created", result.name);
        verify(heartbeatService).publishCreateEvent("TestEntity", createdDto, 3L);
    }

    @Test
    void create_RecordsHistoryWhenConfigured() {
        SearchableRepository<TestEntity, Long> repository = mockRepository();
        BaseMapper<TestEntity, TestDto> mapper = mockMapper();
        TestBaseService service = new TestBaseService(repository, mapper, historyConfig());
        service.historyRecorder = mock(HistoryEventsRecorder.class);

        TestDto input = new TestDto("new item");
        TestEntity mapped = entity(1L, "new item", false);
        TestEntity saved = entity(10L, "new item", false);
        TestDto created = new TestDto("created");

        when(mapper.toDomain(input)).thenReturn(mapped);
        when(repository.saveAndFlush(mapped)).thenReturn(saved);
        when(mapper.toDto(saved)).thenReturn(created);

        assertEquals(created, service.create(input));
        verify(service.historyRecorder).recordCreate(TestHistoryEntityType.ITEM, "10", created);
    }

    @Test
    void create_WithConfiguredHistoryButNoRecorder_FailsBeforePersistence() {
        SearchableRepository<TestEntity, Long> repository = mockRepository();
        BaseMapper<TestEntity, TestDto> mapper = mockMapper();
        TestBaseService service = new TestBaseService(repository, mapper, historyConfig());

        IllegalStateException error = assertThrows(IllegalStateException.class,
                () -> service.create(new TestDto("new item")));

        assertTrue(error.getMessage().contains("no HistoryEventsRecorder bean"));
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void create_DoesNotPublishSuccessWhenHistoryRecordingFails() {
        SearchableRepository<TestEntity, Long> repository = mockRepository();
        BaseMapper<TestEntity, TestDto> mapper = mockMapper();
        TestBaseService service = new TestBaseService(repository, mapper, historyConfig());
        service.historyRecorder = mock(HistoryEventsRecorder.class);
        service.offlineChangeBroadcaster = mock(OfflineChangeBroadcaster.class);

        TestDto input = new TestDto("new item");
        TestEntity saved = entity(10L, "new item", false);
        TestDto created = new TestDto("created");
        when(mapper.toDomain(input)).thenReturn(saved);
        when(repository.saveAndFlush(saved)).thenReturn(saved);
        when(mapper.toDto(saved)).thenReturn(created);
        org.mockito.Mockito.doThrow(new IllegalStateException("history unavailable"))
                .when(service.historyRecorder)
                .recordCreate(TestHistoryEntityType.ITEM, "10", created);

        assertThrows(IllegalStateException.class, () -> service.create(input));
        verify(service.offlineChangeBroadcaster, never()).publishCreateEvent(any(), any(), any());
    }

    @Test
    void update_RecordsHistoryAndPublishesUpdateEvent() {
        SearchableRepository<TestEntity, Long> repository = mockRepository();
        BaseMapper<TestEntity, TestDto> mapper = mockMapper();
        TestBaseService service = new TestBaseService(repository, mapper, historyConfig());

        service.historyRecorder = mock(HistoryEventsRecorder.class);
        service.offlineChangeBroadcaster = mock(OfflineChangeBroadcaster.class);
        service.offlineRevisionTracker = mock(OfflineRevisionTracker.class);
        when(service.offlineRevisionTracker.bump("testEntity")).thenReturn(5L);

        TestEntity existing = entity(10L, "before", false);
        TestEntity saved = entity(10L, "after", false);
        TestDto previous = new TestDto("before");
        TestDto updated = new TestDto("after");
        TestDto patch = new TestDto("patch");

        when(repository.findById(10L)).thenReturn(Optional.of(existing));
        when(mapper.toDto(existing)).thenReturn(previous);
        when(repository.saveAndFlush(existing)).thenReturn(saved);
        when(mapper.toDto(saved)).thenReturn(updated);

        TestDto result = service.update(10L, patch);

        assertEquals("after", result.name);
        verify(service.historyRecorder).recordUpdate(TestHistoryEntityType.ITEM, "10", previous, updated);
        verify(service.offlineChangeBroadcaster).publishUpdateEvent("TestEntity", updated, 5L);
    }

    @Test
    void delete_SoftDeletePathMarksEntityDeletedAndSaves() {
        SearchableRepository<TestEntity, Long> repository = mockRepository();
        BaseMapper<TestEntity, TestDto> mapper = mockMapper();
        EntityConfig config = EntityConfig.builder().softDelete(true).history(TestHistoryEntityType.ITEM).build();
        TestBaseService service = new TestBaseService(repository, mapper, config);

        service.historyRecorder = mock(HistoryEventsRecorder.class);
        service.offlineChangeBroadcaster = mock(OfflineChangeBroadcaster.class);

        TestEntity existing = entity(3L, "to-delete", false);
        TestDto dto = new TestDto("to-delete");
        when(repository.findById(3L)).thenReturn(Optional.of(existing));
        when(mapper.toDto(existing)).thenReturn(dto);

        service.delete(3L);

        assertTrue(existing.isDeleted());
        verify(repository).saveAndFlush(existing);
        verify(repository, never()).delete(existing);
        verify(service.offlineChangeBroadcaster).publishDeleteEvent("TestEntity", dto, null);
    }

    @Test
    void delete_PhysicalDeletePathCallsRepositoryDelete() {
        SearchableRepository<TestEntity, Long> repository = mockRepository();
        BaseMapper<TestEntity, TestDto> mapper = mockMapper();
        TestBaseService service = new TestBaseService(repository, mapper, defaultConfig());

        TestEntity existing = entity(4L, "to-delete", false);
        when(repository.findById(4L)).thenReturn(Optional.of(existing));

        service.delete(4L);

        verify(repository).delete(existing);
        verify(repository, never()).saveAndFlush(existing);
    }

    @Test
    void update_RejectsSoftDeletedEntity() {
        SearchableRepository<TestEntity, Long> repository = mockRepository();
        TestBaseService service = new TestBaseService(repository, mockMapper(), softDeleteConfig());
        when(repository.findById(8L)).thenReturn(Optional.of(entity(8L, "deleted", true)));

        var error = assertThrows(org.springframework.web.server.ResponseStatusException.class,
                () -> service.update(8L, new TestDto("updated")));

        assertEquals(404, error.getStatusCode().value());
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void publishEntityChange_HandlesNullInputsAndUnknownActions() {
        TestBaseService service = new TestBaseService(mockRepository(), mockMapper(), defaultConfig());
        service.offlineChangeBroadcaster = mock(OfflineChangeBroadcaster.class);

        service.callPublish(null, new TestDto("x"));
        service.callPublish("create", null);
        service.callPublish("noop", new TestDto("x"));

        verify(service.offlineChangeBroadcaster, never()).publishCreateEvent(any(), any(), any());
        verify(service.offlineChangeBroadcaster, never()).publishUpdateEvent(any(), any(), any());
        verify(service.offlineChangeBroadcaster, never()).publishDeleteEvent(any(), any(), any());
    }

    @Test
    void publishEntityChange_UsesNullRevisionWhenBumpReturnsZero() {
        TestBaseService service = new TestBaseService(mockRepository(), mockMapper(), defaultConfig());
        service.offlineChangeBroadcaster = mock(OfflineChangeBroadcaster.class);
        service.offlineRevisionTracker = mock(OfflineRevisionTracker.class);

        when(service.offlineRevisionTracker.bump("testEntity")).thenReturn(0L);

        TestDto dto = new TestDto("x");
        service.callPublish("create", dto);

        verify(service.offlineChangeBroadcaster).publishCreateEvent("TestEntity", dto, null);
    }

    @Test
    void snapshotForHistory_DependsOnHistoryConfig() {
        TestBaseService withHistory = new TestBaseService(mockRepository(), mockMapper(), historyConfig());
        TestBaseService withoutHistory = new TestBaseService(mockRepository(), mockMapper(), defaultConfig());

        TestEntity entity = entity(77L, "x", false);
        TestDto dto = new TestDto("snap");
        when(withHistory.mapper.toDto(entity)).thenReturn(dto);

        assertEquals(dto, withHistory.callSnapshotForHistory(entity));
        assertNull(withoutHistory.callSnapshotForHistory(entity));
    }

    @Test
    void extractId_ReturnsStringValueOrNull() {
        TestBaseService service = new TestBaseService(mockRepository(), mockMapper(), defaultConfig());

        TestEntity withId = entity(12L, "id", false);
        TestEntity withoutId = entity(null, "id", false);

        assertEquals("12", service.callExtractId(withId));
        assertNull(service.callExtractId(withoutId));
    }

    @Test
    void extractId_ReturnsNullWhenNoIdFieldExists() {
        NoIdService service = new NoIdService(mockNoIdRepository(), mockNoIdMapper(), defaultConfig());

        assertNull(service.callExtractId(new NoIdEntity()));
    }

    @Test
    void populateKeywords_CoversEmptyAndConfiguredFieldPaths() {
        TestBaseService noFields = new TestBaseService(mockRepository(), mockMapper(), defaultConfig());
        TestEntity emptyEntity = entity(1L, "Alpha", false);
        noFields.callPopulateKeywords(emptyEntity);
        assertNull(emptyEntity.getKeywords());

        EntityConfig config = EntityConfig.builder().localSearchableFields(List.of("name")).build();
        TestBaseService withFields = new TestBaseService(mockRepository(), mockMapper(), config);
        TestEntity entity = entity(2L, "  Alpha  ", false);
        withFields.callPopulateKeywords(entity);

        assertEquals("  Alpha  ", entity.getKeywords());
    }

    @Test
    void constructor_RejectsInvalidSearchConfiguration() {
        EntityConfig unknownLocal = EntityConfig.builder().localSearchableFields(List.of("missingField")).build();
        EntityConfig invalidRelation = EntityConfig.builder().relationSearchableFields(List.of("nonBaseRelation"))
                .build();

        assertThrows(IllegalArgumentException.class,
                () -> new TestBaseService(mockRepository(), mockMapper(), unknownLocal));
        assertThrows(IllegalArgumentException.class,
                () -> new TestBaseService(mockRepository(), mockMapper(), invalidRelation));
    }

    @Test
    void findAll_AppliesQueryEngineFilterWhenBuilderPresent() {
        SearchableRepository<TestEntity, Long> repository = mockRepository();
        BaseMapper<TestEntity, TestDto> mapper = mockMapper();
        TestBaseService service = new TestBaseService(repository, mapper,
                EntityConfig.builder().localSearchableFields(List.of("name")).build());

        FilterSpecificationBuilder builder = mock(FilterSpecificationBuilder.class);
        service.filterSpecificationBuilder = builder;

        Specification<TestEntity> filterSpec = (root, query, criteriaBuilder) -> criteriaBuilder.conjunction();
        when(builder.build(eq(TestEntity.class), any(QueryFilterCriteria.class))).thenReturn(filterSpec);

        TestEntity entity = entity(5L, "n", false);
        TestDto dto = new TestDto("mapped");
        when(repository.findAll(any(Specification.class), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(entity)));
        when(mapper.toDto(entity)).thenReturn(dto);

        SearchablePageable pageable = new SearchablePageable(PageRequest.of(0, 10), "query");
        // The criteria type is a marker: core knows a filter was asked for, but
        // only the query engine knows how to read one.
        QueryFilterCriteria filter = new QueryFilterCriteria() {
        };
        List<Object> events = new ArrayList<>();
        service.setObservationEvents(events::add);

        Page<TestDto> result = service.findAll(pageable, filter);

        assertEquals(1, result.getTotalElements());
        verify(builder).build(TestEntity.class, filter);
        QueryExecutionObservationEvent event = (QueryExecutionObservationEvent) events.get(0);
        assertEquals(QueryExecutionObservationEvent.Outcome.SUCCESS, event.outcome());
        assertTrue(event.searched());
        assertTrue(event.filtered());
        assertEquals(1, event.resultCount());
        assertFalse(event.toString().contains("query"));
    }

    @Test
    void searchSpecification_CoversChunkAndRelationBranches() {
        EntityConfig config = EntityConfig.builder()
                .localSearchableFields(List.of("name"))
                .relationSearchableFields(List.of("related"))
                .build();
        SearchableRepository<TestEntity, Long> repository = mockRepository();
        BaseMapper<TestEntity, TestDto> mapper = mockMapper();
        TestBaseService service = new TestBaseService(repository, mapper, config);

        when(repository.findAll(any(Specification.class), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of()));

        service.findAll(new SearchablePageable(PageRequest.of(0, 10), "abc"), null);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Specification<TestEntity>> specificationCaptor = ArgumentCaptor.forClass(Specification.class);
        verify(repository).findAll(specificationCaptor.capture(), any(Pageable.class));

        Specification<TestEntity> specification = specificationCaptor.getValue();

        @SuppressWarnings("unchecked")
        Root<TestEntity> root = mock(Root.class);
        @SuppressWarnings("unchecked")
        CriteriaQuery<Object> query = mock(CriteriaQuery.class);
        CriteriaBuilder criteriaBuilder = mock(CriteriaBuilder.class);

        @SuppressWarnings("unchecked")
        Path<String> keywordsPath = mock(Path.class);
        @SuppressWarnings("unchecked")
        Expression<String> loweredKeywords = mock(Expression.class);
        @SuppressWarnings("unchecked")
        Join<TestEntity, RelatedEntity> join = mock(Join.class);
        @SuppressWarnings("unchecked")
        Path<String> relationKeywordsPath = mock(Path.class);
        @SuppressWarnings("unchecked")
        Expression<String> loweredRelationKeywords = mock(Expression.class);
        @SuppressWarnings("unchecked")
        Path<Object> relationIdPath = mock(Path.class);
        @SuppressWarnings("unchecked")
        Expression<String> relationIdCast = mock(Expression.class);

        Predicate like1 = mock(Predicate.class);
        Predicate like2 = mock(Predicate.class);
        Predicate like3 = mock(Predicate.class);
        Predicate orPredicate = mock(Predicate.class);
        Predicate andPredicate = mock(Predicate.class);

        when(root.getJavaType()).thenReturn((Class) TestEntity.class);
        when(root.get("keywords")).thenReturn((Path) keywordsPath);
        when(keywordsPath.as(String.class)).thenReturn((Expression) loweredKeywords);
        when(criteriaBuilder.lower((Expression<String>) loweredKeywords)).thenReturn(loweredKeywords);
        when(criteriaBuilder.like(any(Expression.class), eq("%abc%"))).thenReturn(like1, like2, like3);

        when(root.join(eq("related"), any())).thenReturn((Join) join);
        when(join.get("keywords")).thenReturn((Path) relationKeywordsPath);
        when(relationKeywordsPath.as(String.class)).thenReturn((Expression) loweredRelationKeywords);
        when(criteriaBuilder.lower((Expression<String>) loweredRelationKeywords)).thenReturn(loweredRelationKeywords);

        when(join.get("id")).thenReturn((Path) relationIdPath);
        when(relationIdPath.cast(String.class)).thenReturn((Expression) relationIdCast);
        when(criteriaBuilder.lower((Expression<String>) relationIdCast)).thenReturn(relationIdCast);

        when(criteriaBuilder.or(any(Predicate[].class))).thenReturn(orPredicate);
        when(criteriaBuilder.and(any(Predicate[].class))).thenReturn(andPredicate);

        Predicate result = specification.toPredicate(root, query, criteriaBuilder);

        assertNotNull(result);
        verify(criteriaBuilder).or(any(Predicate[].class));
        verify(criteriaBuilder).and(any(Predicate[].class));
        verify(query, never()).distinct(true);
    }

    private static SearchableRepository<TestEntity, Long> mockRepository() {
        @SuppressWarnings("unchecked")
        SearchableRepository<TestEntity, Long> repository = mock(SearchableRepository.class);
        return repository;
    }

    private static SearchableRepository<NoIdEntity, Long> mockNoIdRepository() {
        @SuppressWarnings("unchecked")
        SearchableRepository<NoIdEntity, Long> repository = mock(SearchableRepository.class);
        return repository;
    }

    private static BaseMapper<TestEntity, TestDto> mockMapper() {
        @SuppressWarnings("unchecked")
        BaseMapper<TestEntity, TestDto> mapper = mock(BaseMapper.class);
        return mapper;
    }

    private static BaseMapper<NoIdEntity, TestDto> mockNoIdMapper() {
        @SuppressWarnings("unchecked")
        BaseMapper<NoIdEntity, TestDto> mapper = mock(BaseMapper.class);
        return mapper;
    }

    private static TestEntity entity(Long id, String name, boolean deleted) {
        TestEntity entity = new TestEntity();
        entity.setId(id);
        entity.setName(name);
        entity.setDeleted(deleted);
        return entity;
    }

    private static EntityConfig defaultConfig() {
        return EntityConfig.builder().build();
    }

    private static EntityConfig softDeleteConfig() {
        return EntityConfig.builder().softDelete(true).build();
    }

    private static EntityConfig historyConfig() {
        return EntityConfig.builder().history(TestHistoryEntityType.ITEM).build();
    }

    static class TestBaseService extends BaseService<Long, TestEntity, TestDto> {
        TestBaseService(SearchableRepository<TestEntity, Long> repository, BaseMapper<TestEntity, TestDto> mapper,
                EntityConfig entityConfig) {
            super(repository, mapper, entityConfig);
        }

        void callPopulateKeywords(TestEntity entity) {
            populateKeywords(entity);
        }

        TestDto callSnapshotForHistory(TestEntity entity) {
            return snapshotForHistory(entity);
        }

        String callExtractId(TestEntity entity) {
            return extractId(entity);
        }

        void callPublish(String action, TestDto dto) {
            publishEntityChange(action, dto);
        }
    }

    static class NoIdService extends BaseService<Long, NoIdEntity, TestDto> {
        NoIdService(SearchableRepository<NoIdEntity, Long> repository, BaseMapper<NoIdEntity, TestDto> mapper,
                EntityConfig entityConfig) {
            super(repository, mapper, entityConfig);
        }

        String callExtractId(NoIdEntity entity) {
            return extractId(entity);
        }
    }

    static class CrudOverrideService extends TestBaseService {
        CrudOverrideService(SearchableRepository<TestEntity, Long> repository, BaseMapper<TestEntity, TestDto> mapper,
                EntityConfig entityConfig) {
            super(repository, mapper, entityConfig);
        }

        @Override
        public TestDto create(TestDto dto) {
            return dto;
        }
    }

    static class IntermediateCrudOverrideService extends TestBaseService {
        IntermediateCrudOverrideService(SearchableRepository<TestEntity, Long> repository,
                BaseMapper<TestEntity, TestDto> mapper, EntityConfig entityConfig) {
            super(repository, mapper, entityConfig);
        }

        @Override
        public TestDto create(TestDto dto) {
            return dto;
        }
    }

    static class InheritedCrudOverrideService extends IntermediateCrudOverrideService {
        InheritedCrudOverrideService(SearchableRepository<TestEntity, Long> repository,
                BaseMapper<TestEntity, TestDto> mapper, EntityConfig entityConfig) {
            super(repository, mapper, entityConfig);
        }
    }

    static class ScopedService extends TestBaseService {
        boolean notDeletedSpecificationCalled;

        ScopedService(SearchableRepository<TestEntity, Long> repository, BaseMapper<TestEntity, TestDto> mapper,
                EntityConfig entityConfig) {
            super(repository, mapper, entityConfig);
        }

        @Override
        protected Specification<TestEntity> notDeletedSpecification() {
            notDeletedSpecificationCalled = true;
            return super.notDeletedSpecification();
        }
    }

    static class CustomIdService extends TestBaseService {
        CustomIdService(SearchableRepository<TestEntity, Long> repository, BaseMapper<TestEntity, TestDto> mapper,
                EntityConfig entityConfig) {
            super(repository, mapper, entityConfig);
        }

        @Override
        protected String extractId(TestEntity domain) {
            return "external-" + domain.getId();
        }
    }

    static class TestEntity extends BaseEntity {
        @Id
        private Long id;
        private String name;
        private RelatedEntity related;
        private String nonBaseRelation;

        Long getId() {
            return id;
        }

        void setId(Long id) {
            this.id = id;
        }

        String getName() {
            return name;
        }

        void setName(String name) {
            this.name = name;
        }

        RelatedEntity getRelated() {
            return related;
        }

        void setRelated(RelatedEntity related) {
            this.related = related;
        }

        String getNonBaseRelation() {
            return nonBaseRelation;
        }

        void setNonBaseRelation(String nonBaseRelation) {
            this.nonBaseRelation = nonBaseRelation;
        }
    }

    static class RelatedEntity extends BaseEntity {
        @Id
        private Long id;

        Long getId() {
            return id;
        }

        void setId(Long id) {
            this.id = id;
        }
    }

    static class NoIdEntity extends BaseEntity {
        private String value;

        String getValue() {
            return value;
        }

        void setValue(String value) {
            this.value = value;
        }
    }

    static class TestDto {
        private final String name;

        TestDto(String name) {
            this.name = name;
        }
    }
}
