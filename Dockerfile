FROM node:24-alpine

# Populated by the build pipeline (see Makefile / .github/workflows).
ARG VERSION=dev
ARG REVISION=unknown
ARG CREATED

LABEL org.opencontainers.image.title="wallmanac" \
      org.opencontainers.image.description="Self-hosted wall calendar display: Google Calendar and ICS feeds, keyword styling rules, and Google Tasks on a full-screen dashboard." \
      org.opencontainers.image.source="https://github.com/ccunning/wallmanac" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js calendars.js customEvents.js googleTasks.js ./
COPY public ./public

# Holds the Google Tasks refresh token; docker-compose bind-mounts over it.
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server.js"]
