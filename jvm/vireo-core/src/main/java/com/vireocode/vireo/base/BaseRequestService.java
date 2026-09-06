package com.vireocode.vireo.base;

import java.lang.reflect.Method;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.core.ResolvableType;
import org.springframework.data.domain.Page;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.transaction.annotation.Transactional;

import com.vireocode.vireo.spi.FilterSpecificationBuilder;
import com.vireocode.vireo.spi.HistoryEventsRecorder;
import com.vireocode.vireo.spi.OfflineChangeBroadcaster;
import com.vireocode.vireo.spi.OfflineRevisionTracker;
import com.vireocode.vireo.spi.QueryFilterCriteria;
import com.vireocode.vireo.web.RestUtils;
import com.vireocode.vireo.web.SearchablePageable;

/**
 * CRUD lifecycle with distinct create, PATCH, and response transport models.
 *
 * <p>Use a writable relation identifier in {@code CREATE} and {@code PATCH},
 * then resolve it in {@link #applyCreateRelations(BaseEntity, Object)} or
 * {@link #applyPatchRelations(BaseEntity, Object)}. Return relation display
 * values only from {@code RESPONSE}. Public lifecycle methods are final in
 * practice: overriding them is rejected during construction so history,
 * soft-delete, offline, and observation guarantees remain intact.
 */
public abstract class BaseRequestService<ID, DOMAIN extends BaseEntity, CREATE, PATCH, RESPONSE> {
    protected final SearchableRepository<DOMAIN, ID> repository;
    protected final BaseRequestMapper<DOMAIN, CREATE, PATCH, RESPONSE> mapper;
    protected final EntityConfig entityConfig;
    protected final List<String> localSearchableFields;
    protected final List<String> relationSearchableFields;
    protected final Class<DOMAIN> domainType;

    private HistoryEventsRecorder historyRecorder;
    private FilterSpecificationBuilder filterSpecificationBuilder;
    private OfflineChangeBroadcaster offlineChangeBroadcaster;
    private OfflineRevisionTracker offlineRevisionTracker;
    private ApplicationEventPublisher observationEvents = event -> { };
    private final CrudLifecycleSupport<ID, DOMAIN, RESPONSE> lifecycle;

    /** Primary constructor accepting the full {@link EntityConfig}. */
    public BaseRequestService(SearchableRepository<DOMAIN, ID> repository,
            BaseRequestMapper<DOMAIN, CREATE, PATCH, RESPONSE> mapper, EntityConfig entityConfig) {
        this.repository = Objects.requireNonNull(repository, "repository must not be null");
        this.mapper = Objects.requireNonNull(mapper, "mapper must not be null");
        this.entityConfig = Objects.requireNonNull(entityConfig, "entityConfig must not be null");
        this.localSearchableFields = entityConfig.getLocalSearchableFields();
        this.relationSearchableFields = entityConfig.getRelationSearchableFields();
        this.domainType = resolveDomainType();
        this.lifecycle = new CrudLifecycleSupport<>(repository, entityConfig, localSearchableFields,
                relationSearchableFields, domainType);
        assertNoCrudOverrides();
    }

    public BaseRequestService(SearchableRepository<DOMAIN, ID> repository,
            BaseRequestMapper<DOMAIN, CREATE, PATCH, RESPONSE> mapper,
            List<String> localSearchableFields, List<String> relationSearchableFields) {
        this(repository, mapper, EntityConfig.builder().localSearchableFields(localSearchableFields)
                .relationSearchableFields(relationSearchableFields).build());
    }

    public BaseRequestService(SearchableRepository<DOMAIN, ID> repository,
            BaseRequestMapper<DOMAIN, CREATE, PATCH, RESPONSE> mapper, List<String> localSearchableFields) {
        this(repository, mapper, localSearchableFields, Collections.emptyList());
    }

    public BaseRequestService(SearchableRepository<DOMAIN, ID> repository,
            BaseRequestMapper<DOMAIN, CREATE, PATCH, RESPONSE> mapper) {
        this(repository, mapper, Collections.emptyList(), Collections.emptyList());
    }

    public Page<RESPONSE> findAll(SearchablePageable pageable) {
        return findAll(pageable, null);
    }

    public Page<RESPONSE> findAll(SearchablePageable pageable, QueryFilterCriteria filterRequest) {
        synchronizeCollaborators();
        return lifecycle.findAll(pageable, filterRequest, notDeletedSpecification(), mapper::toResponse);
    }

    public RESPONSE getById(ID id) {
        synchronizeCollaborators();
        return lifecycle.getById(id, this::isHidden, mapper::toResponse);
    }

    @Transactional
    public RESPONSE create(CREATE request) {
        synchronizeCollaborators();
        return lifecycle.create(request, this::validateCreateRequest, this::buildCreateDomain, mapper::toResponse,
                this::extractId);
    }

    @Transactional
    public RESPONSE patch(ID id, PATCH request) {
        synchronizeCollaborators();
        return lifecycle.patch(id, request, this::validatePatchRequest, this::findPatchDomain,
                this::snapshotForHistory, this::applyPatchChanges, mapper::toResponse, this::extractId);
    }

    @Transactional
    public void delete(ID id) {
        synchronizeCollaborators();
        lifecycle.delete(id, this::validateDeleteRequest, this::findDeleteDomain,
                this::snapshotForHistory, this::performDelete, this::extractId);
    }

    protected void validateCreateRequest(CREATE request) { }

    protected void validatePatchRequest(ID id, PATCH request) { }

    protected void validateDeleteRequest(ID id) { }

    protected DOMAIN buildCreateDomain(CREATE request) {
        DOMAIN domain = mapper.toDomain(request);
        applyCreateRelations(domain, request);
        populateKeywords(domain);
        return domain;
    }

    protected DOMAIN findPatchDomain(ID id) {
        return repository.findById(id).filter(entity -> !isHidden(entity))
                .orElseThrow(() -> RestUtils.notFound("id", String.valueOf(id)));
    }

    protected void applyPatchChanges(DOMAIN domain, PATCH request) {
        mapper.patch(request, domain);
        applyPatchRelations(domain, request);
        populateKeywords(domain);
    }

    protected DOMAIN findDeleteDomain(ID id) {
        return repository.findById(id).filter(entity -> !isHidden(entity))
                .orElseThrow(() -> RestUtils.notFound("id", String.valueOf(id)));
    }

    protected void applyCreateRelations(DOMAIN domain, CREATE request) { }

    protected void applyPatchRelations(DOMAIN domain, PATCH request) { }

    protected void performDelete(DOMAIN domain) {
        if (entityConfig.isSoftDelete()) {
            domain.setDeleted(true);
            repository.saveAndFlush(domain);
            return;
        }
        repository.delete(domain);
    }

    /**
     * Completes a create after a specialized protected hook has persisted an
     * aggregate. Prefer {@link #create(Object)} for ordinary endpoints.
     */
    protected final RESPONSE finalizeCreatedEntity(DOMAIN saved) {
        synchronizeCollaborators();
        return lifecycle.finalizeCreated(saved, mapper::toResponse, this::extractId);
    }

    /**
     * Completes a PATCH after a specialized protected hook has persisted an
     * aggregate. Prefer {@link #patch(Object, Object)} for ordinary endpoints.
     */
    protected final RESPONSE finalizePatchedEntity(DOMAIN saved, RESPONSE previousResponse) {
        synchronizeCollaborators();
        return lifecycle.finalizeUpdated(saved, previousResponse, mapper::toResponse, this::extractId);
    }

    /** Completes a delete after a specialized protected hook has changed an aggregate. */
    protected final void finalizeDeletedEntity(DOMAIN domain, RESPONSE previousResponse) {
        synchronizeCollaborators();
        lifecycle.finalizeDeleted(domain, previousResponse, this::extractId);
    }

    protected boolean isHidden(DOMAIN domain) {
        return lifecycle.isHidden(domain);
    }

    protected Specification<DOMAIN> notDeletedSpecification() {
        return lifecycle.notDeletedSpecification();
    }

    protected RESPONSE snapshotForHistory(DOMAIN domain) {
        return entityConfig.recordsHistory() ? mapper.toResponse(domain) : null;
    }

    protected void populateKeywords(DOMAIN domain) {
        lifecycle.populateKeywords(domain);
    }

    protected String extractId(DOMAIN domain) {
        return lifecycle.extractId(domain);
    }

    @Autowired(required = false)
    void setHistoryRecorder(HistoryEventsRecorder historyRecorder) { this.historyRecorder = historyRecorder; }

    @Autowired(required = false)
    void setFilterSpecificationBuilder(FilterSpecificationBuilder filterSpecificationBuilder) {
        this.filterSpecificationBuilder = filterSpecificationBuilder;
    }

    @Autowired(required = false)
    void setOfflineChangeBroadcaster(OfflineChangeBroadcaster offlineChangeBroadcaster) {
        this.offlineChangeBroadcaster = offlineChangeBroadcaster;
    }

    @Autowired(required = false)
    void setOfflineRevisionTracker(OfflineRevisionTracker offlineRevisionTracker) {
        this.offlineRevisionTracker = offlineRevisionTracker;
    }

    @Autowired(required = false)
    void setObservationEvents(ApplicationEventPublisher observationEvents) {
        this.observationEvents = Objects.requireNonNull(observationEvents, "observationEvents");
    }

    private void synchronizeCollaborators() {
        lifecycle.setHistoryRecorder(historyRecorder);
        lifecycle.setFilterSpecificationBuilder(filterSpecificationBuilder);
        lifecycle.setOfflineChangeBroadcaster(offlineChangeBroadcaster);
        lifecycle.setOfflineRevisionTracker(offlineRevisionTracker);
        lifecycle.setObservationEvents(observationEvents);
    }

    @SuppressWarnings("unchecked")
    private Class<DOMAIN> resolveDomainType() {
        Class<DOMAIN> resolved = (Class<DOMAIN>) ResolvableType.forClass(getClass())
                .as(BaseRequestService.class).getGeneric(1).resolve();
        if (resolved == null) {
            throw new IllegalStateException(
                    "Failed to resolve BaseRequestService domain type for " + getClass().getName());
        }
        return resolved;
    }

    private void assertNoCrudOverrides() {
        for (Class<?> type = getClass(); type != null && type != BaseRequestService.class;
                type = type.getSuperclass()) {
            for (Method method : type.getDeclaredMethods()) {
                if (!method.isBridge() && !method.isSynthetic() && isForbiddenCrudOverride(method)) {
                    throw new IllegalStateException("Do not override BaseRequestService CRUD entry points in "
                            + getClass().getName() + ". Use template hooks instead.");
                }
            }
        }
    }

    private boolean isForbiddenCrudOverride(Method method) {
        return ("create".equals(method.getName()) && method.getParameterCount() == 1)
                || ("patch".equals(method.getName()) && method.getParameterCount() == 2)
                || ("delete".equals(method.getName()) && method.getParameterCount() == 1);
    }
}
