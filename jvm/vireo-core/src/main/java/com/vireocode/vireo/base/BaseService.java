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
 * CRUD lifecycle for one DTO shape used for both writes and responses.
 *
 * <p>New endpoints that need distinct create, patch, and response contracts
 * should use {@link BaseRequestService}. This legacy shape remains supported
 * unchanged for existing applications.
 */
public abstract class BaseService<ID, DOMAIN extends BaseEntity, DTO> {
    protected final SearchableRepository<DOMAIN, ID> repository;
    protected final BaseMapper<DOMAIN, DTO> mapper;
    protected final EntityConfig entityConfig;
    protected final List<String> localSearchableFields;
    protected final List<String> relationSearchableFields;
    protected final Class<DOMAIN> domainType;

    HistoryEventsRecorder historyRecorder;
    FilterSpecificationBuilder filterSpecificationBuilder;
    OfflineChangeBroadcaster offlineChangeBroadcaster;
    OfflineRevisionTracker offlineRevisionTracker;
    private ApplicationEventPublisher observationEvents = event -> { };
    private final CrudLifecycleSupport<ID, DOMAIN, DTO> lifecycle;

    /** Primary constructor accepting the full {@link EntityConfig}. */
    public BaseService(SearchableRepository<DOMAIN, ID> repository, BaseMapper<DOMAIN, DTO> mapper,
            EntityConfig entityConfig) {
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

    /** Constructor with separately configured local and relation search fields. */
    public BaseService(SearchableRepository<DOMAIN, ID> repository, BaseMapper<DOMAIN, DTO> mapper,
            List<String> localSearchableFields, List<String> relationSearchableFields) {
        this(repository, mapper, EntityConfig.builder().localSearchableFields(localSearchableFields)
                .relationSearchableFields(relationSearchableFields).build());
    }

    /** Constructor for entities that only search their own keyword fields. */
    public BaseService(SearchableRepository<DOMAIN, ID> repository, BaseMapper<DOMAIN, DTO> mapper,
            List<String> localSearchableFields) {
        this(repository, mapper, localSearchableFields, Collections.emptyList());
    }

    /** Constructor without searchable fields (empty list). */
    public BaseService(SearchableRepository<DOMAIN, ID> repository, BaseMapper<DOMAIN, DTO> mapper) {
        this(repository, mapper, Collections.emptyList(), Collections.emptyList());
    }

    public Page<DTO> findAll(SearchablePageable pageable) {
        return findAll(pageable, null);
    }

    public Page<DTO> findAll(SearchablePageable pageable, QueryFilterCriteria filterRequest) {
        synchronizeCollaborators();
        return lifecycle.findAll(pageable, filterRequest, notDeletedSpecification(), mapper::toDto);
    }

    public DTO getById(ID id) {
        synchronizeCollaborators();
        return lifecycle.getById(id, this::isHidden, mapper::toDto);
    }

    @Transactional
    public DTO create(DTO dto) {
        synchronizeCollaborators();
        return lifecycle.create(dto, this::validateCreateRequest, this::buildCreateDomain, mapper::toDto, this::extractId);
    }

    @Transactional
    public DTO update(ID id, DTO dto) {
        synchronizeCollaborators();
        return lifecycle.patch(id, dto, this::validateUpdateRequest, this::findUpdateDomain,
                this::snapshotForHistory, this::applyUpdateChanges, mapper::toDto, this::extractId);
    }

    @Transactional
    public void delete(ID id) {
        synchronizeCollaborators();
        lifecycle.delete(id, this::validateDeleteRequest, this::findDeleteDomain,
                this::snapshotForHistory, this::performDelete, this::extractId);
    }

    protected void validateCreateRequest(DTO dto) { }

    protected void validateUpdateRequest(ID id, DTO dto) { }

    protected void validateDeleteRequest(ID id) { }

    protected DOMAIN buildCreateDomain(DTO dto) {
        DOMAIN domain = mapper.toDomain(dto);
        applyRelations(domain, dto);
        populateKeywords(domain);
        return domain;
    }

    protected DOMAIN findUpdateDomain(ID id) {
        return repository.findById(id).filter(entity -> !isHidden(entity))
                .orElseThrow(() -> RestUtils.notFound("id", String.valueOf(id)));
    }

    protected void applyUpdateChanges(DOMAIN domain, DTO dto) {
        mapper.update(dto, domain);
        applyRelations(domain, dto);
        populateKeywords(domain);
    }

    protected DOMAIN findDeleteDomain(ID id) {
        return repository.findById(id).filter(entity -> !isHidden(entity))
                .orElseThrow(() -> RestUtils.notFound("id", String.valueOf(id)));
    }

    protected void performDelete(DOMAIN domain) {
        if (entityConfig.isSoftDelete()) {
            domain.setDeleted(true);
            repository.saveAndFlush(domain);
            return;
        }
        repository.delete(domain);
    }

    protected final DTO finalizeCreatedEntity(DOMAIN saved) {
        synchronizeCollaborators();
        return lifecycle.finalizeCreated(saved, mapper::toDto, this::extractId);
    }

    protected final DTO finalizeUpdatedEntity(DOMAIN saved, DTO previousDto) {
        synchronizeCollaborators();
        return lifecycle.finalizeUpdated(saved, previousDto, mapper::toDto, this::extractId);
    }

    protected final void finalizeDeletedEntity(DOMAIN domain, DTO previousDto) {
        synchronizeCollaborators();
        lifecycle.finalizeDeleted(domain, previousDto, this::extractId);
    }

    protected boolean isHidden(DOMAIN domain) {
        return lifecycle.isHidden(domain);
    }

    protected Specification<DOMAIN> notDeletedSpecification() {
        return lifecycle.notDeletedSpecification();
    }

    protected DTO snapshotForHistory(DOMAIN domain) {
        return entityConfig.recordsHistory() ? mapper.toDto(domain) : null;
    }

    /** Hook for entity-specific relation wiring and save-time adjustments. */
    protected void applyRelations(DOMAIN domain, DTO dto) { }

    /** Populate the keywords field from configured searchable fields. */
    protected void populateKeywords(DOMAIN domain) {
        lifecycle.populateKeywords(domain);
    }

    protected String extractId(DOMAIN domain) {
        return lifecycle.extractId(domain);
    }

    final void publishEntityChange(String action, DTO dto) {
        synchronizeCollaborators();
        lifecycle.publishEntityChange(action, dto);
    }

    @Autowired(required = false)
    void setHistoryRecorder(HistoryEventsRecorder historyRecorder) {
        this.historyRecorder = historyRecorder;
        lifecycle.setHistoryRecorder(historyRecorder);
    }

    @Autowired(required = false)
    void setFilterSpecificationBuilder(FilterSpecificationBuilder filterSpecificationBuilder) {
        this.filterSpecificationBuilder = filterSpecificationBuilder;
        lifecycle.setFilterSpecificationBuilder(filterSpecificationBuilder);
    }

    @Autowired(required = false)
    void setOfflineChangeBroadcaster(OfflineChangeBroadcaster offlineChangeBroadcaster) {
        this.offlineChangeBroadcaster = offlineChangeBroadcaster;
        lifecycle.setOfflineChangeBroadcaster(offlineChangeBroadcaster);
    }

    @Autowired(required = false)
    void setOfflineRevisionTracker(OfflineRevisionTracker offlineRevisionTracker) {
        this.offlineRevisionTracker = offlineRevisionTracker;
        lifecycle.setOfflineRevisionTracker(offlineRevisionTracker);
    }

    @Autowired(required = false)
    void setObservationEvents(ApplicationEventPublisher observationEvents) {
        this.observationEvents = Objects.requireNonNull(observationEvents, "observationEvents");
        lifecycle.setObservationEvents(observationEvents);
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
                .as(BaseService.class).getGeneric(1).resolve();
        if (resolved == null) {
            throw new IllegalStateException("Failed to resolve BaseService domain type for " + getClass().getName());
        }
        return resolved;
    }

    private void assertNoCrudOverrides() {
        for (Class<?> type = getClass(); type != null && type != BaseService.class; type = type.getSuperclass()) {
            for (Method method : type.getDeclaredMethods()) {
                if (!method.isBridge() && !method.isSynthetic() && isForbiddenCrudOverride(method)) {
                    throw new IllegalStateException("Do not override BaseService CRUD entry points in "
                            + getClass().getName()
                            + ". Use template hooks (validate*/build*/find*/apply*/performDelete) instead.");
                }
            }
        }
    }

    private boolean isForbiddenCrudOverride(Method method) {
        return ("create".equals(method.getName()) && method.getParameterCount() == 1)
                || ("update".equals(method.getName()) && method.getParameterCount() == 2)
                || ("delete".equals(method.getName()) && method.getParameterCount() == 1);
    }
}
