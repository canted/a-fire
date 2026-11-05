# syntax = docker/dockerfile:1

ARG NODE_IMAGE=node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03

FROM ${NODE_IMAGE} AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y \
  ca-certificates \
  openssl \
  libvips \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack install && pnpm install --frozen-lockfile

FROM deps AS build
WORKDIR /app

COPY . .

# The coordinated cutover ships Expo web with its isolated React runtime.
ARG EXPO_PUBLIC_API_URL
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
RUN pnpm --dir frontend install --frozen-lockfile

ARG VITE_API_BASE_URL
ARG VITE_GRAPHQL_ENDPOINT
ARG VITE_POSTHOG_HOST
ARG VITE_POSTHOG_KEY
ARG VITE_VAPID_PUBLIC_KEY
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_GRAPHQL_ENDPOINT=$VITE_GRAPHQL_ENDPOINT
ENV VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST
ENV VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY
ENV EXPO_PUBLIC_POSTHOG_KEY=$VITE_POSTHOG_KEY
ENV EXPO_PUBLIC_POSTHOG_HOST=$VITE_POSTHOG_HOST
ENV VITE_VAPID_PUBLIC_KEY=$VITE_VAPID_PUBLIC_KEY

RUN pnpm build

FROM deps AS production-deps
WORKDIR /app

COPY server/prisma /app/server/prisma
RUN pnpm prisma:generate && pnpm prune --prod

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y \
  ca-certificates \
  ffmpeg \
  openssl \
  libvips \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY --from=production-deps /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
COPY --from=build /app/public /app/public
COPY --from=build /app/server/prisma /app/server/prisma
COPY package.json ./

EXPOSE 4000
CMD ["node", "dist/server/main.js"]
