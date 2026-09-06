package com.vireocode.vireo.base;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.jpa.domain.Specification;

import com.vireocode.vireo.observability.QueryExecutionObservationEvent;
import com.vireocode.vireo.spi.FilterSpecificationBuilder;
import com.vireocode.vireo.spi.HistoryEventsRecorder;
import com.vireocode.vireo.spi.OfflineChangeBroadcaster;
import com.vireocode.vireo.spi.OfflineRevisionTracker;
import com.vireocode.vireo.spi.QueryFilterCriteria;
import com.vireocode.vireo.web.RestUtils;
import com.vireocode.vireo.web.SearchablePageable;

import jakarta.persistence.Id;
import jakarta.persistence.criteria.JoinType;
import jakarta.persistence.criteria.Predicate;
import lombok.extern.slf4j.Slf4j;

/** Package-private implementation behind the two public CRUD service shapes. */
@Slf4j
final class CrudLifecycleSupport<ID, DOMAIN extends BaseEntity, RESPONSE> {
    private final SearchableRepository<DOMAIN, ID> repository;
    private final EntityConfig entityConfig;
    private final List<String> localSearchableFields;
    private final List<String> relationSearchableFields;
    private final Class<DOMAIN> domainType;

    private HistoryEventsRecorder historyRecorder;
    private FilterSpecificationBuilder filterSpecificationBuilder;
    private OfflineChangeBroadcaster offlineChangeBroadcaster;
    private OfflineRevisionTracker offlineRevisionTracker;
    private ApplicationEventPublisher observationEvents = event -> { };

    CrudLifecycleSupport(SearchableRepository<DOMAIN, ID> repository, EntityConfig entityConfig,
            List<String> localSearchableFields, List<String> relationSearchableFields, Class<DOMAIN> domainType) {
        this.repository = Objects.requireNonNull(repository, "repository must not be null");
        this.entityConfig = Objects.requireNonNull(entityConfig, "entityConfig must not be null");
        this.localSearchableFields = List.copyOf(localSearchableFields);
        this.relationSearchableFields = List.copyOf(relationSearchableFields);
        this.domainType = Objects.requireNonNull(domainType, "domainType must not be null");
        validateConfiguredFields();
    }

    Page<RESPONSE> findAll(SearchablePageable pageable, QueryFilterCriteria filterRequest,
            Specification<DOMAIN> initialSpecification, Function<DOMAIN, RESPONSE> mapper) {
        long startedAt = System.nanoTime();
        boolean searched = pageable.hasSearchText();
        boolean filtered = filterRequest != null;
        QueryExecutionObservationEvent.Outcome outcome = QueryExecutionObservationEvent.Outcome.SUCCESS;
        long resultCount = 0;
        try {
            Specification<DOMAIN> specification = Objects.requireNonNull(initialSpecification,
                    "initialSpecification must not be null");
            if (pageable.hasSearchText() && hasSearchableFields()) {
                specification = specification.and(makeSearchSpecification(pageable.getSearchText()));
            }
            if (filterRequest != null) {
                if (filterSpecificationBuilder == null) {
                    throw new IllegalStateException(
                            "A QueryFilterCriteria was supplied, but no FilterSpecificationBuilder bean is available");
                }
                specification = specification.and(filterSpecificationBuilder.build(domainType, filterRequest));
            }
            Page<RESPONSE> result = repository.findAll(specification, pageable.getPageable()).map(mapper);
            resultCount = result.getNumberOfElements();
            return result;
        } catch (org.springframework.security.access.AccessDeniedException exception) {
            outcome = QueryExecutionObservationEvent.Outcome.DENIED;
            throw exception;
        } catch (IllegalArgumentException | org.springframework.web.server.ResponseStatusException exception) {
            outcome = QueryExecutionObservationEvent.Outcome.REJECTED;
            throw exception;
        } catch (RuntimeException exception) {
            outcome = QueryExecutionObservationEvent.Outcome.ERROR;
            throw exception;
        } finally {
            publishObservationEvent(new QueryExecutionObservationEvent(
                    outcome, searched, filtered, resultCount, System.nanoTime() - startedAt));
        }
    }

    RESPONSE getById(ID id, java.util.function.Predicate<DOMAIN> hidden, Function<DOMAIN, RESPONSE> mapper) {
        DOMAIN domain = repository.findById(id)
                .filter(entity -> !hidden.test(entity))
                .orElseThrow(() -> RestUtils.notFound("id", String.valueOf(id)));
        return mapper.apply(domain);
    }

    <CREATE> RESPONSE create(CREATE request, Consumer<CREATE> validate,
            Function<CREATE, DOMAIN> buildDomain, Function<DOMAIN, RESPONSE> mapper,
            Function<DOMAIN, String> extractId) {
        requireHistoryRecorder();
        validate.accept(request);
        DOMAIN saved = repository.saveAndFlush(buildDomain.apply(request));
        return finalizeCreated(saved, mapper, extractId);
    }

    <PATCH> RESPONSE patch(ID id, PATCH request, BiConsumer<ID, PATCH> validate,
            Function<ID, DOMAIN> findDomain, Function<DOMAIN, RESPONSE> snapshot,
            BiConsumer<DOMAIN, PATCH> applyChanges, Function<DOMAIN, RESPONSE> mapper,
            Function<DOMAIN, String> extractId) {
        requireHistoryRecorder();
        validate.accept(id, request);
        DOMAIN domain = findDomain.apply(id);
        RESPONSE previous = snapshot.apply(domain);
        applyChanges.accept(domain, request);
        DOMAIN saved = repository.saveAndFlush(domain);
        return finalizeUpdated(saved, previous, mapper, extractId);
    }

    void delete(ID id, Consumer<ID> validate, Function<ID, DOMAIN> findDomain,
            Function<DOMAIN, RESPONSE> snapshot, Consumer<DOMAIN> performDelete,
            Function<DOMAIN, String> extractId) {
        requireHistoryRecorder();
        validate.accept(id);
        DOMAIN domain = findDomain.apply(id);
        RESPONSE previous = snapshot.apply(domain);
        performDelete.accept(domain);
        finalizeDeleted(domain, previous, extractId);
    }

    RESPONSE finalizeCreated(DOMAIN saved, Function<DOMAIN, RESPONSE> mapper, Function<DOMAIN, String> extractId) {
        RESPONSE response = mapper.apply(saved);
        recordCreate(saved, response, extractId);
        publishEntityChange("create", response);
        return response;
    }

    RESPONSE finalizeUpdated(DOMAIN saved, RESPONSE previous, Function<DOMAIN, RESPONSE> mapper,
            Function<DOMAIN, String> extractId) {
        RESPONSE response = mapper.apply(saved);
        recordUpdate(saved, previous, response, extractId);
        publishEntityChange("update", response);
        return response;
    }

    void finalizeDeleted(DOMAIN domain, RESPONSE previous, Function<DOMAIN, String> extractId) {
        recordDelete(domain, previous, extractId);
        publishEntityChange("delete", previous);
    }

    boolean isHidden(DOMAIN domain) {
        return entityConfig.isSoftDelete() && domain.isDeleted();
    }

    Specification<DOMAIN> notDeletedSpecification() {
        if (!entityConfig.isSoftDelete()) {
            return (root, query, criteriaBuilder) -> criteriaBuilder.conjunction();
        }
        return (root, query, criteriaBuilder) -> criteriaBuilder.isFalse(root.get("deleted"));
    }

    void populateKeywords(DOMAIN domain) {
        if (localSearchableFields.isEmpty()) {
            return;
        }
        String keywords = localSearchableFields.stream()
                .map(fieldName -> extractFieldValue(domain, fieldName))
                .filter(Objects::nonNull)
                .map(Object::toString)
                .filter(value -> !value.isBlank())
                .collect(Collectors.joining(" "));
        domain.setKeywords(keywords);
    }

    String extractId(DOMAIN domain) {
        String idFieldName = findIdFieldName(domain.getClass());
        if (idFieldName == null) {
            return null;
        }
        Object value = extractFieldValue(domain, idFieldName);
        return value == null ? null : String.valueOf(value);
    }

    void setHistoryRecorder(HistoryEventsRecorder historyRecorder) { this.historyRecorder = historyRecorder; }
    void setFilterSpecificationBuilder(FilterSpecificationBuilder filterSpecificationBuilder) {
        this.filterSpecificationBuilder = filterSpecificationBuilder;
    }
    void setOfflineChangeBroadcaster(OfflineChangeBroadcaster offlineChangeBroadcaster) {
        this.offlineChangeBroadcaster = offlineChangeBroadcaster;
    }
    void setOfflineRevisionTracker(OfflineRevisionTracker offlineRevisionTracker) {
        this.offlineRevisionTracker = offlineRevisionTracker;
    }
    void setObservationEvents(ApplicationEventPublisher observationEvents) {
        this.observationEvents = Objects.requireNonNull(observationEvents, "observationEvents");
    }

    private void requireHistoryRecorder() {
        if (entityConfig.recordsHistory() && historyRecorder == null) {
            throw new IllegalStateException("Entity history is enabled for " + domainType.getName()
                    + ", but no HistoryEventsRecorder bean is available");
        }
    }

    private void recordCreate(DOMAIN saved, RESPONSE response, Function<DOMAIN, String> extractId) {
        if (entityConfig.recordsHistory()) {
            historyRecorder.recordCreate(entityConfig.getHistory(), extractId.apply(saved), response);
        }
    }

    private void recordUpdate(DOMAIN saved, RESPONSE previous, RESPONSE response, Function<DOMAIN, String> extractId) {
        if (entityConfig.recordsHistory()) {
            historyRecorder.recordUpdate(entityConfig.getHistory(), extractId.apply(saved), previous, response);
        }
    }

    private void recordDelete(DOMAIN domain, RESPONSE previous, Function<DOMAIN, String> extractId) {
        if (entityConfig.recordsHistory()) {
            historyRecorder.recordDelete(entityConfig.getHistory(), extractId.apply(domain), previous);
        }
    }

    void publishEntityChange(String action, RESPONSE response) {
        if (action == null || response == null || offlineChangeBroadcaster == null) {
            return;
        }
        String entityName = domainType.getSimpleName();
        Long revision = null;
        if (offlineRevisionTracker != null) {
            long bumpedRevision = offlineRevisionTracker.bump(toOfflineEntityKey(entityName));
            if (bumpedRevision > 0) {
                revision = bumpedRevision;
            }
        }
        switch (action) {
            case "create" -> offlineChangeBroadcaster.publishCreateEvent(entityName, response, revision);
            case "update" -> offlineChangeBroadcaster.publishUpdateEvent(entityName, response, revision);
            case "delete" -> offlineChangeBroadcaster.publishDeleteEvent(entityName, response, revision);
            default -> { }
        }
    }

    private Specification<DOMAIN> makeSearchSpecification(String searchText) {
        return (root, query, criteriaBuilder) -> {
            String[] chunks = searchText.trim().toLowerCase(Locale.ROOT).split("\\s+");
            List<Predicate> chunkPredicates = Arrays.stream(chunks)
                    .filter(chunk -> !chunk.isBlank())
                    .map(chunk -> makeChunkPredicate(root, criteriaBuilder, chunk))
                    .filter(Objects::nonNull)
                    .toList();
            if (chunkPredicates.isEmpty()) {
                return criteriaBuilder.conjunction();
            }
            return criteriaBuilder.and(chunkPredicates.toArray(Predicate[]::new));
        };
    }

    private Predicate makeChunkPredicate(jakarta.persistence.criteria.Root<DOMAIN> root,
            jakarta.persistence.criteria.CriteriaBuilder criteriaBuilder, String chunk) {
        String normalizedSearchText = "%" + chunk + "%";
        List<Predicate> predicates = new ArrayList<>();
        if (!localSearchableFields.isEmpty()) {
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("keywords").as(String.class)),
                    normalizedSearchText));
        }
        for (String relationFieldName : relationSearchableFields) {
            Field relationField = findField(root.getJavaType(), relationFieldName);
            var join = root.join(relationFieldName, JoinType.LEFT);
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(join.get("keywords").as(String.class)),
                    normalizedSearchText));
            String idFieldName = findIdFieldName(relationField.getType());
            if (idFieldName != null) {
                predicates.add(criteriaBuilder.like(criteriaBuilder.lower(join.get(idFieldName).cast(String.class)),
                        normalizedSearchText));
            }
        }
        return predicates.isEmpty() ? null : criteriaBuilder.or(predicates.toArray(Predicate[]::new));
    }

    private boolean hasSearchableFields() {
        return !localSearchableFields.isEmpty() || !relationSearchableFields.isEmpty();
    }

    private Object extractFieldValue(DOMAIN domain, String fieldName) {
        try {
            Field field = findField(domain.getClass(), fieldName);
            if (field == null) {
                return null;
            }
            field.setAccessible(true);
            return field.get(domain);
        } catch (IllegalAccessException exception) {
            log.debug("Could not extract field {} from {}", fieldName, domain.getClass().getSimpleName());
            return null;
        }
    }

    private Field findField(Class<?> type, String fieldName) {
        Class<?> currentType = type;
        while (currentType != null && currentType != Object.class) {
            try {
                return currentType.getDeclaredField(fieldName);
            } catch (NoSuchFieldException exception) {
                currentType = currentType.getSuperclass();
            }
        }
        return null;
    }

    private String findIdFieldName(Class<?> type) {
        Class<?> currentType = type;
        while (currentType != null && currentType != Object.class) {
            for (Field field : currentType.getDeclaredFields()) {
                if (field.isAnnotationPresent(Id.class)) {
                    return field.getName();
                }
            }
            currentType = currentType.getSuperclass();
        }
        return null;
    }

    private String toOfflineEntityKey(String entityName) {
        return entityName == null || entityName.isBlank() ? ""
                : Character.toLowerCase(entityName.charAt(0)) + entityName.substring(1);
    }

    private void publishObservationEvent(Object event) {
        try {
            observationEvents.publishEvent(event);
        } catch (RuntimeException exception) {
            log.debug("Vireo observation listener failed; the application operation remains authoritative.", exception);
        }
    }

    private void validateConfiguredFields() {
        for (String fieldName : localSearchableFields) {
            if (findField(domainType, fieldName) == null) {
                throw new IllegalArgumentException("Unknown local searchable field '" + fieldName + "' on "
                        + domainType.getName());
            }
        }
        for (String fieldName : relationSearchableFields) {
            Field relationField = findField(domainType, fieldName);
            if (relationField == null) {
                throw new IllegalArgumentException("Unknown relation searchable field '" + fieldName + "' on "
                        + domainType.getName());
            }
            if (!BaseEntity.class.isAssignableFrom(relationField.getType())) {
                throw new IllegalArgumentException("Relation searchable field '" + fieldName + "' on "
                        + domainType.getName() + " must extend BaseEntity");
            }
        }
        if (entityConfig.recordsHistory() && findIdFieldName(domainType) == null) {
            throw new IllegalArgumentException("History-enabled entity " + domainType.getName()
                    + " must declare an @Id field");
        }
    }
}
