# Multi-stage build (use when Alpine repos are reachable)
# FROM node:20-alpine AS web
# WORKDIR /app/web
# COPY web/package.json web/package-lock.json ./
# RUN npm ci --silent
# COPY web/ .
# RUN npm run build
#
# FROM golang:1.26-alpine AS backend
# RUN apk add --no-cache git
# WORKDIR /app
# COPY go.mod go.sum ./
# RUN go mod download
# COPY . .
# COPY --from=web /app/web/dist ./cmd/kubeui/web/dist
# RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /kubeui ./cmd/kubeui

# Pre-built binary image (bin/kubeui and bin/helm must exist)
FROM debian:bookworm-slim
# git: for GitOps-lite (fetch manifests from a repo).
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
COPY ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN mkdir -p /home/kubeui && chown 65534:65534 /home/kubeui
COPY bin/helm /usr/local/bin/helm
COPY bin/kubeui /usr/local/bin/kubeui
ENV HOME=/home/kubeui
EXPOSE 8080
USER 65534:65534
ENTRYPOINT ["kubeui"]
