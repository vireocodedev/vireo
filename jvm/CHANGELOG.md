# Vireo JVM changelog

## 0.4.0

- **vireo-core:** Add compatible request-aware CRUD services and stable coded API errors for generated Vireo backends.
- **vireo-auth:** Add a reusable browser-session security chain for applications with narrower external API chains.

## 0.3.1

- **vireo-bom:** Raise managed dependency floors to versions containing the current Jackson, Tomcat, and Swagger UI security fixes.
- **vireo-core:** Publish safe Jackson, Tomcat, and Swagger UI dependency constraints for framework consumers.

## 0.3.0

- **vireo-bom:** Align the coordinated JVM family after adding optional observability integration.
- **vireo-query:** Add safe query and relation-option observability events with an optional Micrometer bridge.
- **vireo-auth:** Serialize authentication errors with Boot's Jackson 3 mapper.
- **vireo-core:** Use Boot-owned Jackson 3 composition and Jackson 3 tree contracts.
- **vireo-history:** Expose history snapshots as Jackson 3 tree contracts.
- **vireo-offline:** Use Jackson 3 for offline command bodies and replay customization.

## 0.2.0

- Initial coordinated public-alpha release of the Vireo JVM family.