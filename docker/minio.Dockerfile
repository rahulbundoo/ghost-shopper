# Local-only MinIO builds from pinned upstream releases; published images are unavailable.
# Sources/license: https://github.com/minio/minio and https://github.com/minio/mc (AGPL-3.0).
FROM golang:1.25-alpine AS minio-build
ARG GODEBUG
ENV CGO_ENABLED=0 GOBIN=/out
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go install -trimpath github.com/minio/minio@RELEASE.2025-10-15T17-29-55Z

FROM golang:1.25-alpine AS mc-build
ARG GODEBUG
ENV CGO_ENABLED=0 GOBIN=/out
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go install -trimpath github.com/minio/mc@RELEASE.2025-08-13T08-35-41Z

FROM alpine:3.22 AS minio
RUN apk add --no-cache ca-certificates curl
COPY --from=minio-build /out/minio /usr/local/bin/minio
LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
      org.opencontainers.image.licenses="AGPL-3.0"
ENTRYPOINT ["minio"]

FROM alpine:3.22 AS mc
RUN apk add --no-cache ca-certificates
COPY --from=mc-build /out/mc /usr/local/bin/mc
LABEL org.opencontainers.image.source="https://github.com/minio/mc" \
      org.opencontainers.image.licenses="AGPL-3.0"
ENTRYPOINT ["mc"]
