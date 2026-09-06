package com.vireocode.vireo.web;

import java.util.Optional;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.server.ResponseStatusException;

public final class RestUtils {
    private static final int MAX_PAGE_NUMBER = 10_000;
    private static final int MAX_ROWS_PER_PAGE = 200;
    private static final int MAX_SEARCH_TEXT_LENGTH = 256;

    private RestUtils() {
    }

    public static ResponseStatusException notFound(String param, String value) {
        return new ApplicationException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Entity with " + param + "=" + value + " not found");
    }

    public static ResponseStatusException badRequest(String message) {
        return new ApplicationException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", message);
    }

    public static ResponseStatusException forbidden(String message) {
        return new ApplicationException(HttpStatus.FORBIDDEN, "FORBIDDEN", message);
    }

    public static ResponseStatusException conflict(String message) {
        return new ApplicationException(HttpStatus.CONFLICT, "CONFLICT", message);
    }

    public static ResponseStatusException unauthorized(String message) {
        return new ApplicationException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", message);
    }

    public static ResponseStatusException internalServerError(String message) {
        return new ApplicationException(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", message);
    }

    public static ResponseStatusException notImplemented(String message) {
        return new ApplicationException(HttpStatus.NOT_IMPLEMENTED, "REQUEST_FAILED", message);
    }

    public static SearchablePageable makePageable(int page, int rowsPerPage, String sortBy, String sortDirection,
            String searchText) {
        if (page < 0 || page > MAX_PAGE_NUMBER) {
            throw badRequest("page must be between zero and " + MAX_PAGE_NUMBER);
        }
        if (rowsPerPage < 1 || rowsPerPage > MAX_ROWS_PER_PAGE) {
            throw badRequest("rowsPerPage must be between 1 and " + MAX_ROWS_PER_PAGE);
        }
        if (sortBy == null || sortBy.isBlank()) {
            throw badRequest("sortBy must not be blank");
        }
        if (searchText != null && searchText.length() > MAX_SEARCH_TEXT_LENGTH) {
            throw badRequest("searchText must not exceed " + MAX_SEARCH_TEXT_LENGTH + " characters");
        }

        Sort.Direction direction;
        try {
            direction = Sort.Direction.fromString(sortDirection);
        } catch (IllegalArgumentException | NullPointerException exception) {
            throw badRequest("sortDirection must be asc or desc");
        }

        Sort sort = Sort.by(direction, sortBy);
        Pageable pageable = PageRequest.of(page, rowsPerPage, sort);
        return new SearchablePageable(pageable, searchText);
    }

    public static <T> Optional<T> getCurrentPrincipal(Class<T> principalType) {
        if (principalType == null) {
            throw new IllegalArgumentException("principalType must not be null");
        }
        var authentication = SecurityContextHolder.getContext().getAuthentication();

        if (authentication == null
                || !authentication.isAuthenticated()
                || authentication instanceof AnonymousAuthenticationToken) {
            return Optional.empty();
        }

        Object principal = authentication.getPrincipal();
        if (!principalType.isInstance(principal)) {
            return Optional.empty();
        }

        return Optional.of(principalType.cast(principal));
    }

}
